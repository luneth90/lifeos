import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { VaultConfig } from '../../src/config.js';
import { withDb } from '../../src/db/index.js';
import { queryVaultIndex } from '../../src/services/retrieval.js';
import type { MemoryScope } from '../../src/types.js';
import { estimateTokens } from '../../src/utils/shared.js';
import { fullScan } from '../../src/utils/vault-indexer.js';
import { createTempVault, writeTestNote } from '../setup.js';

export const RETRIEVAL_EVAL_CATEGORIES = [
	'direct_extraction',
	'multi_document',
	'temporal_update',
	'conflict_override',
	'scope_isolation',
	'abstention',
	'long_tail',
] as const;

export type RetrievalEvalCategory = (typeof RETRIEVAL_EVAL_CATEGORIES)[number];

export interface RetrievalEvalCase {
	id: string;
	category: RetrievalEvalCategory;
	query: string;
	filters: Record<string, string> | null;
	expectedFiles: string[];
	forbiddenFiles: string[];
	expectedScopes: MemoryScope[];
	timeCondition: { notBefore: string } | null;
	shouldAbstain: boolean;
}

export interface RetrievalEvalDocument {
	filePath: string;
	title: string;
	type: string;
	status: string;
	domain: string;
	category: string;
	project: string | null;
	entityId: string;
	tags: string[];
	body: string;
	modifiedAt: string;
	scope: MemoryScope;
	tailEvidence: {
		text: string;
		offset: number;
	} | null;
}

export interface RetrievalEvalFixture {
	version: string;
	documents: RetrievalEvalDocument[];
	cases: RetrievalEvalCase[];
}

export interface RetrievalEvalResult {
	filePath: string;
	scope: MemoryScope;
	modifiedAt: string | null;
	contextTokens: number;
}

export interface RetrievalEvalObservation {
	caseId: string;
	durationMs: number;
	results: RetrievalEvalResult[];
}

export interface RetrievalEvalMetrics {
	recallAt5: number;
	mrrAt10: number;
	abstentionAccuracy: number;
	scopeLeakageRate: number;
	staleHitRate: number;
	forbiddenHitRate: number;
	averageContextTokens: number;
}

export interface RetrievalEvalReport {
	metrics: RetrievalEvalMetrics;
	timings: {
		averageMs: number;
		p50Ms: number;
		p95Ms: number;
	};
	denominators: {
		relevanceCases: number;
		abstentionCases: number;
		scopedResults: number;
		temporalResults: number;
		forbiddenEligibleResults: number;
		contextCases: number;
	};
	thresholds: {
		recallAt5: number;
		mrrAt10: number;
		abstentionAccuracy: number;
		scopeLeakageRate: number;
		staleHitRate: number;
		forbiddenHitRate: number;
	};
	passed: boolean;
}

export interface MemoryRetrievalEvaluationReport extends RetrievalEvalReport {
	fixture: {
		version: string;
		documentCount: number;
		caseCount: number;
	};
	categoryReports: Record<RetrievalEvalCategory, RetrievalEvalReport>;
	rankings: Array<{
		caseId: string;
		files: string[];
	}>;
}

const THRESHOLDS = {
	recallAt5: 0.9,
	mrrAt10: 0.85,
	abstentionAccuracy: 0.9,
	scopeLeakageRate: 0,
	staleHitRate: 0,
	forbiddenHitRate: 0,
} as const;

const scopeSchema = z
	.object({
		type: z.enum(['global', 'skill', 'project', 'repository', 'tool', 'file']),
		key: z.string(),
	})
	.strict();

const documentSchema = z
	.object({
		filePath: z.string().min(1),
		title: z.string().min(1),
		type: z.string().min(1),
		status: z.string().min(1),
		domain: z.string().min(1),
		category: z.string().min(1),
		project: z.string().min(1).nullable(),
		entityId: z.string().min(1),
		tags: z.array(z.string().min(1)),
		body: z.string().min(1),
		modifiedAt: z.string().datetime(),
		scope: scopeSchema,
		tailEvidence: z
			.object({
				text: z.string().min(1),
				offset: z.number().int().min(4001),
			})
			.strict()
			.nullable()
			.optional()
			.default(null),
	})
	.strict();

const caseSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9-]+$/),
		category: z.enum(RETRIEVAL_EVAL_CATEGORIES),
		query: z.string().min(1),
		filters: z.record(z.string()).nullable(),
		expectedFiles: z.array(z.string().min(1)),
		forbiddenFiles: z.array(z.string().min(1)),
		expectedScopes: z.array(scopeSchema),
		timeCondition: z.object({ notBefore: z.string().datetime() }).strict().nullable(),
		shouldAbstain: z.boolean(),
	})
	.strict();

