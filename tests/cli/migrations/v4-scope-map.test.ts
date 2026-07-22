import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LIFEOS_SKILL_IDS,
	type LegacyMemoryInventoryItem,
	REVIEW_REQUIRED_SCOPE_KEY,
	computeV4ScopeMapContextFingerprint,
	computeV4ScopeMapEntriesHash,
	generateV4ScopeMap,
	verifyV4ScopeMapFingerprints,
} from '../../../src/cli/migrations/v4-scope-map.js';
import { assetsDir } from '../../../src/cli/utils/assets.js';

function hash(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

function item(
	slotKey: string,
	content: string,
	overrides: Partial<LegacyMemoryInventoryItem> = {},
): LegacyMemoryInventoryItem {
	return {
		legacyIdentity: `slot:${slotKey}`,
		slotKey,
		content,
		contentHash: hash(content),
		source: 'preference',
		relatedFiles: [],
		status: 'active',
		updatedAt: '2026-07-01T00:00:00.000Z',
		...overrides,
	};
}

const generatedAt = '2026-07-21T08:00:00+08:00';

describe('V4 scope map 自动生成', () => {
	it('默认 skill ID 与打包资产目录保持一一对应', () => {
		const packaged = readdirSync(join(assetsDir(), 'skills'), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
			.map((entry) => entry.name)
			.sort();
		expect([...DEFAULT_LIFEOS_SKILL_IDS].sort()).toEqual(packaged);
	});

	it('自动确认已知 global、skill、tool 和唯一 project 匹配', () => {
		const document = generateV4ScopeMap(
			[
				item('content:language', '必须使用中文', { source: 'correction' }),
				item('workflow:revise-latex', '复习公式必须使用 LaTeX'),
				item('tool:opencode-agent-model-config', '模型通过环境变量配置，换渠道时只需要改变量'),
				item('tool:config-format', 'Obsidian 配置使用 Markdown 表格，不用 YAML'),
				item('project:gts-core', 'GTS 项目采用核心教材'),
			],
			{
				generatedAt,
				projects: [{ id: 'gts-learning' }],
			},
		);

		expect(document.summary).toEqual({ total: 5, confirmed: 5, reviewRequired: 0 });
		const bySlot = new Map(document.entries.map((entry) => [entry.slotKey, entry]));
		expect(bySlot.get('content:language')).toMatchObject({
			confirmed: true,
			scope: { type: 'global', key: '' },
			itemKind: 'rule',
			priority: 100,
			enforcement: 'hard',
		});
		expect(bySlot.get('workflow:revise-latex')).toMatchObject({
			confirmed: true,
			scope: { type: 'skill', key: 'revise' },
			itemKind: 'rule',
		});
		expect(bySlot.get('tool:opencode-agent-model-config')).toMatchObject({
			confirmed: true,
			scope: { type: 'tool', key: 'opencode' },
			itemKind: 'rule',
		});
		expect(bySlot.get('tool:config-format')).toMatchObject({
			confirmed: true,
			scope: { type: 'tool', key: 'obsidian' },
			itemKind: 'rule',
		});
		expect(bySlot.get('project:gts-core')).toMatchObject({
			confirmed: true,
			scope: { type: 'project', key: 'gts-learning' },
			itemKind: 'decision',
		});
	});

	it('可通过 repository binding 和项目路径得到唯一作用域', () => {
		const document = generateV4ScopeMap(
			[
				item('repository:lifeos-release', '发布提交必须保持单一粒度', {
					relatedFiles: ['/Users/example/code/lifeos/src/index.ts'],
				}),
				item('profile:motivation.gts_learning', '持续完成 GTS 学习', {
					relatedFiles: ['20_项目/GTS/GTS.md'],
				}),
			],
			{
				generatedAt,
				projects: [{ id: 'gts-learning', paths: ['20_项目/GTS'] }],
				repositoryBindings: { lifeos: ['/Users/example/code/lifeos'] },
			},
		);

		expect(document.entries[0]).toMatchObject({
			slotKey: 'profile:motivation.gts_learning',
			confirmed: true,
			scope: { type: 'project', key: 'gts-learning' },
			itemKind: 'profile',
		});
		expect(document.entries[1]).toMatchObject({
			slotKey: 'repository:lifeos-release',
			confirmed: true,
			scope: { type: 'repository', key: 'lifeos' },
			itemKind: 'rule',
		});
	});

	it('归档 event、旧 profile summary/current focus 和已退役槽位', () => {
		const document = generateV4ScopeMap(
			[
				item('profile:summary', '旧综合画像'),
				item('profile:current_focus', '旧焦点'),
				item('event:gts-finished', 'GTS 阶段完成'),
				item('archive:diary', '旧日记归档事件'),
			],
			{ generatedAt, projects: [{ id: 'gts-learning' }] },
		);

		expect(document.summary.reviewRequired).toBe(0);
		for (const entry of document.entries) {
			expect(entry).toMatchObject({
				confirmed: true,
				status: 'archived',
				archivedAt: '2026-07-21T00:00:00.000Z',
			});
			expect(entry.archiveReason).toBeTruthy();
		}
		expect(document.entries.find((entry) => entry.slotKey === 'event:gts-finished')).toMatchObject({
			scope: { type: 'project', key: 'gts-learning' },
			itemKind: 'event',
		});
		expect(document.entries.find((entry) => entry.slotKey === 'profile:summary')).toMatchObject({
			scope: { type: 'global', key: '' },
			itemKind: 'profile',
		});
	});

	it('项目标识有歧义时保留候选并阻断自动确认', () => {
		const document = generateV4ScopeMap([item('project:gts-core', 'GTS 项目决策')], {
			generatedAt,
			projects: [{ id: 'gts-learning' }, { id: 'gts-writing' }],
		});

		expect(document.summary).toEqual({ total: 1, confirmed: 0, reviewRequired: 1 });
		const entry = document.entries[0];
		expect(entry?.confirmed).toBe(false);
		expect(entry?.scope.type).toBe('project');
		expect(entry?.scopeCandidates.map((candidate) => candidate.scope)).toEqual([
			{ type: 'project', key: 'gts-learning' },
			{ type: 'project', key: 'gts-writing' },
		]);
		expect(entry?.suggestionReason).toContain('人工消歧');
	});

	it('完全未知的条目不默认归入 global', () => {
		const document = generateV4ScopeMap([item('misc:opaque', '无法判断的旧内容')], {
			generatedAt,
		});
		const entry = document.entries[0];

		expect(entry).toMatchObject({
			confirmed: false,
			scope: { type: 'file', key: REVIEW_REQUIRED_SCOPE_KEY },
		});
		expect(entry?.scope.type).not.toBe('global');
		expect(entry?.suggestionReason).toContain('未默认写入 global');
	});

	it('输出稳定排序、内容预览和哈希校验', () => {
		const document = generateV4ScopeMap(
			[item('global:z', '必须   保留\n空白'), item('global:a', '必须先执行')],
			{ generatedAt, contentPreviewLength: 20 },
		);

		expect(document.entries.map((entry) => entry.legacyIdentity)).toEqual([
			'slot:global:a',
			'slot:global:z',
		]);
		expect(document.entries[1]?.contentPreview).toBe('必须 保留 空白');
		expect(() =>
			generateV4ScopeMap(
				[item('content:language', '必须使用中文', { contentHash: '0'.repeat(64) })],
				{ generatedAt },
			),
		).toThrow(/contentHash 与内容不匹配/);
	});

	it('写入可验证的上下文指纹和生成条目哈希', () => {
		const inventory = [item('content:language', '必须使用中文')];
		const context = {
			generatedAt,
			projects: [{ id: 'gts-learning', aliases: ['GTS'] }],
			repositoryBindings: { lifeos: ['/Users/example/code/lifeos'] },
		};
		const document = generateV4ScopeMap(inventory, context);

		expect(document.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(document.generatedEntriesHash).toMatch(/^[a-f0-9]{64}$/);
		expect(document.contextFingerprint).toBe(
			computeV4ScopeMapContextFingerprint(inventory, context),
		);
		expect(document.generatedEntriesHash).toBe(computeV4ScopeMapEntriesHash(document.entries));
		expect(verifyV4ScopeMapFingerprints(document, inventory, context)).toMatchObject({
			hasFingerprintMetadata: true,
			contextMatches: true,
			entriesUnchanged: true,
		});
	});

	it('上下文指纹忽略生成时间、集合顺序和跨平台路径写法，条目哈希仍精确覆盖生成字段', () => {
		const inventory = [
			item('event:finished', '阶段已完成'),
			item('repository:lifeos-release', 'LifeOS 发布规则'),
		];
		const firstContext = {
			generatedAt: '2026-07-21T08:00:00+08:00',
			projects: [
				{ id: 'writing', aliases: ['Writing'], paths: ['C:\\Work\\Writing\\'] },
				{ id: 'gts-learning', aliases: ['GTS', '视觉群论'], paths: ['20_项目//GTS/'] },
			],
			repositoryBindings: {
				lifeos: ['C:\\Code\\LifeOS\\', '/Users/example/code/lifeos'],
			},
		};
		const secondContext = {
			generatedAt: '2030-01-01T00:00:00.000Z',
			projects: [
				{ id: 'gts-learning', aliases: ['视觉群论', 'gts'], paths: ['20_项目/GTS'] },
				{ id: 'writing', aliases: ['writing'], paths: ['c:/work/writing'] },
			],
			repositoryBindings: {
				lifeos: ['/users/example/code/lifeos/', 'c:/code/lifeos'],
			},
		};

		const first = generateV4ScopeMap(inventory, firstContext);
		const second = generateV4ScopeMap([...inventory].reverse(), secondContext);
		expect(first.contextFingerprint).toBe(second.contextFingerprint);
		expect(first.generatedEntriesHash).not.toBe(second.generatedEntriesHash);
		expect(first.entries.find((entry) => entry.slotKey === 'event:finished')?.archivedAt).not.toBe(
			second.entries.find((entry) => entry.slotKey === 'event:finished')?.archivedAt,
		);
	});

	it('旧条目的任一生成输入变化都会更新上下文指纹', () => {
		const base = item('project:gts-core', 'GTS 项目决策', {
			relatedFiles: ['20_项目/GTS.md'],
		});
		const context = {
			generatedAt,
			projects: [{ id: 'gts' }],
		};
		const baseline = computeV4ScopeMapContextFingerprint([base], context);
		const variants: LegacyMemoryInventoryItem[] = [
			{ ...base, legacyIdentity: 'row:42' },
			{ ...base, slotKey: 'project:gts-policy' },
			item('project:gts-core', 'GTS 项目决策已更新', {
				relatedFiles: [...base.relatedFiles],
			}),
			{ ...base, source: 'correction' },
			{ ...base, relatedFiles: ['20_项目/GTS-v2.md'] },
			{ ...base, status: 'expired' },
			{ ...base, updatedAt: '2026-07-20T00:00:00.000Z' },
		];

		for (const variant of variants) {
			expect(computeV4ScopeMapContextFingerprint([variant], context)).not.toBe(baseline);
		}
	});

	it('上下文变化与条目人工修改可被独立识别', () => {
		const inventory = [item('project:gts-core', 'GTS 项目决策')];
		const context = {
			generatedAt,
			projects: [{ id: 'gts-learning' }],
		};
		const document = generateV4ScopeMap(inventory, context);
		const stale = verifyV4ScopeMapFingerprints(document, inventory, {
			...context,
			projects: [{ id: 'gts-v2' }],
		});
		expect(stale).toMatchObject({
			hasFingerprintMetadata: true,
			contextMatches: false,
			entriesUnchanged: true,
		});

		const edited = structuredClone(document);
		const entry = edited.entries[0];
		if (!entry) throw new Error('测试缺少 scope map 条目');
		entry.scope = { type: 'project', key: 'manually-reviewed' };
		const modified = verifyV4ScopeMapFingerprints(edited, inventory, context);
		expect(modified).toMatchObject({
			hasFingerprintMetadata: true,
			contextMatches: true,
			entriesUnchanged: false,
		});

		const archivedInventory = [item('event:finished', '阶段已完成')];
		const archivedDocument = generateV4ScopeMap(archivedInventory, context);
		const archivedEdited = structuredClone(archivedDocument);
		const archivedEntry = archivedEdited.entries[0];
		if (!archivedEntry) throw new Error('测试缺少归档 scope map 条目');
		archivedEntry.archivedAt = '2030-01-01T00:00:00.000Z';
		expect(verifyV4ScopeMapFingerprints(archivedEdited, archivedInventory, context)).toMatchObject({
			hasFingerprintMetadata: true,
			contextMatches: true,
			entriesUnchanged: false,
		});
	});

	it('旧 formatVersion=1 文档缺少指纹时保守判定为不可自动覆盖', () => {
		const inventory = [item('content:language', '必须使用中文')];
		const context = { generatedAt };
		const document = generateV4ScopeMap(inventory, context);
		const legacyDocument = { ...document } as Partial<typeof document>;
		legacyDocument.contextFingerprint = undefined;
		legacyDocument.generatedEntriesHash = undefined;

		expect(verifyV4ScopeMapFingerprints(legacyDocument, inventory, context)).toMatchObject({
			hasFingerprintMetadata: false,
			contextMatches: false,
			entriesUnchanged: false,
		});
	});
});
