import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZH_PRESET } from '../../../src/config.js';
import { installTemplates, installSchema, installSkills } from '../../../src/cli/utils/install-assets.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-install-assets-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('installTemplates', () => {
	test('copies zh templates and returns paths', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const paths = installTemplates(dir, ZH_PRESET);

			// Should return at least one path
			expect(paths.length).toBeGreaterThan(0);

			// Paths should use the zh system/templates dirs
			const systemDir = ZH_PRESET.directories.system;
			const templatesSubdir = ZH_PRESET.subdirectories.templates;
			for (const p of paths) {
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
});

describe('installSkills', () => {
	test('overwrite mode copies all skills', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = installSkills(dir, 'zh', 'overwrite');

			// Should have updated files
			expect(result.updated.length).toBeGreaterThan(0);
			expect(result.skipped).toHaveLength(0);
			expect(result.unchanged).toHaveLength(0);

			// lifeos-init skill should not be copied
			expect(existsSync(join(dir, '.agents', 'skills', 'lifeos-init'))).toBe(false);

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
});
