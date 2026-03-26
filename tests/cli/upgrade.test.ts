import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import init from '../../src/cli/commands/init.js';
import upgrade from '../../src/cli/commands/upgrade.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-upgrade-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function patchVersion(vaultDir: string, version: string) {
	const yamlPath = join(vaultDir, 'lifeos.yaml');
	const content = readFileSync(yamlPath, 'utf-8');
	const config = parseYaml(content) as Record<string, Record<string, string>>;
	config.installed_versions.assets = version;
	writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');
}

function readYamlConfig(vaultDir: string) {
	const yamlPath = join(vaultDir, 'lifeos.yaml');
	return parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
}

describe('lifeos upgrade', () => {
	let dir: string;
	let cleanup: () => void;

	beforeEach(() => {
		({ dir, cleanup } = makeTmpDir());
	});

	afterEach(() => {
		cleanup();
	});

	test('errors when no lifeos.yaml found', async () => {
		await expect(upgrade([dir])).rejects.toThrow('No lifeos.yaml found');
	});

	test('same version: outputs already up to date', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// installed_versions.assets already equals VERSION, so upgrade should be no-op
		const result = await upgrade([dir]);
		expect(result.updated).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
		expect(result.unchanged).toHaveLength(0);
	});

	test('overwrites templates (Tier 1)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify a template file
		const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		expect(existsSync(templatePath)).toBe(true);
		const original = readFileSync(templatePath, 'utf-8');
		writeFileSync(templatePath, 'USER MODIFIED CONTENT', 'utf-8');

		// Patch version so upgrade proceeds
		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Template should be overwritten with original
		const afterUpgrade = readFileSync(templatePath, 'utf-8');
		expect(afterUpgrade).toBe(original);
		expect(afterUpgrade).not.toBe('USER MODIFIED CONTENT');

		// Should appear in updated list
		expect(result.updated).toContain('90_系统/模板/Daily_Template.md');
	});

	test('overwrites schema (Tier 1)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify a schema file
		const schemaPath = join(dir, '90_系统', '规范', 'Frontmatter_Schema.md');
		expect(existsSync(schemaPath)).toBe(true);
		const original = readFileSync(schemaPath, 'utf-8');
		writeFileSync(schemaPath, 'USER MODIFIED SCHEMA', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		const afterUpgrade = readFileSync(schemaPath, 'utf-8');
		expect(afterUpgrade).toBe(original);
		expect(afterUpgrade).not.toBe('USER MODIFIED SCHEMA');
		expect(result.updated).toContain('90_系统/规范/Frontmatter_Schema.md');
	});

	test('skips modified skill files (Tier 2)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify a skill file
		const skillPath = join(dir, '.agents', 'skills', 'today', 'SKILL.md');
		expect(existsSync(skillPath)).toBe(true);
		writeFileSync(skillPath, 'USER CUSTOMIZED SKILL', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Should be skipped, not overwritten
		const afterUpgrade = readFileSync(skillPath, 'utf-8');
		expect(afterUpgrade).toBe('USER CUSTOMIZED SKILL');
		expect(result.skipped).toContain('.agents/skills/today/SKILL.md');
	});

	test('copies new skill files (Tier 2)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Delete a skill directory
		const skillDir = join(dir, '.agents', 'skills', 'today');
		rmSync(skillDir, { recursive: true, force: true });
		expect(existsSync(skillDir)).toBe(false);

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Should restore the skill
		expect(existsSync(skillDir)).toBe(true);
		expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);

		// Should appear in updated list
		const todayUpdated = result.updated.filter((p) => p.startsWith('.agents/skills/today/'));
		expect(todayUpdated.length).toBeGreaterThan(0);
	});

	test('does not touch CLAUDE.md (Tier 3)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify CLAUDE.md
		const claudePath = join(dir, 'CLAUDE.md');
		writeFileSync(claudePath, 'MY CUSTOM CLAUDE INSTRUCTIONS', 'utf-8');

		patchVersion(dir, '0.0.1');

		await upgrade([dir]);

		// CLAUDE.md should keep user's modifications
		const afterUpgrade = readFileSync(claudePath, 'utf-8');
		expect(afterUpgrade).toBe('MY CUSTOM CLAUDE INSTRUCTIONS');
	});

	test('does not touch AGENTS.md (Tier 3)', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify AGENTS.md
		const agentsPath = join(dir, 'AGENTS.md');
		writeFileSync(agentsPath, 'MY CUSTOM AGENTS INSTRUCTIONS', 'utf-8');

		patchVersion(dir, '0.0.1');

		await upgrade([dir]);

		// AGENTS.md should keep user's modifications
		const afterUpgrade = readFileSync(agentsPath, 'utf-8');
		expect(afterUpgrade).toBe('MY CUSTOM AGENTS INSTRUCTIONS');
	});

	test('updates installed_versions in lifeos.yaml', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		patchVersion(dir, '0.0.1');

		await upgrade([dir]);

		const config = readYamlConfig(dir);
		const versions = config.installed_versions as Record<string, string>;
		expect(versions.assets).toBe('1.0.0');
		expect(versions.cli).toBe('1.0.0');
	});

	test('en: overwrites English templates', async () => {
		await init([dir, '--lang', 'en', '--no-mcp']);

		const templatePath = join(dir, '90_System', 'Templates', 'Daily_Template.md');
		expect(existsSync(templatePath)).toBe(true);
		const original = readFileSync(templatePath, 'utf-8');
		writeFileSync(templatePath, 'MODIFIED', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		expect(readFileSync(templatePath, 'utf-8')).toBe(original);
		expect(result.updated).toContain('90_System/Templates/Daily_Template.md');
	});

	test('reports unchanged skill files', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Skills were just installed and not modified, so they should be unchanged
		expect(result.unchanged.length).toBeGreaterThan(0);
	});
});
