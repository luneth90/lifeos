import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	type RetrievalEvalCase,
	type RetrievalEvalFixture,
	type RetrievalEvalObservation,
	evaluateRetrieval,
	parseRetrievalFixture,
	runMemoryRetrievalEvaluation,
	stableEvaluationJson,
} from '../helpers/memory-retrieval-evaluator.js';

const ALPHA_SCOPE = { type: 'project', key: 'project-alpha' } as const;
const BETA_SCOPE = { type: 'project', key: 'project-beta' } as const;
const LONG_TAIL_NO_GO_GATE = {
	fixtureVersion: '2026-08-09.v1',
	caseOffsets: {
		'long-tail-01': 4101,
		'long-tail-02': 4201,
		'long-tail-03': 4301,
		'long-tail-04': 4401,
		'long-tail-05': 4501,
	},
	minimumRecallAt5: 0.9,
} as const;

function loadFixture(): RetrievalEvalFixture {
	const fixturePath = join(process.cwd(), 'tests/fixtures/memory-retrieval-eval.zh.json');
	return parseRetrievalFixture(JSON.parse(readFileSync(fixturePath, 'utf-8')));
}

describe('记忆检索纯指标计算', () => {
	it('按手工排名精确计算全部指标与分位数', () => {
		const cases: RetrievalEvalCase[] = [
			{
				id: 'manual-multiple-expected',
				category: 'multi_document',
				query: '多期望文件',
				filters: null,
				expectedFiles: ['a.md', 'b.md'],
				forbiddenFiles: ['x.md'],
				expectedScopes: [ALPHA_SCOPE],
				timeCondition: null,
				shouldAbstain: false,
			},
			{
				id: 'manual-rank-six',
				category: 'temporal_update',
				query: '第六名才命中',
				filters: null,
				expectedFiles: ['c.md'],
				forbiddenFiles: ['old.md'],
				expectedScopes: [ALPHA_SCOPE],
				timeCondition: { notBefore: '2026-01-01T00:00:00.000Z' },
				shouldAbstain: false,
			},
			{
				id: 'manual-correct-abstention',
				category: 'abstention',
				query: '没有答案',
				filters: null,
				expectedFiles: [],
				forbiddenFiles: [],
				expectedScopes: [],
				timeCondition: null,
				shouldAbstain: true,
			},
			{
				id: 'manual-empty-relevance-set',
				category: 'direct_extraction',
				query: '无期望文件但允许返回',
				filters: null,
				expectedFiles: [],
				forbiddenFiles: [],
				expectedScopes: [{ type: 'global', key: '' }],
				timeCondition: null,
				shouldAbstain: false,
			},
			{
				id: 'manual-missed-result',
				category: 'direct_extraction',
				query: '应命中但无结果',
				filters: null,
				expectedFiles: ['d.md'],
				forbiddenFiles: [],
				expectedScopes: [ALPHA_SCOPE],
				timeCondition: null,
				shouldAbstain: false,
			},
		];
		const observations: RetrievalEvalObservation[] = [
			{
				caseId: 'manual-multiple-expected',
				durationMs: 10,
				results: [
					{ filePath: 'x.md', scope: BETA_SCOPE, modifiedAt: null, contextTokens: 10 },
					{ filePath: 'a.md', scope: ALPHA_SCOPE, modifiedAt: null, contextTokens: 20 },
					{ filePath: 'b.md', scope: ALPHA_SCOPE, modifiedAt: null, contextTokens: 30 },
				],
			},
			{
				caseId: 'manual-rank-six',
				durationMs: 20,
				results: [
					{
						filePath: 'old.md',
						scope: ALPHA_SCOPE,
						modifiedAt: '2025-12-31T23:59:59.000Z',
						contextTokens: 1,
					},
					...['n2.md', 'n3.md', 'n4.md', 'n5.md', 'c.md'].map((filePath, index) => ({
						filePath,
						scope: ALPHA_SCOPE,
						modifiedAt: '2026-01-02T00:00:00.000Z',
						contextTokens: index + 2,
					})),
				],
			},
			{
				caseId: 'manual-correct-abstention',
				durationMs: 30,
				results: [],
			},
			{
				caseId: 'manual-empty-relevance-set',
				durationMs: 40,
				results: [
					{
						filePath: 'safe.md',
						scope: { type: 'global', key: '' },
						modifiedAt: null,
						contextTokens: 9,
					},
				],
			},
			{
				caseId: 'manual-missed-result',
				durationMs: 50,
				results: [],
			},
		];

		const report = evaluateRetrieval(cases, observations);

		expect(report.metrics.recallAt5).toBeCloseTo(1 / 3, 12);
		expect(report.metrics.mrrAt10).toBeCloseTo(2 / 9, 12);
		expect(report.metrics.abstentionAccuracy).toBeCloseTo(4 / 5, 12);
		expect(report.metrics.scopeLeakageRate).toBeCloseTo(1 / 10, 12);
		expect(report.metrics.staleHitRate).toBeCloseTo(1 / 6, 12);
		expect(report.metrics.forbiddenHitRate).toBeCloseTo(2 / 9, 12);
		expect(report.metrics.averageContextTokens).toBe(18);
		expect(report.timings).toEqual({ averageMs: 30, p50Ms: 30, p95Ms: 50 });
		expect(report.denominators).toEqual({
			relevanceCases: 3,
			abstentionCases: 5,
			scopedResults: 10,
			temporalResults: 6,
			forbiddenEligibleResults: 9,
			contextCases: 5,
		});
	});

	it('固定空集合语义为满召回、满拒答准确率与零风险零耗时', () => {
		const report = evaluateRetrieval([], []);

		expect(report.metrics).toEqual({
			recallAt5: 1,
			mrrAt10: 1,
			abstentionAccuracy: 1,
			scopeLeakageRate: 0,
			staleHitRate: 0,
			forbiddenHitRate: 0,
			averageContextTokens: 0,
		});
		expect(report.timings).toEqual({ averageMs: 0, p50Ms: 0, p95Ms: 0 });
		expect(report.passed).toBe(true);
	});
});

