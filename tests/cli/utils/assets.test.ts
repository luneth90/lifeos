import { spawnSync } from 'node:child_process';
import {
	type Dirent,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { assetsDir, copyDir, ensureDir } from '../../../src/cli/utils/assets.js';
import { parseArgs } from '../../../src/cli/utils/ui.js';

const contractValidatorPath = join(process.cwd(), 'scripts', 'validate-skill-contracts.mjs');
const packageSourceEntries = [
	'package.json',
	'bin',
	'assets',
	'src',
	'scripts',
	'tsconfig.json',
] as const;

async function validateSkillContracts(): Promise<
	typeof import('../../../scripts/validate-skill-contracts.mjs')
> {
	return import(contractValidatorPath);
}

function walkFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
		const fullPath = join(dir, entry.name);
		return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
	});
}

function packagePath(path: string): string {
	return path.split(sep).join('/');
}

function extractFrontmatter(content: string): string {
	const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
	if (!match) {
		throw new Error('missing frontmatter');
	}
	return match[1];
}

function copyPackageSource(source: string, destination: string): void {
	mkdirSync(destination, { recursive: true });
	for (const entry of packageSourceEntries) {
		cpSync(join(source, entry), join(destination, entry), { recursive: true });
	}
}

function directoryLinkType(platform: NodeJS.Platform = process.platform): 'dir' | 'junction' {
	return platform === 'win32' ? 'junction' : 'dir';
}

function npmInvocation(
	platform: NodeJS.Platform = process.platform,
	npmExecPath: string | undefined = process.env.npm_execpath,
	nodeExecutable: string = process.execPath,
): { command: string; prefixArgs: string[] } {
	if (npmExecPath) {
		return { command: nodeExecutable, prefixArgs: [npmExecPath] };
	}
	if (platform === 'win32') {
		throw new Error('Windows 包运行时测试需要 npm_execpath 才能安全启动 npm CLI');
	}
	return { command: 'npm', prefixArgs: [] };
}