const fixtureSchema = z
	.object({
		version: z.string().min(1),
		documents: z.array(documentSchema).min(1),
		cases: z.array(caseSchema).min(1),
	})
	.strict();

function assertUnique(values: string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`${label} 必须唯一`);
}

const PRODUCTION_FILTER_FIELDS = new Set([
	'file_path',
	'title',
	'type',
	'status',
	'domain',
	'category',
	'project',
	'entity_id',
]);

const PRODUCTION_SCOPE_FILTER_FIELDS = new Set(['file_path', 'project', 'entity_id']);

function materializeTailEvidence(document: RetrievalEvalDocument): RetrievalEvalDocument {
	const evidence = document.tailEvidence;
	if (!evidence) return document;
	if (
		document.body.indexOf(evidence.text) === evidence.offset &&
		document.body.lastIndexOf(evidence.text) === evidence.offset
	) {
		return document;
	}
	const cleanBody = document.body.split(evidence.text).join('').trimEnd();
	const headingPrefix = '\n\n## ';
	const paddingLength = evidence.offset - cleanBody.length - headingPrefix.length;
	if (paddingLength < 0) {
		throw new Error(`长文 ${document.filePath} 无法在固定偏移 ${evidence.offset} 放置尾证据`);
	}
	const fillerUnit = '\n补充记录用于保持长文结构、固定证据偏移并验证尾部检索边界。';
	const filler = fillerUnit
		.repeat(Math.ceil(paddingLength / fillerUnit.length))
		.slice(0, paddingLength);
	const body = `${cleanBody}${filler}${headingPrefix}${evidence.text}\n该标题记录本用例唯一的尾部证据。`;
	return { ...document, body };
}

export function parseRetrievalFixture(value: unknown): RetrievalEvalFixture {
	const parsed = fixtureSchema.parse(value) as RetrievalEvalFixture;
	const fixture = {
		...parsed,
		documents: parsed.documents.map(materializeTailEvidence),
	};
	assertUnique(
		fixture.documents.map((document) => document.filePath),
		'评测文档 filePath',
	);
	assertUnique(
		fixture.documents.map((document) => document.entityId),
		'评测文档 entityId',
	);
	assertUnique(
		fixture.cases.map((testCase) => testCase.id),
		'评测用例 id',
	);
	assertUnique(
		fixture.cases.map((testCase) => testCase.query),
		'评测查询',
	);
	const documentPaths = new Set(fixture.documents.map((document) => document.filePath));
	for (const testCase of fixture.cases) {
		for (const field of Object.keys(testCase.filters ?? {})) {
			if (!PRODUCTION_FILTER_FIELDS.has(field)) {
				throw new Error(`评测用例 ${testCase.id} 使用了非法生产过滤字段：${field}`);
			}
		}
		for (const filePath of [...testCase.expectedFiles, ...testCase.forbiddenFiles]) {
			if (!documentPaths.has(filePath)) {
				throw new Error(`评测用例 ${testCase.id} 引用了不存在的文档：${filePath}`);
			}
		}
		if (testCase.expectedFiles.some((filePath) => testCase.forbiddenFiles.includes(filePath))) {
			throw new Error(`评测用例 ${testCase.id} 的期望文件与禁止文件重叠`);
		}
		if (testCase.shouldAbstain && testCase.expectedFiles.length > 0) {
			throw new Error(`拒答用例 ${testCase.id} 不得声明期望文件`);
		}
		if (testCase.category === 'temporal_update') {
			if (!testCase.timeCondition) throw new Error(`时间用例 ${testCase.id} 必须声明时间条件`);
			if (!testCase.filters || Object.keys(testCase.filters).length === 0) {
				throw new Error(`时间用例 ${testCase.id} 必须声明生产过滤器`);
			}
		}
		if (testCase.category === 'abstention' && !testCase.shouldAbstain) {
			throw new Error(`拒答用例 ${testCase.id} 必须声明 shouldAbstain=true`);
		}
		if (testCase.category === 'long_tail') {
			if (testCase.expectedFiles.length !== 1) {
				throw new Error(`长文用例 ${testCase.id} 必须且只能声明一个期望文件`);
			}
			const document = fixture.documents.find(
				(candidate) => candidate.filePath === testCase.expectedFiles[0],
			);
			if (
				!document?.tailEvidence ||
				document.tailEvidence.text !== testCase.query ||
				document.body.indexOf(testCase.query) <= 4000 ||
				document.body.lastIndexOf(testCase.query) !== document.body.indexOf(testCase.query)
			) {
				throw new Error(`长文用例 ${testCase.id} 必须在正文第 4000 字符后提供唯一证据`);
			}
		}
		if (testCase.category === 'conflict_override' || testCase.category === 'scope_isolation') {
			const filterFields = Object.keys(testCase.filters ?? {});
			if (!filterFields.some((field) => PRODUCTION_SCOPE_FILTER_FIELDS.has(field))) {
				throw new Error(`作用域用例 ${testCase.id} 必须声明生产作用域过滤器`);
			}
		}
	}
	return fixture;
}

