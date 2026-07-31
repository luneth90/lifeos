import { createHmac, randomBytes } from 'node:crypto';
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
	return secureCallbacks(overrides);
}

interface TestManifest extends Record<string, unknown> {
	status: string;
	errors: Array<Record<string, unknown>>;
	candidates: Array<Record<string, unknown>>;
	inventories: Array<Record<string, unknown>>;
	candidate_states: Array<{ move_started: boolean; moved: boolean }>;
	moves: Array<Record<string, unknown>>;
	intents: Array<Record<string, unknown>>;
	move_receipts: Array<Record<string, unknown>>;
	notified: Array<Record<string, unknown>>;
	confirmed: Array<Record<string, unknown>>;
	forgotten: Array<Record<string, unknown>>;
}

interface TestEnvelope extends Record<string, unknown> {
	manifest: TestManifest;
	persistence_receipt: string | null;
	persistence_state: 'verified' | 'unverified';
}

function manifestFrom(result: Record<string, unknown>): TestManifest {
	return ((result.manifest as TestManifest | undefined) ?? result) as TestManifest;
}

function payloadManifest(payload: Record<string, unknown>): TestManifest {
	return ((payload.manifest as TestManifest | undefined) ?? payload) as TestManifest;
}

function createTrustedManifestStore() {
	const secret = randomBytes(32);
	const stored = new Set<string>();
	const digest = (manifest: unknown) =>
		createHmac('sha256', secret).update(JSON.stringify(manifest)).digest('hex');
	const seal = (manifest: unknown) => {
		const receipt = `hmac-sha256:${digest(manifest)}`;
		stored.add(`${receipt}\n${JSON.stringify(manifest)}`);
		return { ok: true as const, receipt };
	};
	return {
		seal,
		async persist_manifest(payload: Record<string, unknown>) {
			return seal(payload.manifest ?? payload);
		},
		async verify_manifest_receipt({
			manifest,
			receipt,
		}: {
			manifest: unknown;
			receipt: string;
		}) {
			const expected = `hmac-sha256:${digest(manifest)}`;
			return {
				ok: true as const,
				verified: receipt === expected && stored.has(`${receipt}\n${JSON.stringify(manifest)}`),
			};
		},
	};
}

function secureCallbacks(
	overrides: Record<string, unknown> = {},
	store = createTrustedManifestStore(),
) {
	return {
		persist_manifest: store.persist_manifest,
		verify_manifest_receipt: store.verify_manifest_receipt,
		move_with_link_update(payload: Parameters<typeof moveReal>[0] & { idempotency_key: string }) {
			moveReal(payload);
			return { ok: true, receipt: `move:${payload.idempotency_key}` };
		},
		async memory_notify({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, receipt: `notify:${idempotency_key}` };
		},
		async confirm_index({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, confirmed: true, receipt: `confirm:${idempotency_key}` };
		},
		async memory_forget({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, receipt: `forget:${idempotency_key}` };
		},
		...overrides,
	};
}

