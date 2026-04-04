import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	installPrompts,
	installSchema,
	installSkills,
	installTemplates,
} from '../../../src/cli/utils/install-assets.js';
import { ZH_PRESET } from '../../../src/config.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-install-assets-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('installTemplates', () => {
	test('copies zh templates and returns paths', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = installTemplates(dir, ZH_PRESET, 'overwrite');

			// Should return at least one path
			expect(result.updated.length).toBeGreaterThan(0);
			expect(result.skipped).toHaveLength(0);
			expect(result.unchanged).toHaveLength(0);

			// Paths should use the zh system/templates dirs
			const systemDir = ZH_PRESET.directories.system;
			const templatesSubdir = ZH_PRESET.subdirectories.system.templates;
			for (const p of result.updated) {
				expect(p).toMatch(`${systemDir}/${templatesSubdir}/`);
			}

			// Files should exist on disk
			const templatesDir = join(dir, systemDir, templatesSubdir);
			expect(existsSync(templatesDir)).toBe(true);
			expect(existsSync(join(templatesDir, 'Daily_Template.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('smart-merge mode skips user-modified templates', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			installTemplates(dir, ZH_PRESET, 'overwrite');

			const templatePath = join(dir, '90_系统', '模板', 'Daily_Template.md');
			writeFileSync(templatePath, 'USER CUSTOMIZED TEMPLATE', 'utf-8');

			const result = installTemplates(dir, ZH_PRESET, 'smart-merge');

			expect(result.skipped).toContain('90_系统/模板/Daily_Template.md');
			expect(readFileSync(templatePath, 'utf-8')).toBe('USER CUSTOMIZED TEMPLATE');
		} finally {
			cleanup();
		}
	});
});

describe('installSchema', () => {
	test('smart-merge mode skips user-modified schema files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			installSchema(dir, ZH_PRESET, 'overwrite');

			const schemaPath = join(dir, '90_系统', '规范', 'Frontmatter_Schema.md');
			writeFileSync(schemaPath, 'USER CUSTOMIZED SCHEMA', 'utf-8');

			const result = installSchema(dir, ZH_PRESET, 'smart-merge');

			expect(result.skipped).toContain('90_系统/规范/Frontmatter_Schema.md');
			expect(readFileSync(schemaPath, 'utf-8')).toBe('USER CUSTOMIZED SCHEMA');
		} finally {
			cleanup();
		}
	});
});

describe('installPrompts', () => {
	test('smart-merge mode skips user-modified prompt files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			installPrompts(dir, ZH_PRESET, 'overwrite');

			const promptPath = join(dir, '90_系统', '提示词', 'AI_LLMResearch_Prompt.md');
			writeFileSync(promptPath, 'USER CUSTOMIZED PROMPT', 'utf-8');

			const result = installPrompts(dir, ZH_PRESET, 'smart-merge');

			expect(result.skipped).toContain('90_系统/提示词/AI_LLMResearch_Prompt.md');
			expect(readFileSync(promptPath, 'utf-8')).toBe('USER CUSTOMIZED PROMPT');
		} finally {
			cleanup();
		}
	});
});

describe('installSkills', () => {
	test('ignores hidden non-directory entries in the skills asset root', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			expect(() => installSkills(dir, 'zh', 'overwrite')).not.toThrow();
		} finally {
			cleanup();
		}
	});

	test('overwrite mode copies all skills', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = installSkills(dir, 'zh', 'overwrite');

			// Should have updated files
			expect(result.updated.length).toBeGreaterThan(0);
			expect(result.skipped).toHaveLength(0);
			expect(result.unchanged).toHaveLength(0);

			// Known skills should exist
			expect(existsSync(join(dir, '.agents', 'skills', 'today'))).toBe(true);
			expect(existsSync(join(dir, '.agents', 'skills', 'research'))).toBe(true);

			// All updated paths should use .agents/skills/ prefix
			for (const p of result.updated) {
				expect(p).toMatch(/^\.agents\/skills\//);
			}
		} finally {
			cleanup();
		}
	});

	test('smart-merge mode skips user-modified files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			// First pass: install all skills
			installSkills(dir, 'zh', 'overwrite');

			// Modify a skill file
			const skillPath = join(dir, '.agents', 'skills', 'today', 'SKILL.md');
			expect(existsSync(skillPath)).toBe(true);
			writeFileSync(skillPath, 'USER CUSTOMIZED SKILL', 'utf-8');

			// Second pass: smart-merge should skip the modified file
			const result = installSkills(dir, 'zh', 'smart-merge');

			// Modified file should be in skipped
			expect(result.skipped).toContain('.agents/skills/today/SKILL.md');

			// File should retain user modification
			expect(readFileSync(skillPath, 'utf-8')).toBe('USER CUSTOMIZED SKILL');
		} finally {
			cleanup();
		}
	});

	test('smart-merge mode reports unchanged files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			// First pass: install all skills
			installSkills(dir, 'zh', 'overwrite');

			// Second pass: smart-merge with no modifications
			const result = installSkills(dir, 'zh', 'smart-merge');

			// Should have unchanged files (nothing was modified)
			expect(result.unchanged.length).toBeGreaterThan(0);
			expect(result.skipped).toHaveLength(0);
		} finally {
			cleanup();
		}
	});

	test('installs language-specific digest skill content', () => {
		const zhTmp = makeTmpDir();
		const enTmp = makeTmpDir();
		try {
			installSkills(zhTmp.dir, 'zh', 'overwrite');
			installSkills(enTmp.dir, 'en', 'overwrite');

			const zhDigest = readFileSync(
				join(zhTmp.dir, '.agents', 'skills', 'digest', 'SKILL.md'),
				'utf-8',
			);
			const enDigest = readFileSync(
				join(enTmp.dir, '.agents', 'skills', 'digest', 'SKILL.md'),
				'utf-8',
			);
			const zhConfig = readFileSync(
				join(zhTmp.dir, '.agents', 'skills', 'digest', 'references', 'config-parser.md'),
				'utf-8',
			);
			const enConfig = readFileSync(
				join(enTmp.dir, '.agents', 'skills', 'digest', 'references', 'config-parser.md'),
				'utf-8',
			);

			expect(zhDigest).not.toBe(enDigest);
			expect(zhDigest).toContain('通用信息周报');
			expect(enDigest).toContain('general weekly digest');
			expect(zhDigest).toContain('Paper Sources');
			expect(enDigest).toContain('Paper Sources');
			expect(zhConfig).toContain('Paper Sources');
			expect(enConfig).toContain('Paper Sources');
			expect(zhConfig).toContain('旧版兼容');
			expect(enConfig).toContain('### arXiv Search');
		} finally {
			zhTmp.cleanup();
			enTmp.cleanup();
		}
	});
});