function average(values: number[], emptyValue: number): number {
	if (values.length === 0) return emptyValue;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nearestRankPercentile(values: number[], percentile: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
	return sorted[index] ?? 0;
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
	return left.type === right.type && left.key === right.key;
}

export function evaluateRetrieval(
	cases: RetrievalEvalCase[],
	observations: RetrievalEvalObservation[],
): RetrievalEvalReport {
	const observationsById = new Map(
		observations.map((observation) => [observation.caseId, observation]),
	);
	const caseIds = new Set(cases.map((testCase) => testCase.id));
	if (caseIds.size !== cases.length) throw new Error('评测用例 id 必须唯一');
	if (observationsById.size !== observations.length) throw new Error('评测观察 caseId 必须唯一');
	if (
		observations.length !== cases.length ||
		observations.some((observation) => !caseIds.has(observation.caseId))
	) {
		throw new Error('每个评测用例必须且只能有一条同 id 观察结果');
	}

	const relevanceCases = cases.filter((testCase) => testCase.expectedFiles.length > 0);
	const recalls: number[] = [];
	const reciprocalRanks: number[] = [];
	let correctAbstentions = 0;
	let scopedResults = 0;
	let scopeLeaks = 0;
	let temporalResults = 0;
	let staleHits = 0;
	let allResults = 0;
	let forbiddenEligibleResults = 0;
	let forbiddenHits = 0;
	let contextTokens = 0;
	const durations: number[] = [];

	for (const testCase of cases) {
		const observation = observationsById.get(testCase.id);
		if (!observation) throw new Error(`缺少评测观察：${testCase.id}`);
		const expected = new Set(testCase.expectedFiles);
		const forbidden = new Set(testCase.forbiddenFiles);
		const rankedPaths = observation.results.map((result) => result.filePath);

		if (expected.size > 0) {
			const hitsAt5 = new Set(rankedPaths.slice(0, 5).filter((filePath) => expected.has(filePath)));
			recalls.push(hitsAt5.size / expected.size);
			const firstRelevantIndex = rankedPaths
				.slice(0, 10)
				.findIndex((filePath) => expected.has(filePath));
			reciprocalRanks.push(firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1));
		}

		const predictedAbstention = observation.results.length === 0;
		if (predictedAbstention === testCase.shouldAbstain) correctAbstentions += 1;

		for (const result of observation.results) {
			allResults += 1;
			if (forbidden.size > 0) forbiddenEligibleResults += 1;
			contextTokens += result.contextTokens;
			if (forbidden.has(result.filePath)) forbiddenHits += 1;
			if (testCase.expectedScopes.length > 0) {
				scopedResults += 1;
				if (!testCase.expectedScopes.some((scope) => sameScope(scope, result.scope))) {
					scopeLeaks += 1;
				}
			}
			if (testCase.timeCondition) {
				temporalResults += 1;
				if (
					result.modifiedAt === null ||
					Date.parse(result.modifiedAt) < Date.parse(testCase.timeCondition.notBefore)
				) {
					staleHits += 1;
				}
			}
		}
		durations.push(observation.durationMs);
	}

	const metrics: RetrievalEvalMetrics = {
		recallAt5: average(recalls, 1),
		mrrAt10: average(reciprocalRanks, 1),
		abstentionAccuracy: cases.length === 0 ? 1 : correctAbstentions / cases.length,
		scopeLeakageRate: scopedResults === 0 ? 0 : scopeLeaks / scopedResults,
		staleHitRate: temporalResults === 0 ? 0 : staleHits / temporalResults,
		forbiddenHitRate: forbiddenEligibleResults === 0 ? 0 : forbiddenHits / forbiddenEligibleResults,
		averageContextTokens: cases.length === 0 ? 0 : contextTokens / cases.length,
	};
	const passed =
		metrics.recallAt5 >= THRESHOLDS.recallAt5 &&
		metrics.mrrAt10 >= THRESHOLDS.mrrAt10 &&
		metrics.abstentionAccuracy >= THRESHOLDS.abstentionAccuracy &&
		metrics.scopeLeakageRate === THRESHOLDS.scopeLeakageRate &&
		metrics.staleHitRate === THRESHOLDS.staleHitRate &&
		metrics.forbiddenHitRate === THRESHOLDS.forbiddenHitRate;

	return {
		metrics,
		timings: {
			averageMs: average(durations, 0),
			p50Ms: nearestRankPercentile(durations, 0.5),
			p95Ms: nearestRankPercentile(durations, 0.95),
		},
		denominators: {
			relevanceCases: relevanceCases.length,
			abstentionCases: cases.length,
			scopedResults,
			temporalResults,
			forbiddenEligibleResults,
			contextCases: cases.length,
		},
		thresholds: THRESHOLDS,
		passed,
	};
}

