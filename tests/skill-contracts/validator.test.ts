import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_PRESET } from '../../src/config.js';

const repositoryRoot = process.cwd();
const scriptPath = join(repositoryRoot, 'scripts', 'validate-skill-contracts.mjs');
const fixtureRoot = join(repositoryRoot, 'tests', 'fixtures', 'skill-contracts', 'broken');

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

	it('报告每类最小错误资产的稳定诊断', async () => {
		const { validateSkillContracts } = await loadValidator();
		const result = validateSkillContracts(fixtureRoot);
		const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

		expect(result.ok).toBe(false);
		for (const code of [
			'missing_locale_pair',
			'missing_dependency',
			'placeholder_mismatch',
			'unknown_generated_type',
			'invalid_template_id',
			'hardcoded_logical_path',
			'undeclared_capability',
			'invalid_lifecycle_transition',
			'capability_contract_mismatch',
			'invalid_schema_json',
		]) {
			expect(codes, `缺少 ${code}`).toContain(code);
		}
		for (const diagnostic of result.diagnostics) {
			expect(diagnostic).toMatchObject({
				code: expect.any(String),
				path: expect.any(String),
				message: expect.any(String),
			});
		}
		expect(result.diagnostics).toEqual(
			[...result.diagnostics].sort((left, right) =>
				`${left.path}\u0000${left.code}\u0000${left.related_path ?? ''}`.localeCompare(
					`${right.path}\u0000${right.code}\u0000${right.related_path ?? ''}`,
				),
			),
		);
	});

	it('真实 assets 通过所有跨资产检查', async () => {
		const { validateSkillContracts } = await loadValidator();
		expect(validateSkillContracts(repositoryRoot)).toEqual({ ok: true, diagnostics: [] });
	});

	it('CLI 对失败资产返回 1，对真实 assets 返回 0', () => {
		const failed = spawnSync(process.execPath, [scriptPath, fixtureRoot], { encoding: 'utf8' });
		expect(failed.status).toBe(1);
		expect(failed.stderr).toContain('missing_locale_pair');

		const passed = spawnSync(process.execPath, [scriptPath, repositoryRoot], { encoding: 'utf8' });
		expect(passed.status).toBe(0);
		expect(passed.stdout).toContain('技能契约校验通过');
	});
});
