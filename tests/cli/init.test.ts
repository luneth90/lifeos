import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import init from '../../src/cli/commands/init.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-init-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('lifeos init', () => {
	let dir: string;
	let cleanup: () => void;

	beforeEach(() => {
		({ dir, cleanup } = makeTmpDir());
	});

	afterEach(() => {
		cleanup();
	});

	test('zh: creates full directory structure', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Top-level directories
		const expectedDirs = [
			'00_草稿',
			'10_日记',
			'20_项目',
			'30_研究',
			'40_知识',
			'50_成果',
			'60_计划',
			'70_资源',
			'80_复盘',
			'90_系统',
		];
		for (const d of expectedDirs) {
			expect(existsSync(join(dir, d))).toBe(true);
		}

		// Subdirectories
		expect(existsSync(join(dir, '40_知识', '笔记'))).toBe(true);
		expect(existsSync(join(dir, '40_知识', '百科'))).toBe(true);
		expect(existsSync(join(dir, '90_系统', '模板'))).toBe(true);
		expect(existsSync(join(dir, '90_系统', '规范'))).toBe(true);
		expect(existsSync(join(dir, '90_系统', '记忆'))).toBe(true);

		// Reflection subdirectories
		expect(existsSync(join(dir, '80_复盘', '周复盘'))).toBe(true);
		expect(existsSync(join(dir, '80_复盘', '月复盘'))).toBe(true);
		expect(existsSync(join(dir, '80_复盘', '季度复盘'))).toBe(true);
		expect(existsSync(join(dir, '80_复盘', '年度复盘'))).toBe(true);
		expect(existsSync(join(dir, '80_复盘', '项目复盘'))).toBe(true);
		expect(existsSync(join(dir, '80_复盘', '路径校准'))).toBe(true);
	});

	test('en: creates English directory structure', async () => {
		await init([dir, '--lang', 'en', '--no-mcp']);

		const expectedDirs = [
			'00_Drafts',
			'10_Diary',
			'20_Projects',
			'30_Research',
			'40_Knowledge',
			'50_Outputs',
			'60_Plans',
			'70_Resources',
			'80_Reflection',
			'90_System',
		];
		for (const d of expectedDirs) {
			expect(existsSync(join(dir, d))).toBe(true);
		}

		// Subdirectories
		expect(existsSync(join(dir, '40_Knowledge', 'Notes'))).toBe(true);
		expect(existsSync(join(dir, '40_Knowledge', 'Wiki'))).toBe(true);
		expect(existsSync(join(dir, '90_System', 'Templates'))).toBe(true);

		// Reflection subdirectories
		expect(existsSync(join(dir, '80_Reflection', 'Weekly'))).toBe(true);
		expect(existsSync(join(dir, '80_Reflection', 'Monthly'))).toBe(true);
		expect(existsSync(join(dir, '80_Reflection', 'Quarterly'))).toBe(true);
		expect(existsSync(join(dir, '80_Reflection', 'Yearly'))).toBe(true);
		expect(existsSync(join(dir, '80_Reflection', 'Projects'))).toBe(true);
		expect(existsSync(join(dir, '80_Reflection', 'Alignment'))).toBe(true);
	});

	test('generates lifeos.yaml with correct content', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const yamlPath = join(dir, 'lifeos.yaml');
		expect(existsSync(yamlPath)).toBe(true);

		const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
		expect(config.language).toBe('zh');
		expect(config.version).toBe('1.0');
		expect(config.directories).toBeDefined();
		expect(config.subdirectories).toBeDefined();
		expect(config.memory).toBeDefined();

		const versions = config.installed_versions as Record<string, string>;
		expect(versions.cli).toBe('1.0.0');
		expect(versions.assets).toBe('1.0.0');
	});

	test('copies templates to system directory', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const templatesDir = join(dir, '90_系统', '模板');
		expect(existsSync(templatesDir)).toBe(true);
		expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(true);
		expect(existsSync(join(templatesDir, 'Project_Template.md'))).toBe(true);
	});

	test('copies schema to system directory', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const schemaDir = join(dir, '90_系统', '规范');
		expect(existsSync(schemaDir)).toBe(true);
		expect(existsSync(join(schemaDir, 'Frontmatter_Schema.md'))).toBe(true);
	});

	test('copies skills with language switching', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const skillsDir = join(dir, '.agents', 'skills');
		expect(existsSync(skillsDir)).toBe(true);

		// At least one skill should exist
		expect(existsSync(join(skillsDir, 'today'))).toBe(true);
		expect(existsSync(join(skillsDir, 'research'))).toBe(true);
	});

	test('skips lifeos-init skill', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const initSkill = join(dir, '.agents', 'skills', 'lifeos-init');
		expect(existsSync(initSkill)).toBe(false);
	});

	test('copies CLAUDE.md to vault root', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const claudePath = join(dir, 'CLAUDE.md');
		expect(existsSync(claudePath)).toBe(true);

		const content = readFileSync(claudePath, 'utf-8');
		expect(content.length).toBeGreaterThan(0);
	});

	test('creates .gitignore', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		const gitignorePath = join(dir, '.gitignore');
		expect(existsSync(gitignorePath)).toBe(true);

		const content = readFileSync(gitignorePath, 'utf-8');
		expect(content).toContain('*.db');
		expect(content).toContain('.obsidian/workspace*.json');
	});

	test('rejects if lifeos.yaml already exists', async () => {
		// First init
		await init([dir, '--lang', 'zh', '--no-mcp']);

		// Second init should fail
		await expect(init([dir, '--lang', 'zh', '--no-mcp'])).rejects.toThrow(
			'Vault already initialized',
		);
	});

	test('en: copies English templates', async () => {
		await init([dir, '--lang', 'en', '--no-mcp']);

		const templatesDir = join(dir, '90_System', 'Templates');
		expect(existsSync(templatesDir)).toBe(true);
		expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(true);
	});

	test('initializes git repository', async () => {
		await init([dir, '--lang', 'zh', '--no-mcp']);

		expect(existsSync(join(dir, '.git'))).toBe(true);
	});
});