describe('assetsDir', () => {
	test.each([
		['win32', 'junction'],
		['darwin', 'dir'],
		['linux', 'dir'],
	] as const)('%s 使用 %s 连接测试 node_modules', (platform, expected) => {
		expect(directoryLinkType(platform)).toBe(expected);
	});
	test('Windows 通过 Node 启动 npm CLI，而不是直接执行 npm.cmd', () => {
		expect(npmInvocation('win32', 'C:\\npm-cli.js', 'C:\\node.exe')).toEqual({
			command: 'C:\\node.exe',
			prefixArgs: ['C:\\npm-cli.js'],
		});
		expect(() => npmInvocation('win32', '', 'C:\\node.exe')).toThrow();
		expect(npmInvocation('linux', '', '/usr/bin/node')).toEqual({
			command: 'npm',
			prefixArgs: [],
		});
	});

	test('发布资产通过双语技能契约校验', async () => {
		const { validateSkillContracts: validate } = await validateSkillContracts();
		expect(validate(assetsDir())).toEqual({ ok: true, diagnostics: [] });
	});

	test('npm 包清单包含完整 assets，且构建产物从包根解析 assets', async () => {
		const directory = join(tmpdir(), `lifeos-pack-${Date.now()}`);
		const packageSource = join(directory, 'source');
		mkdirSync(directory, { recursive: true });
		try {
			copyPackageSource(process.cwd(), packageSource);
			symlinkSync(
				join(process.cwd(), 'node_modules'),
				join(packageSource, 'node_modules'),
				directoryLinkType(),
			);
			const environment = { ...process.env, NPM_CONFIG_CACHE: join(directory, 'npm-cache') };
			const npm = npmInvocation();
			const built = spawnSync(npm.command, [...npm.prefixArgs, 'run', 'build'], {
				cwd: packageSource,
				encoding: 'utf8',
				env: environment,
			});
			expect(built.status, built.stderr).toBe(0);
			const packed = spawnSync(
				npm.command,
				[...npm.prefixArgs, 'pack', '--json', '--pack-destination', directory],
				{
					cwd: packageSource,
					encoding: 'utf8',
					env: environment,
				},
			);
			expect(packed.status, packed.stderr).toBe(0);
			const { normalizePackEntries } = await import(
				pathToFileURL(join(packageSource, 'scripts', 'release', 'pack.mjs')).href
			);
			const [{ files }] = normalizePackEntries(JSON.parse(packed.stdout)) as Array<{
				files: Array<{ path: string }>;
			}>;
			const packedPaths = new Set(files.map((file) => file.path));
			const expectedAssetPaths = walkFiles(join(packageSource, 'assets')).map((path) =>
				packagePath(relative(packageSource, path)),
			);
			expect(expectedAssetPaths.every((path) => packedPaths.has(path))).toBe(true);
			expect(packedPaths.has('dist/cli/utils/assets.js')).toBe(true);
			const { validateSkillContracts: validate } = await validateSkillContracts();
			const runtimeAssets = await import(
				pathToFileURL(join(packageSource, 'dist', 'cli', 'utils', 'assets.js')).href
			);
			expect(realpathSync(runtimeAssets.assetsDir())).toBe(
				realpathSync(join(packageSource, 'assets')),
			);
			expect(validate(runtimeAssets.assetsDir())).toEqual({ ok: true, diagnostics: [] });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test('points to existing assets/ directory', () => {
		const dir = assetsDir();
		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dir, 'lifeos.yaml'))).toBe(true);
		expect(existsSync(join(dir, 'templates', 'zh'))).toBe(true);
		expect(existsSync(join(dir, 'templates', 'en'))).toBe(true);
	});

	test('documents plan lifecycle and plan statuses across schema and skills', () => {
		const dir = assetsDir();
		const lifeosYaml = readFileSync(join(dir, 'lifeos.yaml'), 'utf-8');
		const schema = readFileSync(join(dir, 'schema', 'Frontmatter_Schema.md'), 'utf-8');
		const lifecycleZh = readFileSync(join(dir, 'skills', '_shared', 'lifecycle.zh.md'), 'utf-8');
		const lifecycleEn = readFileSync(join(dir, 'skills', '_shared', 'lifecycle.en.md'), 'utf-8');
		const archiveZh = readFileSync(join(dir, 'skills', 'archive', 'SKILL.zh.md'), 'utf-8');
		const archiveEn = readFileSync(join(dir, 'skills', 'archive', 'SKILL.en.md'), 'utf-8');
		const rulesZh = readFileSync(join(dir, 'lifeos-rules.zh.md'), 'utf-8');
		const rulesEn = readFileSync(join(dir, 'lifeos-rules.en.md'), 'utf-8');
		const projectPlanZh = readFileSync(
			join(dir, 'skills', 'project', 'references', 'planning-agent-prompt.zh.md'),
			'utf-8',
		);
		const projectSkillZh = readFileSync(join(dir, 'skills', 'project', 'SKILL.zh.md'), 'utf-8');
		const projectExecZh = readFileSync(
			join(dir, 'skills', 'project', 'references', 'execution-agent-prompt.zh.md'),
			'utf-8',
		);
		const researchPlanZh = readFileSync(
			join(dir, 'skills', 'research', 'references', 'planning-agent-prompt.zh.md'),
			'utf-8',
		);
		const researchExecZh = readFileSync(
			join(dir, 'skills', 'research', 'references', 'execution-agent-prompt.zh.md'),
			'utf-8',
		);

		expect(schema).toContain('- `plan`');
		expect(schema).toContain('### plan');
		expect(schema).toContain('- `pending` / `active` / `done` / `failed` / `cancelled`');

		expect(lifecycleZh).toContain('## 计划生命周期');
		expect(lifecycleZh).toContain(
			'pending ──确认后──→ active ──执行完成──→ done ──/archive──→ 保留 done',
		);
		expect(lifecycleEn).toContain('## Plan Lifecycle');
		expect(lifecycleEn).toContain(
			'pending ──confirmation──→ active ──execution completes──→ done ──/archive──→ keep done',
		);

		expect(projectPlanZh).toContain('type: plan');
		expect(projectPlanZh).toContain('status: pending');
		expect(researchPlanZh).toContain('type: plan');
		expect(researchPlanZh).toContain('status: pending');

		expect(projectExecZh).toContain('不得修改来源草稿状态、计划状态或 project scope 记忆');
		expect(projectSkillZh).toContain(
			'把来源草稿（如有）和计划更新为 `status: done`，并分别调用 `memory_notify`',
		);
		expect(projectExecZh).not.toContain(
			'将计划文件从 `{计划目录}/Plan_YYYY-MM-DD_Project_ProjectName.md` 移动到',
		);
		expect(researchExecZh).toContain('不得修改任何来源草稿或计划状态');
		expect(researchExecZh).not.toContain('将计划文件从 `{计划目录}/` 移动到');

		expect(lifeosYaml).toContain('diary: "归档/日记"');
		expect(archiveZh).toContain('{计划目录}');
		expect(archiveZh).toContain('{归档计划子目录}');
		expect(archiveZh).toContain('{归档日记子目录}');
		expect(archiveZh).toContain('最近 7 天');
		expect(archiveZh).toContain('obsidian move');
		expect(archiveZh).toContain('永不删除');
		expect(archiveZh).toContain('status: done');
		expect(archiveEn).toContain('{plans directory}');
		expect(archiveEn).toContain('{archived plans subdirectory}');
		expect(archiveEn).toContain('{archived diary subdirectory}');
		expect(archiveEn).toContain('last 7 days');
		expect(archiveEn).toContain('obsidian move');
		expect(archiveEn).toContain('Never delete');
		expect(archiveEn).toContain('status: done');
		// 归档目录结构已下沉到 lifeos.yaml（第 88 行已验证），lifeos-rules 只保留精简映射表
	});

	test('all skill frontmatters are valid yaml', () => {
		const dir = join(assetsDir(), 'skills');
		const skillFiles = walkFiles(dir).filter((file) => /\/SKILL\.(en|zh)\.md$/.test(file));

		for (const file of skillFiles) {
			const content = readFileSync(file, 'utf-8');
			const frontmatter = extractFrontmatter(content);

			try {
				parseYaml(frontmatter);
			} catch (error) {
				throw new Error(
					`Invalid frontmatter in ${relative(assetsDir(), file)}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	});

	test('digest skill ships bilingual main and reference docs', () => {
		const dir = join(assetsDir(), 'skills', 'digest');
		const digestEn = readFileSync(join(dir, 'SKILL.en.md'), 'utf-8');
		const digestZh = readFileSync(join(dir, 'SKILL.zh.md'), 'utf-8');
		const configEn = readFileSync(join(dir, 'references', 'config-parser.en.md'), 'utf-8');
		const setupEn = readFileSync(join(dir, 'references', 'setup-guide.en.md'), 'utf-8');
		const runEn = readFileSync(join(dir, 'references', 'run-pipeline.en.md'), 'utf-8');

		expect(existsSync(join(dir, 'SKILL.zh.md'))).toBe(true);
		expect(existsSync(join(dir, 'SKILL.en.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'setup-guide.zh.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'setup-guide.en.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'config-parser.zh.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'config-parser.en.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'run-pipeline.zh.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'run-pipeline.en.md'))).toBe(true);
		expect(existsSync(join(dir, 'references', 'rss-arxiv-script.py'))).toBe(true);
		expect(digestEn).toContain('Paper Sources');
		expect(digestZh).toContain('Paper Sources');
		expect(configEn).toContain('### Paper Sources');
		expect(configEn).toContain('### arXiv Search');
		expect(setupEn).toContain('bioRxiv');
		expect(setupEn).toContain('ChemRxiv');
		expect(runEn).toContain('paper sources');
		expect(runEn).toContain('structured per-source errors');
	});
});

describe('ensureDir', () => {
	test('creates directory and returns true when it does not exist', () => {
		const dir = join(tmpdir(), `lifeos-test-${Date.now()}`);
		try {
			expect(ensureDir(dir)).toBe(true);
			expect(existsSync(dir)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('returns false when directory already exists', () => {
		const dir = join(tmpdir(), `lifeos-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		try {
			expect(ensureDir(dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('copyDir', () => {
	test('copies directory contents recursively', () => {
		const src = join(tmpdir(), `lifeos-src-${Date.now()}`);
		const dest = join(tmpdir(), `lifeos-dest-${Date.now()}`);
		mkdirSync(join(src, 'sub'), { recursive: true });
		writeFileSync(join(src, 'a.txt'), 'hello');
		writeFileSync(join(src, 'sub', 'b.txt'), 'world');
		try {
			copyDir(src, dest);
			expect(existsSync(join(dest, 'a.txt'))).toBe(true);
			expect(existsSync(join(dest, 'sub', 'b.txt'))).toBe(true);
		} finally {
			rmSync(src, { recursive: true, force: true });
			rmSync(dest, { recursive: true, force: true });
		}
	});
});

describe('parseArgs', () => {
	test('parses --flag value and positionals', () => {
		const result = parseArgs(['init', '/tmp/foo', '--lang', 'zh'], {
			lang: { alias: 'l' },
		});
		expect(result.positionals).toEqual(['init', '/tmp/foo']);
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('parses short alias and boolean flag', () => {
		const result = parseArgs(['/tmp/foo', '-l', 'en', '--no-mcp'], {
			lang: { alias: 'l' },
			'no-mcp': {},
		});
		expect(result.positionals).toEqual(['/tmp/foo']);
		expect(result.flags).toEqual({ lang: 'en', 'no-mcp': true });
	});

	test('parses --flag=value form', () => {
		const result = parseArgs(['--lang=zh'], { lang: { alias: 'l' } });
		expect(result.positionals).toEqual([]);
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('applies default values for missing flags', () => {
		const result = parseArgs([], { lang: { default: 'zh' } });
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('explicit value overrides default', () => {
		const result = parseArgs(['--lang', 'en'], { lang: { default: 'zh' } });
		expect(result.flags).toEqual({ lang: 'en' });
	});
});
