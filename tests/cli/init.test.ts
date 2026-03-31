import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import init from '../../src/cli/commands/init.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-init-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const ZH_DIRS = {
	drafts: '00_草稿',
	system: '90_系统',
	knowledge: '40_知识',
	reflection: '80_复盘',
	notes: '笔记',
	wiki: '百科',
	templates: '模板',
	schema: '规范',
	memory: '记忆',
	digest: '信息',
	archiveDiary: '归档/日记',
	reflectionSubs: ['周复盘', '月复盘', '季度复盘', '年度复盘', '项目复盘'],
	topLevel: [
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
	],
};

const EN_DIRS = {
	drafts: '00_Drafts',
	system: '90_System',
	knowledge: '40_Knowledge',
	reflection: '80_Reflection',
	notes: 'Notes',
	wiki: 'Wiki',
	templates: 'Templates',
	schema: 'Schema',
	memory: 'Memory',
	digest: 'Digest',
	archiveDiary: 'Archive/Diary',
	reflectionSubs: ['Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Projects'],
	topLevel: [
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
	],
};

const DIRS = { zh: ZH_DIRS, en: EN_DIRS };

describe.each(['zh', 'en'] as const)('lifeos init --lang %s', (lang) => {
	let dir: string;
	let cleanup: () => void;
	const d = DIRS[lang];

	beforeEach(() => {
		({ dir, cleanup } = makeTmpDir());
	});

	afterEach(() => {
		cleanup();
	});

	test('creates full directory structure', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		// Top-level directories
		for (const name of d.topLevel) {
			expect(existsSync(join(dir, name))).toBe(true);
		}

		// Subdirectories
		expect(existsSync(join(dir, d.knowledge, d.notes))).toBe(true);
		expect(existsSync(join(dir, d.knowledge, d.wiki))).toBe(true);
			expect(existsSync(join(dir, d.system, d.templates))).toBe(true);
			expect(existsSync(join(dir, d.system, d.schema))).toBe(true);
			expect(existsSync(join(dir, d.system, d.memory))).toBe(true);
			expect(existsSync(join(dir, d.system, d.digest))).toBe(true);
			expect(existsSync(join(dir, d.system, d.archiveDiary))).toBe(true);

		// Reflection subdirectories
		for (const sub of d.reflectionSubs) {
			expect(existsSync(join(dir, d.reflection, sub))).toBe(true);
		}
	});

	test('generates lifeos.yaml with correct language', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const yamlPath = join(dir, 'lifeos.yaml');
		expect(existsSync(yamlPath)).toBe(true);

		const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
		expect(config.language).toBe(lang);
		expect(config.version).toBe('1.0');
			expect(config.directories).toBeDefined();
			expect(config.subdirectories).toBeDefined();
			expect(config.memory).toBeDefined();
			expect(
				(config.subdirectories as { system?: { digest?: string } }).system?.digest,
			).toBe(d.digest);

		const versions = config.installed_versions as Record<string, string>;
		expect(versions.cli).toBe('1.1.2');
		expect(versions.assets).toBe('1.1.2');
	});

	test('records managed asset hashes in lifeos.yaml', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const config = parseYaml(readFileSync(join(dir, 'lifeos.yaml'), 'utf-8')) as {
			managed_assets?: Record<string, { version?: string; sha256?: string }>;
		};
		const managedAssets = config.managed_assets;

		expect(managedAssets).toBeDefined();
		expect(managedAssets?.[`${d.system}/${d.templates}/Daily_Template.md`]).toMatchObject({
			version: '1.1.2',
		});
		expect(managedAssets?.[`${d.system}/${d.templates}/Daily_Template.md`]?.sha256).toMatch(
			/^[0-9a-f]{64}$/,
		);
		expect(managedAssets?.['.agents/skills/today/SKILL.md']).toMatchObject({
			version: '1.1.2',
		});
	});

	test('copies templates to system directory', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const templatesDir = join(dir, d.system, d.templates);
		expect(existsSync(templatesDir)).toBe(true);
		expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(true);
		expect(existsSync(join(templatesDir, 'Project_Template.md'))).toBe(true);
	});

	test('copies schema to system directory', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const schemaDir = join(dir, d.system, d.schema);
		expect(existsSync(schemaDir)).toBe(true);
		expect(existsSync(join(schemaDir, 'Frontmatter_Schema.md'))).toBe(true);
	});

	test('copies skills with language switching', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const skillsDir = join(dir, '.agents', 'skills');
		expect(existsSync(skillsDir)).toBe(true);

		// At least one skill should exist
		expect(existsSync(join(skillsDir, 'today'))).toBe(true);
		expect(existsSync(join(skillsDir, 'research'))).toBe(true);
	});

	test('copies CLAUDE.md to vault root', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const claudePath = join(dir, 'CLAUDE.md');
		expect(existsSync(claudePath)).toBe(true);

		const content = readFileSync(claudePath, 'utf-8');
		expect(content.length).toBeGreaterThan(0);
	});

	test('copies AGENTS.md to vault root', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const agentsPath = join(dir, 'AGENTS.md');
		expect(existsSync(agentsPath)).toBe(true);

		const content = readFileSync(agentsPath, 'utf-8');
		expect(content.length).toBeGreaterThan(0);
	});

	test('does not create .gitignore', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		const gitignorePath = join(dir, '.gitignore');
		expect(existsSync(gitignorePath)).toBe(false);
	});

	test('does not initialize a git repository', async () => {
		await init([dir, '--lang', lang, '--no-mcp']);

		expect(existsSync(join(dir, '.git'))).toBe(false);
	});
});

describe('lifeos init', () => {
	test('rejects if lifeos.yaml already exists', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await init([dir, '--lang', 'zh', '--no-mcp']);
			await expect(init([dir, '--lang', 'zh', '--no-mcp'])).rejects.toThrow(
				'Vault already initialized',
			);
		} finally {
			cleanup();
		}
	});
});
