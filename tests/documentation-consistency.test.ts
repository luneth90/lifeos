import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
	return readFileSync(path, 'utf-8');
}

describe('documentation consistency', () => {
	it('manual testing guides do not instruct users to call removed memory tools', () => {
		const zh = read('docs/manual-testing-guide.zh.md');
		const en = read('docs/manual-testing-guide.en.md');

		expect(zh).not.toContain('memory_refresh');
		expect(zh).not.toContain('memory_skill_context');
		expect(en).not.toContain('memory_refresh');
		expect(en).not.toContain('memory_skill_context');
	});

	it('manual testing guides stay aligned with current memory tool contracts', () => {
		const zh = read('docs/manual-testing-guide.zh.md');
		const en = read('docs/manual-testing-guide.en.md');

		expect(zh).not.toContain('1.0.2');
		expect(en).not.toContain('1.0.2');
		expect(zh).not.toContain('observation 或 discovery');
		expect(en).not.toContain('observation or discovery');
		expect(zh).toContain('90_系统/记忆/memory.db');
		expect(en).toContain('90_System/Memory/memory.db');
		expect(zh).toContain('entry_type');
		expect(en).toContain('entry_type');
	});

	it('integration testing guides do not hardcode outdated versions', () => {
		const zh = read('docs/integration-test.zh.md');
		const en = read('docs/integration-test.en.md');

		expect(zh).not.toContain('1.0.2');
		expect(en).not.toContain('1.0.2');
	});

	it('today skill assets do not depend on removed memory tools', () => {
		const zh = read('assets/skills/today/SKILL.zh.md');
		const en = read('assets/skills/today/SKILL.en.md');

		expect(zh).not.toContain('memory_refresh');
		expect(en).not.toContain('memory_refresh');
	});
});
