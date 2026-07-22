import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
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
	rmdirSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import Database from 'better-sqlite3';
import { assertVaultPathSafe, canonicalVaultLocation } from '../../utils/safe-path.js';

export const WRITE_SET_BACKUP_FORMAT = 'write-set-v1' as const;
const MANIFEST_FILENAME = 'manifest.json';
const PAYLOAD_DIRECTORY = 'payload';

export type WriteSetTargetStrategy = 'content' | 'directory-presence' | 'sqlite';

export interface WriteSetTarget {
	path: string;
	strategy: WriteSetTargetStrategy;
}

export interface WriteSetBackupHooks {
	afterSourceSnapshot?: () => void | Promise<void>;
}

export interface WriteSetBackupOptions {
	vaultRoot: string;
	backupPath: string;
	cutoverId: string;
	targets: readonly WriteSetTarget[];
	contentOverrides?: ReadonlyMap<string, Buffer>;
	retryDelaysMs?: readonly number[];
	hooks?: WriteSetBackupHooks;
	onSqliteRetry?: (attempt: number, error: unknown) => void;
}

export interface WriteSetBackupResult {
	backupSha256: string;
	manifest: WriteSetManifest;
}

type OriginalKind = 'absent' | 'file' | 'directory' | 'symlink';

export interface WriteSetManifestEntry {
	path: string;
	strategy: WriteSetTargetStrategy;
	originalKind: OriginalKind;
	sourceFingerprint?: string;
	restoreFingerprint?: string;
}

export interface WriteSetManifest {
	format: typeof WRITE_SET_BACKUP_FORMAT;
	formatVersion: 1;
	cutoverId: string;
	vaultRoot: string;
	createdAt: string;
	entries: WriteSetManifestEntry[];
}

interface NormalizedTarget extends WriteSetManifestEntry {
	absolutePath: string;
}

export class WriteSetChangedError extends Error {
	readonly changedPaths: string[];

	constructor(changedPaths: string[]) {
		super(`升级写集在切换前发生变化：\n${changedPaths.map((path) => `- ${path}`).join('\n')}`);
		this.name = 'WriteSetChangedError';
		this.changedPaths = changedPaths;
	}
}

