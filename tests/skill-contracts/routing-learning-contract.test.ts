import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
	const byId = new Map(contract.routes.map((candidate) => [candidate.id, candidate]));
	const matched = contract.order
		.map((id) => byId.get(id))
		.find((candidate) => candidate?.examples.includes(input));
	return matched?.target ?? 'direct_answer';
}

function declaredSkills(): Set<string> {
	const skillsRoot = join(process.cwd(), 'assets/skills');
	return new Set(
		readdirSync(skillsRoot).filter((name) => existsSync(join(skillsRoot, name, 'SKILL.zh.md'))),
	);
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
		expect(
			route('重叠意图', {
				...contract,
				order: ['translation', 'pdf_reading'],
				routes: [
					{ id: 'pdf_reading', target: 'read-pdf', examples: ['重叠意图'] },
					{ id: 'translation', target: 'translate', examples: ['重叠意图'] },
				],
			}),
		).toBe('translate');
		expect(route('未匹配的普通提问', contract)).toBe('direct_answer');
		const skills = declaredSkills();
		for (const candidate of contract.routes) {
			expect(skills.has(candidate.target), `${candidate.target} 不是已声明技能`).toBe(true);
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

	it('Today 在 AskUserQuestion 无响应时不从候选池写入任务或相关项目', () => {
		for (const path of ['assets/skills/today/SKILL.zh.md', 'assets/skills/today/SKILL.en.md']) {
			const content = read(path);
			expect(content, path).toMatch(/无响应|no response/i);
			expect(content, path).toMatch(/保持.*托管区块为空|keep.*managed blocks empty/i);
			expect(content, path).toMatch(/不得.*候选池.*推断|never.*candidate pool/i);
		}
	});

	it('Brainstorm 为 checkpoint 提供模板化草稿，并只通过公开 Project 入口交接', () => {
		for (const path of ['assets/skills/brainstorm/SKILL.zh.md', 'assets/skills/brainstorm/SKILL.en.md']) {
			const content = read(path);
			expect(content, path).toMatch(/首次.*checkpoint.*创建或复用.*Draft_Template|first.*checkpoint.*create or reuse.*Draft_Template/i);
			expect(content, path).toMatch(/发散[\s\S]{0,400}memory_notify|Divergence[\s\S]{0,400}memory_notify/i);
			expect(content, path).toMatch(/收敛[\s\S]{0,400}memory_notify|Convergence[\s\S]{0,400}memory_notify/i);
			expect(content, path).toMatch(/交接[\s\S]{0,400}memory_notify|Handoff[\s\S]{0,400}memory_notify/i);
			expect(content, path).toMatch(/\/project.*公共规划入口|\/project.*public planning entry/i);
			expect(content, path).not.toMatch(/sub-agent Planning Agent|子-agent Planning Agent|子 Agent Planning Agent/i);
		}
	});

	it('行为证据在已追踪文件中完整保存，且不依赖 SDD 临时目录', () => {
		const evidence = read('development/skill-tests/2026-07-31-phase-3-routing-learning.md');
		expect(evidence).not.toContain('.superpowers/sdd/');
		for (const marker of [
			'baseline-148e453-场景一-今日安排',
			'baseline-148e453-场景二-PDF翻译',
			'baseline-148e453-场景三-AI周报',
			'baseline-148e453-场景四-独立百科',
			'green-routing-fresh-context-20260731',
			'memory_bootstrap()',
			'memory_context(contract_version=2',
			'memory_query(contract_version=2',
		]) {
			expect(evidence).toContain(marker);
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
