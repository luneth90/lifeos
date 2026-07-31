import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(
	process.cwd(),
	'assets',
	'skills',
	'archive',
	'scripts',
	'archive_transaction.mjs',
);

async function loadModule(): Promise<
	typeof import('../../assets/skills/archive/scripts/archive_transaction.mjs')
> {
	return import(scriptPath);
}

function write(root: string, path: string, value: string): void {
	const absolute = join(root, ...path.split('/'));
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, value, 'utf8');
}

function moveReal({
	vault_root,
	source_path,
	target_path,
}: {
	vault_root: string;
	source_path: string;
	target_path: string;
}): void {
	renameSync(
		join(vault_root, ...source_path.split('/')),
		join(vault_root, ...target_path.split('/')),
	);
}

function files(root: string, current = root): string[] {
	return readdirSync(current, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(current, entry.name);
			if (entry.isDirectory()) return files(root, path);
			return entry.isFile() ? [relative(root, path).split(sep).join('/')] : [];
		})
		.sort();
}

function candidate(
	source_path: string,
	target_path: string,
	entity_type: 'project' | 'draft' | 'plan' | 'diary' = 'project',
) {
	return {
		source_path,
		target_path,
		entity_type,
		...(entity_type === 'project' ? { project_id: 'demo-project' } : {}),
	};
}

function callbacks(overrides: Record<string, unknown> = {}) {
	return {
		move_with_link_update: moveReal,
		memory_notify: async () => undefined,
		confirm_index: async () => true,
		memory_forget: async () => undefined,
		...overrides,
	};
}

