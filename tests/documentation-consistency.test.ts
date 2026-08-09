import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FINAL_TOOLS = [
	'memory_bootstrap',
	'memory_query',
	'memory_context',
	'memory_log',
	'memory_rules',
	'memory_history',
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

const RELEASE_SURFACES = [
	'README.md',
	'README.en.md',
	'assets/lifeos-rules.zh.md',
	'assets/lifeos-rules.en.md',
] as const;

const DIAGRAM_SEMANTICS = [
	'Agent',
	'Bootstrap',
	'ScopeCatalog',
	'ContextQuery',
	'EightTools',
	'StructuredOutput',
	'TextOutput',
	'MemoryItems',
	'MemoryEvents',
	'MaintenanceState',
	'CliPurge',
	'BackupBoundary',
	'NoSchemaV6',
] as const;

describe('公开协议文档门禁', () => {
	it('协议文档列出全部公开 MCP 工具', () => {
		const registered = [...read('src/server.ts').matchAll(/server\.tool\(\s*'([^']+)'/g)].map(
			(match) => match[1],
		);
		expect(registered).toEqual(FINAL_TOOLS);
		for (const path of PROTOCOL_DOCS) {
			const content = read(path);
			for (const tool of FINAL_TOOLS.filter((name) => name !== 'memory_history')) {
				expect(content, `${path} 缺少 ${tool}`).toContain(tool);
			}
		}
		expect(read('docs/memory-contract-v2.md')).toContain('memory_history');
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
			'Schema V5',
			'运行时只接受 `Schema V5`',
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
				check:
					/`?notify_failed`?\（记忆索引通知失败）[\s\S]{0,1200}补写通知失败[\s\S]{0,400}memory_notify\(contract_version=2, file_path="<目标路径>"\)[\s\S]{0,600}移动通知失败[\s\S]{0,400}previous_file_path="<源路径>"/,
			},
			{
				path: 'assets/skills/archive/SKILL.en.md',
				check:
					/`?notify_failed`? \(memory index notification failure\)[\s\S]{0,1200}metadata-repair notification[\s\S]{0,400}memory_notify\(contract_version=2, file_path="<target-path>"\)[\s\S]{0,600}move notification[\s\S]{0,400}previous_file_path="<source-path>"/i,
			},
		] as const;
		for (const item of cases) {
			expect(read(item.path), `${item.path} 缺少完整恢复指引`).toMatch(item.check);
		}
	});

	it('公开表面统一声明 Schema V5、8 工具与当前记忆治理边界', () => {
		for (const path of RELEASE_SURFACES) {
			const content = read(path);
			for (const marker of [
				'Schema V5',
				'memory_history',
				'memory_items',
				'memory_item_events',
				'ScopeCatalog',
				'structuredContent',
				'rankScore',
			]) {
				expect(content, `${path} 缺少 ${marker}`).toContain(marker);
			}
			expect(content, `${path} 未声明 8 个工具`).toMatch(/(?:8 个|8 MCP|eight MCP)/i);
			expect(content, `${path} 未声明 No-Go`).toMatch(/No-Go/i);
		}

		const agents = read('AGENTS.md');
		expect(agents).toMatch(/8 tools/i);
		expect(agents).toContain('Schema V5');
		for (const stale of [
			'11 tools',
			'session event log',
			'session_log',
			'session_state',
			'enhance_queue',
			'module-level singleton',
		]) {
			expect(agents).not.toContain(stale);
		}

		const contract = read('docs/memory-contract-v2.md');
		for (const marker of [
			'V4 baseline',
			'append-only',
			'--confirm-item-id',
			'先创建并校验',
			'pending',
			'running',
			'succeeded',
			'failed',
			'single-flight',
			'rankPosition',
			'evidence',
		]) {
			expect(contract, `契约缺少 ${marker}`).toContain(marker);
		}
	});

	it('公开说明将结构化与文本同值限定为成功调用，并声明启动错误边界', () => {
		for (const surface of [
			{
				path: 'README.md',
				success: /8 个工具[^\n]*成功调用[^\n]*structuredContent[^\n]*文本结果/,
				startup:
					/bootstrap[^\n]*以外的其他 7 个工具[^\n]*启动失败[^\n]*isError[^\n]*文本 JSON[^\n]*不返回 structuredContent/,
			},
			{
				path: 'README.en.md',
				success:
					/All 8 MCP tools[^\n]*successful calls[^\n]*equivalent[^\n]*structuredContent[^\n]*text JSON/i,
				startup:
					/seven non-bootstrap tools[^\n]*startup failure[^\n]*isError[^\n]*text JSON[^\n]*no structuredContent/i,
			},
			{
				path: 'AGENTS.md',
				success: /8 tools[^\n]*成功调用[^\n]*structuredContent[^\n]*content\[0\]\.text/,
				startup:
					/bootstrap 以外的 7 个工具[^\n]*启动失败[^\n]*isError[^\n]*文本 JSON[^\n]*无 structuredContent/,
			},
		] as const) {
			const content = read(surface.path);
			expect(content, `${surface.path} 未将同值契约限定为成功调用`).toMatch(surface.success);
			expect(content, `${surface.path} 未精确说明启动错误边界`).toMatch(surface.startup);
		}

		const changelog = read('CHANGELOG.md');
		expect(changelog).toMatch(
			/MCP 结果新增严格 `outputSchema`[^\n]*成功调用[^\n]*structuredContent[^\n]*content\[0\]\.text/,
		);
		expect(changelog).toMatch(
			/其他七工具的启动失败[^\n]*isError[^\n]*不返回 `structuredContent`[^\n]*原文本 JSON/,
		);
	});

	it('真实环境文档记录 51 个自动项普通通过、C-06 唯一跳过和 Schema V5 夹具', () => {
		const cases = read('docs/memory-real-env-test-cases.zh.md');
		const report = read('docs/memory-real-env-test-execution-report.zh.md');
		for (const content of [cases, report]) {
			expect(content).toContain('v2.5.0');
			expect(content).not.toMatch(/(?:版本|包版本)：v2\.4\.0/);
			expect(content).toContain('Schema V5');
			expect(content).toContain('51');
			expect(content).toContain('54');
			expect(content).toContain('C-06');
			expect(content).not.toContain('it.fails');
			expect(content).not.toContain('expected fail');
		}
		expect(report).toContain('生产只读快照未升级');
		expect(report).toMatch(/active.*archived|活跃.*归档/i);
	});

	it('中英文 Mermaid 与 SVG 具有相同的关键语义节点和连线契约', () => {
		for (const [mermaidPath, svgPath] of [
			['assets/lifeos-memory.mmd', 'assets/lifeos-memory.svg'],
			['assets/lifeos-memory.en.mmd', 'assets/lifeos-memory.en.svg'],
		] as const) {
			const mermaid = read(mermaidPath);
			const svg = read(svgPath);
			for (const semantic of DIAGRAM_SEMANTICS) {
				expect(mermaid, `${mermaidPath} 缺少节点 ${semantic}`).toMatch(
					new RegExp(`\\b${semantic}[\\[{(]`),
				);
				expect(svg, `${svgPath} 缺少节点 ${semantic}`).toContain(`data-semantic=\"${semantic}\"`);
			}
			for (const edge of [
				'Agent --> Bootstrap',
				'Bootstrap --> ScopeCatalog',
				'ScopeCatalog --> ContextQuery',
				'ContextQuery --> EightTools',
				'MemoryItems <--> MemoryEvents',
				'EightTools --> StructuredOutput',
				'EightTools --> TextOutput',
				'CliPurge --> BackupBoundary',
				'NoSchemaV6 -.-> MemoryItems',
			]) {
				expect(mermaid, `${mermaidPath} 缺少连线 ${edge}`).toContain(edge);
			}
			expect(svg).toMatch(/^<\?xml[\s\S]*<svg[\s\S]*<\/svg>\s*$/);
		}
	});

	it('工具目录来源与 purge 备份位置符合当前实现', () => {
		const contract = read('docs/memory-contract-v2.md');
		expect(contract).toMatch(
			/scope_hints\.available_tools[^\n]*lifeos\.yaml[^\n]*已配置的稳定工具 ID/,
		);
		expect(contract).not.toContain('存在活跃记忆的工具作用域');

		for (const path of ['assets/lifeos-memory.mmd', 'assets/lifeos-memory.svg']) {
			const content = read(path);
			expect(content, `${path} 缺少 purge-backups`).toContain('purge-backups');
			expect(content, `${path} 未声明独立 SQLite 备份文件`).toContain('独立 SQLite 备份文件');
			expect(content, `${path} 错称备份位于 Vault 外`).not.toContain('Vault 外 SQLite');
		}
		for (const path of ['assets/lifeos-memory.en.mmd', 'assets/lifeos-memory.en.svg']) {
			const content = read(path);
			expect(content, `${path} 缺少 purge-backups`).toContain('purge-backups');
			expect(content, `${path} 未声明独立 SQLite 备份文件`).toContain(
				'independent SQLite backup file',
			);
			expect(content, `${path} 错称 external backup`).not.toContain('external SQLite backup');
		}
	});
});
