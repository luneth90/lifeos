import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	extractPlaceholders,
	pairedAssetPaths,
	readContractYaml,
	readMarkdownAsset,
} from './helpers.js';

const schemaPath = 'assets/schema/Frontmatter_Schema.md';
const projectPaths = [
	'assets/skills/project/SKILL.zh.md',
	'assets/skills/project/references/planning-agent-prompt.zh.md',
	'assets/skills/project/references/execution-agent-prompt.zh.md',
	'assets/skills/project/SKILL.en.md',
	'assets/skills/project/references/planning-agent-prompt.en.md',
	'assets/skills/project/references/execution-agent-prompt.en.md',
];
const researchPaths = [
	'assets/skills/research/SKILL.zh.md',
	'assets/skills/research/references/execution-agent-prompt.zh.md',
	'assets/skills/research/SKILL.en.md',
	'assets/skills/research/references/execution-agent-prompt.en.md',
];

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

describe('阶段一数据契约', () => {
	it('公开机器可读的状态契约', () => {
		const schema = readContractYaml(schemaPath, 'frontmatter-contract-v1') as {
			types: Record<string, { statuses: string[] }>;
		};
		expect(schema.types.translation.statuses).toEqual(['draft', 'complete']);
		expect(schema.types.plan.statuses).toEqual(['pending', 'active', 'done', 'failed', 'cancelled']);
		expect(schema.types.draft.statuses).toEqual(['pending', 'done']);
		expect(schema.types.project.statuses).toEqual(['active', 'frozen', 'done']);
	});

	it('双语实体模板共享 frontmatter 键并使用动态 ID', () => {
		for (const paths of pairedAssetPaths('assets/templates')) {
			const zh = readMarkdownAsset(paths.zh);
			const en = readMarkdownAsset(paths.en);
			expect(Object.keys(zh.frontmatter).sort(), paths.zh).toEqual(Object.keys(en.frontmatter).sort());
			expect(zh.frontmatter.id, paths.zh).toBe('{{ID}}');
			expect(en.frontmatter.id, paths.en).toBe('{{ID}}');
		}
	});

	it('应用专有模板字段', () => {
		const retrospective = readMarkdownAsset('assets/templates/zh/Retrospective_Template.md');
		const project = readMarkdownAsset('assets/templates/zh/Project_Template.md');
		const research = readMarkdownAsset('assets/templates/zh/Research_Template.md');
		const translation = readMarkdownAsset('assets/templates/zh/Translation_Template.md');
		expect(retrospective.frontmatter.type).toBe('retro');
		expect(retrospective.frontmatter.revise_type).toBe('{{REVISE_TYPE}}');
		expect(project.frontmatter.category).toBe('{{CATEGORY}}');
		expect(research.frontmatter.status).toBe('draft');
		expect(research.frontmatter.completeness).toBe('{{COMPLETENESS}}');
		expect(translation.frontmatter.type).toBe('translation');
		expect(translation.frontmatter.status).toBe('draft');
	});

	it('归档保留业务终态，只写归档日期', () => {
		for (const path of [
			'assets/skills/_shared/lifecycle.zh.md',
			'assets/skills/_shared/lifecycle.en.md',
			'assets/skills/archive/SKILL.zh.md',
			'assets/skills/archive/SKILL.en.md',
		]) {
			const content = read(path);
			expect(content, path).not.toMatch(/status:\s*archived/);
			expect(content, path).toContain('archived: "YYYY-MM-DD"');
		}
	});

	it('项目与研究的调用输入在主技能和提示词中一致', () => {
		for (const path of projectPaths) {
			expect([...new Set(extractPlaceholders(read(path)))], path).toEqual(['{{PROJECT_INPUT}}']);
		}
		for (const path of researchPaths) {
			expect([...new Set(extractPlaceholders(read(path)))], path).toEqual(['{{RESEARCH_INPUT}}']);
		}
	});
});