class EmptySqliteSnapshotError extends Error {
	constructor(path: string) {
		super(`SQLite 在线备份未生成有效快照：${path}`);
		this.name = 'EmptySqliteSnapshotError';
	}
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function fsyncDirectory(path: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(path, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
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
	if (!stat.isDirectory()) throw new Error(`写集备份包含不支持的文件类型：${path}`);
	for (const entry of readdirSorted(path)) fsyncTree(join(path, entry));
	fsyncDirectory(path);
}

function atomicBuffer(path: string, content: Buffer, mode = 0o600): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', mode);
	try {
		writeFileSync(descriptor, content);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, path);
	fsyncDirectory(dirname(path));
}

function atomicJson(path: string, value: unknown): void {
	atomicBuffer(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf-8'));
}

function portablePath(path: string): string {
	return path.replaceAll('\\', '/');
}

function normalizeRelativePath(
	vaultRoot: string,
	path: string,
): { relativePath: string; absolutePath: string } {
	if (
		!path ||
		path.includes('\0') ||
		isAbsolute(path) ||
		win32.isAbsolute(path) ||
		portablePath(path)
			.split('/')
			.some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error(`写集路径非法：${JSON.stringify(path)}`);
	}
	const root = canonicalVaultLocation(vaultRoot);
	const absolutePath = resolve(root, portablePath(path));
	const parent = dirname(absolutePath);
	// 写集本身可以是符号链接（例如 .claude/skills），但它的父链不能经过符号链接。
	// 只校验父目录，恢复时始终把该路径当作一个节点处理，不会沿链接继续写入。
	if (parent !== root) assertVaultPathSafe(root, parent);
	const relativePath = portablePath(relative(root, absolutePath));
	if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
		throw new Error(`写集路径越界：${path}`);
	}
	return { relativePath, absolutePath };
}

function originalKind(path: string): OriginalKind {
	const stat = lstatIfPresent(path);
	if (!stat) return 'absent';
	if (stat.isSymbolicLink()) return 'symlink';
	if (stat.isFile()) return 'file';
	if (stat.isDirectory()) return 'directory';
	throw new Error(`写集目标不是普通文件、目录或符号链接：${path}`);
}

function normalizeTargets(
	vaultRoot: string,
	targets: readonly WriteSetTarget[],
): NormalizedTarget[] {
	const byPath = new Map<string, NormalizedTarget>();
	for (const target of targets) {
		const normalized = normalizeRelativePath(vaultRoot, target.path);
		const kind = originalKind(normalized.absolutePath);
		if (target.strategy === 'sqlite' && kind !== 'file') {
			throw new Error(`SQLite 写集目标必须是普通文件：${normalized.relativePath}`);
		}
		if (target.strategy === 'directory-presence' && kind !== 'absent' && kind !== 'directory') {
			throw new Error(`目录存在性目标不是普通目录：${normalized.relativePath}`);
		}
		const existing = byPath.get(normalized.relativePath);
		if (existing && existing.strategy !== target.strategy) {
			throw new Error(`写集路径使用了冲突策略：${normalized.relativePath}`);
		}
		byPath.set(normalized.relativePath, {
			path: normalized.relativePath,
			absolutePath: normalized.absolutePath,
			strategy: target.strategy,
			originalKind: kind,
		});
	}
	return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function hashBufferNode(content: Buffer, mode = 0o600): string {
	const hash = createHash('sha256');
	hash.update(`file\0.\0${mode & 0o7777}\0${content.length}\0`);
	hash.update(content);
	hash.update('\0');
	return hash.digest('hex');
}

function nodeFingerprint(path: string): string {
	const root = resolve(path);
	const stat = lstatIfPresent(root);
	if (!stat) return createHash('sha256').update('absent\0').digest('hex');
	const hash = createHash('sha256');
	const visit = (current: string): void => {
		const currentStat = lstatSync(current);
		const rel = portablePath(relative(root, current)) || '.';
		if (currentStat.isSymbolicLink()) {
			hash.update(`link\0${rel}\0${readlinkSync(current)}\0`);
			return;
		}
		if (currentStat.isDirectory()) {
			hash.update(`dir\0${rel}\0${currentStat.mode & 0o7777}\0`);
			for (const entry of readdirSorted(current)) visit(join(current, entry));
			return;
		}
		if (!currentStat.isFile()) throw new Error(`写集包含不支持的文件类型：${current}`);
		const content = readFileSync(current);
		hash.update(`file\0${rel}\0${currentStat.mode & 0o7777}\0${content.length}\0`);
		hash.update(content);
		hash.update('\0');
	};
	visit(root);
	return hash.digest('hex');
}

function directoryPresenceFingerprint(path: string): string {
	const stat = lstatIfPresent(path);
	if (!stat) return 'absent';
	return stat.isDirectory() && !stat.isSymbolicLink() ? 'directory' : 'other';
}

function sourceFingerprint(target: NormalizedTarget): string | undefined {
	if (target.strategy === 'sqlite') return undefined;
	if (target.strategy === 'directory-presence') {
		return directoryPresenceFingerprint(target.absolutePath);
	}
	return nodeFingerprint(target.absolutePath);
}

function payloadPath(backupPath: string, relativePath: string): string {
	return join(backupPath, PAYLOAD_DIRECTORY, ...relativePath.split('/'));
}

function copyNode(source: string, destination: string): void {
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination, {
		recursive: true,
		preserveTimestamps: true,
		errorOnExist: true,
		verbatimSymlinks: true,
	});
}

function quickCheckDatabase(path: string): void {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const rows = db.pragma('quick_check') as Array<Record<string, unknown>>;
		if (rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== 'ok') {
			throw new Error(`SQLite 快照 quick_check 失败：${path}`);
		}
	} finally {
		db.close();
	}
}

function isTransientSqliteError(error: unknown): boolean {
	if (error instanceof EmptySqliteSnapshotError) return true;
	const code = (error as { code?: unknown })?.code;
	return (
		typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'))
	);
}

