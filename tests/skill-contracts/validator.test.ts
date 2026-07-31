import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_PRESET } from '../../src/config.js';

const repositoryRoot = process.cwd();
const scriptPath = join(repositoryRoot, 'scripts', 'validate-skill-contracts.mjs');

async function loadValidator(): Promise<
	typeof import('../../scripts/validate-skill-contracts.mjs')
> {
	return import(scriptPath);
}

describe('技能契约校验器', () => {
	it('英文默认路径映射与运行时配置保持一致', async () => {
		const { englishDefaultPathConfig } = await loadValidator();
		expect(englishDefaultPathConfig()).toEqual({
			directories: EN_PRESET.directories,
			subdirectories: EN_PRESET.subdirectories,
		});
	});

	it('缺少 assets 根目录时返回结构化诊断', async () => {
		const { validateSkillContracts } = await loadValidator();
		const result = validateSkillContracts(join(tmpdir(), `lifeos-missing-assets-${Date.now()}`));
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [
				{
					code: 'missing_assets_root',
					path: '.',
					message: expect.stringContaining('找不到 assets 目录'),
				},
			],
		});
	});

	async function expectMutatedAssetsDiagnostic(
		mutate: (write: (relativePath: string, transform: (content: string) => string) => void) => void,
		expected: { code: string; path: string; related_path?: string },
	): Promise<void> {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-red-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const write = (relativePath: string, transform: (content: string) => string) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			};
			mutate(write);

			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual(
				expect.arrayContaining([expect.objectContaining(expected)]),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}

	it.each([
		[
			'中文物理路径',
			(write) =>
				write(
					'assets/skills/_shared/memory-protocol.zh.md',
					(content) => `${content}\n00_草稿/leak.md\n`,
				),
			{ code: 'hardcoded_logical_path', path: 'assets/skills/_shared/memory-protocol.zh.md' },
		],
		[
			'英文物理路径',
			(write) =>
				write(
					'assets/skills/_shared/memory-protocol.en.md',
					(content) => `${content}\n00_Drafts/leak.md\n`,
				),
			{ code: 'hardcoded_logical_path', path: 'assets/skills/_shared/memory-protocol.en.md' },
		],
		[
			'遗漏 Schema 生成类型映射',
			(write) =>
				write('assets/schema/Frontmatter_Schema.md', (content) =>
					content.replace('  note:\n    statuses: []\n    template: Daily_Template.md\n', ''),
				),
			{ code: 'unknown_generated_type', path: 'assets/templates/en/Daily_Template.md' },
		],
		[
			'缺少操作预检字段但保留正文关键词',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('preflight: required\n', '').replace('**Preflight**', '**preflight**'),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'缺少操作清单字段',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('manifest:', 'manifest_removed:'),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'错误操作决策枚举',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'decision: [create, merge, resume, skip, replace]',
						'decision: [create, overwrite]',
					),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'遗漏修改型技能的协议依赖',
			(write) =>
				write('assets/skills/ask/SKILL.en.md', (content) =>
					content.replace('  protocols:\n    - path: ../_shared/operation-safety.md\n', ''),
				),
			{ code: 'missing_operation_safety_reference', path: 'assets/skills/ask/SKILL.en.md' },
		],
		[
			'能力机器数组漂移',
			(write) =>
				write('assets/skills/_shared/client-capabilities.en.md', (content) =>
					content.replace('"exec_command"', '"shell_command"'),
				),
			{
				code: 'capability_contract_mismatch',
				path: 'assets/skills/_shared/client-capabilities.zh.md',
				related_path: 'assets/skills/_shared/client-capabilities.en.md',
			},
		],
		[
			'能力版本漂移',
			(write) =>
				write('assets/skills/_shared/client-capabilities.en.md', (content) =>
					content.replace('contract_version: 1', 'contract_version: 2'),
				),
			{
				code: 'capability_contract_mismatch',
				path: 'assets/skills/_shared/client-capabilities.zh.md',
			},
		],
		[
			'同名模板但错误逻辑目录',
			(write) =>
				write('assets/skills/ask/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{templates subdirectory}/Draft_Template.md',
						'{system directory}/wrong/Draft_Template.md',
					),
				),
			{ code: 'invalid_dependency_path', path: 'assets/skills/ask/SKILL.en.md' },
		],
	])('拒绝%s', async (_name, mutate, expected) => {
		await expectMutatedAssetsDiagnostic(mutate, expected);
	});

	it.each([
		[
			'path_guard 标量',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(/path_guard:\n(?: {2}.*\n)+?manifest:/, 'path_guard: invalid\nmanifest:'),
				),
		],
		[
			'path_guard 缺少 revalidate',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('  revalidate: revalidateVaultPathGuard\n', ''),
				),
		],
		[
			'manifest 为字符串',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }',
						'manifest: invalid',
					),
				),
		],
		[
			'通知枚举漂移',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('notification: memory_notify', 'notification: notify'),
				),
		],
		[
			'恢复枚举漂移',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('recovery: resume_same_run_id', 'recovery: retry'),
				),
		],
	])('独立拒绝操作安全契约：%s', async (_name, mutate) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-safety-contract-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			mutate((relativePath, transform) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			});
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual([
				{
					code: 'invalid_operation_safety_contract',
					path: 'assets/skills/_shared/operation-safety.en.md',
					message: '操作安全机器契约字段或值非法',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'templates',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{templates subdirectory}/Research_Template.md',
						'{typo directory}/{templates subdirectory}/Research_Template.md',
					),
				),
			'依赖路径不符合 templates 语法：{typo directory}/{templates subdirectory}/Research_Template.md',
		],
		[
			'schemas',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{schema subdirectory}/Frontmatter_Schema.md',
						'{typo directory}/{schema subdirectory}/Frontmatter_Schema.md',
					),
				),
			'依赖路径不符合 schemas 语法：{typo directory}/{schema subdirectory}/Frontmatter_Schema.md',
		],
		[
			'agents',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'references/planning-agent-prompt.md',
						'references/../planning-agent-prompt.md',
					),
				),
			'依赖路径不符合 agents 语法：references/../planning-agent-prompt.md',
		],
		[
			'references',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'  protocols:',
						'  references:\n    - path: references/../planning-agent-prompt.md\n  protocols:',
					),
				),
			'依赖路径不符合 references 语法：references/../planning-agent-prompt.md',
		],
		[
			'prompts',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{prompts subdirectory}/',
						'{typo directory}/{prompts subdirectory}/',
					),
				),
			'依赖路径不符合 prompts 语法：{typo directory}/{prompts subdirectory}/',
		],
		[
			'protocols',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace('../_shared/operation-safety.md', '../_shared/other.md'),
				),
			'依赖路径不符合 protocols 语法：../_shared/other.md',
		],
		[
			'未知 Agent 占位符',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace('invocation: "{{RESEARCH_INPUT}}"', 'invocation: "{{UNKNOWN}}"'),
				),
			'Agent 调用声明与提示词占位符不一致：references/planning-agent-prompt.md',
		],
	])('独立拒绝依赖：%s', async (_name, mutate, expectedMessage) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-dependency-contract-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			mutate((relativePath, transform) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			});
			const { validateSkillContracts } = await loadValidator();
			const result = validateSkillContracts(root);
			const expectedCode =
				_name === '未知 Agent 占位符' ? 'placeholder_mismatch' : 'invalid_dependency_path';
			expect(result.diagnostics).toEqual([
				{
					code: expectedCode,
					path: 'assets/skills/research/SKILL.en.md',
					message:
						expectedCode === 'placeholder_mismatch'
							? 'Agent 调用声明与提示词占位符不一致：references/planning-agent-prompt.md'
							: expectedMessage,
					...(expectedCode === 'placeholder_mismatch'
						? { related_path: 'assets/skills/research/references/planning-agent-prompt.en.md' }
						: {}),
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('真实 assets 通过所有跨资产检查', async () => {
		const { validateSkillContracts } = await loadValidator();
		expect(validateSkillContracts(repositoryRoot)).toEqual({ ok: true, diagnostics: [] });
	});

	it('CLI 对缺失 assets 根返回单条 JSON 诊断，对真实 assets 返回 0', () => {
		const missingRoot = join(tmpdir(), `lifeos-missing-assets-cli-${Date.now()}`);
		const failed = spawnSync(process.execPath, [scriptPath, missingRoot], { encoding: 'utf8' });
		expect(failed.status).toBe(1);
		expect(failed.stderr.trim().split('\n').map(JSON.parse)).toEqual([
			{
				code: 'missing_assets_root',
				path: '.',
				message: `找不到 assets 目录：${missingRoot}`,
			},
		]);

		const passed = spawnSync(process.execPath, [scriptPath, repositoryRoot], { encoding: 'utf8' });
		expect(passed.status).toBe(0);
		expect(passed.stdout).toContain('技能契约校验通过');
	});
});