describe('固定中文评测夹具', () => {
	it('校验版本、唯一 id、类别数量与长文尾部证据', () => {
		const fixture = loadFixture();

		expect(fixture.version).toBe('2026-08-09.v1');
		expect(fixture.cases).toHaveLength(42);
		expect(new Set(fixture.cases.map((testCase) => testCase.id)).size).toBe(42);
		expect(new Set(fixture.cases.map((testCase) => testCase.query)).size).toBe(42);
		expect(
			Object.fromEntries(
				fixture.cases
					.map((testCase) => testCase.category)
					.reduce((counts, category) => {
						counts.set(category, (counts.get(category) ?? 0) + 1);
						return counts;
					}, new Map<string, number>()),
			),
		).toEqual({
			direct_extraction: 8,
			multi_document: 6,
			temporal_update: 6,
			conflict_override: 6,
			scope_isolation: 6,
			abstention: 5,
			long_tail: 5,
		});

		const documents = new Map(fixture.documents.map((document) => [document.filePath, document]));
		for (const testCase of fixture.cases.filter(({ category }) => category === 'long_tail')) {
			const evidenceDocument = documents.get(testCase.expectedFiles[0] ?? '');
			expect(evidenceDocument?.tailEvidence).toEqual({
				text: testCase.query,
				offset: expect.any(Number),
			});
			expect(evidenceDocument?.body.indexOf(testCase.query)).toBeGreaterThan(4000);
			expect(evidenceDocument?.body.lastIndexOf(testCase.query)).toBe(
				evidenceDocument?.body.indexOf(testCase.query),
			);
		}
	});

	it.each([
		[
			'temporal 必须声明时间条件',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'temporal_update');
				if (testCase) testCase.timeCondition = null;
			},
		],
		[
			'temporal 必须声明生产过滤器',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'temporal_update');
				if (testCase) testCase.filters = null;
			},
		],
		[
			'abstention 必须拒答',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'abstention');
				if (testCase) testCase.shouldAbstain = false;
			},
		],
		[
			'long-tail 必须只有一个期望文件',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'long_tail');
				if (testCase) testCase.expectedFiles.push('40_知识/长文/陶瓷烧制.md');
			},
		],
		[
			'conflict 必须声明生产作用域过滤器',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'conflict_override');
				if (testCase) testCase.filters = { status: 'active' };
			},
		],
		[
			'scope 必须声明生产作用域过滤器',
			(fixture: RetrievalEvalFixture) => {
				const testCase = fixture.cases.find(({ category }) => category === 'scope_isolation');
				if (testCase) testCase.filters = { status: 'active' };
			},
		],
	] as const)('拒绝违反类别语义不变量：%s', (_label, mutate) => {
		const fixture = loadFixture();
		mutate(fixture);

		expect(() => parseRetrievalFixture(fixture)).toThrow();
	});
});