async function wait(ms: number): Promise<void> {
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function backupSqlite(
	source: string,
	destination: string,
	retryDelaysMs: readonly number[],
	onRetry?: (attempt: number, error: unknown) => void,
): Promise<void> {
	mkdirSync(dirname(destination), { recursive: true });
	const sourceMode = lstatSync(source).mode & 0o7777;
	for (let attempt = 0; ; attempt += 1) {
		const temporary = `${destination}.attempt-${attempt}-${randomUUID()}`;
		let reader: Database.Database | undefined;
		try {
			reader = new Database(source, { readonly: true, fileMustExist: true, timeout: 30_000 });
			const metadata = await reader.backup(temporary);
			reader.close();
			reader = undefined;
			if (metadata.totalPages <= 0 || metadata.remainingPages !== 0 || !existsSync(temporary)) {
				throw new EmptySqliteSnapshotError(source);
			}
			quickCheckDatabase(temporary);
			chmodSync(temporary, sourceMode);
			removeSqliteSidecars(temporary);
			fsyncTree(temporary);
			renameSync(temporary, destination);
			fsyncDirectory(dirname(destination));
			return;
		} catch (error) {
			reader?.close();
			if (existsSync(temporary)) rmSync(temporary, { force: true });
			removeSqliteSidecars(temporary);
			const delay = retryDelaysMs[attempt];
			if (delay === undefined || !isTransientSqliteError(error)) throw error;
			onRetry?.(attempt + 1, error);
			await wait(delay);
		}
	}
}

function treeSha256(root: string): string {
	return nodeFingerprint(root);
}

function validatePayload(
	backupPath: string,
	entry: WriteSetManifestEntry,
	override?: Buffer,
): void {
	if (entry.strategy === 'directory-presence') return;
	const payload = payloadPath(backupPath, entry.path);
	if (entry.originalKind === 'absent') {
		if (lstatIfPresent(payload)) throw new Error(`缺失目标不应存在备份 payload：${entry.path}`);
		return;
	}
	if (!lstatIfPresent(payload)) throw new Error(`写集备份 payload 缺失：${entry.path}`);
	if (entry.strategy === 'sqlite') {
		if (!entry.restoreFingerprint || nodeFingerprint(payload) !== entry.restoreFingerprint) {
			throw new Error(`SQLite 写集快照哈希校验失败：${entry.path}`);
		}
		return;
	}
	const expected = override ? hashBufferNode(override) : entry.restoreFingerprint;
	if (!expected || nodeFingerprint(payload) !== expected) {
		throw new Error(`写集备份 payload 校验失败：${entry.path}`);
	}
}

export async function backupWriteSet(
	options: WriteSetBackupOptions,
): Promise<WriteSetBackupResult> {
	const root = canonicalVaultLocation(options.vaultRoot);
	const backupPath = resolve(options.backupPath);
	if (existsSync(backupPath)) throw new Error('cutover 写集备份已存在');
	const targets = normalizeTargets(root, options.targets);
	const overrides = new Map<string, Buffer>();
	for (const [path, content] of options.contentOverrides ?? []) {
		const normalized = normalizeRelativePath(root, path).relativePath;
		overrides.set(normalized, content);
	}
	for (const path of overrides.keys()) {
		const target = targets.find((candidate) => candidate.path === path);
		if (!target || target.strategy !== 'content' || target.originalKind !== 'file') {
			throw new Error(`备份内容替换不对应现有普通文件：${path}`);
		}
	}

	for (const target of targets) target.sourceFingerprint = sourceFingerprint(target);
	await options.hooks?.afterSourceSnapshot?.();

	try {
		mkdirSync(join(backupPath, PAYLOAD_DIRECTORY), { recursive: true, mode: 0o700 });
		for (const target of targets) {
			if (target.strategy === 'directory-presence' || target.originalKind === 'absent') continue;
			const destination = payloadPath(backupPath, target.path);
			if (target.strategy === 'sqlite') {
				await backupSqlite(
					target.absolutePath,
					destination,
					options.retryDelaysMs ?? [300, 1_000, 3_000],
					options.onSqliteRetry,
				);
			} else {
				copyNode(target.absolutePath, destination);
			}
		}
		for (const [path, content] of overrides) {
			atomicBuffer(payloadPath(backupPath, path), content);
		}

		const changed: string[] = [];
		for (const target of targets) {
			const after = sourceFingerprint(target);
			if (target.strategy !== 'sqlite' && after !== target.sourceFingerprint)
				changed.push(target.path);
		}
		if (changed.length > 0) throw new WriteSetChangedError(changed);

		const manifest: WriteSetManifest = {
			format: WRITE_SET_BACKUP_FORMAT,
			formatVersion: 1,
			cutoverId: options.cutoverId,
			vaultRoot: root,
			createdAt: new Date().toISOString(),
			entries: targets.map(({ path, strategy, originalKind: kind, sourceFingerprint }) => {
				const override = overrides.get(path);
				const restoreFingerprint =
					strategy === 'directory-presence' || kind === 'absent'
						? undefined
						: override
							? hashBufferNode(override)
							: strategy === 'sqlite'
								? nodeFingerprint(payloadPath(backupPath, path))
								: sourceFingerprint;
				return {
					path,
					strategy,
					originalKind: kind,
					...(sourceFingerprint ? { sourceFingerprint } : {}),
					...(restoreFingerprint ? { restoreFingerprint } : {}),
				};
			}),
		};
		for (const entry of manifest.entries)
			validatePayload(backupPath, entry, overrides.get(entry.path));
		atomicJson(join(backupPath, MANIFEST_FILENAME), manifest);
		fsyncTree(backupPath);
		fsyncDirectory(dirname(backupPath));
		return { backupSha256: treeSha256(backupPath), manifest };
	} catch (error) {
		if (existsSync(backupPath)) rmSync(backupPath, { recursive: true, force: true });
		throw error;
	}
}

function readManifest(backupPath: string, cutoverId: string, vaultRoot: string): WriteSetManifest {
	let manifest: WriteSetManifest;
	try {
		manifest = JSON.parse(
			readFileSync(join(backupPath, MANIFEST_FILENAME), 'utf-8'),
		) as WriteSetManifest;
	} catch {
		throw new Error('写集备份 manifest 缺失或不是有效 JSON');
	}
	if (
		manifest.format !== WRITE_SET_BACKUP_FORMAT ||
		manifest.formatVersion !== 1 ||
		manifest.cutoverId !== cutoverId ||
		canonicalVaultLocation(manifest.vaultRoot) !== canonicalVaultLocation(vaultRoot) ||
		!Array.isArray(manifest.entries)
	) {
		throw new Error('写集备份 manifest 身份或格式无效');
	}
	const seen = new Set<string>();
	for (const entry of manifest.entries) {
		if (
			!entry ||
			typeof entry.path !== 'string' ||
			!['content', 'directory-presence', 'sqlite'].includes(entry.strategy) ||
			!['absent', 'file', 'directory', 'symlink'].includes(entry.originalKind) ||
			seen.has(entry.path)
		) {
			throw new Error('写集备份 manifest 条目无效或重复');
		}
		if (
			(entry.sourceFingerprint !== undefined &&
				(typeof entry.sourceFingerprint !== 'string' || !entry.sourceFingerprint)) ||
			(entry.restoreFingerprint !== undefined &&
				(typeof entry.restoreFingerprint !== 'string' || !entry.restoreFingerprint)) ||
			(entry.strategy === 'sqlite' && entry.originalKind !== 'file') ||
			(entry.strategy === 'directory-presence' &&
				entry.originalKind !== 'directory' &&
				entry.originalKind !== 'absent') ||
			(entry.strategy !== 'sqlite' && !entry.sourceFingerprint)
		) {
			throw new Error('写集备份 manifest 条目指纹或策略无效');
		}
		normalizeRelativePath(vaultRoot, entry.path);
		seen.add(entry.path);
	}
	return manifest;
}

export function assertWriteSetBackupIntegrity(options: {
	vaultRoot: string;
	backupPath: string;
	cutoverId: string;
	backupSha256: string;
}): WriteSetManifest {
	if (!/^[a-f0-9]{64}$/.test(options.backupSha256)) {
		throw new Error('cutover 写集备份哈希缺失或非法');
	}
	if (treeSha256(options.backupPath) !== options.backupSha256) {
		throw new Error('cutover 写集备份哈希校验失败');
	}
	const manifest = readManifest(options.backupPath, options.cutoverId, options.vaultRoot);
	for (const entry of manifest.entries) validatePayload(options.backupPath, entry);
	return manifest;
}

export function assertWriteSetSourceUnchanged(options: {
	vaultRoot: string;
	backupPath: string;
	cutoverId: string;
	backupSha256: string;
}): void {
	const manifest = assertWriteSetBackupIntegrity(options);
	const changed: string[] = [];
	for (const entry of manifest.entries) {
		if (entry.strategy === 'sqlite') continue;
		const target = normalizeRelativePath(options.vaultRoot, entry.path).absolutePath;
		const current =
			entry.strategy === 'directory-presence'
				? directoryPresenceFingerprint(target)
				: nodeFingerprint(target);
		if (current !== entry.sourceFingerprint) changed.push(entry.path);
	}
	if (changed.length > 0) throw new WriteSetChangedError(changed);
}

function removeIfPresent(path: string): boolean {
	const stat = lstatIfPresent(path);
	if (!stat) return false;
	rmSync(path, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
	return true;
}

function restoreNode(
	payload: string,
	target: string,
	cutoverId: string,
	beforeReplace?: () => void,
): void {
	mkdirSync(dirname(target), { recursive: true });
	const staging = join(dirname(target), `.${basename(target)}.lifeos-restore-${cutoverId}`);
	const displaced = join(dirname(target), `.${basename(target)}.lifeos-previous-${cutoverId}`);
	removeIfPresent(staging);
	copyNode(payload, staging);
	fsyncTree(staging);
	fsyncDirectory(dirname(target));
	removeIfPresent(displaced);
	beforeReplace?.();
	if (lstatIfPresent(target)) renameSync(target, displaced);
	try {
		renameSync(staging, target);
		fsyncDirectory(dirname(target));
	} catch (error) {
		if (!lstatIfPresent(target) && lstatIfPresent(displaced)) renameSync(displaced, target);
		throw error;
	}
	removeIfPresent(displaced);
	fsyncDirectory(dirname(target));
}

function removeSqliteSidecars(path: string): void {
	let removed = false;
	for (const suffix of ['-wal', '-shm', '-journal']) {
		removed = removeIfPresent(`${path}${suffix}`) || removed;
	}
	if (removed) fsyncDirectory(dirname(path));
}

function restoreManifestEntry(
	vaultRoot: string,
	backupPath: string,
	cutoverId: string,
	entry: WriteSetManifestEntry,
): void {
	const target = normalizeRelativePath(vaultRoot, entry.path).absolutePath;
	if (entry.strategy === 'directory-presence') return;
	if (entry.originalKind === 'absent') {
		if (removeIfPresent(target)) fsyncDirectory(dirname(target));
		return;
	}
	const payload = payloadPath(backupPath, entry.path);
	if (nodeFingerprint(target) !== nodeFingerprint(payload)) {
		restoreNode(
			payload,
			target,
			cutoverId,
			entry.strategy === 'sqlite' ? () => removeSqliteSidecars(target) : undefined,
		);
	} else {
		if (entry.strategy === 'sqlite') removeSqliteSidecars(target);
		// 上次进程可能已完成替换，但尚未来得及清理确定性 staging/previous。
		removeIfPresent(join(dirname(target), `.${basename(target)}.lifeos-restore-${cutoverId}`));
		removeIfPresent(join(dirname(target), `.${basename(target)}.lifeos-previous-${cutoverId}`));
		fsyncDirectory(dirname(target));
	}
	if (entry.strategy === 'sqlite') {
		removeSqliteSidecars(target);
		quickCheckDatabase(target);
	}
}

function restoreDirectoryPresence(vaultRoot: string, entry: WriteSetManifestEntry): void {
	const target = normalizeRelativePath(vaultRoot, entry.path).absolutePath;
	if (entry.originalKind === 'directory') {
		const stat = lstatIfPresent(target);
		if (!stat) {
			mkdirSync(target, { recursive: true });
			fsyncDirectory(dirname(target));
		} else if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(`恢复目录被非普通目录占用：${entry.path}`);
		}
		return;
	}
	if (entry.originalKind !== 'absent') return;
	const stat = lstatIfPresent(target);
	if (stat?.isDirectory() && !stat.isSymbolicLink() && readdirSync(target).length === 0) {
		rmdirSync(target);
		fsyncDirectory(dirname(target));
	}
}

export function restoreWriteSet(options: {
	vaultRoot: string;
	backupPath: string;
	cutoverId: string;
	backupSha256: string;
}): void {
	const manifest = assertWriteSetBackupIntegrity(options);
	for (const entry of manifest.entries) {
		if (entry.strategy !== 'directory-presence') {
			restoreManifestEntry(options.vaultRoot, options.backupPath, options.cutoverId, entry);
		}
	}
	for (const entry of [...manifest.entries]
		.filter((candidate) => candidate.strategy === 'directory-presence')
		.sort((left, right) => right.path.split('/').length - left.path.split('/').length)) {
		restoreDirectoryPresence(options.vaultRoot, entry);
	}
}

export function assertWriteSetRestored(options: {
	vaultRoot: string;
	backupPath: string;
	cutoverId: string;
	backupSha256: string;
}): void {
	const manifest = assertWriteSetBackupIntegrity(options);
	for (const entry of manifest.entries) {
		const target = normalizeRelativePath(options.vaultRoot, entry.path).absolutePath;
		if (entry.strategy === 'directory-presence') {
			if (entry.originalKind === 'directory' && originalKind(target) !== 'directory') {
				throw new Error(`恢复后的目录缺失：${entry.path}`);
			}
			continue;
		}
		if (entry.originalKind === 'absent') {
			if (lstatIfPresent(target)) throw new Error(`恢复后应不存在写集目标：${entry.path}`);
			continue;
		}
		const payload = payloadPath(options.backupPath, entry.path);
		if (nodeFingerprint(target) !== nodeFingerprint(payload)) {
			throw new Error(`恢复后的写集目标与备份不一致：${entry.path}`);
		}
		if (entry.strategy === 'sqlite') quickCheckDatabase(target);
	}
}

function readdirSorted(path: string): string[] {
	return readdirSync(path).sort((left, right) => left.localeCompare(right));
}