describe('Archive 发布事务适配器', () => {
	it('单文件成功移动、通知、确认后才清理项目记忆', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-single-001',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				move_with_link_update(payload: Record<string, unknown>) {
					calls.push({ name: 'move', payload });
					moveReal(payload as Parameters<typeof moveReal>[0]);
					return { ok: true, receipt: `move:${payload.idempotency_key}` };
				},
				async memory_notify(payload: Record<string, unknown>) {
					calls.push({ name: 'notify', payload });
					return { ok: true, receipt: `notify:${payload.idempotency_key}` };
				},
				async confirm_index(payload: Record<string, unknown>) {
					calls.push({ name: 'confirm', payload });
					return {
						ok: true,
						confirmed: true,
						receipt: `confirm:${payload.idempotency_key}`,
					};
				},
				async memory_forget(payload: Record<string, unknown>) {
					calls.push({ name: 'forget', payload });
					return { ok: true, receipt: `forget:${payload.idempotency_key}` };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-nested-001',
			candidates: [
				candidate('00_Drafts/Idea.md', '90_System/Archive/Drafts/2026/07/Idea.md', 'draft'),
			],
			adapters: callbacks(),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-directory-001',
			candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo')],
			adapters: callbacks({
				move_with_link_update(
					payload: Parameters<typeof moveReal>[0] & { idempotency_key: string },
				) {
					moved.push(payload.source_path);
					moveReal(payload);
					return { ok: true, receipt: `move:${payload.idempotency_key}` };
				},
				async memory_notify({
					file_path,
					idempotency_key,
				}: {
					file_path: string;
					idempotency_key: string;
				}) {
					notified.push(file_path);
					return { ok: true, receipt: `notify:${idempotency_key}` };
				},
				async confirm_index({
					file_path,
					idempotency_key,
				}: {
					file_path: string;
					idempotency_key: string;
				}) {
					confirmed.push(file_path);
					return { ok: true, confirmed: true, receipt: `confirm:${idempotency_key}` };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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
			move_with_link_update(payload: Parameters<typeof moveReal>[0] & { idempotency_key: string }) {
				moveCount += 1;
				moveReal(payload);
				return { ok: true, receipt: `move:${payload.idempotency_key}` };
			},
			async memory_notify({
				file_path,
				idempotency_key,
			}: {
				file_path: string;
				idempotency_key: string;
			}) {
				notifyCalls.push(file_path);
				if (interrupt && file_path.endsWith('/B.md'))
					throw Object.assign(new Error('offline'), { code: 'notify_offline' });
				return { ok: true, receipt: `notify:${idempotency_key}` };
			},
		});
		const request = {
			vault_root: root,
			run_id: 'archive-resume-001',
			candidates: [candidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo')],
			adapters,
		};

		const interrupted = await runArchiveTransaction(request);
		const interruptedManifest = manifestFrom(interrupted as Record<string, unknown>);
		expect(interruptedManifest.status).toBe('failed');
		expect(interruptedManifest.confirmed).toHaveLength(1);
		expect(interruptedManifest.errors.at(-1)).toMatchObject({
			step: 'memory_notify',
			path: '90_System/Archive/Projects/2026/Demo/B.md',
			code: 'notify_offline',
			recovery_action: 'resume_same_run_id_with_idempotency_key',
		});

		interrupt = false;
		const resumed = await runArchiveTransaction({ ...request, manifest: interrupted });
		const resumedManifest = manifestFrom(resumed as Record<string, unknown>);

		expect(resumedManifest.status).toBe('complete');
		expect(moveCount).toBe(1);
		expect(notifyCalls.filter((path) => path.endsWith('/A.md'))).toHaveLength(1);
		expect(notifyCalls.filter((path) => path.endsWith('/B.md'))).toHaveLength(2);
	});

	it('索引未确认时禁止 project memory_forget', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		let forgetCount = 0;

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-unconfirmed-001',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				confirm_index: async ({ idempotency_key }: { idempotency_key: string }) => ({
					ok: true,
					confirmed: false,
					receipt: `confirm:${idempotency_key}`,
				}),
				memory_forget: async ({ idempotency_key }: { idempotency_key: string }) => {
					forgetCount += 1;
					return { ok: true, receipt: `forget:${idempotency_key}` };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-collision-001',
			candidates: [
				candidate('20_Projects/A.md', '90_System/Archive/Projects/2026/A.md'),
				candidate('20_Projects/B.md', '90_System/Archive/Projects/2026/B.md', 'draft'),
			],
			adapters: callbacks({
				move_with_link_update: () => {
					moveCount += 1;
					return { ok: true, receipt: 'move:unexpected' };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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
			move_with_link_update(payload: Parameters<typeof moveReal>[0] & { idempotency_key: string }) {
				moveCount += 1;
				moveReal(payload);
				return { ok: true, receipt: `move:${payload.idempotency_key}` };
			},
		});

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-shared-parent-001',
			candidates: [
				candidate('00_Drafts/A.md', '90_System/Archive/Drafts/2026/07/A.md', 'draft'),
				candidate('00_Drafts/B.md', '90_System/Archive/Drafts/2026/07/B.md', 'draft'),
			],
			adapters,
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: `archive-replaced-${replacement}`,
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: callbacks({
				move_with_link_update({
					vault_root,
					target_path,
				}: { vault_root: string; target_path: string; idempotency_key: string }) {
					const target = join(vault_root, ...target_path.split('/'));
					if (replacement === 'leaf') {
						symlinkSync(join(outside, 'Demo.md'), target);
						return { ok: true, receipt: 'move:replacement' };
					}
					const parent = dirname(target);
					renameSync(parent, `${parent}-original`);
					mkdirSync(parent);
					return { ok: true, receipt: 'move:replacement' };
				},
				memory_notify: async ({ idempotency_key }: { idempotency_key: string }) => {
					notifyCount += 1;
					return { ok: true, receipt: `notify:${idempotency_key}` };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

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
				memory_notify: async ({ idempotency_key }: { idempotency_key: string }) => {
					if (interrupt) throw Object.assign(new Error('offline'), { code: 'notify_offline' });
					return { ok: true, receipt: `notify:${idempotency_key}` };
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
		const drifted = await runArchiveTransaction({ ...base, manifest: interrupted });
		const driftedManifest = manifestFrom(drifted as Record<string, unknown>);
		expect(driftedManifest.status).toBe('failed');
		expect(driftedManifest.errors.at(-1)).toMatchObject({ code: 'inventory_mismatch' });
	});
});

describe('Archive 安全边界复审', () => {
	it.each(['persist_manifest', 'verify_manifest_receipt'])(
		'将 %s 作为必需的可信持久化适配器',
		async (adapterName) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, '20_Projects/Demo.md', 'project');
			const adapters = secureCallbacks() as Record<string, unknown>;
			delete adapters[adapterName];

			await expect(
				runArchiveTransaction({
					vault_root: root,
					run_id: `archive-required-${adapterName}`,
					candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
					adapters,
				}),
			).rejects.toThrow(`missing_adapter_${adapterName}`);
		},
	);

	it.each(['ancestor', 'leaf'])(
		'intent 持久化回调替换目标%s后重新建 guard，任何 move 都不得发生',
		async (replacement) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
			write(root, '20_Projects/Demo.md', 'project');
			const store = createTrustedManifestStore();
			let replaced = false;
			let moveCount = 0;
			const adapters = secureCallbacks(
				{
					async persist_manifest(payload: Record<string, unknown>) {
						const result = await store.persist_manifest(payload);
						const manifest = payloadManifest(payload);
						const moveIntent =
							manifest.intents?.some(
								(item: { effect_type: string }) => item.effect_type === 'move',
							) ||
							manifest.candidate_states?.some(
								(state: { move_started: boolean; moved: boolean }) =>
									state.move_started && !state.moved,
							);
						if (!replaced && moveIntent) {
							replaced = true;
							const target = join(root, '90_System/Archive/Projects/2026/Demo.md');
							if (replacement === 'ancestor') {
								const parent = dirname(target);
								renameSync(parent, `${parent}-original`);
								symlinkSync(outside, parent);
							} else {
								writeFileSync(join(outside, 'Demo.md'), 'outside', 'utf8');
								symlinkSync(join(outside, 'Demo.md'), target);
							}
						}
						return result;
					},
					move_with_link_update(
						payload: Parameters<typeof moveReal>[0] & { idempotency_key: string },
					) {
						moveCount += 1;
						moveReal(payload);
						return { ok: true, receipt: `move:${payload.idempotency_key}` };
					},
				},
				store,
			);

			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: `archive-persist-replace-${replacement}`,
				candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
				adapters,
			});
			const manifest = manifestFrom(result as Record<string, unknown>);

			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({
				step: 'move',
				code: expect.stringMatching(/path_guard_changed|vault_escape|target_collision/),
			});
			expect(moveCount).toBe(0);
		},
	);

	it('intent 持久化后源内容漂移时在 move 前持久化失败状态', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'before');
		const store = createTrustedManifestStore();
		let changed = false;
		let moveCount = 0;
		const adapters = secureCallbacks(
			{
				async persist_manifest(payload: Record<string, unknown>) {
					const result = await store.persist_manifest(payload);
					const manifest = payloadManifest(payload);
					if (
						!changed &&
						(manifest.intents?.some(
							(item: { effect_type: string }) => item.effect_type === 'move',
						) ||
							manifest.candidate_states?.some(
								(state: { move_started: boolean; moved: boolean }) =>
									state.move_started && !state.moved,
							))
					) {
						changed = true;
						writeFileSync(join(root, '20_Projects/Demo.md'), 'after', 'utf8');
					}
					return result;
				},
				move_with_link_update(
					payload: Parameters<typeof moveReal>[0] & { idempotency_key: string },
				) {
					moveCount += 1;
					moveReal(payload);
					return { ok: true, receipt: `move:${payload.idempotency_key}` };
				},
			},
			store,
		);

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-source-drift',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters,
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ step: 'move', code: 'inventory_mismatch' });
		expect(moveCount).toBe(0);
		expect(existsSync(join(root, '20_Projects/Demo.md'))).toBe(true);
	});

	it('move 返回后目标内容被篡改时返回带副作用和人工恢复信息的 failed envelope', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'before');
		let notifyCount = 0;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-post-move-drift',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: secureCallbacks({
				move_with_link_update(
					payload: Parameters<typeof moveReal>[0] & { idempotency_key: string },
				) {
					moveReal(payload);
					writeFileSync(
						join(payload.vault_root, ...payload.target_path.split('/')),
						'changed-after-move',
						'utf8',
					);
					return { ok: true, receipt: `move:${payload.idempotency_key}` };
				},
				async memory_notify() {
					notifyCount += 1;
					return { ok: true, receipt: 'notify:unexpected' };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({
			step: 'move',
			code: 'inventory_mismatch',
			recovery_action: 'manual_recovery_required',
			side_effect_state: 'move_applied_target_changed',
		});
		expect(notifyCount).toBe(0);
		expect(result).toMatchObject({ persistence_state: 'verified' });
	});

	it('每次持久化后、notify 前重新验证目标 guard 与 inventory', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'before');
		const store = createTrustedManifestStore();
		let changed = false;
		let notifyCount = 0;
		const adapters = secureCallbacks(
			{
				async persist_manifest(payload: Record<string, unknown>) {
					const result = await store.persist_manifest(payload);
					const manifest = payloadManifest(payload);
					if (!changed && manifest.move_receipts?.length === 1) {
						changed = true;
						writeFileSync(
							join(root, '90_System/Archive/Projects/2026/Demo.md'),
							'changed-before-notify',
							'utf8',
						);
					}
					return result;
				},
				async memory_notify({ idempotency_key }: { idempotency_key: string }) {
					notifyCount += 1;
					return { ok: true, receipt: `notify:${idempotency_key}` };
				},
			},
			store,
		);

		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-pre-notify-drift',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters,
		});
		const manifest = manifestFrom(result as Record<string, unknown>);

		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ step: 'memory_notify' });
		expect(notifyCount).toBe(0);
	});

	it('恢复必须验证可信 HMAC envelope，任意字段篡改都在副作用前拒绝', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const store = createTrustedManifestStore();
		let interrupt = true;
		let notifyCount = 0;
		const adapters = secureCallbacks(
			{
				async memory_notify({ idempotency_key }: { idempotency_key: string }) {
					notifyCount += 1;
					if (interrupt) throw Object.assign(new Error('offline'), { code: 'notify_offline' });
					return { ok: true, receipt: `notify:${idempotency_key}` };
				},
			},
			store,
		);
		const request = {
			vault_root: root,
			run_id: 'archive-authenticated-resume',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters,
		};
		const interrupted = (await runArchiveTransaction(request)) as TestEnvelope;
		interrupt = false;
		expect(interrupted).toMatchObject({
			manifest: { status: 'failed' },
			persistence_receipt: expect.stringMatching(/^hmac-sha256:/),
			persistence_state: 'verified',
		});
		const tampered = structuredClone(interrupted);
		tampered.manifest.errors[0].code = 'forged-error-code';

		const rejected = await runArchiveTransaction({ ...request, manifest: tampered });
		const rejectedManifest = manifestFrom(rejected as Record<string, unknown>);
		expect(rejectedManifest.status).toBe('failed');
		expect(rejectedManifest.errors.at(-1)).toMatchObject({
			step: 'verify_manifest_receipt',
			code: 'manifest_receipt_invalid',
			recovery_action: 'manual_recovery_required',
		});
		expect(notifyCount).toBe(1);
	});

	it('即使可信存储封装，额外键、原型键、伪造 ID、重复集合和穿越路径也被 Schema 拒绝', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const store = createTrustedManifestStore();
		const adapters = secureCallbacks(
			{
				async memory_notify() {
					throw Object.assign(new Error('offline'), { code: 'notify_offline' });
				},
			},
			store,
		);
		const request = {
			vault_root: root,
			run_id: 'archive-schema-resume',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters,
		};
		const interrupted = (await runArchiveTransaction(request)) as TestEnvelope;
		const mutations = [
			(manifest: TestManifest) => Object.assign(manifest, { extra: true }),
			(manifest: TestManifest) => {
				manifest.moves[0].move_id = 'forged';
			},
			(manifest: TestManifest) => manifest.moves.push(structuredClone(manifest.moves[0])),
			(manifest: TestManifest) => {
				manifest.candidates[0].source_path = '../../outside.md';
			},
		];
		for (const mutate of mutations) {
			const manifest = structuredClone(interrupted.manifest);
			mutate(manifest);
			const receipt = store.seal(manifest).receipt;
			await expect(
				runArchiveTransaction({
					...request,
					manifest: { manifest, persistence_receipt: receipt, persistence_state: 'verified' },
				}),
			).rejects.toThrow(/invalid_manifest|candidate_set_mismatch|vault_escape/);
		}
		const polluted = structuredClone(interrupted);
		Object.setPrototypeOf(polluted.manifest, { injected: true });
		await expect(runArchiveTransaction({ ...request, manifest: polluted })).rejects.toThrow(
			'invalid_manifest',
		);

		const accessorEnvelope = structuredClone(interrupted);
		const firstMove = accessorEnvelope.manifest.moves[0];
		Object.defineProperty(accessorEnvelope.manifest.moves, '0', {
			configurable: true,
			enumerable: true,
			get: () => firstMove,
		});
		accessorEnvelope.persistence_receipt = store.seal(accessorEnvelope.manifest).receipt;
		await expect(runArchiveTransaction({ ...request, manifest: accessorEnvelope })).rejects.toThrow(
			'invalid_manifest',
		);
	});

	it('恢复时 source 被恢复出来必须失败关闭，不得自动跳过副作用', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const store = createTrustedManifestStore();
		const adapters = secureCallbacks(
			{
				async memory_notify() {
					throw Object.assign(new Error('offline'), { code: 'notify_offline' });
				},
			},
			store,
		);
		const request = {
			vault_root: root,
			run_id: 'archive-source-restored',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters,
		};
		const interrupted = await runArchiveTransaction(request);
		write(root, '20_Projects/Demo.md', 'restored');

		await expect(runArchiveTransaction({ ...request, manifest: interrupted })).rejects.toThrow(
			'resume_source_restored',
		);
	});

	const crossCandidateCases = [
		[
			candidate('20_Projects/A.md', '20_Projects/B.md'),
			candidate('20_Projects/B.md', '90_System/Archive/Projects/2026/B.md'),
		],
		[
			candidate('20_Projects/B.md', '90_System/Archive/Projects/2026/B.md'),
			candidate('20_Projects/A.md', '20_Projects/B.md'),
		],
		[
			candidate('20_Projects/A', '90_System/Archive/Projects/2026/A'),
			candidate('20_Projects/B.md', '20_Projects/A/nested.md'),
		],
		[
			candidate('20_Projects/B.md', '20_Projects/A/nested.md'),
			candidate('20_Projects/A', '90_System/Archive/Projects/2026/A'),
		],
	];

	it.each(crossCandidateCases)(
		'候选 source/target 任意方向交叉都在所有 move 前拒绝，且顺序无关',
		async (...candidates) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, '20_Projects/A/A.md', 'a');
			write(root, '20_Projects/A.md', 'a-file');
			write(root, '20_Projects/B.md', 'b');
			let moveCount = 0;
			await expect(
				runArchiveTransaction({
					vault_root: root,
					run_id: 'archive-cross-candidate',
					candidates,
					adapters: secureCallbacks({
						move_with_link_update() {
							moveCount += 1;
							return { ok: true, receipt: 'move:unexpected' };
						},
					}),
				}),
			).rejects.toThrow('candidate_path_overlap');
			expect(moveCount).toBe(0);
		},
	);

	it.each(['draft', 'plan', 'diary'] as const)(
		'%s 候选只允许普通文件，目录在 move 前失败关闭',
		async (entityType) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, 'Source/Entry/Child.md', 'child');
			let moveCount = 0;
			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: `archive-shape-${entityType}`,
				candidates: [candidate('Source/Entry', 'Archive/Entry', entityType)],
				adapters: secureCallbacks({
					move_with_link_update() {
						moveCount += 1;
						return { ok: true, receipt: 'move:unexpected' };
					},
				}),
			});
			const manifest = manifestFrom(result as Record<string, unknown>);
			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({ code: 'invalid_candidate_shape' });
			expect(moveCount).toBe(0);
		},
	);

	it('空 project 目录禁止 vacuous forget', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		mkdirSync(join(root, '20_Projects/Empty'), { recursive: true });
		let moveCount = 0;
		let forgetCount = 0;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-empty-project',
			candidates: [candidate('20_Projects/Empty', 'Archive/Empty')],
			adapters: secureCallbacks({
				move_with_link_update() {
					moveCount += 1;
					return { ok: true, receipt: 'move:unexpected' };
				},
				async memory_forget() {
					forgetCount += 1;
					return { ok: true, receipt: 'forget:unexpected' };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ code: 'empty_project' });
		expect(moveCount).toBe(0);
		expect(forgetCount).toBe(0);
	});

	it('同一 project 的多个候选全部确认后仅 forget 一次', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/A.md', 'a');
		write(root, '20_Projects/B.md', 'b');
		let forgetCount = 0;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-same-project',
			candidates: [
				candidate('20_Projects/A.md', 'Archive/A.md'),
				candidate('20_Projects/B.md', 'Archive/B.md'),
			],
			adapters: secureCallbacks({
				async memory_forget({ idempotency_key }: { idempotency_key: string }) {
					forgetCount += 1;
					return { ok: true, receipt: `forget:${idempotency_key}` };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('complete');
		expect(forgetCount).toBe(1);
		expect(manifest.forgotten).toHaveLength(1);
	});

	it.each(['Cafe\u0301.md', 'bad\\name.md', 'bad\tname.md', 'CON.md'])(
		'目录 inventory 拒绝不安全原始子项名称 %j，不得静默规范化',
		async (name) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			mkdirSync(join(root, '20_Projects/Demo'), { recursive: true });
			writeFileSync(join(root, '20_Projects/Demo', name), 'content', 'utf8');
			let moveCount = 0;
			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: `archive-child-${Buffer.from(name).toString('hex')}`,
				candidates: [candidate('20_Projects/Demo', 'Archive/Demo')],
				adapters: secureCallbacks({
					move_with_link_update() {
						moveCount += 1;
						return { ok: true, receipt: 'move:unexpected' };
					},
				}),
			});
			const manifest = manifestFrom(result as Record<string, unknown>);
			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({ code: 'unsafe_archive_component' });
			expect(moveCount).toBe(0);
		},
	);

	it('目录 inventory 拒绝符号链接子项并持久化失败，而不是裸抛', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, '20_Projects/Demo'), { recursive: true });
		writeFileSync(join(outside, 'outside.md'), 'outside', 'utf8');
		symlinkSync(join(outside, 'outside.md'), join(root, '20_Projects/Demo/Link.md'));
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-child-symlink',
			candidates: [candidate('20_Projects/Demo', 'Archive/Demo')],
			adapters: secureCallbacks(),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ code: 'unsafe_archive_symlink' });
	});

	it.each([
		['persist_manifest', false],
		['persist_manifest', null],
		['persist_manifest', { isError: true }],
		['persist_manifest', { ok: true }],
		['memory_notify', false],
		['memory_notify', null],
		['memory_notify', { isError: true }],
		['memory_notify', { ok: true }],
		['confirm_index', false],
		['confirm_index', null],
		['confirm_index', { isError: true }],
		['confirm_index', { ok: true }],
		['memory_forget', false],
		['memory_forget', null],
		['memory_forget', { isError: true }],
		['memory_forget', { ok: true }],
	] as const)(
		'%s 返回非法结果 %j 时停止并记录 adapter_result_invalid',
		async (adapterName, invalidResult) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, '20_Projects/Demo.md', 'project');
			let downstreamCount = 0;
			const store = createTrustedManifestStore();
			const overrides: Record<string, unknown> = {
				[adapterName]: async () => invalidResult,
			};
			if (adapterName === 'persist_manifest') {
				overrides.memory_notify = async () => {
					downstreamCount += 1;
					return { ok: true, receipt: 'notify:unexpected' };
				};
			} else if (adapterName === 'memory_notify') {
				overrides.confirm_index = async () => {
					downstreamCount += 1;
					return { ok: true, confirmed: true, receipt: 'confirm:unexpected' };
				};
			} else if (adapterName === 'confirm_index') {
				overrides.memory_forget = async () => {
					downstreamCount += 1;
					return { ok: true, receipt: 'forget:unexpected' };
				};
			}
			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: `archive-invalid-${adapterName}-${JSON.stringify(invalidResult)}`,
				candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
				adapters: secureCallbacks(overrides, store),
			});
			const manifest = manifestFrom(result as Record<string, unknown>);
			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({ code: 'adapter_result_invalid' });
			expect(downstreamCount).toBe(0);
		},
	);

	it.each([false, null, { isError: true }, { ok: true }])(
		'verify_manifest_receipt 返回非法结果 %j 时失败关闭并持久化人工恢复状态',
		async (invalidResult) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, '20_Projects/Demo.md', 'project');
			const store = createTrustedManifestStore();
			const runId = `archive-invalid-verify-${JSON.stringify(invalidResult)}`;
			const candidates = [
				candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md'),
			];
			const interrupted = (await runArchiveTransaction({
				vault_root: root,
				run_id: runId,
				candidates,
				adapters: secureCallbacks(
					{
						async memory_notify() {
							throw Object.assign(new Error('offline'), { code: 'notify_offline' });
						},
					},
					store,
				),
			})) as TestEnvelope;
			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: runId,
				candidates,
				manifest: interrupted,
				adapters: secureCallbacks(
					{
						async verify_manifest_receipt() {
							return invalidResult;
						},
					},
					store,
				),
			});
			const manifest = manifestFrom(result as Record<string, unknown>);
			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({
				step: 'verify_manifest_receipt',
				code: 'adapter_result_invalid',
				recovery_action: 'manual_recovery_required',
			});
			expect(result).toMatchObject({ persistence_state: 'verified' });
		},
	);

	it.each([false, null, { isError: true }, { ok: true }])(
		'move_with_link_update 返回非法结果 %j 时立即记录非法回执并停止',
		async (invalidResult) => {
			const { runArchiveTransaction } = await loadModule();
			const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
			write(root, '20_Projects/Demo.md', 'project');
			let notifyCount = 0;
			const result = await runArchiveTransaction({
				vault_root: root,
				run_id: `archive-invalid-move-${JSON.stringify(invalidResult)}`,
				candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
				adapters: secureCallbacks({
					move_with_link_update() {
						return invalidResult;
					},
					async memory_notify() {
						notifyCount += 1;
						return { ok: true, receipt: 'notify:unexpected' };
					},
				}),
			});
			const manifest = manifestFrom(result as Record<string, unknown>);
			expect(manifest.status).toBe('failed');
			expect(manifest.errors.at(-1)).toMatchObject({
				step: 'move',
				code: 'adapter_result_invalid',
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'move_may_have_started_receipt_missing',
			});
			expect(notifyCount).toBe(0);
		},
	);

	it.each([
		['move_with_link_update', 'move_offline'],
		['memory_notify', 'notify_offline'],
		['confirm_index', 'confirm_offline'],
		['memory_forget', 'forget_offline'],
	] as const)('%s 抛错时记录错误、停止并返回恢复状态', async (adapterName, code) => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: `archive-throws-${adapterName}`,
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: secureCallbacks({
				[adapterName]: async () => {
					throw Object.assign(new Error('offline'), { code });
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({ code });
		expect(result).toHaveProperty('persistence_state');
	});

	it('verify_manifest_receipt 抛错时记录错误并持久化人工恢复状态', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		const store = createTrustedManifestStore();
		const candidates = [candidate('20_Projects/Demo.md', 'Archive/Demo.md')];
		const interrupted = (await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-verify-throws',
			candidates,
			adapters: secureCallbacks(
				{
					async memory_notify() {
						throw Object.assign(new Error('offline'), { code: 'notify_offline' });
					},
				},
				store,
			),
		})) as TestEnvelope;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-verify-throws',
			candidates,
			manifest: interrupted,
			adapters: secureCallbacks(
				{
					async verify_manifest_receipt() {
						throw Object.assign(new Error('offline'), { code: 'verify_offline' });
					},
				},
				store,
			),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({
			step: 'verify_manifest_receipt',
			code: 'verify_offline',
			recovery_action: 'manual_recovery_required',
		});
	});

	it('move 返回非法结构时不进入 notify，并记录可能已发生的副作用', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		let notifyCount = 0;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-invalid-move-result',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: secureCallbacks({
				move_with_link_update(payload: Parameters<typeof moveReal>[0]) {
					moveReal(payload);
					return { ok: true };
				},
				async memory_notify() {
					notifyCount += 1;
					return { ok: true, receipt: 'notify:unexpected' };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({
			step: 'move',
			code: 'adapter_result_invalid',
			side_effect_state: 'move_may_have_started_receipt_missing',
		});
		expect(notifyCount).toBe(0);
	});

	it('持久化抛错时返回不可自动恢复的 failed envelope，且不执行副作用', async () => {
		const { runArchiveTransaction } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-'));
		write(root, '20_Projects/Demo.md', 'project');
		let moveCount = 0;
		const result = await runArchiveTransaction({
			vault_root: root,
			run_id: 'archive-persist-throws',
			candidates: [candidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md')],
			adapters: secureCallbacks({
				async persist_manifest() {
					throw Object.assign(new Error('disk full'), { code: 'persist_offline' });
				},
				move_with_link_update() {
					moveCount += 1;
					return { ok: true, receipt: 'move:unexpected' };
				},
			}),
		});
		const manifest = manifestFrom(result as Record<string, unknown>);
		expect(manifest.status).toBe('failed');
		expect(manifest.errors.at(-1)).toMatchObject({
			step: 'persist_manifest',
			code: 'persist_offline',
			recovery_action: 'manual_recovery_required',
		});
		expect(result).toMatchObject({ persistence_receipt: null, persistence_state: 'unverified' });
		expect(moveCount).toBe(0);
	});
});