describe('Archive 发布事务适配器', () => {
	it('单文件成功移动、通知、确认后才清理项目记忆', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-single-001',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				move_with_link_update(payload: Record<string, unknown>) {
					calls.push({ name: 'move', payload });
					moveReal(payload as Parameters<typeof moveReal>[0]);
				},
				async memory_notify(payload: Record<string, unknown>) {
					calls.push({ name: 'notify', payload });
				},
				async confirm_index(payload: Record<string, unknown>) {
					calls.push({ name: 'confirm', payload });
					return true;
				},
				async memory_forget(payload: Record<string, unknown>) {
					calls.push({ name: 'forget', payload });
				},
			}),
		});

		expect(manifest.status).toBe('complete');
		expect(manifest.moves).toEqual([
			expect.objectContaining({
				source_path: '20_Projects/Demo.md',
				target_path: '90_System/Archive/Projects/2026/Demo.md',
			}),
		]);
		expect(calls.map((call) => call.name)).toEqual(['move', 'notify', 'confirm', 'forget']);
		expect(calls.every((call) => typeof call.payload.idempotency_key === 'string')).toBe(true);
		expect(readFileSync(join(root, '90_System/Archive/Projects/2026/Demo.md'), 'utf8')).toBe(
			'project',
		);
		expect(existsSync(join(root, '20_Projects/Demo.md'))).toBe(false);
		expect(() => JSON.stringify(manifest)).not.toThrow();
	});

	it('安全创建多级目标父目录，不使用递归 mkdir 越过 guard', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '00_Drafts/Idea.md', 'draft');

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-nested-001',
			candidates: [
				candidate('00_Drafts/Idea.md', '90_System/Archive/Drafts/2026/07/Idea.md', 'draft'),
			],
			adapters: callbacks(),
		});

		expect(manifest.status).toBe('complete');
		expect(statSync(join(root, '90_System/Archive/Drafts/2026/07')).isDirectory()).toBe(true);
		expect(manifest.forgotten).toEqual([]);
	});

	it('文件夹整体只移动一次，但逐文件记录、通知和确认', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo/Demo.md', 'main');
		write(root, '20_Projects/Demo/docs/Guide.md', 'guide');
		const moved: string[] = [];
		const notified: string[] = [];
		const confirmed: string[] = [];

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-directory-001',
			candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo')],
			adapters: callbacks({
				move_with_link_update(payload: Parameters<typeof moveReal>[0]) {
					moved.push(payload.source_path);
					moveReal(payload);
				},
				async memory_notify({ file_path }: { file_path: string }) {
					notified.push(file_path);
				},
				async confirm_index({ file_path }: { file_path: string }) {
					confirmed.push(file_path);
					return true;
				},
			}),
		});

		expect(moved).toEqual(['20_Projects/Demo']);
		expect(
			manifest.moves.map((move: { source_path: string; target_path: string }) => [
				move.source_path,
				move.target_path,
			]),
		).toEqual([
			['20_Projects/Demo/Demo.md', '90_System/Archive/Projects/2026/Demo/Demo.md'],
			['20_Projects/Demo/docs/Guide.md', '90_System/Archive/Projects/2026/Demo/docs/Guide.md'],
		]);
		expect(notified).toEqual(
			manifest.moves.map((move: { target_path: string }) => move.target_path),
		);
		expect(confirmed).toEqual(notified);
		expect(files(join(root, '90_System/Archive/Projects/2026/Demo'))).toEqual([
			'Demo.md',
			'docs/Guide.md',
		]);
	});

	it('notify 中断后以相同 run_id 恢复，不重复移动或已确认文件通知', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo/A.md', 'a');
		write(root, '20_Projects/Demo/B.md', 'b');
		let moveCount = 0;
		const notifyCalls: string[] = [];
		let interrupt = true;
		const adapters = callbacks({
			move_with_link_update(payload: Parameters<typeof moveReal>[0]) {
				moveCount += 1;
				moveReal(payload);
			},
			async memory_notify({ file_path }: { file_path: string }) {
				notifyCalls.push(file_path);
				if (interrupt && file_path.endsWith('/B.md'))
					throw Object.assign(new Error('offline'), { code: 'notify_offline' });
			},
		});
		const request = {
			vault_root: root,
			run_id: 'archive-resume-001',
			candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo')],
			adapters,
		};

		const interrupted = await runArchiveTransaction(request);
		expect(interrupted.status).toBe('failed');
		expect(interrupted.confirmed).toHaveLength(1);
		expect(interrupted.errors.at(-1)).toMatchObject({
			step: 'memory_notify',
			path: '90_System/Archive/Projects/2026/Demo/B.md',
			code: 'notify_offline',
			recovery_action: 'resume_same_run_id',
		});

		interrupt = false;
		const resumed = await runArchiveTransaction({ ...request, manifest: interrupted });

		expect(resumed.status).toBe('complete');
		expect(moveCount).toBe(1);
		expect(notifyCalls.filter((path) => path.endsWith('/A.md'))).toHaveLength(1);
		expect(notifyCalls.filter((path) => path.endsWith('/B.md'))).toHaveLength(2);
	});

	it('索引未确认时禁止 project memory_forget', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		let forgetCount = 0;

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-unconfirmed-001',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				confirm_index: async () => false,
				memory_forget: async () => {
					forgetCount += 1;
				},
			}),
		});

		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({
			step: 'confirm_index',
			code: 'index_unconfirmed',
		});
		expect(forgetCount).toBe(0);
		expect(manifest.forgotten).toEqual([]);
	});

	it('任一目标碰撞都在任何 move 前停止', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/A.md', 'a');
		write(root, '20_Projects/B.md', 'b');
		write(root, '90_System/Archive/Projects/2026/B.md', 'collision');
		let moveCount = 0;

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-collision-001',
			candidates: [
				candidate('20_Projects/A.md', '90_System/Archive/Projects/2026/A.md'),
				candidate('20_Projects/B.md', '90_System/Archive/Projects/2026/B.md', 'draft'),
			],
			adapters: callbacks({
				move_with_link_update: () => {
					moveCount += 1;
				},
			}),
		});

		expect(manifest.status).toBe('failed');
		expect(manifest.moves).toEqual([]);
		expect(manifest.collisions).toEqual([
			expect.objectContaining({
				source_path: '20_Projects/B.md',
				target_path: '90_System/Archive/Projects/2026/B.md',
				code: 'target_collision',
			}),
		]);
		expect(moveCount).toBe(0);
		expect(readFileSync(join(root, '20_Projects/A.md'), 'utf8')).toBe('a');
	});

	it('多个候选共享缺失目标父目录时先统一安全创建再移动', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '00_Drafts/A.md', 'a');
		write(root, '00_Drafts/B.md', 'b');
		let moveCount = 0;
		const adapters = callbacks({
			move_with_link_update(payload: Parameters<typeof moveReal>[0]) {
				moveCount += 1;
				moveReal(payload);
			},
		});

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-shared-parent-001',
			candidates: [
				candidate('00_Drafts/A.md', '90_System/Archive/Drafts/2026/07/A.md', 'draft'),
				candidate('00_Drafts/B.md', '90_System/Archive/Drafts/2026/07/B.md', 'draft'),
			],
			adapters,
		});

		expect(manifest.status).toBe('complete');
		expect(moveCount).toBe(2);
		expect(manifest.moves).toHaveLength(2);
		expect(readFileSync(join(root, '90_System/Archive/Drafts/2026/07/A.md'), 'utf8')).toBe('a');
		expect(readFileSync(join(root, '90_System/Archive/Drafts/2026/07/B.md'), 'utf8')).toBe('b');
	});

	it.each(['ancestor', 'leaf'])('移动窗口中目标%s被替换时失败关闭', async (replacement) => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		let notifyCount = 0;

		const manifest = await runArchiveTransaction({
			vault_root: root,
			run_id: `archive-replaced-${replacement}`,
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				move_with_link_update({
					vault_root,
					target_path,
				}: { vault_root: string; target_path: string }) {
					const target = join(vault_root, ...target_path.split('/'));
					if (replacement === 'leaf') {
						symlinkSync(join(outside, 'Demo.md'), target);
						return;
					}
					const parent = dirname(target);
					renameSync(parent, `${parent}-original`);
					mkdirSync(parent);
				},
				memory_notify: async () => {
					notifyCount += 1;
				},
			}),
		});

		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ step: 'move', code: 'path_guard_changed' });
		expect(notifyCount).toBe(0);
		expect(existsSync(join(root, '20_Projects/Demo.md'))).toBe(true);
	});

	it('恢复时拒绝 run_id、候选目标或冻结 inventory 不匹配', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo/A.md', 'a');
		write(root, '20_Projects/Demo/B.md', 'b');
		let interrupt = true;
		const base = {
			vault_root: root,
			run_id: 'archive-freeze-001',
			candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo')],
			adapters: callbacks({
				memory_notify: async () => {
					if (interrupt) throw Object.assign(new Error('offline'), { code: 'notify_offline' });
				},
			}),
		};
		const interrupted = await runArchiveTransaction(base);
		interrupt = false;

		await expect(
			runArchiveTransaction({ ...base, run_id: 'archive-other', manifest: interrupted }),
		).rejects.toThrow('run_id_mismatch');
		await expect(
			runArchiveTransaction({
				...base,
				candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2027/Demo')],
				manifest: interrupted,
			}),
		).rejects.toThrow('candidate_set_mismatch');

		writeFileSync(join(root, '90_System/Archive/Projects/2026/Demo/B.md'), 'changed', 'utf8');
		await expect(runArchiveTransaction({ ...base, manifest: interrupted })).rejects.toThrow(
			'inventory_mismatch',
		);
	});
});
