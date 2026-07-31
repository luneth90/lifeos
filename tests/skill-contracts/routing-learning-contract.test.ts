import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readContractYaml, readMarkdownAsset } from './helpers.js';

type Route = {
	id: string;
	target: string;
	examples: string[];
};

type RoutingContract = {
	contract_version: number;
	order: string[];
	routes: Route[];
};

type LearningContract = {
	contract_version: number;
	nodes: string[];
	edges: Array<{ from: string; to: string }>;
};

function route(input: string, contract: RoutingContract): string {
	const matched = contract.routes.find((candidate) => candidate.examples.includes(input));
	return matched?.target ?? 'direct_answer';
}

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

function expectSameContract<T>(marker: string, zhPath: string, enPath: string): T {
	const zh = readContractYaml(zhPath, marker) as T;
	const en = readContractYaml(enPath, marker) as T;
	expect(en, `${enPath} 与中文机器契约不一致`).toEqual(zh);
	return zh;
}

describe('阶段三路由与学习链路契约', () => {
	it('按固定优先级将每日、周报和翻译请求路由到声明的技能', () => {
		const contract = expectSameContract<RoutingContract>(
			'routing-contract-v1',
			'assets/skills/ask/SKILL.zh.md',
			'assets/skills/ask/SKILL.en.md',
		);
		expect(contract.contract_version).toBe(1);
		expect(contract.order).toEqual([
			'explicit_skill',
			'daily_planning',
			'pdf_reading',
			'translation',
			'digest',
			'research',
			'project',
			'knowledge',
			'brainstorm',
			'direct_answer',
		]);
		expect(route('询问今日安排', contract)).toBe('today');
		expect(route('生成信息周报', contract)).toBe('digest');
		expect(route('翻译这个 PDF 章节', contract)).toBe('translate');
		for (const candidate of contract.routes) {
			expect(candidate.target).toMatch(/^[a-z-]+$/);
		}
	});

	it('公开学习链路节点与交接边', () => {
		const contract = expectSameContract<LearningContract>(
			'learning-lifecycle-contract-v1',
			'assets/skills/_shared/learning-lifecycle.zh.md',
			'assets/skills/_shared/learning-lifecycle.en.md',
		);
		expect(contract.contract_version).toBe(1);
		expect(contract.nodes).toEqual(
			expect.arrayContaining(['digest', 'read-pdf', 'translate', 'knowledge', 'revise']),
		);
		expect(contract.edges).toEqual(
			expect.arrayContaining([
				{ from: 'digest', to: 'draft' },
				{ from: 'draft', to: 'research' },
				{ from: 'draft', to: 'project' },
				{ from: 'draft', to: 'knowledge' },
				{ from: 'read-pdf', to: 'extraction' },
				{ from: 'extraction', to: 'translate' },
				{ from: 'translate', to: 'knowledge' },
				{ from: 'knowledge', to: 'revise' },
			]),
		);
	});

	it('将规则、偏好和决策交给作用域记忆，而将原文交给 Vault 查询', () => {
		for (const [zhPath, enPath] of [
			['assets/skills/ask/SKILL.zh.md', 'assets/skills/ask/SKILL.en.md'],
			['assets/skills/brainstorm/SKILL.zh.md', 'assets/skills/brainstorm/SKILL.en.md'],
			['assets/skills/knowledge/SKILL.zh.md', 'assets/skills/knowledge/SKILL.en.md'],
		] as const) {
			const content = read(zhPath);
			const english = read(enPath);
			for (const value of [content, english]) {
				expect(value).toMatch(/memory_context[\s\S]{0,700}(规则|偏好|决策|rules|preferences|decisions)/i);
				expect(value).toMatch(/memory_query[\s\S]{0,700}(Vault|原文|source documents|笔记原文)/i);
			}
		}
	});

	it('Today 仅检索 pending 草稿，并将任务和相关项目写入稳定托管区块', () => {
		for (const path of ['assets/skills/today/SKILL.zh.md', 'assets/skills/today/SKILL.en.md']) {
			const content = read(path);
			expect(content).toMatch(/filters=\{"type":"draft","status":"pending"\}/);
			expect(content).toMatch(/临近截止|nearest deadline/i);
			expect(content).toMatch(/用户选中|user-selected/i);
		}
		for (const path of ['assets/templates/zh/Daily_Template.md', 'assets/templates/en/Daily_Template.md']) {
			const body = readMarkdownAsset(path).body;
			expect(body, path).toContain('<!-- BEGIN AUTO:tasks -->');
			expect(body, path).toContain('<!-- END AUTO:tasks -->');
			expect(body, path).toContain('<!-- BEGIN AUTO:related-projects -->');
			expect(body, path).toContain('<!-- END AUTO:related-projects -->');
		}
	});

	it('Knowledge 同时支持独立与项目绑定路径，且模板标题和消费审计保持一致', () => {
		for (const [skillPath, templatePath] of [
			['assets/skills/knowledge/SKILL.zh.md', 'assets/templates/zh/Knowledge_Template.md'],
			['assets/skills/knowledge/SKILL.en.md', 'assets/templates/en/Knowledge_Template.md'],
		] as const) {
			const skill = read(skillPath);
			const template = readMarkdownAsset(templatePath).body;
			expect(skill, skillPath).toMatch(/独立.*Wiki|standalone.*Wiki/i);
			expect(skill, skillPath).toMatch(/项目绑定|project-bound/i);
			expect(skill, skillPath).toContain('subdirectories.resources.books');
			expect(skill, skillPath).toContain('subdirectories.resources.literature');
			expect(skill, skillPath).toMatch(/消费审计|consumption audit/i);
			expect(skill, skillPath).toMatch(/掌握度表|mastery table/i);
			for (const heading of ['核心摘录', '前置知识', '问题背景与动机', '核心概念与定义']) {
				if (template.includes(`## ${heading}`)) expect(skill, skillPath).toContain(`## ${heading}`);
			}
			for (const heading of ['Key Excerpts', 'Prerequisites', 'Problem Background and Motivation', 'Core Concepts and Definitions']) {
				if (template.includes(`## ${heading}`)) expect(skill, skillPath).toContain(`## ${heading}`);
			}
		}
	});
});
