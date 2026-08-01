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
	'assets/skills/research/references/planning-agent-prompt.zh.md',
	'assets/skills/research/references/execution-agent-prompt.zh.md',
	'assets/skills/research/SKILL.en.md',
	'assets/skills/research/references/planning-agent-prompt.en.md',
	'assets/skills/research/references/execution-agent-prompt.en.md',
];

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

function markdownSection(body: string, heading: string): string {
	const start = body.indexOf(heading);
	if (start < 0) return '';
	const end = body.indexOf('\n## ', start + heading.length);
	return body.slice(start, end < 0 ? undefined : end);
}

describe('阶段一数据契约', () => {
	it('公开机器可读的状态契约', () => {
		const schema = readContractYaml(schemaPath, 'frontmatter-contract-v1') as {
			types: Record<string, { statuses: string[]; template: string | null }>;
		};
		expect(schema.types.translation.statuses).toEqual(['draft', 'complete']);
		expect(schema.types.plan.statuses).toEqual([
			'pending',
			'active',
			'done',
			'failed',
			'cancelled',
		]);
		expect(schema.types.draft.statuses).toEqual(['pending', 'done']);
		expect(schema.types.project.statuses).toEqual(['active', 'frozen', 'done']);
		expect(schema.types['project-doc']).toEqual({ statuses: [], template: null });
		expect(schema.types.system).toEqual({ statuses: [], template: null });
		expect(read(schemaPath)).not.toContain('- `active` / `archived`');
	});

	it('双语生命周期公开 revise-record 的 pending 到 graded 状态机和参与者', () => {
		for (const path of [
			'assets/skills/_shared/lifecycle.zh.md',
			'assets/skills/_shared/lifecycle.en.md',
		]) {
			const content = read(path);
			expect(content, path).toMatch(/revise-record|复习记录/i);
			expect(content, path).toMatch(/pending[\s\S]{0,160}graded/i);
			expect(content, path).toMatch(/\/revise[\s\S]{0,240}pending[\s\S]{0,120}graded/i);
		}
	});

	it('双语实体模板共享 frontmatter 键并使用动态 ID', () => {
		for (const paths of pairedAssetPaths('assets/templates')) {
			const zh = readMarkdownAsset(paths.zh);
			const en = readMarkdownAsset(paths.en);
			expect(Object.keys(zh.frontmatter).sort(), paths.zh).toEqual(
				Object.keys(en.frontmatter).sort(),
			);
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

	it('归档保留业务终态，归档日期由必需元数据事务闭环写入', () => {
		for (const path of [
			'assets/skills/_shared/lifecycle.zh.md',
			'assets/skills/_shared/lifecycle.en.md',
		]) {
			const content = read(path);
			expect(content, path).not.toMatch(/status:\s*archived/);
			expect(content, path).toContain('archived: "YYYY-MM-DD"');
		}
		for (const path of ['assets/skills/archive/SKILL.zh.md', 'assets/skills/archive/SKILL.en.md']) {
			const content = read(path);
			expect(content, path).not.toMatch(/status:\s*archived/);
			expect(content, path).toContain('archived_frontmatter: required_metadata_transaction');
			expect(content, path).toContain('completion_gate: move_and_metadata_transactions_complete');
			expect(content, path).toContain('current_run: forbidden');
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

	it('研究人格只能调整内容，不得替换 Research 模板结构', () => {
		for (const path of [
			'assets/skills/research/references/planning-agent-prompt.zh.md',
			'assets/skills/research/references/execution-agent-prompt.zh.md',
			'assets/skills/research/references/planning-agent-prompt.en.md',
			'assets/skills/research/references/execution-agent-prompt.en.md',
		]) {
			const content = read(path);
			expect(content, path).toMatch(/Research_Template\.md/);
			expect(content, path).not.toMatch(
				/Output Format.*替换默认章节|替换默认章节结构|replace default chapters|replace default chapter structure/i,
			);
		}
	});

	it('双语翻译模板公开同一套自动视觉嵌入与原书提示记录', () => {
		const templates = [
			{
				path: 'assets/templates/zh/Translation_Template.md',
				heading: '## 中文对照',
				orderPattern: /按.*阅读顺序/,
			},
			{
				path: 'assets/templates/en/Translation_Template.md',
				heading: '## Chinese companion',
				orderPattern: /reading order/i,
			},
		] as const;
		const embed = '![[<Vault相对图片路径>|720]]';
		const visualSummary = '视觉处理：嵌入 N；转 Markdown N；转 LaTeX N；原书提示 N；忽略装饰 N';
		const referenceItem =
			'- reference：PDF 物理页 XX；图号 X.X 或 block.order N；原因：<自动降级原因>';
		const referenceWithFigure = '> 📖 见原书图 X.X';
		const referenceWithoutFigure = '> 📖 见原书相关图表（PDF 物理页 XX，block.order N）';

		for (const template of templates) {
			const body = readMarkdownAsset(template.path).body;
			const companion = markdownSection(body, template.heading);
			const completeness = markdownSection(
				body,
				template.path.includes('/zh/') ? '## 完整性记录' : '## Completeness record',
			);

			expect(companion, template.path).toMatch(template.orderPattern);
			expect(companion, template.path).toContain(embed);
			expect(companion, template.path).toMatch(/译文段落。[\s\S]*> 图 X\.X/);
			expect(companion, template.path).not.toMatch(
				/印刷页|printed page|printed label|page mapping/i,
			);
			expect(companion, template.path).toContain(referenceWithFigure);
			expect(companion, template.path).toContain(referenceWithoutFigure);
			expect(completeness, template.path).toContain(visualSummary);
			expect(completeness, template.path).toContain(referenceItem);
			expect(completeness, template.path).not.toMatch(
				/印刷页|printed page|printed label|page mapping/i,
			);
		}
	});
});
