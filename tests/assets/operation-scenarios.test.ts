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
		expect(result.boundary).toBe(
			'验证真实临时文件系统归档事务；外部客户端、MCP 与网络能力使用记录型适配器',
		);
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
			archive: ['create', 'resume'],
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
				'90_System/Archive/Projects/2026/Demo/Demo.md',
				'90_System/Archive/Projects/2026/Demo/docs/Guide.md',
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

	it('Archive 使用发布事务适配器整体移动目录并在 resume 时去重', async () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
		const result = await executeFixture(root);
		const archive = result.scenarios.archive;
		expect(archive.manifest.status).toBe('complete');
		expect(archive.move_calls).toHaveLength(1);
		expect(archive.manifest.moves).toHaveLength(2);
		expect(archive.notify_calls).toHaveLength(2);
		expect(archive.confirm_calls).toHaveLength(2);
		expect(archive.forget_calls).toHaveLength(1);
		expect(archive.manifest.errors).toEqual([]);
		expect(readFileSync(join(root, '90_System/Archive/Projects/2026/Demo/Demo.md'), 'utf8')).toBe(
			'project',
		);
		expect(
			readFileSync(join(root, '90_System/Archive/Projects/2026/Demo/docs/Guide.md'), 'utf8'),
		).toBe('guide');
	});
});
