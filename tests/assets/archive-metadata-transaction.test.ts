import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const moveScriptPath = join(
	process.cwd(),
	'assets',
	'skills',
	'archive',
	'scripts',
	'archive_transaction.mjs',
);
const metadataScriptPath = join(
	process.cwd(),
	'assets',
	'skills',
	'archive',
	'scripts',
	'archive_metadata_transaction.mjs',
);

async function loadMoveModule(): Promise<
	typeof import('../../assets/skills/archive/scripts/archive_transaction.mjs')
> {
	return import(moveScriptPath);
}

async function loadMetadataModule(): Promise<
	typeof import('../../assets/skills/archive/scripts/archive_metadata_transaction.mjs')
> {
	return import(metadataScriptPath);
}

function write(root: string, path: string, value: string): void {
	const absolute = join(root, ...path.split('/'));
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, value, 'utf8');
}

function read(root: string, path: string): string {
	return readFileSync(join(root, ...path.split('/')), 'utf8');
}

function note(type: 'project' | 'draft' | 'plan', title: string): string {
	return `---\ntitle: "${title}"\ntype: ${type}\nstatus: done\n---\n\n# ${title}\n`;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function createTrustedManifestStore() {
	const secret = randomBytes(32);
	const stored = new Set<string>();
	const serializedPayload = (manifest: unknown, vaultIdentity?: unknown) =>
		JSON.stringify({
			vault_identity:
				vaultIdentity ?? (manifest as { vault_identity?: unknown } | null)?.vault_identity,
			manifest,
		});
	const digest = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');
	return {
		async persist_manifest(payload: Record<string, unknown>) {
			const serialized = serializedPayload(payload.manifest ?? payload, payload.vault_identity);
			const receipt = `hmac-sha256:${digest(serialized)}`;
			stored.add(`${receipt}\n${serialized}`);
			return { ok: true as const, receipt };
		},
		async verify_manifest_receipt({
			manifest,
			persistence_receipt,
			vault_identity,
		}: {
			manifest: unknown;
			persistence_receipt: string;
			vault_identity?: unknown;
		}) {
			const serialized = serializedPayload(manifest, vault_identity);
			const expected = `hmac-sha256:${digest(serialized)}`;
			return {
				ok: true as const,
				verified:
					persistence_receipt === expected && stored.has(`${persistence_receipt}\n${serialized}`),
			};
		},
	};
}

function moveCandidate(
	source_path: string,
	target_path: string,
	entity_type: 'project' | 'draft' | 'plan' | 'diary',
) {
	return {
		source_path,
		target_path,
		entity_type,
		...(entity_type === 'project' ? { project_id: 'demo-project' } : {}),
	};
}

function moveAdapters(root: string, store: ReturnType<typeof createTrustedManifestStore>) {
	return {
		...store,
		move_with_link_update({ source_path, target_path, idempotency_key }: Record<string, string>) {
			renameSync(join(root, ...source_path.split('/')), join(root, ...target_path.split('/')));
			return { ok: true, receipt: `move:${idempotency_key}` };
		},
		async memory_notify({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, receipt: `move-notify:${idempotency_key}` };
		},
		async confirm_index({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, confirmed: true, receipt: `move-confirm:${idempotency_key}` };
		},
		async memory_forget({ idempotency_key }: { idempotency_key: string }) {
			return { ok: true, receipt: `move-forget:${idempotency_key}` };
		},
	};
}

function metadataAdapters(
	root: string,
	store: ReturnType<typeof createTrustedManifestStore>,
	calls: string[],
	overrides: Record<string, unknown> = {},
) {
	return {
		...store,
		async write_archived_frontmatter(payload: Record<string, string>) {
			calls.push(`write:${payload.file_path}`);
			const before = read(root, payload.file_path);
			if (sha256(before) !== payload.expected_before_sha256 && before !== payload.content) {
				throw new Error('compare_and_swap_failed');
			}
			write(root, payload.file_path, payload.content);
			return {
				ok: true,
				receipt: `metadata-write:${payload.idempotency_key}`,
				applied_sha256: sha256(payload.content),
			};
		},
		async memory_notify({ file_path, idempotency_key }: Record<string, string>) {
			calls.push(`notify:${file_path}`);
			return { ok: true, receipt: `metadata-notify:${idempotency_key}` };
		},
		async confirm_index({ file_path, idempotency_key }: Record<string, string>) {
			calls.push(`confirm:${file_path}`);
			return { ok: true, confirmed: true, receipt: `metadata-confirm:${idempotency_key}` };
		},
		...overrides,
	};
}

async function moveIntoArchive({
	root,
	store,
	candidates,
}: {
	root: string;
	store: ReturnType<typeof createTrustedManifestStore>;
	candidates: ReturnType<typeof moveCandidate>[];
}) {
	const { runArchiveTransaction } = await loadMoveModule();
	return runArchiveTransaction({
		vault_root: root,
		run_id: 'archive-parent-001',
		candidates,
		adapters: moveAdapters(root, store),
	});
}

describe('Archive archived 日期元数据事务', () => {
	it('从已认证移动清单派生项目、草稿和计划目标，保留 done 并闭环写入 archived', async () => {
		const { runArchiveMetadataTransaction } = await loadMetadataModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-metadata-'));
		const store = createTrustedManifestStore();
		write(root, '20_Projects/Demo.md', note('project', 'Demo'));
		write(root, '00_Drafts/Idea.md', note('draft', 'Idea'));
		write(root, '60_Plans/Plan.md', note('plan', 'Plan'));
		write(root, '10_Diary/2026-07-01.md', '---\ntype: diary\n---\n\n# Diary\n');
		const moveEnvelope = await moveIntoArchive({
			root,
			store,
			candidates: [
				moveCandidate('20_Projects/Demo.md', '90_System/Archive/Projects/2026/Demo.md', 'project'),
				moveCandidate('00_Drafts/Idea.md', '90_System/Archive/Drafts/2026/08/Idea.md', 'draft'),
				moveCandidate('60_Plans/Plan.md', '90_System/Archive/Plans/Plan.md', 'plan'),
				moveCandidate(
					'10_Diary/2026-07-01.md',
					'90_System/Archive/Diary/2026/07/2026-07-01.md',
					'diary',
				),
			],
		});
		const calls: string[] = [];

		const result = await runArchiveMetadataTransaction({
			vault_root: root,
			run_id: 'archive-metadata-001',
			archive_date: '2026-08-01',
			move_envelope: moveEnvelope,
			adapters: metadataAdapters(root, store, calls),
		});

		expect(result.manifest.status).toBe('complete');
		expect(
			result.manifest.targets.map((target: Record<string, string>) => target.file_path),
		).toEqual([
			'90_System/Archive/Drafts/2026/08/Idea.md',
			'90_System/Archive/Plans/Plan.md',
			'90_System/Archive/Projects/2026/Demo.md',
		]);
		for (const path of result.manifest.targets.map(
			(target: Record<string, string>) => target.file_path,
		)) {
			expect(read(root, path)).toContain('status: done');
			expect(read(root, path)).toContain('archived: "2026-08-01"');
		}
		expect(read(root, '90_System/Archive/Diary/2026/07/2026-07-01.md')).not.toContain('archived:');
		expect(calls).toEqual([
			'write:90_System/Archive/Drafts/2026/08/Idea.md',
			'write:90_System/Archive/Plans/Plan.md',
			'write:90_System/Archive/Projects/2026/Demo.md',
			'notify:90_System/Archive/Drafts/2026/08/Idea.md',
			'notify:90_System/Archive/Plans/Plan.md',
			'notify:90_System/Archive/Projects/2026/Demo.md',
			'confirm:90_System/Archive/Drafts/2026/08/Idea.md',
			'confirm:90_System/Archive/Plans/Plan.md',
			'confirm:90_System/Archive/Projects/2026/Demo.md',
		]);
	});

	it('父移动清单回执无效时失败关闭且不执行元数据副作用', async () => {
		const { runArchiveMetadataTransaction } = await loadMetadataModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-metadata-parent-'));
		const store = createTrustedManifestStore();
		write(root, '00_Drafts/Idea.md', note('draft', 'Idea'));
		const moveEnvelope = (await moveIntoArchive({
			root,
			store,
			candidates: [
				moveCandidate('00_Drafts/Idea.md', '90_System/Archive/Drafts/2026/08/Idea.md', 'draft'),
			],
		})) as Record<string, unknown>;
		const calls: string[] = [];

		const result = await runArchiveMetadataTransaction({
			vault_root: root,
			run_id: 'archive-metadata-parent-invalid',
			archive_date: '2026-08-01',
			move_envelope: { ...moveEnvelope, persistence_receipt: 'forged' },
			adapters: metadataAdapters(root, store, calls),
		});

		expect(result.persistence_state).toBe('unverified');
		expect(result.manifest.status).toBe('failed');
		expect(result.manifest.errors).toContainEqual(
			expect.objectContaining({ code: 'parent_manifest_receipt_invalid' }),
		);
		expect(calls).toEqual([]);
	});

	it('目录项目存在多个主项目文件时在写入前失败关闭', async () => {
		const { runArchiveMetadataTransaction } = await loadMetadataModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-metadata-project-'));
		const store = createTrustedManifestStore();
		write(root, '20_Projects/Demo/Demo.md', note('project', 'Demo'));
		write(root, '20_Projects/Demo/Copy.md', note('project', 'Copy'));
		const moveEnvelope = await moveIntoArchive({
			root,
			store,
			candidates: [
				moveCandidate('20_Projects/Demo', '90_System/Archive/Projects/2026/Demo', 'project'),
			],
		});
		const calls: string[] = [];

		const result = await runArchiveMetadataTransaction({
			vault_root: root,
			run_id: 'archive-metadata-ambiguous-project',
			archive_date: '2026-08-01',
			move_envelope: moveEnvelope,
			adapters: metadataAdapters(root, store, calls),
		});

		expect(result.manifest.status).toBe('failed');
		expect(result.manifest.errors).toContainEqual(
			expect.objectContaining({ code: 'ambiguous_metadata_target' }),
		);
		expect(calls).toEqual([]);
	});

	it('通知失败后用同一认证 envelope 恢复，跳过已有写入回执并完成确认', async () => {
		const { runArchiveMetadataTransaction } = await loadMetadataModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-metadata-resume-'));
		const store = createTrustedManifestStore();
		write(root, '00_Drafts/Idea.md', note('draft', 'Idea'));
		const moveEnvelope = await moveIntoArchive({
			root,
			store,
			candidates: [
				moveCandidate('00_Drafts/Idea.md', '90_System/Archive/Drafts/2026/08/Idea.md', 'draft'),
			],
		});
		const calls: string[] = [];
		const firstAdapters = metadataAdapters(root, store, calls, {
			async memory_notify({ file_path }: Record<string, string>) {
				calls.push(`notify-failed:${file_path}`);
				throw new Error('notify_failed');
			},
		});

		const failed = await runArchiveMetadataTransaction({
			vault_root: root,
			run_id: 'archive-metadata-resume',
			archive_date: '2026-08-01',
			move_envelope: moveEnvelope,
			adapters: firstAdapters,
		});
		expect(failed.manifest.status).toBe('failed');

		const resumed = await runArchiveMetadataTransaction({
			vault_root: root,
			run_id: 'archive-metadata-resume',
			archive_date: '2026-08-01',
			move_envelope: moveEnvelope,
			manifest: failed,
			adapters: metadataAdapters(root, store, calls),
		});

		expect(resumed.manifest.status).toBe('complete');
		expect(calls.filter((call) => call.startsWith('write:'))).toHaveLength(1);
		expect(calls.at(-2)).toBe('notify:90_System/Archive/Drafts/2026/08/Idea.md');
		expect(calls.at(-1)).toBe('confirm:90_System/Archive/Drafts/2026/08/Idea.md');
	});
});
