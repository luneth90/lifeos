import {
	existsSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import doctor from '../../src/cli/commands/doctor.js';
import { _resetDefaultInstance } from '../../src/config.js';
import {
	memoryContext,
	memoryForget,
	memoryLog,
	memoryNotify,
	memoryQuery,
	memoryRules,
	memoryStartup,
	memoryStartupMaintenance,
} from '../../src/core.js';
import { CONTRACT_VERSION } from '../../src/runtime-contract.js';
import {
	assertNotProductionVault,
	createIsolatedMemoryVault,
} from '../helpers/memory-real-env-vault.js';
import type { IsolatedMemoryVault } from '../helpers/memory-real-env-vault.js';

describe('LifeOS v2 真实环境隔离夹具', () => {
	let cleanup: (() => void) | undefined;

	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	it('夹具只在系统临时目录创建完整且独立的 Vault', () => {
		const vault = createIsolatedMemoryVault();
		cleanup = vault.cleanup;

		expect(realpathSync(vault.root).startsWith(`${realpathSync(tmpdir())}/`)).toBe(true);
		expect(vault.dbPath).toBe(join(vault.root, '90_系统', '记忆', 'memory.db'));
		expect(existsSync(join(vault.root, 'lifeos.yaml'))).toBe(true);
		expect(existsSync(join(vault.root, '.agents', 'skills', 'revise', 'SKILL.md'))).toBe(true);
		expect(existsSync(join(vault.root, '00_草稿', '测试草稿.md'))).toBe(true);
		expect(existsSync(join(vault.root, '60_计划', '测试计划.md'))).toBe(true);
		expect(existsSync(join(vault.root, '20_项目', '稳定项目定位.md'))).toBe(true);
		expect(existsSync(join(vault.root, '40_知识', '百科', '群论夹具.md'))).toBe(true);
		expect(existsSync(vault.dbPath)).toBe(true);
	});

	it('安全护栏拒绝源码仓库等系统临时目录外目标', () => {
		const vault = createIsolatedMemoryVault();
		cleanup = vault.cleanup;
		expect(() => assertNotProductionVault(vault.root)).not.toThrow();
		expect(() => assertNotProductionVault(process.cwd())).toThrow(/系统临时目录/);
		expect(() => assertNotProductionVault(dirname(process.cwd()))).toThrow(/系统临时目录/);
	});

	it('计数快照只读取夹具自己的独立数据库', () => {
		const vault = createIsolatedMemoryVault();
		cleanup = vault.cleanup;

		expect(vault.snapshotCounts()).toEqual({
			activeMemoryItems: 0,
			archivedMemoryItems: 0,
			vaultIndex: 0,
		});
	});
});

describe.sequential('LifeOS v2 真实环境 52 用例映射', () => {
	let vault: IsolatedMemoryVault;
	let previousVaultRoot: string | undefined;

	function runtime() {
		assertNotProductionVault(vault.root);
		expect(process.env.LIFEOS_VAULT_ROOT, '测试入口必须锁定隔离 Vault').toBe(vault.root);
		return {
			contractVersion: CONTRACT_VERSION,
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
		};
	}

	function context(
		scopes: Array<{
			type: 'global' | 'skill' | 'project' | 'repository' | 'tool' | 'file';
			key: string;
		}>,
		includeGlobal = false,
	) {
		return memoryContext({
			...runtime(),
			request: { scopes, includeGlobal, includeRelatedFiles: true },
		});
	}

	function forget(itemId: number, reason: string): void {
		memoryForget({ ...runtime(), itemId, reason });
	}

	function openFixtureDb(readonly = true): Database.Database {
		runtime();
		return new Database(vault.dbPath, { readonly, fileMustExist: true });
	}

	function writeMarkdown(relativePath: string, content: string): void {
		assertNotProductionVault(vault.root);
		writeFileSync(join(vault.root, relativePath), content, 'utf-8');
	}

	beforeAll(() => {
		vault = createIsolatedMemoryVault();
		previousVaultRoot = process.env.LIFEOS_VAULT_ROOT;
		process.env.LIFEOS_VAULT_ROOT = vault.root;
		memoryStartupMaintenance(runtime());

		for (const seed of [
			{
				slotKey: 'fixture:global-rule',
				content: '所有测试回复使用中文。',
				scope: { type: 'global', key: '' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:revise-rule',
				content: '复习时先主动回忆。',
				scope: { type: 'skill', key: 'revise' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:digest-rule',
				content: '周报按主题生成。',
				scope: { type: 'skill', key: 'digest' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:today-rule',
				content: '每日规划读取活跃项目。',
				scope: { type: 'skill', key: 'today' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:brainstorm-rule',
				content: '头脑风暴先静默检索。',
				scope: { type: 'skill', key: 'brainstorm' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:knowledge-rule',
				content: '知识整理后通知索引。',
				scope: { type: 'skill', key: 'knowledge' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:research-rule',
				content: '研究开始前执行避重检索。',
				scope: { type: 'skill', key: 'research' } as const,
				itemKind: 'rule' as const,
			},
			{
				slotKey: 'fixture:project-decision',
				content: '项目使用稳定实体标识。',
				scope: { type: 'project', key: 'fixture-project' } as const,
				itemKind: 'decision' as const,
				relatedFiles: ['20_项目/稳定项目定位.md'],
			},
			{
				slotKey: 'profile:work_style',
				content: '隔离夹具用户偏好深度优先学习。',
				scope: { type: 'global', key: '' } as const,
				itemKind: 'profile' as const,
			},
			{
				slotKey: 'profile:weak.fixture',
				content: '项目薄弱点是群作用。',
				scope: { type: 'project', key: 'fixture-project' } as const,
				itemKind: 'profile' as const,
			},
			{
				slotKey: 'fixture:obsidian-tool',
				content: 'Obsidian CLI 用于 Vault 操作。',
				scope: { type: 'tool', key: 'obsidian' } as const,
				itemKind: 'fact' as const,
			},
		]) {
			memoryLog({ ...runtime(), ...seed });
		}
	});

	afterEach(() => {
		if (!vault || !existsSync(vault.dbPath)) return;
		const db = openFixtureDb();
		let active: Array<{ item_id: number; slot_key: string }> = [];
		try {
			active = db
				.prepare(
					"SELECT item_id, slot_key FROM memory_items WHERE status = 'active' AND slot_key LIKE 'test:%'",
				)
				.all() as Array<{ item_id: number; slot_key: string }>;
		} finally {
			db.close();
		}
		for (const item of active) forget(item.item_id, `自动清理残留：${item.slot_key}`);
		expect(active, '每项用例必须自行清理活跃 test: 条目').toEqual([]);
	});

	afterAll(() => {
		if (previousVaultRoot === undefined) Reflect.deleteProperty(process.env, 'LIFEOS_VAULT_ROOT');
		else process.env.LIFEOS_VAULT_ROOT = previousVaultRoot;
		_resetDefaultInstance();
		vault.cleanup();
	});

	it('[自动核心] A-01 bootstrap 返回完整 Layer 0 与作用域提示', () => {
		const result = memoryStartup(runtime());
		for (const heading of ['行为约束', 'TaskBoard 当前焦点', 'UserProfile 速览', '复习提醒']) {
			expect(result.layer0.text).toContain(heading);
		}
		expect(result.layer0.text).toContain('待复习笔记：1 篇');
		expect(result.layer0.meta.sections).toMatchObject({
			globalRules: { total: expect.any(Number), loaded: expect.any(Number) },
			taskboardFocus: { total: expect.any(Number), loaded: expect.any(Number) },
			userprofileSummary: { total: expect.any(Number), loaded: expect.any(Number) },
			revisionReminder: { total: 1, loaded: 1, omitted: 0 },
		});
		expect(result.scopeHints).toMatchObject({
			availableProjects: expect.arrayContaining(['fixture-project']),
			availableRepositories: ['learningapp', 'lifeos'],
			availableSkills: expect.arrayContaining(['revise']),
			availableTools: expect.arrayContaining(['obsidian']),
			toolBindings: {
				obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
			},
		});
	});

	it('[自动核心] A-02 context 按 skill scope 精确加载', () => {
		const result = context([{ type: 'skill', key: 'revise' }]);
		expect(result.matchedScopes).toEqual([{ type: 'skill', key: 'revise' }]);
		expect(result.rules.map((item) => item.slotKey)).toContain('fixture:revise-rule');
		expect(result.effectiveItems.every((item) => item.scope.type !== 'global')).toBe(true);
	});

	it('[自动核心] A-03 context 按稳定 project id 精确加载', () => {
		const result = context([{ type: 'project', key: 'fixture-project' }]);
		expect(result.matchedScopes).toEqual([{ type: 'project', key: 'fixture-project' }]);
		expect(result.effectiveItems.every((item) => item.scope.key === 'fixture-project')).toBe(true);
	});

	it('[自动核心] A-04 context 组合加载多个 scope', () => {
		const result = context([
			{ type: 'skill', key: 'revise' },
			{ type: 'project', key: 'fixture-project' },
		]);
		expect(result.matchedScopes).toEqual([
			{ type: 'skill', key: 'revise' },
			{ type: 'project', key: 'fixture-project' },
		]);
	});

	it('[自动核心] A-05 context 增量补载仅返回新增 repository scope', () => {
		context([{ type: 'skill', key: 'revise' }]);
		const result = context([{ type: 'repository', key: 'lifeos' }]);
		expect(result.matchedScopes).toEqual([{ type: 'repository', key: 'lifeos' }]);
		expect(result.effectiveItems.every((item) => item.scope.type === 'repository')).toBe(true);
	});

	it('[自动核心] A-06 context 对不存在的 scope 返回诊断而不抛错', () => {
		const result = context([{ type: 'project', key: 'missing-project' }]);
		expect(result.matchedScopes).toEqual([]);
		expect(result.diagnostics.unresolvedScopes).toContainEqual({
			scope: { type: 'project', key: 'missing-project' },
			reason: 'unknown_project',
		});
	});

	it('[自动核心] A-07 tool scope 通过绑定别名解析', () => {
		const result = context([{ type: 'tool', key: 'obsidian-cli' }]);
		expect(result.matchedScopes).toEqual([{ type: 'tool', key: 'obsidian' }]);
		expect(result.diagnostics.unresolvedScopes).toEqual([]);
	});

	it('[自动核心] A-08 global 只在 includeGlobal=true 时注入', () => {
		const withoutGlobal = context([{ type: 'skill', key: 'revise' }]);
		const withGlobal = context([{ type: 'skill', key: 'revise' }], true);
		expect(withoutGlobal.effectiveItems.some((item) => item.scope.type === 'global')).toBe(false);
		expect(withGlobal.effectiveItems.some((item) => item.scope.type === 'global')).toBe(true);
	});

	it('[自动核心] B-01 rule 写入后可按字段审计', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:lang-rule',
			content: '所有回复使用中文。',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
			source: 'correction',
		});
		const listed = memoryRules({
			...runtime(),
			filters: { slotKey: 'test:lang-rule', status: 'active' },
		});
		expect(listed.items).toHaveLength(1);
		expect(listed.items[0]).toMatchObject({
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
			source: 'correction',
		});
		forget(created.itemId, 'B-01 清理');
	});

	it('[自动核心] B-02 decision 写入稳定 project id 后可召回关联文件', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:arch-decision',
			content: '选择隔离测试架构。',
			scope: { type: 'project', key: 'fixture-project' },
			itemKind: 'decision',
			relatedFiles: ['20_项目/稳定项目定位.md'],
		});
		const result = context([{ type: 'project', key: 'fixture-project' }]);
		expect(result.decisions.map((item) => item.itemId)).toContain(created.itemId);
		expect(result.relatedFiles).toContain('20_项目/稳定项目定位.md');
		forget(created.itemId, 'B-02 清理');
	});

	it('[自动核心] B-03 fact 与 profile 均可写入和审计', () => {
		const fact = memoryLog({
			...runtime(),
			slotKey: 'test:repo-path',
			content: '仓库路径由隔离配置绑定。',
			scope: { type: 'repository', key: 'lifeos' },
			itemKind: 'fact',
		});
		const profile = memoryLog({
			...runtime(),
			slotKey: 'test:work-style',
			content: '偏好深度优先学习。',
			scope: { type: 'global', key: '' },
			itemKind: 'profile',
		});
		expect(
			memoryRules({ ...runtime(), filters: { itemKind: 'fact', slotKey: 'test:repo-path' } }).items,
		).toHaveLength(1);
		expect(
			memoryRules({ ...runtime(), filters: { itemKind: 'profile', slotKey: 'test:work-style' } })
				.items,
		).toHaveLength(1);
		forget(fact.itemId, 'B-03 清理 fact');
		forget(profile.itemId, 'B-03 清理 profile');
	});

	it('[自动核心] B-04 correction 不被后续 preference 降级', () => {
		const first = memoryLog({
			...runtime(),
			slotKey: 'test:no-downgrade',
			content: '纠正版本。',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			source: 'correction',
		});
		memoryLog({
			...runtime(),
			slotKey: 'test:no-downgrade',
			content: '偏好版本。',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			source: 'preference',
		});
		const [item] = memoryRules({ ...runtime(), filters: { slotKey: 'test:no-downgrade' } }).items;
		expect(item).toMatchObject({ itemId: first.itemId, source: 'correction' });
		forget(first.itemId, 'B-04 清理');
	});

	it('[自动核心] B-05 相同复合键原地覆盖且不产生归档副本', () => {
		const first = memoryLog({
			...runtime(),
			slotKey: 'test:overwrite',
			content: '第一版。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		const second = memoryLog({
			...runtime(),
			slotKey: 'test:overwrite',
			content: '第二版。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		expect(second).toMatchObject({ action: 'updated', itemId: first.itemId });
		expect(
			memoryRules({ ...runtime(), filters: { slotKey: 'test:overwrite', status: 'active' } }).items,
		).toHaveLength(1);
		expect(
			memoryRules({ ...runtime(), filters: { slotKey: 'test:overwrite', status: 'archived' } })
				.items,
		).toHaveLength(0);
		forget(first.itemId, 'B-05 清理');
	});

	it('[自动核心] B-06 plan 与 draft file scope 被硬拦截', () => {
		for (const key of ['fixture-plan', 'fixture-draft']) {
			expect(() =>
				memoryLog({
					...runtime(),
					slotKey: `test:file-block-${key}`,
					content: '不得写入临时文件记忆。',
					scope: { type: 'file', key },
					itemKind: 'fact',
				}),
			).toThrow(/plan|draft|临时|Memory Policy/i);
		}
	});

	it('[自动核心] B-07 event 不能通过 memoryLog 写入', () => {
		expect(() =>
			memoryLog({
				...runtime(),
				slotKey: 'test:event-block',
				content: '一次性事件。',
				scope: { type: 'global', key: '' },
				itemKind: 'event',
			}),
		).toThrow(/event/);
	});

	it('[自动核心] B-08 global scope 的 key 必须为空', () => {
		expect(() =>
			memoryLog({
				...runtime(),
				slotKey: 'test:global-key',
				content: '非法 global key。',
				scope: { type: 'global', key: 'invalid' },
				itemKind: 'rule',
			}),
		).toThrow(/invalid_scope|无法解析/);
	});

	it('[自动核心] B-09 priority 边界可写而越界被拒', () => {
		const minimum = memoryLog({
			...runtime(),
			slotKey: 'test:priority-min',
			content: '最低优先级。',
			scope: { type: 'global', key: '' },
			itemKind: 'fact',
			priority: 0,
			enforcement: 'soft',
		});
		const maximum = memoryLog({
			...runtime(),
			slotKey: 'test:priority-max',
			content: '最高优先级。',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
		});
		expect(() =>
			memoryLog({
				...runtime(),
				slotKey: 'test:priority-overflow',
				content: '越界优先级。',
				scope: { type: 'global', key: '' },
				itemKind: 'fact',
				priority: 101,
			}),
		).toThrow();
		forget(minimum.itemId, 'B-09 清理 min');
		forget(maximum.itemId, 'B-09 清理 max');
	});

	it('[自动核心] C-01 写入后 context 立即召回', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:recall-rule',
			content: '复习时使用费曼方法。',
			scope: { type: 'skill', key: 'revise' },
			itemKind: 'rule',
		});
		expect(context([{ type: 'skill', key: 'revise' }]).rules.map((item) => item.itemId)).toContain(
			created.itemId,
		);
		forget(created.itemId, 'C-01 清理');
	});

	it('[版本夹具] C-02 中文关键词由相关性优先召回', () => {
		const results = memoryQuery({ ...runtime(), query: '群论', limit: 10 }).results;
		const topThreeEntityIds = results.slice(0, 3).map((item) => item.entityId);
		expect(topThreeEntityIds).toContain('fixture-group-theory');
	});

	it('[版本夹具] C-03 英文关键词可召回中文知识夹具', () => {
		const results = memoryQuery({ ...runtime(), query: 'Group Action', limit: 10 }).results;
		expect(results.map((item) => item.entityId)).toContain('fixture-group-theory');
	});

	it('[版本夹具] C-04 中文单字通过前缀匹配召回', () => {
		expect(memoryQuery({ ...runtime(), query: '群', limit: 10 }).results.length).toBeGreaterThan(0);
	});

	it('[自动核心] C-05 query 的 type 过滤精确生效', () => {
		const results = memoryQuery({ ...runtime(), filters: { type: 'project' }, limit: 10 }).results;
		expect(results.length).toBeGreaterThan(0);
		expect(results.every((item) => item.type === 'project')).toBe(true);
	});

	it.skip('[宿主跨会话] C-06 闲聊会话的 memory_* 调用数由宿主日志验证', () => {});

	it('[自动核心] D-01 today 链路可取得活跃项目并通知新日记', () => {
		const startup = memoryStartup(runtime());
		expect(startup.scopeHints.availableProjects).toContain('fixture-project');
		expect(context([{ type: 'skill', key: 'today' }]).matchedScopes).toHaveLength(1);
		const projects = memoryQuery({
			...runtime(),
			filters: { type: 'project', status: 'active' },
			limit: 10,
		}).results;
		expect(projects.map((item) => item.entityId)).toContain('fixture-project');
		writeMarkdown(
			'10_日记/2099-01-01.md',
			'---\ntitle: 测试日记\ntype: daily\nstatus: active\n---\n今日计划。\n',
		);
		expect(memoryNotify({ ...runtime(), filePath: '10_日记/2099-01-01.md' })).toMatchObject({
			action: 'indexed',
		});
	});

	it('[自动核心] D-02 ask scope 可加载且一次性问答 event 被拒绝', () => {
		const ask = memoryLog({
			...runtime(),
			slotKey: 'test:ask-route',
			content: '通用问答按需检索。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		expect(context([{ type: 'skill', key: 'ask' }]).matchedScopes).toEqual([
			{ type: 'skill', key: 'ask' },
		]);
		expect(() =>
			memoryLog({
				...runtime(),
				slotKey: 'test:ask-event',
				content: '一次性问答。',
				scope: { type: 'skill', key: 'ask' },
				itemKind: 'event',
			}),
		).toThrow(/event/);
		forget(ask.itemId, 'D-02 清理');
	});

	it('[版本夹具] D-03 brainstorm 可静默检索相关项目', () => {
		expect(context([{ type: 'skill', key: 'brainstorm' }]).matchedScopes).toHaveLength(1);
		const results = memoryQuery({ ...runtime(), query: '密码学 Agent', limit: 5 }).results;
		expect(results.map((item) => item.entityId)).toContain('fixture-project');
	});

	it('[自动核心] D-04 project 通过稳定 id 解析并出现在索引', () => {
		expect(
			context([{ type: 'project', key: 'fixture-project' }]).diagnostics.unresolvedScopes,
		).toEqual([]);
		const results = memoryQuery({
			...runtime(),
			filters: { type: 'project', entity_id: 'fixture-project' },
			limit: 10,
		}).results;
		expect(results).toHaveLength(1);
	});

	it('[自动核心] D-05 knowledge 通知后可立即检索', () => {
		const scoped = context([
			{ type: 'skill', key: 'knowledge' },
			{ type: 'project', key: 'fixture-project' },
		]);
		expect(scoped.matchedScopes).toHaveLength(2);
		expect(memoryNotify({ ...runtime(), filePath: '40_知识/百科/群论夹具.md' }).action).toMatch(
			/indexed|unchanged/,
		);
		expect(
			memoryQuery({ ...runtime(), query: '群论', limit: 5 }).results.map((item) => item.entityId),
		).toContain('fixture-group-theory');
	});

	it.fails('[版本夹具] D-06 revise 同时加载技能与项目画像并筛选待复习项', () => {
		const scoped = context([
			{ type: 'skill', key: 'revise' },
			{ type: 'project', key: 'fixture-project' },
		]);
		expect(scoped.matchedScopes).toEqual([
			{ type: 'skill', key: 'revise' },
			{ type: 'project', key: 'fixture-project' },
		]);
		expect(scoped.rules.map((item) => item.slotKey)).toContain('fixture:revise-rule');
		const review = memoryQuery({ ...runtime(), filters: { status: 'review' }, limit: 10 }).results;
		expect(review.map((item) => item.entityId)).toContain('fixture-group-theory');
		const profileAware = scoped as typeof scoped & { profiles?: Array<{ slotKey: string }> };
		expect(profileAware.profiles?.map((item) => item.slotKey)).toContain('profile:weak.fixture');
		expect(scoped.text).toContain('作用域画像');
	});

	it('[版本夹具] D-07 research 启动前可检索已有报告避重', () => {
		expect(context([{ type: 'skill', key: 'research' }]).matchedScopes).toHaveLength(1);
		const results = memoryQuery({
			...runtime(),
			query: '空间智能',
			filters: { type: 'research' },
			limit: 5,
		}).results;
		expect(results.map((item) => item.entityId)).toContain('fixture-spatial-intelligence');
	});

	it('[自动核心] D-08 digest skill scope 可加载', () => {
		const result = context([{ type: 'skill', key: 'digest' }]);
		expect(result.matchedScopes).toEqual([{ type: 'skill', key: 'digest' }]);
		expect(result.rules.map((item) => item.slotKey)).toContain('fixture:digest-rule');
	});

	it('[自动核心] D-09 非生产 skill scope 可批量软归档', () => {
		const first = memoryLog({
			...runtime(),
			slotKey: 'test:batch-1',
			content: '条目一。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		const second = memoryLog({
			...runtime(),
			slotKey: 'test:batch-2',
			content: '条目二。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		const result = memoryForget({
			...runtime(),
			scope: { type: 'skill', key: 'ask' },
			reason: 'D-09 批量清理',
		});
		expect(result).toEqual({ archived: 2 });
		expect(
			memoryRules({
				...runtime(),
				filters: { scope: { type: 'skill', key: 'ask' }, status: 'active' },
			}).items,
		).toHaveLength(0);
		expect([first.itemId, second.itemId]).toHaveLength(2);
	});

	it('[自动核心] D-10 global scope 禁止批量归档', () => {
		expect(() =>
			memoryForget({
				...runtime(),
				scope: { type: 'global', key: '' },
				reason: '不得批量归档 global',
			}),
		).toThrow(/global/);
	});

	it('[自动核心] E-01 重置进程内配置后仍可恢复项目上下文', () => {
		_resetDefaultInstance();
		const startup = memoryStartup(runtime());
		expect(startup.scopeHints.availableProjects).toContain('fixture-project');
		expect(startup.layer0.text).toContain('隔离夹具用户偏好深度优先学习。');
		expect(startup.layer0.text).not.toContain('项目薄弱点是群作用。');
		const restored = context([{ type: 'project', key: 'fixture-project' }]);
		expect(restored.decisions.map((item) => item.slotKey)).toContain('fixture:project-decision');
		expect(restored.relatedFiles).toContain('20_项目/稳定项目定位.md');
		expect(restored.relatedFiles.length).toBeGreaterThan(0);
		for (const relatedFile of restored.relatedFiles) {
			expect(existsSync(join(vault.root, relatedFile)), `关联文件 ${relatedFile}`).toBe(true);
		}
	});

	it('[自动核心] E-02 写入后重置调用边界仍可召回', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:cross-session',
			content: '跨调用持久化。',
			scope: { type: 'skill', key: 'revise' },
			itemKind: 'rule',
		});
		_resetDefaultInstance();
		memoryStartup(runtime());
		expect(context([{ type: 'skill', key: 'revise' }]).rules.map((item) => item.itemId)).toContain(
			created.itemId,
		);
		forget(created.itemId, 'E-02 清理');
	});

	it('[自动核心] F-01 rules 按 kind、scope 与 status 精确过滤', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:audit',
			content: '审计条目。',
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
		});
		const rules = memoryRules({
			...runtime(),
			filters: { itemKind: 'rule', status: 'active', limit: 100 },
		}).items;
		expect(rules.every((item) => item.itemKind === 'rule' && item.status === 'active')).toBe(true);
		const global = memoryRules({
			...runtime(),
			filters: { scope: { type: 'global', key: '' }, status: 'active' },
		}).items;
		expect(global.every((item) => item.scope.type === 'global')).toBe(true);
		forget(created.itemId, 'F-01 清理');
		expect(
			memoryRules({ ...runtime(), filters: { status: 'archived', slotKey: 'test:audit' } }).items,
		).toHaveLength(1);
	});

	it('[自动核心] F-02 forget 软归档且 reason 必须非空', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:forget-soft',
			content: '待软归档。',
			scope: { type: 'global', key: '' },
			itemKind: 'fact',
		});
		forget(created.itemId, 'F-02 软归档');
		expect(
			memoryRules({ ...runtime(), filters: { status: 'archived', slotKey: 'test:forget-soft' } })
				.items[0],
		).toMatchObject({ archiveReason: 'F-02 软归档' });
		expect(() => memoryForget({ ...runtime(), itemId: 999999, reason: '' })).toThrow(/reason|原因/);
	});

	it('[自动核心] F-03 归档条目不再进入 context', () => {
		const created = memoryLog({
			...runtime(),
			slotKey: 'test:archived-invisible',
			content: '归档后不可见。',
			scope: { type: 'skill', key: 'ask' },
			itemKind: 'rule',
		});
		expect(context([{ type: 'skill', key: 'ask' }]).rules.map((item) => item.itemId)).toContain(
			created.itemId,
		);
		forget(created.itemId, 'F-03 清理');
		expect(context([{ type: 'skill', key: 'ask' }]).rules.map((item) => item.itemId)).not.toContain(
			created.itemId,
		);
	});

	it('[自动核心] F-04 forget 的 itemId 与 scope 必须且只能传一个', () => {
		expect(() =>
			memoryForget({
				...runtime(),
				itemId: 1,
				scope: { type: 'skill', key: 'ask' },
				reason: '互斥',
			}),
		).toThrow(/必须且只能传其一/);
		expect(() => memoryForget({ ...runtime(), reason: '缺失目标' })).toThrow(/必须且只能传其一/);
	});

	it('[自动核心] G-01 notify 由稳定 id 定位项目夹具', () => {
		const [project] = memoryQuery({
			...runtime(),
			filters: { entity_id: 'fixture-project' },
			limit: 1,
		}).results;
		expect(project?.entityId).toBe('fixture-project');
		expect(memoryNotify({ ...runtime(), filePath: project.filePath }).action).toMatch(
			/indexed|unchanged/,
		);
		expect(
			memoryQuery({ ...runtime(), filters: { entity_id: 'fixture-project' }, limit: 1 }).results,
		).toHaveLength(1);
	});

	it('[自动核心] G-02 notify 不存在路径会清理索引且不崩溃', () => {
		expect(memoryNotify({ ...runtime(), filePath: '40_知识/笔记/不存在.md' })).toMatchObject({
			action: 'removed',
		});
	});

	it('[自动核心] G-03 notify previousFilePath 完成移动索引切换', () => {
		const oldPath = '40_知识/笔记/移动前.md';
		const newPath = '40_知识/笔记/移动后.md';
		writeMarkdown(
			oldPath,
			'---\nid: fixture-move\ntitle: 移动夹具\ntype: knowledge\nstatus: review\n---\n移动一致性关键词。\n',
		);
		memoryNotify({ ...runtime(), filePath: oldPath });
		renameSync(join(vault.root, oldPath), join(vault.root, newPath));
		memoryNotify({ ...runtime(), filePath: newPath, previousFilePath: oldPath });
		const results = memoryQuery({ ...runtime(), query: '移动一致性关键词', limit: 5 }).results;
		expect(results.map((item) => item.filePath)).toContain(newPath);
		expect(results.map((item) => item.filePath)).not.toContain(oldPath);
	});

	it('[自动核心] G-04 notify 后 query 具备 read-after-write 一致性', () => {
		const path = '40_知识/笔记/即时一致性.md';
		writeMarkdown(
			path,
			'---\nid: fixture-read-after-write\ntitle: 即时一致性\ntype: knowledge\nstatus: review\n---\n唯一术语星云握手协议。\n',
		);
		memoryNotify({ ...runtime(), filePath: path });
		expect(
			memoryQuery({ ...runtime(), query: '星云握手协议', limit: 5 }).results.map(
				(item) => item.entityId,
			),
		).toContain('fixture-read-after-write');
	});

	it('[版本夹具] H-01 数据库使用 INCREMENTAL auto_vacuum', () => {
		const db = openFixtureDb();
		try {
			expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
		} finally {
			db.close();
		}
	});

	it('[版本夹具] H-02 freelist 占 page_count 比例低于 5%', () => {
		const maintenanceVault = createIsolatedMemoryVault();
		const sharedVaultRoot = process.env.LIFEOS_VAULT_ROOT;
		process.env.LIFEOS_VAULT_ROOT = maintenanceVault.root;
		const maintenanceRuntime = {
			contractVersion: CONTRACT_VERSION,
			dbPath: maintenanceVault.dbPath,
			vaultRoot: maintenanceVault.root,
		};
		try {
			assertNotProductionVault(maintenanceVault.root);
			memoryStartupMaintenance(maintenanceRuntime);
			const loadDb = new Database(maintenanceVault.dbPath);
			let before: { pages: number; free: number };
			try {
				loadDb.exec('CREATE TABLE h02_fragmentation(payload TEXT NOT NULL)');
				const insert = loadDb.prepare('INSERT INTO h02_fragmentation(payload) VALUES (?)');
				loadDb.transaction(() => {
					for (let index = 0; index < 500; index += 1) insert.run('x'.repeat(8192));
				})();
				loadDb.exec('DELETE FROM h02_fragmentation; DROP TABLE h02_fragmentation');
				before = {
					pages: loadDb.pragma('page_count', { simple: true }) as number,
					free: loadDb.pragma('freelist_count', { simple: true }) as number,
				};
			} finally {
				loadDb.close();
			}
			expect(before.pages).toBeGreaterThan(0);
			expect(before.free / before.pages).toBeGreaterThan(0.5);

			memoryStartupMaintenance(maintenanceRuntime);
			const maintainedDb = new Database(maintenanceVault.dbPath, {
				readonly: true,
				fileMustExist: true,
			});
			try {
				const after = {
					pages: maintainedDb.pragma('page_count', { simple: true }) as number,
					free: maintainedDb.pragma('freelist_count', { simple: true }) as number,
				};
				expect(after.pages).toBeGreaterThan(0);
				expect(after.free).toBeLessThan(before.free);
				expect(after.free / after.pages).toBeLessThan(0.05);
			} finally {
				maintainedDb.close();
			}
		} finally {
			_resetDefaultInstance();
			if (sharedVaultRoot === undefined) {
				Reflect.deleteProperty(process.env, 'LIFEOS_VAULT_ROOT');
			} else {
				process.env.LIFEOS_VAULT_ROOT = sharedVaultRoot;
			}
			maintenanceVault.cleanup();
		}
	});

	it('[版本夹具] H-03 启动维护后 WAL 小于 1MB', () => {
		memoryStartupMaintenance(runtime());
		const walPath = `${vault.dbPath}-wal`;
		const bytes = existsSync(walPath) ? statSync(walPath).size : 0;
		expect(bytes).toBeLessThan(1024 * 1024);
	});

	it('[版本夹具] H-04 doctor 的数据库健康指标无告警', async () => {
		const result = await doctor([vault.root]);
		for (const name of [
			'database freelist',
			'database auto_vacuum',
			'database memory_items size',
		]) {
			expect(result.checks.find((check) => check.name === name)).toMatchObject({ status: 'pass' });
		}
	});

	it('[版本夹具] H-05 中文与英文 bm25 场景将目标排入前三', () => {
		for (const query of ['同构', 'Lagrange']) {
			const results = memoryQuery({ ...runtime(), query, limit: 10 }).results;
			const topThreeEntityIds = results.slice(0, 3).map((item) => item.entityId);
			expect(topThreeEntityIds, `查询 ${query} 的前三名`).toContain('fixture-group-theory');
		}
	});

	it.fails('[版本夹具] H-06 未知工具诊断保留 candidates 数组', () => {
		const known = context([{ type: 'tool', key: 'obsidian' }]);
		expect(known.diagnostics.unresolvedScopes).toEqual([]);
		const unknown = context([{ type: 'tool', key: 'unknown-tool' }]);
		expect(unknown.diagnostics.unresolvedScopes[0]).toMatchObject({
			reason: 'unknown_tool',
			candidates: expect.any(Array),
		});
	});

	it('[版本夹具] H-07 bootstrap 仓库白名单来自隔离配置', () => {
		expect(memoryStartup(runtime()).scopeHints.availableRepositories).toEqual([
			'learningapp',
			'lifeos',
		]);
	});

	it('[版本夹具] H-08 FTS5 optimize 后中英文查询均可执行', () => {
		memoryStartupMaintenance(runtime());
		expect(memoryQuery({ ...runtime(), query: '群', limit: 20 }).results.length).toBeGreaterThan(0);
		expect(
			memoryQuery({ ...runtime(), query: '密码学', limit: 20 }).results.length,
		).toBeGreaterThan(0);
	});

	it('[版本夹具] H-09 正文深处 4000 字窗口内关键词可召回', () => {
		const body = readFileSync(join(vault.root, '40_知识/百科/群论夹具.md'), 'utf-8');
		const offset = body.indexOf('离散几何覆盖验证');
		expect(offset).toBeGreaterThan(600);
		expect(offset).toBeLessThan(4000);
		const results = memoryQuery({ ...runtime(), query: '离散几何覆盖验证', limit: 10 }).results;
		expect(results.map((item) => item.entityId)).toContain('fixture-group-theory');
	});
});
