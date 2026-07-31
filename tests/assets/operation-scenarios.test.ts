import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const adapterPath = join(process.cwd(), 'tests', 'assets', 'helpers', 'operation-scenarios.mjs');

async function executeFixture(root: string) {
	const { runOperationScenarioSuite } = await import(adapterPath);
	return runOperationScenarioSuite(root);
}

describe('阶段五可执行协议场景', () => {
	it('六种操作各执行两次并收敛到同一运行身份与目标', async () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
		const result = await executeFixture(root);
		expect(result.context).toBe('protocol-adapter-fixture');
		expect(result.boundary).toBe('验证技能操作协议，不执行真实客户端或网络抓取');
		expect(Object.keys(result.scenarios)).toEqual([
			'today',
			'digest',
			'research',
			'translate',
			'revise',
			'archive',
		]);
		for (const [name, expectedDecisions] of Object.entries({
			today: ['create', 'merge'],
			digest: ['create', 'merge'],
			research: ['create', 'resume'],
			translate: ['create', 'resume'],
			revise: ['create', 'resume'],
			archive: ['skip', 'skip'],
		})) {
			const runs = result.scenarios[name].runs;
			expect(runs).toHaveLength(2);
			expect(runs.map((run: { decision: string }) => run.decision)).toEqual(expectedDecisions);
			expect(runs[0].run_id).toBe(runs[1].run_id);
			expect(runs[0].target_path).toBe(runs[1].target_path);
		}
		expect(result.file_tree).toEqual(
			expect.arrayContaining([
				'10_Diary/2026-07-31.md',
				'00_Drafts/AI-2026-07-25--2026-07-31.md',
				'30_Research/agent-memory.md',
				'70_Resources/Translations/Book/Chapter-1.md',
				'40_Knowledge/Notes/Book/Chapter-1/revise.md',
			]),
		);
	});

	it('Digest 单源失败保留完整台账且两次都不是完成状态', async () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
		const result = await executeFixture(root);
		const digest = result.scenarios.digest;
		expect(digest.runs.map((run: { status: string }) => run.status)).toEqual([
			'partial',
			'partial',
		]);
		expect(digest.manifest.sources).toEqual([
			{
				id: 'rss-main',
				published_at: '2026-07-30',
				fetched_at: '2026-07-31T08:00:00Z',
				health: 'healthy',
				errors: [],
			},
			{
				id: 'paper-backup',
				published_at: null,
				fetched_at: '2026-07-31T08:00:00Z',
				health: 'failed',
				errors: ['source_timeout'],
			},
		]);
		const artifact = readFileSync(join(root, digest.runs[0].target_path), 'utf8');
		expect(JSON.parse(artifact)).toMatchObject({
			status: 'partial',
			run_id: digest.runs[0].run_id,
		});
	});

	it('Archive 碰撞在任何移动前失败并给出恢复记录', async () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
		const result = await executeFixture(root);
		const archive = result.scenarios.archive;
		expect(archive.manifest.moves).toEqual([]);
		expect(archive.manifest.collisions).toEqual([
			{ source: '20_Projects/Demo.md', target: '90_System/Archive/Projects/2026/Demo.md' },
		]);
		expect(archive.manifest.errors).toEqual(['collision_preflight']);
		expect(archive.manifest.recovery).toEqual(['resolve_collision_then_resume_same_run_id']);
		expect(readFileSync(join(root, '20_Projects/Demo.md'), 'utf8')).toBe('source');
		expect(readFileSync(join(root, '90_System/Archive/Projects/2026/Demo.md'), 'utf8')).toBe(
			'existing-target',
		);
	});
});
