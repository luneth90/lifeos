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
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { cutoverRoot } from '../../cutover-lock.js';

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
}

function atomicJson(path: string, value: unknown): void {
	const temporary = `${path}.tmp-${process.pid}`;
	const descriptor = openSync(temporary, 'w', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, path);
	if (process.platform !== 'win32') {
		const directoryDescriptor = openSync(dirname(path), 'r');
		try {
			fsyncSync(directoryDescriptor);
		} finally {
			closeSync(directoryDescriptor);
		}
	}
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
	const root = resolve(vaultRoot);
	const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	const dir = join(cutoverRoot(root), id);
	const backup = join(dir, 'vault');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
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

export function backupVault(journal: CutoverJournal): void {
	if (existsSync(journal.backup_path)) throw new Error('cutover backup 已存在');
	const sourceHash = treeSha256(journal.vault_root);
	cpSync(journal.vault_root, journal.backup_path, {
		recursive: true,
		preserveTimestamps: true,
		errorOnExist: true,
	});
	const finalSourceHash = treeSha256(journal.vault_root);
	const backupHash = treeSha256(journal.backup_path);
	if (sourceHash !== finalSourceHash || sourceHash !== backupHash) {
		throw new Error('Vault 在备份期间发生变化，拒绝进入切换阶段');
	}
	journal.backup_sha256 = backupHash;
}

export function restoreVault(journal: CutoverJournal): void {
	const root = resolve(journal.vault_root);
	const backup = resolve(journal.backup_path);
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
	if (!existsSync(root) || existsSync(staging) || existsSync(displaced)) {
		throw new Error('Vault 原子恢复路径状态异常，需要手工恢复');
	}
	try {
		cpSync(backup, staging, { recursive: true, preserveTimestamps: true, errorOnExist: true });
		if (treeSha256(staging) !== journal.backup_sha256) {
			throw new Error('恢复 staging 哈希校验失败');
		}
	} catch (error) {
		if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
		throw error;
	}

	renameSync(root, displaced);
	try {
		renameSync(staging, root);
	} catch (error) {
		renameSync(displaced, root);
		throw error;
	}
	if (treeSha256(root) !== journal.backup_sha256) {
		const invalid = `${staging}.invalid`;
		renameSync(root, invalid);
		renameSync(displaced, root);
		throw new Error(`恢复后哈希校验失败；无效副本保留于 ${invalid}`);
	}
	try {
		rmSync(displaced, { recursive: true, force: true });
	} catch {
		// Vault 已完成原子恢复；旧工作副本保留供人工清理。
	}
}

export function readCutoverJournal(path: string): CutoverJournal {
	return JSON.parse(readFileSync(path, 'utf-8')) as CutoverJournal;
}

function treeSha256(root: string): string {
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
		const content = readFileSync(path);
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