describe('临时 Vault 生产检索评测', () => {
	it('锁定 Schema V6 No-Go 决策输入，长文 Recall@5 跌破 0.90 时失败', () => {
		const fixture = loadFixture();
		const documents = new Map(fixture.documents.map((document) => [document.filePath, document]));
		const longTailCases = fixture.cases.filter(({ category }) => category === 'long_tail');
		const actualOffsets = Object.fromEntries(
			longTailCases.map((testCase) => {
				expect(testCase.expectedFiles).toHaveLength(1);
				const evidenceDocument = documents.get(testCase.expectedFiles[0] ?? '');
				const firstOffset = evidenceDocument?.body.indexOf(testCase.query) ?? -1;
				expect(firstOffset).toBeGreaterThan(4000);
				expect(evidenceDocument?.body.lastIndexOf(testCase.query)).toBe(firstOffset);
				return [testCase.id, firstOffset];
			}),
		);

		expect(fixture.version).toBe(LONG_TAIL_NO_GO_GATE.fixtureVersion);
		expect(actualOffsets).toEqual(LONG_TAIL_NO_GO_GATE.caseOffsets);
		expect(new Set(longTailCases.flatMap(({ expectedFiles }) => expectedFiles)).size).toBe(5);

		const report = runMemoryRetrievalEvaluation(fixture);
		expect(report.categoryReports.long_tail.denominators.relevanceCases).toBe(5);
		expect(report.categoryReports.long_tail.metrics.recallAt5).toBeGreaterThanOrEqual(
			LONG_TAIL_NO_GO_GATE.minimumRecallAt5,
		);
	});

	it('复用生产索引和检索并单列长文尾部子集', () => {
		const fixture = loadFixture();
		const report = runMemoryRetrievalEvaluation(fixture);

		expect(report.fixture).toEqual({
			version: '2026-08-09.v1',
			documentCount: 61,
			caseCount: 42,
		});
		expect(report.rankings).toHaveLength(42);
		expect(report.categoryReports.long_tail.denominators.relevanceCases).toBe(5);
		expect(report.metrics.recallAt5).toBeGreaterThanOrEqual(0.9);
		expect(report.metrics.mrrAt10).toBeGreaterThanOrEqual(0.85);
		expect(report.metrics.abstentionAccuracy).toBeGreaterThanOrEqual(0.9);
		expect(report.metrics.scopeLeakageRate).toBeLessThanOrEqual(0);
		expect(report.metrics.staleHitRate).toBeLessThanOrEqual(0);
		expect(report.metrics.forbiddenHitRate).toBeLessThanOrEqual(0);
		expect(report.categoryReports.long_tail.metrics.recallAt5).toBeGreaterThanOrEqual(0.8);
		expect(report.metrics).toEqual({
			recallAt5: 1,
			mrrAt10: 1,
			abstentionAccuracy: 1,
			scopeLeakageRate: 0,
			staleHitRate: 0,
			forbiddenHitRate: 0,
			averageContextTokens: 55.45238095238095,
		});
		expect(report.denominators).toEqual({
			relevanceCases: 37,
			abstentionCases: 42,
			scopedResults: 43,
			temporalResults: 6,
			forbiddenEligibleResults: 18,
			contextCases: 42,
		});
	});

	it('从生产索引事实推导作用域，夹具自报值不能隐藏泄漏', () => {
		const fixture: RetrievalEvalFixture = {
			version: 'scope-fact-check.v1',
			documents: [
				{
					filePath: '20_项目/索引事实.md',
					title: '生产索引作用域事实',
					type: 'project',
					status: 'active',
					domain: '测试',
					category: 'development',
					project: 'project-index-fact',
					entityId: 'scope-index-fact',
					tags: ['作用域'],
					body: '生产索引作用域事实来自 project 字段。',
					modifiedAt: '2026-08-01T00:00:00.000Z',
					scope: { type: 'project', key: 'project-self-report' },
					tailEvidence: null,
				},
			],
			cases: [
				{
					id: 'scope-fact-check',
					category: 'scope_isolation',
					query: '生产索引作用域事实',
					filters: { project: 'project-index-fact' },
					expectedFiles: ['20_项目/索引事实.md'],
					forbiddenFiles: [],
					expectedScopes: [{ type: 'project', key: 'project-self-report' }],
					timeCondition: null,
					shouldAbstain: false,
				},
			],
		};

		const report = runMemoryRetrievalEvaluation(fixture);

		expect(report.metrics.scopeLeakageRate).toBe(1);
	});

	it('除本机耗时外连续两次报告完全一致', () => {
		const fixture = loadFixture();
		const first = runMemoryRetrievalEvaluation(fixture);
		const second = runMemoryRetrievalEvaluation(fixture);

		expect(stableEvaluationJson(first, { normalizeTimings: true })).toBe(
			stableEvaluationJson(second, { normalizeTimings: true }),
		);
	});

	it('达到固定门槛', () => {
		const report = runMemoryRetrievalEvaluation(loadFixture());

		expect(report.passed).toBe(true);
	});
});
