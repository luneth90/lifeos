import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FINAL_TOOLS = [
	'memory_bootstrap',
	'memory_query',
	'memory_context',
	'memory_log',
	'memory_rules',
	'memory_forget',
	'memory_notify',
] as const;

const PROTOCOL_DOCS = [
	'README.md',
	'docs/memory-contract-v2.md',
	'docs/manual-testing-guide.zh.md',
	'docs/manual-testing-guide.en.md',
	'docs/integration-test.zh.md',
	'docs/integration-test.en.md',
] as const;

function read(path: string): string {
	return readFileSync(path, 'utf-8');
}

function markdownFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return markdownFiles(path);
		return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
	});
}

function allProductDocumentation(): Array<{ path: string; content: string }> {
	return ['README.md', ...markdownFiles('docs')].map((path) => ({ path, content: read(path) }));
}

describe('最终协议文档门禁', () => {
	it('服务端与协议文档固定为七个 MCP 工具', () => {
		const server = read('src/server.ts');
		const registered = [...server.matchAll(/server\.tool\(\s*'([^']+)'/g)].map((match) => match[1]);
		expect(registered).toEqual(FINAL_TOOLS);

		for (const path of PROTOCOL_DOCS) {
			const content = read(path);
			for (const tool of FINAL_TOOLS) {
				expect(content, `${path} 缺少 ${tool}`).toContain(tool);
			}
		}
	});

	it('所有产品文档都不再描述旧事件与会话接口', () => {
		const removedIdentifiers = [
			'memory_startup',
			'memory_recent',
			'memory_citations',
			'memory_checkpoint',
			'memory_skill_complete',
			'memory_refresh',
			'memory_skill_context',
			'entry_type',
			'session_log',
			'session_state',
			'session_fts',
			'skill_completion',
		];
		for (const { path, content } of allProductDocumentation()) {
			for (const identifier of removedIdentifiers) {
				expect(content, `${path} 仍包含 ${identifier}`).not.toContain(identifier);
			}
		}
	});

	it('历史兼容计划不再属于产品文档', () => {
		const paths = markdownFiles('docs');
		expect(paths.some((path) => path.includes('/superpowers/'))).toBe(false);
		const combined = allProductDocumentation()
			.map(({ content }) => content)
			.join('\n');
		for (const obsoleteClaim of [
			'首次任意工具调用',
			'首次工具返回带 `_layer0`',
			'其他工具仍可维持旧行为',
			'兼容旧客户端和旧技能行为',
		]) {
			expect(combined).not.toContain(obsoleteClaim);
		}
	});

	it('文档版本与源码常量一致，且 runtime 不承诺迁移', () => {
		const runtime = read('src/runtime-contract.ts');
		const schema = read('src/db/schema.ts');
		expect(runtime).toMatch(/CONTRACT_VERSION\s*=\s*2/);
		expect(schema).toMatch(/SCHEMA_VERSION\s*=\s*4/);

		const contract = read('docs/memory-contract-v2.md');
		expect(contract).toContain('`contract_version=2`');
		expect(contract).toContain('`Schema V4`');
		expect(contract).toContain('运行时只接受 `Schema V4`');
		expect(contract).toContain('不会迁移旧数据库');
	});

	it('所有非 bootstrap 调用示例显式传 contract_version=2', () => {
		const callPattern = /memory_(query|context|log|rules|forget|notify)\([^\n]*\)/g;
		for (const { path, content } of allProductDocumentation()) {
			for (const match of content.matchAll(callPattern)) {
				expect(match[0], `${path} 存在无版本调用`).toContain('contract_version=2');
			}
			for (const match of content.matchAll(/memory_bootstrap\([^\n]*\)/g)) {
				expect(match[0], `${path} 给 bootstrap 传入了版本`).not.toContain('contract_version');
			}
		}
	});

	it('所有 memory_log 调用示例显式传 item_kind 与 scope', () => {
		for (const { path, content } of allProductDocumentation()) {
			for (const match of content.matchAll(/memory_log\([^\n]*\)/g)) {
				expect(match[0], `${path} 的 memory_log 缺少 item_kind`).toContain('item_kind=');
				expect(match[0], `${path} 的 memory_log 缺少 scope`).toContain('scope=');
			}
		}
	});

	it('Layer 0 与局部上下文职责没有混写', () => {
		const contract = read('docs/memory-contract-v2.md');
		expect(contract).toContain('Layer 0 只包含全局上下文');
		expect(contract).toContain('局部上下文必须在任务路由完成后');
		expect(contract).toContain('全局 `hard` 规则始终阻止局部同 slot 覆盖');
		expect(contract).toContain('`memory_context` 只返回 `rule`、`decision`、`fact`');
	});

	it('升级文档只允许 V1/V2/V3 到 V4 的离线 cutover', () => {
		for (const path of ['README.md', 'docs/memory-contract-v2.md', ...PROTOCOL_DOCS.slice(2)]) {
			const content = read(path);
			expect(content, `${path} 缺少 lifeos upgrade`).toContain('lifeos upgrade');
			expect(content, `${path} 缺少 scope map`).toContain('--scope-map');
			expect(content, `${path} 仍把 --override 当作命令参数`).not.toMatch(
				/lifeos upgrade[^\n]*--override/,
			);
		}

		const combined = PROTOCOL_DOCS.map(read).join('\n');
		for (const version of ['Schema V1', 'Schema V2', 'Schema V3', 'Schema V4']) {
			expect(combined).toContain(version);
		}
		expect(combined).toContain('离线');
		expect(combined).toContain('cutover');
	});

	it('CLI rules 六个治理子命令全部有文档', () => {
		const contract = read('docs/memory-contract-v2.md');
		for (const command of ['list', 'audit', 'export', 'classify', 'archive', 'restore']) {
			expect(contract).toContain(`lifeos rules ${command}`);
		}
	});

	it('知识状态链固定为 draft 到 mastered 的四阶段单向流转', () => {
		const finalChain = 'draft → review → revised → mastered';
		for (const path of PROTOCOL_DOCS) {
			expect(read(path), `${path} 缺少最终知识状态链`).toContain(finalChain);
		}
		const combined = allProductDocumentation()
			.map(({ content }) => content)
			.join('\n');
		for (const obsoleteChain of [
			'draft → review → mastered',
			'draft → revise → mastered',
			'draft → revised → mastered',
		]) {
			expect(combined).not.toContain(obsoleteChain);
		}
	});
});
