import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	cpSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { cutoverRoot, isValidCutoverId } from '../../cutover-lock.js';
import { canonicalVaultLocation, canonicalVaultRoot } from '../../utils/safe-path.js';

export type CutoverState =
	| 'preparing'
	| 'prepared'
	| 'files_installed'
	| 'db_committed'
	| 'verified'
	| 'opened'
	| 'restored';

export interface CutoverJournal {
	cutover_id: string;
	vault_root: string;
	contract_version: 2;
	schema_version: 4;
	from_version: string;
	to_version: string;
	prepared_at: string;
	package_sha256: string;
	state: CutoverState;
	backup_path: string;
	backup_sha256?: string;
	error?: string;
	backup_receipt_detached?: boolean;
}

export interface BackupVaultOptions {
	runtimeReceiptPath?: string;
}

interface RuntimeReceiptOverride {
	relativePath: string;
	value: Record<string, unknown>;
	content: Buffer;
}

function fsyncDirectory(path: string): void {
	if (process.platform === 'win32') return;
	const directoryDescriptor = openSync(path, 'r');
	try {
		fsyncSync(directoryDescriptor);
	} finally {
		closeSync(directoryDescriptor);
	}
}

function fsyncTree(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return;
	if (stat.isFile()) {
		const descriptor = openSync(path, 'r');
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
		return;
	}
	if (!stat.isDirectory()) throw new Error(`cutover 包含不支持的文件类型：${path}`);
	for (const entry of readdirSorted(path)) fsyncTree(join(path, entry));
	fsyncDirectory(path);
}

function atomicJson(path: string, value: unknown): void {
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, path);
	fsyncDirectory(dirname(path));
}

const CUTOVER_TRANSITIONS: Record<CutoverState, ReadonlySet<CutoverState>> = {
	preparing: new Set(['prepared', 'restored']),
	prepared: new Set(['files_installed', 'restored']),
	files_installed: new Set(['db_committed', 'restored']),
	db_committed: new Set(['verified', 'restored']),
	verified: new Set(['opened', 'restored']),
	opened: new Set(['restored']),
	restored: new Set(),
};

export function createCutover(
	vaultRoot: string,
	fromVersion: string,
	toVersion: string,
	packageSha256: string,
): { dir: string; journalPath: string; journal: CutoverJournal } {
	const root = canonicalVaultRoot(vaultRoot);
	const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	const cutovers = cutoverRoot(root);
	mkdirSync(cutovers, { recursive: true, mode: 0o700 });
	fsyncDirectory(cutovers);
	fsyncDirectory(dirname(cutovers));
	fsyncDirectory(dirname(dirname(cutovers)));
	const dir = join(cutovers, id);
	const backup = join(dir, 'vault');
	mkdirSync(dir, { recursive: false, mode: 0o700 });
	fsyncDirectory(dir);
	fsyncDirectory(cutovers);
	const journal: CutoverJournal = {
		cutover_id: id,
		vault_root: root,
		contract_version: 2,
		schema_version: 4,
		from_version: fromVersion,
		to_version: toVersion,
		prepared_at: new Date().toISOString(),
		package_sha256: packageSha256,
		state: 'preparing',
		backup_path: backup,
	};
	const journalPath = join(dir, 'journal.json');
	atomicJson(journalPath, journal);
	return { dir, journalPath, journal };
}

export function advanceCutover(
	path: string,
	journal: CutoverJournal,
	state: CutoverState,
	error?: string,
): void {
	if (!CUTOVER_TRANSITIONS[journal.state].has(state)) {
		throw new Error(`非法 cutover 状态转换：${journal.state} → ${state}`);
	}
	journal.state = state;
	if (error) journal.error = error;
	atomicJson(path, journal);
}

