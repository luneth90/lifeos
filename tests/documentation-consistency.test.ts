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

function expectInOrder(
	content: string,
	path: string,
	checks: ReadonlyArray<{ label: string; pattern: RegExp }>,
): void {
	let cursor = 0;
	for (const check of checks) {
		const match = content.slice(cursor).match(check.pattern);
		expect(match, `${path} 缺少有序步骤：${check.label}`).not.toBeNull();
		cursor += (match?.index ?? 0) + (match?.[0].length ?? 0);
	}
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
		for (const path of ['docs/memory-contract-v2.md', ...PROTOCOL_DOCS.slice(2)]) {
			const content = read(path);
			expect(content, `${path} 缺少 lifeos upgrade`).toContain('lifeos upgrade');
			expect(content, `${path} 缺少自动 scope map`).toContain('自动生成');
			expect(content, `${path} 缺少 scope map 确认入口`).toContain('--accept-scope-map');
			expect(content, `${path} 缺少未知 scope 阻断约束`).toContain('__REVIEW_REQUIRED__');
			expect(content, `${path} 仍把 --override 当作命令参数`).not.toMatch(
				/^\s*lifeos upgrade[^\n]*--override/m,
			);
		}
		for (const path of ['docs/memory-contract-v2.md']) {
			const content = read(path);
			expect(content, `${path} 缺少 repository_bindings 路径数组示例`).toMatch(
				/repository_bindings:\n\s+lifeos:\n\s+- \/Users\/your-name\/code\/lifeos/,
			);
			expect(content, `${path} 缺少无 repository 记忆时的空对象示例`).toContain(
				'repository_bindings: {}',
			);
		}

		const combined = PROTOCOL_DOCS.map(read).join('\n');
		for (const version of ['Schema V1', 'Schema V2', 'Schema V3', 'Schema V4']) {
			expect(combined).toContain(version);
		}
		expect(combined).toContain('离线');
		expect(combined).toContain('cutover');
	});

	it('中英文 README 只说明如何查找 journal 并执行回滚', () => {
		const contracts = [
			{ path: 'README.md', wholeVault: /回滚会替换整个 Vault/ },
			{ path: 'README.en.md', wholeVault: /Rollback replaces the entire vault/i },
		] as const;

		for (const contract of contracts) {
			const content = read(contract.path);
			expect(content, `${contract.path} 缺少备份目录`).toContain('.lifeos-cutovers');
			expect(content, `${contract.path} 缺少 journal 文件名`).toContain('journal.json');
			expect(content, `${contract.path} 缺少 journal 查找命令`).toMatch(
				/^find \/absolute\/path\/to\/\.lifeos-cutovers -type f -name journal\.json -print$/m,
			);
			expect(content, `${contract.path} 缺少回滚命令`).toMatch(
				/lifeos upgrade \/absolute\/path\/to\/my-vault \\\n\s+--restore \/absolute\/path\/to\/\.lifeos-cutovers\/[^\n]+\/journal\.json/,
			);
			expect(content, `${contract.path} 缺少完整 Vault 覆盖警告`).toMatch(
				contract.wholeVault,
			);
			for (const internalDetail of [
				'v4-scope-map.json',
				'--scope-map',
				'--accept-scope-map',
				'runtime-receipt.json',
				'active.lock',
				'from_version',
				'to_version',
				'backup_path',
				'repository_bindings',
				'__REVIEW_REQUIRED__',
			]) {
				expect(content, `${contract.path} 暴露了内部升级细节：${internalDetail}`).not.toContain(
					internalDetail,
				);
			}
		}
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

describe('项目技能稳定 ID 契约', () => {
	it('中英文项目模板都只包含一个 ID 占位字段', () => {
		for (const path of [
			'assets/templates/zh/Project_Template.md',
			'assets/templates/en/Project_Template.md',
		]) {
			const content = read(path);
			expect(
				content.match(/^id:\s*"\{\{ID\}\}"\s*$/gm) ?? [],
				`${path} 缺少唯一 ID 占位`,
			).toHaveLength(1);
		}
	});

	it('中英文 Planning Agent 都把确定性 project_id 写入计划', () => {
		const contracts = [
			{
				path: 'assets/skills/project/references/planning-agent-prompt.zh.md',
				relativePath: /Vault 相对路径/,
				conflict: /冲突/,
			},
			{
				path: 'assets/skills/project/references/planning-agent-prompt.en.md',
				relativePath: /Vault-relative\s+path/i,
				conflict: /conflict|collision/i,
			},
		] as const;

		for (const contract of contracts) {
			const content = read(contract.path);
			expect(content, `${contract.path} 计划中缺少机器可读 project_id`).toMatch(
				/^\s*project_id:\s*"[^"]+"\s*$/m,
			);
			expect(content, `${contract.path} 缺少稳定哈希算法`).toContain('SHA-256');
			expect(content, `${contract.path} 缺少 Vault 相对路径输入约束`).toMatch(
				contract.relativePath,
			);
			expect(content, `${contract.path} 缺少 ID 冲突消歧规则`).toMatch(contract.conflict);
		}
	});

	it('中英文 Execution Agent 都生成、写入并回读验证项目 ID', () => {
		const contracts = [
			{
				path: 'assets/skills/project/references/execution-agent-prompt.zh.md',
				generate: /生成/,
				replace: /替换/,
				unique: /唯一/,
				reread: /回读/,
				stringType: /字符串/,
				exactlyOnce: /各且仅有一个|各出现一次/,
				matchesPlan: /与计划[^\n]*一致/,
				noPlaceholder: /不包含[^\n]*(?:占位|\{\{ID\}\})|(?:不得|禁止)[^\n]*残留/,
				returnResult: /返回/,
				leaveStatus: /(?:不得|禁止)[^\n]*(?:草稿|计划)[^\n]*(?:状态|status)/,
			},
			{
				path: 'assets/skills/project/references/execution-agent-prompt.en.md',
				generate: /generat/i,
				replace: /replac/i,
				unique: /unique/i,
				reread: /re-?read/i,
				stringType: /string/i,
				exactlyOnce: /exactly once|exactly one[^\n]*type[^\n]*one[^\n]*id/i,
				matchesPlan: /match(?:es)?[^\n]*plan/i,
				noPlaceholder:
					/contains no[^\n]*(?:template|\{\{ID\}\})|(?:must not|do not|no)[^\n]*(?:remain|leftover)/i,
				returnResult: /return/i,
				leaveStatus: /(?:must not|do not)[^\n]*(?:draft|plan)[^\n]*status/i,
			},
		] as const;

		for (const contract of contracts) {
			const content = read(contract.path);
			expect(content, `${contract.path} 的主项目示例缺少引用计划 project_id`).toMatch(
				/^id:\s*"\[[^\]]*project_id[^\]]*\]"\s*$/im,
			);
			expect(content, `${contract.path} 缺少新 ID 合法格式`).toContain(
				'^[a-z0-9]+(?:-[a-z0-9]+)*$',
			);
			expect(content, `${contract.path} 缺少 ID 生成指令`).toMatch(contract.generate);
			expect(content, `${contract.path} 缺少 ID 占位符替换指令`).toMatch(contract.replace);
			expect(content, `${contract.path} 缺少全 Vault 唯一性检查`).toMatch(contract.unique);
			expect(content, `${contract.path} 缺少创建后回读验证`).toMatch(contract.reread);
			expect(content, `${contract.path} 缺少 ID 字符串类型验证`).toMatch(contract.stringType);
			expect(content, `${contract.path} 缺少 type/id 顶层键唯一性验证`).toMatch(
				contract.exactlyOnce,
			);
			expect(content, `${contract.path} 缺少与计划 ID 一致性验证`).toMatch(contract.matchesPlan);
			expect(content, `${contract.path} 缺少占位符残留验证`).toMatch(contract.noPlaceholder);
			expect(content, `${contract.path} 必须显式检查 ID 占位符`).toContain('{{ID}}');
			expectInOrder(content, contract.path, [
				{ label: '创建后回读自检', pattern: contract.reread },
				{ label: '向 Orchestrator 返回结果', pattern: contract.returnResult },
			]);
			expect(content, `${contract.path} 不得越权更新计划或草稿状态`).toMatch(contract.leaveStatus);
		}
	});

	it('中英文主 SKILL 都要求 Orchestrator 独立验收 ID 后才收尾', () => {
		const contracts = [
			{
				path: 'assets/skills/project/SKILL.zh.md',
				independent: /独立/,
				reread: /回读/,
				acceptance: /验收/,
				correction: /修正/,
				phaseStart: '# 阶段2：启动 Execution Agent（用户确认后）',
				phaseEnd: '# 边界情况',
				ordered: [
					{ label: '独立验收', pattern: /创建后验收/ },
					{ label: '通知主项目变更', pattern: /memory_notify/ },
					{
						label: '验证 project scope',
						pattern: /memory_context[\s\S]{0,300}type:\s*"project"/,
					},
					{ label: '更新计划和草稿状态', pattern: /status:\s*done/ },
					{ label: '交付完成报告', pattern: /报告创建完成/ },
				],
			},
			{
				path: 'assets/skills/project/SKILL.en.md',
				independent: /independent/i,
				reread: /re-?read/i,
				acceptance: /acceptance|validat/i,
				correction: /correct|fix|repair/i,
				phaseStart: '# Phase 2: Launch Execution Agent (After User Confirmation)',
				phaseEnd: '# Edge Cases',
				ordered: [
					{ label: '独立验收', pattern: /post-creation acceptance/i },
					{ label: '通知主项目变更', pattern: /memory_notify/ },
					{
						label: '验证 project scope',
						pattern: /memory_context[\s\S]{0,300}type:\s*"project"/i,
					},
					{ label: '更新计划和草稿状态', pattern: /status:\s*done/i },
					{ label: '交付完成报告', pattern: /report completion/i },
				],
			},
		] as const;

		for (const contract of contracts) {
			const content = read(contract.path);
			const phaseStart = content.indexOf(contract.phaseStart);
			const phaseEnd = content.indexOf(contract.phaseEnd, phaseStart);
			expect(phaseStart, `${contract.path} 缺少 Execution 阶段`).toBeGreaterThanOrEqual(0);
			expect(phaseEnd, `${contract.path} 缺少 Execution 阶段结束边界`).toBeGreaterThan(phaseStart);
			expectInOrder(content.slice(phaseStart, phaseEnd), contract.path, contract.ordered);
			expect(content).toContain('Orchestrator');
			expect(content, `${contract.path} 缺少独立验收要求`).toMatch(contract.independent);
			expect(content, `${contract.path} 缺少主项目回读`).toMatch(contract.reread);
			expect(content, `${contract.path} 缺少验收关卡`).toMatch(contract.acceptance);
			expect(content, `${contract.path} 缺少验收失败修正要求`).toMatch(contract.correction);
		}
	});
});
