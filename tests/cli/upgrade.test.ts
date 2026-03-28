import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import init from '../../src/cli/commands/init.js';
import renameCommand from '../../src/cli/commands/rename.js';
import upgrade from '../../src/cli/commands/upgrade.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-upgrade-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function patchVersion(vaultDir: string, version: string) {
	updateYamlConfig(vaultDir, (config) => {
		const versions = (config.installed_versions as Record<string, string> | undefined) ?? {};
		versions.assets = version;
		config.installed_versions = versions;
	});
}

function readYamlConfig(vaultDir: string) {
	const yamlPath = join(vaultDir, 'lifeos.yaml');
	return parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
}

function updateYamlConfig(
	vaultDir: string,
	mutate: (config: Record<string, unknown>) => void,
) {
	const yamlPath = join(vaultDir, 'lifeos.yaml');
	const config = readYamlConfig(vaultDir);
	mutate(config);
	writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');
}

function sha256(content: string) {
	return createHash('sha256').update(content).digest('hex');
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

	test('same version: restores missing templates', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const templatesDir = join(dir, '90_系统', '模板');
		rmSync(templatesDir, { recursive: true, force: true });
		expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(false);

		const result = await upgrade([dir]);

		expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(true);
		expect(result.updated).toContain('90_系统/模板/Daily_Template.md');
	});

	test('same version: restores missing diary archive directory', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const archiveDiaryDir = join(dir, '90_系统', '归档', '日记');
		rmSync(archiveDiaryDir, { recursive: true, force: true });
		expect(existsSync(archiveDiaryDir)).toBe(false);

		await upgrade([dir]);

		expect(existsSync(archiveDiaryDir)).toBe(true);
	});

	test('skips modified templates during upgrade', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify a template file
		const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		expect(existsSync(templatePath)).toBe(true);
		writeFileSync(templatePath, 'USER MODIFIED CONTENT', 'utf-8');

		// Patch version so upgrade proceeds
		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Template should be preserved
		const afterUpgrade = readFileSync(templatePath, 'utf-8');
		expect(afterUpgrade).toBe('USER MODIFIED CONTENT');

		// Should appear in skipped list
		expect(result.skipped).toContain('90_系统/模板/Daily_Template.md');
	});

	test('override overwrites modified templates during upgrade', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		const latestTemplate = readFileSync(templatePath, 'utf-8');
		writeFileSync(templatePath, 'USER MODIFIED CONTENT', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir, '--override']);

		expect(readFileSync(templatePath, 'utf-8')).toBe(latestTemplate);
		expect(result.updated).toContain('90_系统/模板/Daily_Template.md');
		expect(result.skipped).not.toContain('90_系统/模板/Daily_Template.md');
	});

	test('upgrades tracked unchanged templates when managed hash matches current content', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		const latestTemplate = readFileSync(templatePath, 'utf-8');
		const previousTemplate = 'OLDER MANAGED TEMPLATE CONTENT';
		writeFileSync(templatePath, previousTemplate, 'utf-8');

		updateYamlConfig(dir, (config) => {
			const versions = (config.installed_versions as Record<string, string> | undefined) ?? {};
			versions.assets = '0.0.1';
			config.installed_versions = versions;
			config.managed_assets = {
				...(config.managed_assets as Record<string, unknown> | undefined),
				'90_系统/模板/Daily_Template.md': {
					version: '0.0.1',
					sha256: sha256(previousTemplate),
				},
			};
		});

		const result = await upgrade([dir]);
		const config = readYamlConfig(dir) as {
			managed_assets?: Record<string, { version?: string; sha256?: string }>;
		};

		expect(readFileSync(templatePath, 'utf-8')).toBe(latestTemplate);
		expect(result.updated).toContain('90_系统/模板/Daily_Template.md');
		expect(config.managed_assets?.['90_系统/模板/Daily_Template.md']).toEqual({
			version: '1.0.2',
			sha256: sha256(latestTemplate),
		});
	});

	test('smart-merge still upgrades tracked templates after renaming the system directory', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const oldTemplatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		const latestTemplate = readFileSync(oldTemplatePath, 'utf-8');
		const previousTemplate = 'OLDER MANAGED TEMPLATE CONTENT';
		writeFileSync(oldTemplatePath, previousTemplate, 'utf-8');

		updateYamlConfig(dir, (config) => {
			const versions = (config.installed_versions as Record<string, string> | undefined) ?? {};
			versions.assets = '0.0.1';
			config.installed_versions = versions;
			config.managed_assets = {
				...(config.managed_assets as Record<string, unknown> | undefined),
				'90_系统/模板/Daily_Template.md': {
					version: '0.0.1',
					sha256: sha256(previousTemplate),
				},
			};
		});

		await renameCommand([dir, '--logical', 'system', '--name', '99_系统']);

		const result = await upgrade([dir]);
		const renamedTemplatePath = join(dir, '99_系统', '模板', 'Daily_Template.md');

		expect(readFileSync(renamedTemplatePath, 'utf-8')).toBe(latestTemplate);
		expect(result.updated).toContain('99_系统/模板/Daily_Template.md');
		expect(result.skipped).not.toContain('99_系统/模板/Daily_Template.md');
	});

	test('skips modified schema during upgrade', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Modify a schema file
		const schemaPath = join(dir, '90_系统', '规范', 'Frontmatter_Schema.md');
		expect(existsSync(schemaPath)).toBe(true);
		writeFileSync(schemaPath, 'USER MODIFIED SCHEMA', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		const afterUpgrade = readFileSync(schemaPath, 'utf-8');
		expect(afterUpgrade).toBe('USER MODIFIED SCHEMA');
		expect(result.skipped).toContain('90_系统/规范/Frontmatter_Schema.md');
	});

	test('skips modified prompts during upgrade', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const promptPath = join(dir, '90_系统', '提示词', 'AI_LLMResearch_Prompt.md');
		expect(existsSync(promptPath)).toBe(true);
		writeFileSync(promptPath, 'USER MODIFIED PROMPT', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		expect(readFileSync(promptPath, 'utf-8')).toBe('USER MODIFIED PROMPT');
		expect(result.skipped).toContain('90_系统/提示词/AI_LLMResearch_Prompt.md');
	});

	test('skips differing templates conservatively when managed hash metadata is missing', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
		writeFileSync(templatePath, 'LEGACY TEMPLATE WITHOUT MANIFEST', 'utf-8');

		updateYamlConfig(dir, (config) => {
			const versions = (config.installed_versions as Record<string, string> | undefined) ?? {};
			versions.assets = '0.0.1';
			config.installed_versions = versions;
			delete config.managed_assets;
		});

		const result = await upgrade([dir]);

		expect(readFileSync(templatePath, 'utf-8')).toBe('LEGACY TEMPLATE WITHOUT MANIFEST');
		expect(result.skipped).toContain('90_系统/模板/Daily_Template.md');
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

	test('override overwrites modified skill files', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const skillPath = join(dir, '.agents', 'skills', 'today', 'SKILL.md');
		const latestSkill = readFileSync(skillPath, 'utf-8');
		writeFileSync(skillPath, 'USER CUSTOMIZED SKILL', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir, '--override']);

		expect(readFileSync(skillPath, 'utf-8')).toBe(latestSkill);
		expect(result.updated).toContain('.agents/skills/today/SKILL.md');
		expect(result.skipped).not.toContain('.agents/skills/today/SKILL.md');
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

	test('override overwrites rules files', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const claudePath = join(dir, 'CLAUDE.md');
		const agentsPath = join(dir, 'AGENTS.md');
		const originalClaude = readFileSync(claudePath, 'utf-8');
		const originalAgents = readFileSync(agentsPath, 'utf-8');

		writeFileSync(claudePath, 'MY CUSTOM CLAUDE INSTRUCTIONS', 'utf-8');
		writeFileSync(agentsPath, 'MY CUSTOM AGENTS INSTRUCTIONS', 'utf-8');

		patchVersion(dir, '0.0.1');

		await upgrade([dir, '--override']);

		expect(readFileSync(claudePath, 'utf-8')).toBe(originalClaude);
		expect(readFileSync(agentsPath, 'utf-8')).toBe(originalAgents);
	});

	test('updates installed_versions in lifeos.yaml', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		patchVersion(dir, '0.0.1');

		await upgrade([dir]);

		const config = readYamlConfig(dir);
		const versions = config.installed_versions as Record<string, string>;
		expect(versions.assets).toBe('1.0.2');
		expect(versions.cli).toBe('1.0.2');
	});

	test('en: skips modified English templates', async () => {
		await init([dir, '--lang', 'en', '--no-mcp']);

		const templatePath = join(dir, '90_System', 'Templates', 'Daily_Template.md');
		expect(existsSync(templatePath)).toBe(true);
		writeFileSync(templatePath, 'MODIFIED', 'utf-8');

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		expect(readFileSync(templatePath, 'utf-8')).toBe('MODIFIED');
		expect(result.skipped).toContain('90_System/Templates/Daily_Template.md');
	});

	test('reports unchanged skill files', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		patchVersion(dir, '0.0.1');

		const result = await upgrade([dir]);

		// Skills were just installed and not modified, so they should be unchanged
		expect(result.unchanged.length).toBeGreaterThan(0);
	});

	test('merges missing zh preset keys from partial lifeos.yaml', async () => {
		writeFileSync(
			join(dir, 'lifeos.yaml'),
			[
				"version: '1.0'",
				'language: zh',
				'directories:',
				'  system: "90_系统"',
				'subdirectories:',
				'  knowledge:',
				'    notes: "笔记"',
				'    wiki: "百科"',
				'  resources:',
				'    books: "书籍"',
				'    literature: "文献"',
				'installed_versions:',
				'  assets: "0.0.1"',
				'',
			].join('\n'),
			'utf-8',
		);

		const result = await upgrade([dir]);
		const config = readYamlConfig(dir);

		expect(existsSync(join(dir, '90_系统', '模板', 'Daily_Template.md'))).toBe(true);
		expect(result.updated).toContain('90_系统/模板/Daily_Template.md');
		expect((config.subdirectories as { system?: { templates?: string } }).system?.templates).toBe(
			'模板',
		);
		expect(
			(
				config.subdirectories as { system?: { archive?: Record<string, string> } }
			).system?.archive?.diary,
		).toBe('归档/日记');
	});

	test('restores missing init-managed directories and files', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		rmSync(join(dir, '90_系统', '记忆'), { recursive: true, force: true });
		rmSync(join(dir, '90_系统', '归档', '日记'), { recursive: true, force: true });
		rmSync(join(dir, '.claude'), { recursive: true, force: true });
		rmSync(join(dir, 'CLAUDE.md'), { force: true });
		rmSync(join(dir, 'AGENTS.md'), { force: true });
		rmSync(join(dir, '.gitignore'), { force: true });

		await upgrade([dir]);

		expect(existsSync(join(dir, '90_系统', '记忆'))).toBe(true);
		expect(existsSync(join(dir, '90_系统', '归档', '日记'))).toBe(true);
		expect(existsSync(join(dir, '.claude', 'skills'))).toBe(true);
		expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
		expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
		expect(existsSync(join(dir, '.gitignore'))).toBe(true);
	});

	test('recreates git metadata when missing', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);
		rmSync(join(dir, '.git'), { recursive: true, force: true });

		await upgrade([dir]);

		expect(existsSync(join(dir, '.git'))).toBe(true);
	});

	test('registers missing MCP config entries during upgrade', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
		expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(false);
		expect(existsSync(join(dir, 'opencode.json'))).toBe(false);

		await upgrade([dir]);

		const claudeConfig = parseYaml(readFileSync(join(dir, '.mcp.json'), 'utf-8')) as {
			mcpServers?: Record<string, { command?: string; args?: string[] }>;
		};
		expect(claudeConfig.mcpServers?.lifeos?.command).toBe('lifeos');
		expect(claudeConfig.mcpServers?.lifeos?.args).toEqual(['--vault-root', dir]);

		const codexConfig = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8');
		expect(codexConfig).toContain('[mcp_servers.lifeos]');
		expect(codexConfig).toContain('command = "lifeos"');
		expect(codexConfig).toContain(`"--vault-root", "${dir}"`);

		const openCodeConfig = parseYaml(readFileSync(join(dir, 'opencode.json'), 'utf-8')) as {
			mcp?: Record<string, { type?: string; command?: string[] }>;
		};
		expect(openCodeConfig.mcp?.lifeos?.type).toBe('local');
		expect(openCodeConfig.mcp?.lifeos?.command).toEqual(['lifeos', '--vault-root', dir]);
	});

	test('fills missing lifeos MCP fields without overwriting existing values', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		writeFileSync(
			join(dir, '.mcp.json'),
			JSON.stringify(
				{
					mcpServers: {
						lifeos: { command: 'custom-command' },
						existing: { command: 'keep-me', args: ['foo'] },
					},
				},
				null,
				2,
			),
			'utf-8',
		);
		ensureDirForTest(join(dir, '.codex'));
		writeFileSync(
			join(dir, '.codex', 'config.toml'),
			[
				'[mcp_servers.lifeos]',
				'command = "custom-command"',
				'',
				'[mcp_servers.existing]',
				'command = "keep-me"',
				'args = ["foo"]',
				'',
			].join('\n'),
			'utf-8',
		);
		writeFileSync(
			join(dir, 'opencode.json'),
			JSON.stringify(
				{
					mcp: {
						lifeos: { type: 'remote' },
						existing: { type: 'local', command: ['keep-me'] },
					},
				},
				null,
				2,
			),
			'utf-8',
		);

		await upgrade([dir]);

		const claudeConfig = parseYaml(readFileSync(join(dir, '.mcp.json'), 'utf-8')) as {
			mcpServers?: Record<string, { command?: string; args?: string[] }>;
		};
		expect(claudeConfig.mcpServers?.lifeos?.command).toBe('custom-command');
		expect(claudeConfig.mcpServers?.lifeos?.args).toEqual(['--vault-root', dir]);
		expect(claudeConfig.mcpServers?.existing).toEqual({ command: 'keep-me', args: ['foo'] });

		const codexConfig = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8');
		expect(codexConfig).toContain('[mcp_servers.lifeos]');
		expect(codexConfig).toContain('command = "custom-command"');
		expect(codexConfig).toContain(`args = ["--vault-root", "${dir}"]`);
		expect(codexConfig).toContain('[mcp_servers.existing]');

		const openCodeConfig = parseYaml(readFileSync(join(dir, 'opencode.json'), 'utf-8')) as {
			mcp?: Record<string, { type?: string; command?: string[] }>;
		};
		expect(openCodeConfig.mcp?.lifeos?.type).toBe('remote');
		expect(openCodeConfig.mcp?.lifeos?.command).toEqual(['lifeos', '--vault-root', dir]);
		expect(openCodeConfig.mcp?.existing).toEqual({ type: 'local', command: ['keep-me'] });
	});

	test('override replaces existing lifeos MCP config entries', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		writeFileSync(
			join(dir, '.mcp.json'),
			JSON.stringify(
				{
					mcpServers: {
						lifeos: { command: 'custom-command', args: ['--foo'] },
						existing: { command: 'keep-me', args: ['foo'] },
					},
				},
				null,
				2,
			),
			'utf-8',
		);
		ensureDirForTest(join(dir, '.codex'));
		writeFileSync(
			join(dir, '.codex', 'config.toml'),
			[
				'[mcp_servers.lifeos]',
				'command = "custom-command"',
				'args = ["--foo"]',
				'',
				'[mcp_servers.existing]',
				'command = "keep-me"',
				'args = ["foo"]',
				'',
			].join('\n'),
			'utf-8',
		);
		writeFileSync(
			join(dir, 'opencode.json'),
			JSON.stringify(
				{
					mcp: {
						lifeos: { type: 'remote', command: ['custom-command', '--foo'] },
						existing: { type: 'local', command: ['keep-me'] },
					},
				},
				null,
				2,
			),
			'utf-8',
		);

		await upgrade([dir, '--override']);

		const claudeConfig = parseYaml(readFileSync(join(dir, '.mcp.json'), 'utf-8')) as {
			mcpServers?: Record<string, { command?: string; args?: string[] }>;
		};
		expect(claudeConfig.mcpServers?.lifeos).toEqual({
			command: 'lifeos',
			args: ['--vault-root', dir],
		});
		expect(claudeConfig.mcpServers?.existing).toEqual({ command: 'keep-me', args: ['foo'] });

		const codexConfig = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8');
		expect(codexConfig).toContain('[mcp_servers.lifeos]');
		expect(codexConfig).toContain('command = "lifeos"');
		expect(codexConfig).toContain(`args = ["--vault-root", "${dir}"]`);
		expect(codexConfig).toContain('[mcp_servers.existing]');
		expect(codexConfig).toContain('command = "keep-me"');

		const openCodeConfig = parseYaml(readFileSync(join(dir, 'opencode.json'), 'utf-8')) as {
			mcp?: Record<string, { type?: string; command?: string[] }>;
		};
		expect(openCodeConfig.mcp?.lifeos).toEqual({
			type: 'local',
			command: ['lifeos', '--vault-root', dir],
		});
		expect(openCodeConfig.mcp?.existing).toEqual({ type: 'local', command: ['keep-me'] });
	});

	test('override preserves custom config and user-generated data', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		updateYamlConfig(dir, (config) => {
			config.directories = {
				...(config.directories as Record<string, unknown>),
				knowledge: '40_CustomKnowledge',
				system: '99_CustomSystem',
			};
			config.subdirectories = {
				...(config.subdirectories as Record<string, unknown>),
				knowledge: {
					...((config.subdirectories as { knowledge?: Record<string, string> }).knowledge ?? {}),
					notes: 'MyNotes',
					wiki: 'MyWiki',
				},
				system: {
					...(
						(config.subdirectories as {
							system?: Record<string, string | Record<string, string>>;
						}).system ?? {}
					),
					templates: 'MyTemplates',
				},
			};
		});

		const userNotePath = join(dir, '40_CustomKnowledge', 'MyNotes', 'user-note.md');
		ensureDirForTest(join(dir, '40_CustomKnowledge', 'MyNotes'));
		writeFileSync(userNotePath, '# user note\n', 'utf-8');

		const memoryDbPath = join(dir, 'memory.db');
		writeFileSync(memoryDbPath, 'sqlite-placeholder', 'utf-8');

		await upgrade([dir, '--override']);

		const config = readYamlConfig(dir) as {
			directories: { knowledge: string; system: string };
			subdirectories: {
				knowledge: { notes: string; wiki: string };
				system: { templates: string };
			};
		};
		expect(config.directories.knowledge).toBe('40_CustomKnowledge');
		expect(config.directories.system).toBe('99_CustomSystem');
		expect(config.subdirectories.knowledge.notes).toBe('MyNotes');
		expect(config.subdirectories.system.templates).toBe('MyTemplates');
		expect(readFileSync(userNotePath, 'utf-8')).toBe('# user note\n');
		expect(readFileSync(memoryDbPath, 'utf-8')).toBe('sqlite-placeholder');
	});
});

function ensureDirForTest(path: string) {
	mkdirSync(path, { recursive: true });
}
