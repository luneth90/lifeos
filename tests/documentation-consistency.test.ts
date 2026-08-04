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

describe('公开协议文档门禁', () => {
	it('协议文档列出全部公开 MCP 工具', () => {
		const registered = [...read('src/server.ts').matchAll(/server\.tool\(\s*'([^']+)'/g)].map(
			(match) => match[1],
		);
		expect(registered).toEqual(FINAL_TOOLS);
		for (const path of PROTOCOL_DOCS) {
			const content = read(path);
			for (const tool of FINAL_TOOLS) expect(content, `${path} 缺少 ${tool}`).toContain(tool);
		}
	});

	it('产品文档不再公开旧接口，并保留升级恢复入口', () => {
		const combined = allProductDocumentation()
			.map(({ content }) => content)
			.join('\n');
		for (const identifier of [
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
		]) {
			expect(combined).not.toContain(identifier);
		}
		const contract = read('docs/memory-contract-v2.md');
		for (const marker of [
			'Schema V4',
			'运行时只接受 `Schema V4`',
			'不会迁移旧数据库',
			'lifeos upgrade',
			'--accept-scope-map',
			'__REVIEW_REQUIRED__',
			'离线',
			'cutover',
		]) {
			expect(contract).toContain(marker);
		}
		for (const path of ['docs/memory-contract-v2.md', ...PROTOCOL_DOCS.slice(2)]) {
			const content = read(path);
			for (const marker of ['lifeos upgrade', '--accept-scope-map', '__REVIEW_REQUIRED__']) {
				expect(content, `${path} 缺少 ${marker}`).toContain(marker);
			}
		}
		for (const path of ['README.md', 'README.en.md']) {
			const content = read(path);
			for (const marker of ['journal.json', 'lifeos upgrade', '--restore']) {
				expect(content).toContain(marker);
			}
			for (const internal of [
				'v4-scope-map.json',
				'--scope-map',
				'--accept-scope-map',
				'runtime-receipt.json',
				'active.lock',
				'__REVIEW_REQUIRED__',
			]) {
				expect(content, `${path} 暴露了内部升级细节：${internal}`).not.toContain(internal);
			}
			expect(content).toMatch(/回滚会替换整个 Vault|Rollback replaces the entire vault/i);
		}
	});

	it('文档中的 MCP 调用示例携带正确的契约参数', () => {
		for (const { path, content } of allProductDocumentation()) {
			for (const match of content.matchAll(
				/memory_(query|context|log|rules|forget|notify)\([^\n]*\)/g,
			)) {
				expect(match[0], `${path} 存在无版本调用`).toContain('contract_version=2');
				if (match[1] === 'log') {
					expect(match[0], `${path} 的 memory_log 缺少 item_kind`).toContain('item_kind=');
					expect(match[0], `${path} 的 memory_log 缺少 scope`).toContain('scope=');
				}
			}
			for (const match of content.matchAll(/memory_bootstrap\([^\n]*\)/g)) {
				expect(match[0], `${path} 给 bootstrap 传入了版本`).not.toContain('contract_version');
			}
		}
	});

	it('中英文记忆路由资产保留增量作用域与工具别名标记', () => {
		for (const asset of [
			{
				rules: read('assets/lifeos-rules.zh.md'),
				protocol: read('assets/skills/_shared/memory-protocol.zh.md'),
				incremental: /增量调用 `memory_context`/,
			},
			{
				rules: read('assets/lifeos-rules.en.md'),
				protocol: read('assets/skills/_shared/memory-protocol.en.md'),
				incremental: /incrementally call `memory_context`/i,
			},
		] as const) {
			expect(asset.rules).toMatch(asset.incremental);
			expect(asset.protocol).toMatch(asset.incremental);
			for (const marker of [
				'scope_hints.available_tools',
				'scope_hints.available_repositories',
				'scope_hints.tool_bindings',
				'memory.tool_bindings',
				'ambiguous_tool_alias',
			]) {
				expect(asset.protocol).toContain(marker);
			}
		}
	});

	it('记忆治理命令与知识状态链保持公开一致', () => {
		const contract = read('docs/memory-contract-v2.md');
		for (const command of ['list', 'audit', 'export', 'classify', 'archive', 'restore']) {
			expect(contract).toContain(`lifeos rules ${command}`);
		}

		const finalChain = 'draft → review → revised → mastered';
		for (const path of PROTOCOL_DOCS) {
			expect(read(path), `${path} 缺少最终知识状态链`).toContain(finalChain);
		}
	});

	it('Archive 技能文档包含完整的 notify_failed 人工恢复指引', () => {
		const cases = [
			{
				path: 'assets/skills/archive/SKILL.zh.md',
				check: /`?notify_failed`?\（记忆索引通知失败）[\s\S]{0,1200}补写通知失败[\s\S]{0,400}memory_notify\(contract_version=2, file_path="<目标路径>"\)[\s\S]{0,600}移动通知失败[\s\S]{0,400}previous_file_path="<源路径>"/,
			},
			{
				path: 'assets/skills/archive/SKILL.en.md',
				check: /`?notify_failed`? \(memory index notification failure\)[\s\S]{0,1200}metadata-repair notification[\s\S]{0,400}memory_notify\(contract_version=2, file_path="<target-path>"\)[\s\S]{0,600}move notification[\s\S]{0,400}previous_file_path="<source-path>"/i,
			},
		] as const;
		for (const item of cases) {
			expect(read(item.path), `${item.path} 缺少完整恢复指引`).toMatch(item.check);
		}
	});
});