function standaloneRuntimeReceiptOverride(
	journal: CutoverJournal,
	path: string | undefined,
): RuntimeReceiptOverride | null {
	if (!path || !existsSync(path)) return null;
	const root = resolve(journal.vault_root);
	const requested = resolve(path);
	const relativePath = relative(root, requested).replace(/\\/g, '/');
	if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
		throw new Error('runtime receipt 必须位于待备份 Vault 内');
	}
	const stat = lstatSync(requested);
	if (stat.isSymbolicLink() || !stat.isFile() || realpathSync.native(requested) !== requested) {
		throw new Error('runtime receipt 必须是 Vault 内普通文件');
	}
	let source: Record<string, unknown>;
	try {
		source = JSON.parse(readFileSync(requested, 'utf-8')) as Record<string, unknown>;
	} catch {
		throw new Error('runtime receipt 不是有效 JSON');
	}
	if (
		source.contract_version !== 2 ||
		source.schema_version !== 4 ||
		(source.kind !== 'fresh-install' && source.kind !== 'upgrade') ||
		source.state !== 'opened' ||
		typeof source.runtime_version !== 'string' ||
		typeof source.installed_at !== 'string' ||
		typeof source.package_sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/.test(source.package_sha256)
	) {
		throw new Error('runtime receipt 无法转换为独立回滚收据');
	}
	if (source.kind === 'fresh-install') return null;
	const value = Object.fromEntries(
		Object.entries(source).filter(([key]) => key !== 'journal_path' && key !== 'cutover_id'),
	);
	value.kind = 'fresh-install';
	const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf-8');
	return { relativePath, value, content };
}

export function backupVault(journal: CutoverJournal, options: BackupVaultOptions = {}): void {
	if (existsSync(journal.backup_path)) throw new Error('cutover backup 已存在');
	const receiptOverride = standaloneRuntimeReceiptOverride(journal, options.runtimeReceiptPath);
	const sourceHash = treeSha256(journal.vault_root);
	cpSync(journal.vault_root, journal.backup_path, {
		recursive: true,
		preserveTimestamps: true,
		errorOnExist: true,
		verbatimSymlinks: true,
	});
	if (receiptOverride) {
		atomicJson(join(journal.backup_path, receiptOverride.relativePath), receiptOverride.value);
	}
	fsyncTree(journal.backup_path);
	fsyncDirectory(dirname(journal.backup_path));
	const finalSourceHash = treeSha256(journal.vault_root);
	const expectedBackupHash = treeSha256(
		journal.vault_root,
		receiptOverride
			? new Map([[receiptOverride.relativePath, receiptOverride.content]])
			: undefined,
	);
	const backupHash = treeSha256(journal.backup_path);
	if (sourceHash !== finalSourceHash || expectedBackupHash !== backupHash) {
		throw new Error('Vault 在备份期间发生变化，拒绝进入切换阶段');
	}
	journal.backup_sha256 = backupHash;
	journal.backup_receipt_detached = receiptOverride !== null;
}

function controlledBackup(journal: CutoverJournal): { root: string; backup: string } {
	if (!isValidCutoverId(journal.cutover_id)) throw new Error('cutover id 非法');
	const root = canonicalVaultLocation(journal.vault_root);
	if (root !== resolve(journal.vault_root))
		throw new Error('cutover Vault 根目录必须是规范真实路径');
	const expectedBackup = join(cutoverRoot(root), journal.cutover_id, 'vault');
	const requestedBackup = resolve(journal.backup_path);
	if (requestedBackup !== expectedBackup) throw new Error('cutover backup 不在受控目录');
	if (!existsSync(requestedBackup)) throw new Error('cutover backup 不存在');
	const backupStat = lstatSync(requestedBackup);
	if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) {
		throw new Error('cutover backup 不是安全目录');
	}
	const backup = realpathSync.native(requestedBackup);
	if (backup !== expectedBackup) throw new Error('cutover backup 真实路径不匹配');
	return { root, backup };
}

function ordinaryDirectoryExists(path: string, label: string): boolean {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(`${label} 不是安全目录：${path}`);
		}
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

