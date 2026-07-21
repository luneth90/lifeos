import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	acquireCutoverLock,
	bindCutoverLock,
	claimCutoverLock,
	cutoverLockPath,
	cutoverRoot,
	readCutoverLock,
	releaseCutoverLock,
} from '../src/cutover-lock.js';

function exitedChildPid(): number {
	const child = spawnSync(process.execPath, ['-e', '']);
	if (!child.pid) throw new Error('测试无法取得已退出子进程 PID');
	return child.pid;
}

describe('cutover lock 的 Vault 身份', () => {
	it.skipIf(process.platform === 'win32')('真实路径与符号链接别名必须共用同一个写闸', () => {
		const parent = mkdtempSync(join(tmpdir(), 'lifeos-cutover-alias-'));
		const vaultRoot = join(parent, 'vault');
		const vaultAlias = join(parent, 'vault-alias');
		mkdirSync(vaultRoot);
		symlinkSync(vaultRoot, vaultAlias, 'dir');

		const lock = acquireCutoverLock(vaultRoot);
		try {
			expect(cutoverLockPath(vaultAlias)).toBe(cutoverLockPath(vaultRoot));
			expect(() => acquireCutoverLock(vaultAlias)).toThrow(/已有未完成的 LifeOS cutover/);
		} finally {
			releaseCutoverLock(vaultAlias, lock.token);
			expect(existsSync(cutoverLockPath(vaultRoot))).toBe(false);
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it('只接管 owner 已退出且属于同一 cutover 的写闸', () => {
		const parent = mkdtempSync(join(tmpdir(), 'lifeos-cutover-stale-'));
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const acquired = acquireCutoverLock(vaultRoot);
		const bound = bindCutoverLock(vaultRoot, acquired.token, 'cutover-a');
		writeFileSync(
			cutoverLockPath(vaultRoot),
			`${JSON.stringify({ ...bound, pid: exitedChildPid() }, null, 2)}\n`,
			'utf-8',
		);

		const claimed = claimCutoverLock(vaultRoot, 'cutover-a');
		try {
			expect(claimed.token).not.toBe(acquired.token);
			expect(claimed.pid).toBe(process.pid);
			expect(claimed.cutover_id).toBe('cutover-a');
			expect(readCutoverLock(vaultRoot)).toEqual(claimed);
		} finally {
			releaseCutoverLock(vaultRoot, claimed.token);
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it('拒绝接管属于其他 cutover 的失效写闸', () => {
		const parent = mkdtempSync(join(tmpdir(), 'lifeos-cutover-mismatch-'));
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const acquired = acquireCutoverLock(vaultRoot);
		const bound = bindCutoverLock(vaultRoot, acquired.token, 'cutover-a');
		writeFileSync(
			cutoverLockPath(vaultRoot),
			`${JSON.stringify({ ...bound, pid: exitedChildPid() }, null, 2)}\n`,
			'utf-8',
		);
		const before = readFileSync(cutoverLockPath(vaultRoot), 'utf-8');

		try {
			expect(() => claimCutoverLock(vaultRoot, 'cutover-b')).toThrow(/属于其他 cutover/);
			expect(readFileSync(cutoverLockPath(vaultRoot), 'utf-8')).toBe(before);
		} finally {
			releaseCutoverLock(vaultRoot, acquired.token);
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it('遗留恢复 claim 时保守拒绝，不自动删除现场', () => {
		const parent = mkdtempSync(join(tmpdir(), 'lifeos-cutover-claim-'));
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const acquired = acquireCutoverLock(vaultRoot);
		const bound = bindCutoverLock(vaultRoot, acquired.token, 'cutover-a');
		writeFileSync(
			cutoverLockPath(vaultRoot),
			`${JSON.stringify({ ...bound, pid: exitedChildPid() }, null, 2)}\n`,
			'utf-8',
		);
		const claimPath = join(cutoverRoot(vaultRoot), '.active.lock.claim');
		writeFileSync(
			claimPath,
			`${JSON.stringify({ token: 'stale-claim', pid: exitedChildPid(), created_at: new Date().toISOString() })}\n`,
			'utf-8',
		);

		try {
			expect(() => claimCutoverLock(vaultRoot, 'cutover-a')).toThrow(/遗留的安全 claim/);
			expect(existsSync(claimPath)).toBe(true);
			expect(readCutoverLock(vaultRoot)?.token).toBe(acquired.token);
		} finally {
			rmSync(claimPath, { force: true });
			releaseCutoverLock(vaultRoot, acquired.token);
			rmSync(parent, { recursive: true, force: true });
		}
	});
});
