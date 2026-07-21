import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { canonicalVaultLocation } from './utils/safe-path.js';

export interface CutoverLock {
	token: string;
	vault_root: string;
	cutover_id?: string;
	pid: number;
	created_at: string;
}

interface RecoveryClaim {
	token: string;
	pid: number;
	created_at: string;
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

export function isValidCutoverId(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes('..');
}

function vaultId(vaultRoot: string): string {
	return `${basename(vaultRoot)}-${createHash('sha256')
		.update(vaultRoot)
		.digest('hex')
		.slice(0, 12)}`;
}

export function cutoverRoot(vaultRoot: string): string {
	const root = canonicalVaultLocation(vaultRoot);
	const container = join(dirname(root), '.lifeos-cutovers');
	const directory = join(container, vaultId(root));
	for (const path of [container, directory]) {
		const stat = lstatIfPresent(path);
		if (!stat) continue;
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(`cutover 目录不安全：${path}`);
		}
	}
	return directory;
}

export function cutoverLockPath(vaultRoot: string): string {
	return join(cutoverRoot(vaultRoot), 'active.lock');
}

function recoveryClaimPath(vaultRoot: string): string {
	return join(cutoverRoot(vaultRoot), '.active.lock.claim');
}

function fsyncParent(path: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(dirname(path), 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

export function readCutoverLock(vaultRoot: string): CutoverLock | null {
	const path = cutoverLockPath(vaultRoot);
	const lockStat = lstatIfPresent(path);
	if (!lockStat) return null;
	try {
		if (lockStat.isSymbolicLink() || !lockStat.isFile()) throw new Error('invalid lock file');
		const lock = JSON.parse(readFileSync(path, 'utf-8')) as CutoverLock;
		const root = canonicalVaultLocation(vaultRoot);
		if (
			typeof lock.token !== 'string' ||
			!lock.token ||
			!Number.isSafeInteger(lock.pid) ||
			lock.pid <= 0 ||
			(lock.cutover_id !== undefined &&
				(typeof lock.cutover_id !== 'string' || !isValidCutoverId(lock.cutover_id))) ||
			canonicalVaultLocation(lock.vault_root) !== root
		) {
			throw new Error('invalid lock');
		}
		return lock;
	} catch {
		throw new Error(`cutover lock 损坏：${path}`);
	}
}

function processIsAlive(pid: number): boolean {
	if (pid === process.pid) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		// EPERM 等错误表示进程存在但当前用户无权发送信号；安全起见视为活动。
		return true;
	}
}

function readRecoveryClaim(path: string): RecoveryClaim {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`恢复 claim 不安全：${path}`);
	let claim: RecoveryClaim;
	try {
		claim = JSON.parse(readFileSync(path, 'utf-8')) as RecoveryClaim;
	} catch {
		throw new Error(`恢复 claim 损坏：${path}`);
	}
	if (
		typeof claim.token !== 'string' ||
		!claim.token ||
		!Number.isSafeInteger(claim.pid) ||
		claim.pid <= 0 ||
		typeof claim.created_at !== 'string' ||
		!claim.created_at
	) {
		throw new Error(`恢复 claim 损坏：${path}`);
	}
	return claim;
}