export function restoreVault(journal: CutoverJournal): void {
	const { root, backup } = controlledBackup(journal);
	const relativeBackup = relative(root, backup);
	if (!existsSync(join(backup, 'lifeos.yaml')) || !journal.backup_sha256) {
		throw new Error('cutover backup 无效');
	}
	if (
		!isAbsolute(root) ||
		!isAbsolute(backup) ||
		relativeBackup === '' ||
		!relativeBackup.startsWith('..')
	) {
		throw new Error('拒绝从 Vault 内部恢复');
	}
	if (treeSha256(backup) !== journal.backup_sha256) {
		throw new Error('cutover backup 哈希校验失败');
	}
	const parent = dirname(root);
	const name = basename(root);
	const staging = join(parent, `.${name}.restore-${journal.cutover_id}`);
	const displaced = join(parent, `.${name}.previous-${journal.cutover_id}`);
	let rootExists = ordinaryDirectoryExists(root, 'Vault');
	let stagingExists = ordinaryDirectoryExists(staging, '恢复 staging');
	let displacedExists = ordinaryDirectoryExists(displaced, '恢复 previous');

	// 上次进程可能在两次 rename 之间退出。优先完成已经校验过的 staging 切换。
	if (!rootExists && stagingExists) {
		if (treeSha256(staging) !== journal.backup_sha256) {
			throw new Error('残留恢复 staging 哈希校验失败');
		}
		fsyncTree(staging);
		fsyncDirectory(parent);
		renameSync(staging, root);
		fsyncDirectory(parent);
		rootExists = true;
		stagingExists = false;
	}
	// 若 staging 丢失但 previous 仍在，先恢复原工作副本，再重新执行完整恢复。
	if (!rootExists && displacedExists) {
		renameSync(displaced, root);
		fsyncDirectory(parent);
		rootExists = true;
		displacedExists = false;
	}
	if (!rootExists) throw new Error('Vault 与恢复残留均不存在，需要手工恢复');
	if (!stagingExists && !displacedExists && treeSha256(root) === journal.backup_sha256) {
		return;
	}

	// staging 已换入、previous 尚未清理时，校验完成即可收尾。
	if (displacedExists) {
		if (treeSha256(root) !== journal.backup_sha256) {
			throw new Error('恢复残留状态冲突；当前 Vault 与 backup 哈希不一致');
		}
		fsyncTree(root);
		fsyncDirectory(parent);
		if (stagingExists) {
			if (treeSha256(staging) !== journal.backup_sha256) {
				throw new Error('恢复残留 staging 哈希校验失败');
			}
			rmSync(staging, { recursive: true, force: true });
		}
		rmSync(displaced, { recursive: true, force: true });
		fsyncDirectory(parent);
		return;
	}

	if (!stagingExists) {
		try {
			cpSync(backup, staging, {
				recursive: true,
				preserveTimestamps: true,
				errorOnExist: true,
				verbatimSymlinks: true,
			});
		} catch (error) {
			if (ordinaryDirectoryExists(staging, '恢复 staging')) {
				rmSync(staging, { recursive: true, force: true });
			}
			throw error;
		}
		stagingExists = true;
	}
	fsyncTree(staging);
	fsyncDirectory(parent);
	if (!stagingExists || treeSha256(staging) !== journal.backup_sha256) {
		if (ordinaryDirectoryExists(staging, '恢复 staging')) {
			rmSync(staging, { recursive: true, force: true });
		}
		throw new Error('恢复 staging 哈希校验失败');
	}

	renameSync(root, displaced);
	fsyncDirectory(parent);
	try {
		renameSync(staging, root);
		fsyncDirectory(parent);
	} catch (error) {
		renameSync(displaced, root);
		fsyncDirectory(parent);
		throw error;
	}
	if (treeSha256(root) !== journal.backup_sha256) {
		const invalid = `${staging}.invalid-${randomUUID()}`;
		renameSync(root, invalid);
		renameSync(displaced, root);
		fsyncDirectory(parent);
		throw new Error(`恢复后哈希校验失败；无效副本保留于 ${invalid}`);
	}
	rmSync(displaced, { recursive: true, force: true });
	fsyncDirectory(parent);
}

export function assertVaultMatchesCutoverBackup(journal: CutoverJournal): void {
	if (!/^[a-f0-9]{64}$/.test(journal.backup_sha256 ?? '')) {
		throw new Error('cutover backup 哈希缺失或非法');
	}
	const { root, backup } = controlledBackup(journal);
	if (treeSha256(backup) !== journal.backup_sha256) {
		throw new Error('cutover backup 哈希校验失败');
	}
	if (treeSha256(root) !== journal.backup_sha256) {
		throw new Error('恢复后的 Vault 与 cutover backup 哈希不一致');
	}
}

