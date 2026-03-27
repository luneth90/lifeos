import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assetsDir, copyDir, ensureDir } from '../../../src/cli/utils/assets.js';
import { parseArgs } from '../../../src/cli/utils/ui.js';

describe('assetsDir', () => {
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
		expect(schema).toContain('- `active` / `done` / `archived`');

		expect(lifecycleZh).toContain('## 计划生命周期');
		expect(lifecycleZh).toContain('active ──/project,/research──→ done ──/archive──→ archived');
		expect(lifecycleEn).toContain('## Plan Lifecycle');
		expect(lifecycleEn).toContain('active ──/project,/research──→ done ──/archive──→ archived');

		expect(projectPlanZh).toContain('type: plan');
		expect(projectPlanZh).toContain('status: active');
		expect(researchPlanZh).toContain('type: plan');
		expect(researchPlanZh).toContain('status: active');

		expect(projectExecZh).toContain('将计划文件的 frontmatter 中 `status` 更新为 `done`');
		expect(projectExecZh).not.toContain('将计划文件从 `{计划目录}/Plan_YYYY-MM-DD_Project_ProjectName.md` 移动到');
		expect(researchExecZh).toContain('将计划文件的 frontmatter 中 `status` 更新为 `done`');
		expect(researchExecZh).not.toContain('将计划文件从 `{计划目录}/` 移动到');

		expect(lifeosYaml).toContain('diary: "归档/日记"');
		expect(archiveZh).toContain('{计划目录}');
		expect(archiveZh).toContain('{归档计划子目录}');
		expect(archiveZh).toContain('{归档日记子目录}');
		expect(archiveZh).toContain('最近 7 天');
		expect(archiveZh).toContain('status: done');
		expect(archiveEn).toContain('{plans directory}');
		expect(archiveEn).toContain('{archived plans subdirectory}');
		expect(archiveEn).toContain('{archived diary subdirectory}');
		expect(archiveEn).toContain('most recent 7 days');
		expect(archiveEn).toContain('status: done');
		expect(rulesZh).toContain('归档/日记/YYYY/MM/');
		expect(rulesEn).toContain('Archive/Diary/YYYY/MM/');
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