function createRecoveryClaim(vaultRoot: string): RecoveryClaim {
	const path = recoveryClaimPath(vaultRoot);
	const claim: RecoveryClaim = {
		token: randomUUID(),
		pid: process.pid,
		created_at: new Date().toISOString(),
	};
	let descriptor: number;
	try {
		descriptor = openSync(path, 'wx', 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		const observed = readRecoveryClaim(path);
		if (processIsAlive(observed.pid)) {
			throw new Error(`另一个恢复进程正在接管 cutover lock（pid=${observed.pid}）`);
		}
		throw new Error(
			`检测到上次恢复遗留的安全 claim：${path}；为避免并发覆盖，已保留现场并拒绝自动删除`,
		);
	}
	try {
		writeFileSync(descriptor, `${JSON.stringify(claim, null, 2)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	fsyncParent(path);
	return claim;
}

function assertRecoveryClaimOwner(vaultRoot: string, token: string): void {
	const claim = readRecoveryClaim(recoveryClaimPath(vaultRoot));
	if (claim.token !== token || claim.pid !== process.pid) {
		throw new Error('cutover 恢复 claim 已被其他进程接管');
	}
}

function releaseRecoveryClaim(vaultRoot: string, token: string): void {
	const path = recoveryClaimPath(vaultRoot);
	let claim: RecoveryClaim;
	try {
		claim = readRecoveryClaim(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}
	if (claim.token !== token || claim.pid !== process.pid) return;
	unlinkSync(path);
	fsyncParent(path);
}

function atomicLock(path: string, lock: CutoverLock): void {
	const temporary = `${path}.tmp-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, path);
	fsyncParent(path);
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
	const root = canonicalVaultLocation(vaultRoot);
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
	fsyncParent(path);
	return lock;
}

/**
 * 为显式恢复取得独占写闸。活动 owner 永不被接管；仅允许接管 owner 已退出且尚未绑定，
 * 或已绑定到同一 cutover 的锁。claim 文件把并发恢复串行化，替换期间 active.lock 始终存在。
 */
export function claimCutoverLock(vaultRoot: string, cutoverId: string): CutoverLock {
	if (!isValidCutoverId(cutoverId)) throw new Error('cutover id 非法');
	const root = canonicalVaultLocation(vaultRoot);
	const existing = readCutoverLock(root);
	if (!existing) {
		const acquired = acquireCutoverLock(root);
		return bindCutoverLock(root, acquired.token, cutoverId);
	}
	const claim = createRecoveryClaim(root);
	try {
		assertRecoveryClaimOwner(root, claim.token);
		const current = readCutoverLock(root);
		if (!current) throw new Error('cutover lock 在恢复接管期间消失');
		if (current.token !== existing.token) {
			throw new Error('cutover lock 在恢复接管前已被其他进程替换');
		}
		if (processIsAlive(current.pid)) {
			throw new Error(`cutover lock 仍由活动进程持有（pid=${current.pid}）`);
		}
		if (current.cutover_id && current.cutover_id !== cutoverId) {
			throw new Error(`当前写闸属于其他 cutover：${current.cutover_id}`);
		}
		assertRecoveryClaimOwner(root, claim.token);
		const latest = readCutoverLock(root);
		if (!latest || latest.token !== current.token) {
			throw new Error('cutover lock 在恢复接管期间发生变化');
		}
		const updated: CutoverLock = {
			token: randomUUID(),
			vault_root: root,
			cutover_id: cutoverId,
			pid: process.pid,
			created_at: new Date().toISOString(),
		};
		atomicLock(cutoverLockPath(root), updated);
		assertRecoveryClaimOwner(root, claim.token);
		const verified = readCutoverLock(root);
		if (!verified || verified.token !== updated.token || verified.pid !== process.pid) {
			throw new Error('cutover lock 恢复接管校验失败');
		}
		return updated;
	} finally {
		releaseRecoveryClaim(root, claim.token);
	}
}

export function bindCutoverLock(vaultRoot: string, token: string, cutoverId: string): CutoverLock {
	if (!isValidCutoverId(cutoverId)) throw new Error('cutover id 非法');
	const path = cutoverLockPath(vaultRoot);
	const lock = readCutoverLock(vaultRoot);
	if (!lock || lock.token !== token) throw new Error('拒绝绑定不属于当前切换的 cutover lock');
	if (lock.cutover_id && lock.cutover_id !== cutoverId) {
		throw new Error('cutover lock 已绑定其他切换');
	}
	const updated = { ...lock, cutover_id: cutoverId };
	atomicLock(path, updated);
	return updated;
}

export function releaseCutoverLock(vaultRoot: string, token: string): void {
	const path = cutoverLockPath(vaultRoot);
	const lock = readCutoverLock(vaultRoot);
	if (!lock) return;
	if (lock.token !== token) throw new Error('拒绝释放不属于当前切换的 cutover lock');
	const released = `${path}.released-${randomUUID()}`;
	renameSync(path, released);
	unlinkSync(released);
	fsyncParent(path);
}
