import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const scriptPath = join(repositoryRoot, 'scripts', 'validate-skill-contracts.mjs');
const fixtureRoot = join(repositoryRoot, 'tests', 'fixtures', 'skill-contracts', 'broken');

async function loadValidator(): Promise<
	typeof import('../../scripts/validate-skill-contracts.mjs')
> {
	return import(scriptPath);
}

describe('技能契约校验器', () => {
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
