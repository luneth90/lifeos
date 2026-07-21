import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface CutoverLock {
	token: string;
	vault_root: string;
	pid: number;
	created_at: string;
}

function vaultId(vaultRoot: string): string {
	return `${basename(vaultRoot)}-${createHash('sha256')
		.update(resolve(vaultRoot))
		.digest('hex')
		.slice(0, 12)}`;
}

export function cutoverRoot(vaultRoot: string): string {
	const root = resolve(vaultRoot);
	return join(dirname(root), '.lifeos-cutovers', vaultId(root));
}

export function cutoverLockPath(vaultRoot: string): string {
	return join(cutoverRoot(vaultRoot), 'active.lock');
}

export function readCutoverLock(vaultRoot: string): CutoverLock | null {
	const path = cutoverLockPath(vaultRoot);
	if (!existsSync(path)) return null;
	try {
		const lock = JSON.parse(readFileSync(path, 'utf-8')) as CutoverLock;
		if (
			!lock.token ||
			!Number.isInteger(lock.pid) ||
			resolve(lock.vault_root) !== resolve(vaultRoot)
		) {
			throw new Error('invalid lock');
		}
		return lock;
	} catch {
		throw new Error(`cutover lock 损坏：${path}`);
	}
}

export function assertNoActiveCutover(vaultRoot: string): void {
	const lock = readCutoverLock(vaultRoot);
	if (lock) {
		throw new Error(
			`LifeOS cutover 写闸已关闭（pid=${lock.pid}，${lock.created_at}）；请完成或恢复该切换`,
		);
	}
}

export function acquireCutoverLock(vaultRoot: string): CutoverLock {
	const root = resolve(vaultRoot);
	const directory = cutoverRoot(root);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = cutoverLockPath(root);
	const lock: CutoverLock = {
		token: randomUUID(),
		vault_root: root,
		pid: process.pid,
		created_at: new Date().toISOString(),
	};
	let descriptor: number;
	try {
		descriptor = openSync(path, 'wx', 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			const existing = readCutoverLock(root);
			throw new Error(
				`已有未完成的 LifeOS cutover${existing ? `（pid=${existing.pid}）` : ''}；请先恢复`,
			);
		}
		throw error;
	}
	try {
		writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	return lock;
}

export function releaseCutoverLock(vaultRoot: string, token: string): void {
	const path = cutoverLockPath(vaultRoot);
	const lock = readCutoverLock(vaultRoot);
	if (!lock) return;
	if (lock.token !== token) throw new Error('拒绝释放不属于当前切换的 cutover lock');
	const released = `${path}.released-${process.pid}`;
	renameSync(path, released);
	unlinkSync(released);
}

export function clearCutoverLockForRecovery(vaultRoot: string): void {
	const path = cutoverLockPath(vaultRoot);
	if (!existsSync(path)) return;
	readCutoverLock(vaultRoot);
	unlinkSync(path);
}