export function readCutoverJournal(path: string): CutoverJournal {
	return JSON.parse(readFileSync(path, 'utf-8')) as CutoverJournal;
}

function controlledCutoverBundle(
	vaultRoot: string,
	cutoverId: string,
): { bundlePath: string; journal: CutoverJournal } {
	if (!isValidCutoverId(cutoverId)) throw new Error('cutover id 非法');
	const root = canonicalVaultLocation(vaultRoot);
	const bundlePath = join(cutoverRoot(root), cutoverId);
	const bundleStat = lstatSync(bundlePath);
	if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory()) {
		throw new Error(`cutover bundle 不是安全目录：${bundlePath}`);
	}
	if (realpathSync.native(bundlePath) !== bundlePath) {
		throw new Error(`cutover bundle 路径经过符号链接：${bundlePath}`);
	}
	const journalPath = join(bundlePath, 'journal.json');
	const journalStat = lstatSync(journalPath);
	if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
		throw new Error(`cutover journal 不是普通文件：${journalPath}`);
	}
	const journal = readCutoverJournal(journalPath);
	if (
		journal.cutover_id !== cutoverId ||
		canonicalVaultLocation(journal.vault_root) !== root ||
		resolve(journal.backup_path) !== join(bundlePath, 'vault')
	) {
		throw new Error(`cutover bundle 身份校验失败：${bundlePath}`);
	}
	return { bundlePath, journal };
}

export function retainOnlyCutoverBundle(vaultRoot: string, keepCutoverId: string): string[] {
	const root = canonicalVaultLocation(vaultRoot);
	const directory = cutoverRoot(root);
	const keep = controlledCutoverBundle(root, keepCutoverId);
	if (!/^[a-f0-9]{64}$/.test(keep.journal.backup_sha256 ?? '')) {
		throw new Error('保留的 cutover backup 哈希缺失或非法');
	}
	const { backup } = controlledBackup(keep.journal);
	if (treeSha256(backup) !== keep.journal.backup_sha256) {
		throw new Error('保留的 cutover backup 哈希校验失败');
	}
	const removed: string[] = [];
	for (const entry of readdirSorted(directory)) {
		if (entry === 'active.lock' || entry === keepCutoverId || !isValidCutoverId(entry)) continue;
		const candidate = controlledCutoverBundle(root, entry);
		rmSync(candidate.bundlePath, { recursive: true });
		removed.push(entry);
	}
	fsyncDirectory(directory);
	return removed;
}

export function discardCutoverBundle(vaultRoot: string, cutoverId: string): void {
	const root = canonicalVaultLocation(vaultRoot);
	const { bundlePath } = controlledCutoverBundle(root, cutoverId);
	rmSync(bundlePath, { recursive: true });
	fsyncDirectory(cutoverRoot(root));
}

function treeSha256(root: string, contentOverrides?: ReadonlyMap<string, Buffer>): string {
	const base = resolve(root);
	const hash = createHash('sha256');
	const visit = (path: string): void => {
		const stat = lstatSync(path);
		const rel = relative(base, path).replace(/\\/g, '/') || '.';
		if (stat.isSymbolicLink()) {
			hash.update(`link\0${rel}\0${readlinkSync(path)}\0`);
			return;
		}
		if (stat.isDirectory()) {
			hash.update(`dir\0${rel}\0`);
			for (const entry of readdirSorted(path)) visit(join(path, entry));
			return;
		}
		if (!stat.isFile()) throw new Error(`Vault 包含不支持的文件类型：${path}`);
		const content = contentOverrides?.get(rel) ?? readFileSync(path);
		hash.update(`file\0${rel}\0${content.length}\0`);
		hash.update(content);
		hash.update('\0');
	};
	visit(base);
	return hash.digest('hex');
}

function readdirSorted(path: string): string[] {
	return readdirSync(path).sort((a, b) => a.localeCompare(b));
}