export function runMemoryRetrievalEvaluation(
	fixture: RetrievalEvalFixture,
): MemoryRetrievalEvaluationReport {
	const vault = createTempVault();
	try {
		for (const document of fixture.documents) {
			writeTestNote(
				vault.root,
				document.filePath,
				{
					id: document.entityId,
					title: document.title,
					type: document.type,
					status: document.status,
					domain: document.domain,
					category: document.category,
					project: document.project,
					tags: document.tags,
				},
				document.body,
			);
			const modifiedAt = new Date(document.modifiedAt);
			utimesSync(join(vault.root, document.filePath), modifiedAt, modifiedAt);
		}

		fullScan(vault.root, vault.dbPath, new VaultConfig(vault.root));
		const observations = withDb(vault.dbPath, (db) =>
			fixture.cases.map((testCase): RetrievalEvalObservation => {
				const started = performance.now();
				const results = queryVaultIndex(db, testCase.query, testCase.filters, 10).results;
				const durationMs = performance.now() - started;
				return {
					caseId: testCase.id,
					durationMs,
					results: results.map((result) => {
						const indexedFact = db
							.prepare('SELECT project, entity_id FROM vault_index WHERE file_path = ?')
							.get(result.filePath) as
							| { project: string | null; entity_id: string | null }
							| undefined;
						const scope: MemoryScope = indexedFact?.project
							? { type: 'project', key: indexedFact.project }
							: {
									type: 'file',
									key: indexedFact?.entity_id ?? result.filePath,
								};
						return {
							filePath: result.filePath,
							scope,
							modifiedAt: result.modifiedAt,
							contextTokens: estimateTokens(`${result.title}\n${result.displaySummary}`),
						};
					}),
				};
			}),
		);
		const base = evaluateRetrieval(fixture.cases, observations);
		const categoryReports = Object.fromEntries(
			RETRIEVAL_EVAL_CATEGORIES.map((category) => {
				const categoryCases = fixture.cases.filter((testCase) => testCase.category === category);
				const categoryCaseIds = new Set(categoryCases.map((testCase) => testCase.id));
				return [
					category,
					evaluateRetrieval(
						categoryCases,
						observations.filter((observation) => categoryCaseIds.has(observation.caseId)),
					),
				];
			}),
		) as Record<RetrievalEvalCategory, RetrievalEvalReport>;
		return {
			...base,
			fixture: {
				version: fixture.version,
				documentCount: fixture.documents.length,
				caseCount: fixture.cases.length,
			},
			categoryReports,
			rankings: observations.map((observation) => ({
				caseId: observation.caseId,
				files: observation.results.map((result) => result.filePath),
			})),
		};
	} finally {
		vault.cleanup();
	}
}

function stableValue(value: unknown, normalizeTimings: boolean, key = ''): unknown {
	if (normalizeTimings && key === 'timings') {
		return { averageMs: 0, p50Ms: 0, p95Ms: 0 };
	}
	if (Array.isArray(value)) {
		return value.map((item) => stableValue(item, normalizeTimings));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([childKey, childValue]) => [
					childKey,
					stableValue(childValue, normalizeTimings, childKey),
				]),
		);
	}
	return value;
}

export function stableEvaluationJson(
	report: MemoryRetrievalEvaluationReport,
	options: { normalizeTimings?: boolean } = {},
): string {
	return `${JSON.stringify(stableValue(report, options.normalizeTimings ?? false), null, 2)}\n`;
}
