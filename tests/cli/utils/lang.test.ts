import { join } from 'node:path';
import { assetsDir } from '../../../src/cli/utils/assets.js';
import { resolveSkillFiles } from '../../../src/cli/utils/lang.js';

const skills = join(assetsDir(), 'skills');

describe('resolveSkillFiles', () => {
	describe('knowledge/ (has SKILL.zh.md + SKILL.en.md, no plain SKILL.md)', () => {
		it('zh → maps SKILL.zh.md to SKILL.md', () => {
			const map = resolveSkillFiles(join(skills, 'knowledge'), 'zh');
			expect(map.has('SKILL.md')).toBe(true);
			expect(map.get('SKILL.md')).toContain('SKILL.zh.md');
			expect(map.has('SKILL.zh.md')).toBe(false);
			expect(map.has('SKILL.en.md')).toBe(false);
		});

		it('en → maps SKILL.en.md to SKILL.md', () => {
			const map = resolveSkillFiles(join(skills, 'knowledge'), 'en');
			expect(map.has('SKILL.md')).toBe(true);
			expect(map.get('SKILL.md')).toContain('SKILL.en.md');
			expect(map.has('SKILL.zh.md')).toBe(false);
			expect(map.has('SKILL.en.md')).toBe(false);
		});
	});

	describe('brainstorm/ (only SKILL.md, no language variants)', () => {
		it('zh → includes original SKILL.md as-is', () => {
			const map = resolveSkillFiles(join(skills, 'brainstorm'), 'zh');
			expect(map.has('SKILL.md')).toBe(true);
			expect(map.get('SKILL.md')).toContain('brainstorm/SKILL.md');
		});
	});

	describe('project/ (nested references/ with language variants)', () => {
		it('zh → resolves all language files, no .zh.md or .en.md in output', () => {
			const map = resolveSkillFiles(join(skills, 'project'), 'zh');

			expect(map.has('SKILL.md')).toBe(true);
			expect(map.get('SKILL.md')).toContain('SKILL.zh.md');

			expect(map.has('references/planning-agent-prompt.md')).toBe(true);
			expect(map.get('references/planning-agent-prompt.md')).toContain(
				'planning-agent-prompt.zh.md',
			);

			expect(map.has('references/execution-agent-prompt.md')).toBe(true);
			expect(map.get('references/execution-agent-prompt.md')).toContain(
				'execution-agent-prompt.zh.md',
			);

			// No language-suffixed keys in output
			for (const key of map.keys()) {
				expect(key).not.toMatch(/\.(zh|en)\.md$/);
			}
		});
	});

	describe('read-pdf/ (non-md files)', () => {
		it('includes scripts/read_pdf.py', () => {
			const map = resolveSkillFiles(join(skills, 'read-pdf'), 'zh');
			expect(map.has('scripts/read_pdf.py')).toBe(true);
			expect(map.get('scripts/read_pdf.py')).toContain('read_pdf.py');
		});
	});
});
