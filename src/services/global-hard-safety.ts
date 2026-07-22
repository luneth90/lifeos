import type Database from 'better-sqlite3';
import { estimateTokens } from '../utils/shared.js';

export const MAX_ACTIVE_GLOBAL_HARD_RULES = 256;
export const MAX_GLOBAL_HARD_ITEM_TOKENS = 4_096;
export const MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES = 16 * 1_024;
export const MAX_GLOBAL_HARD_TOTAL_TOKENS = 16_384;
export const MAX_GLOBAL_HARD_TOTAL_PAYLOAD_BYTES = 64 * 1_024;

const ACTIVE_GLOBAL_HARD_FILTER = `
	status = 'active'
	AND scope_type = 'global'
	AND scope_key = ''
	AND item_kind = 'rule'
	AND enforcement = 'hard'
	AND (expires_at IS NULL OR expires_at >= ?)
`;
const PAYLOAD_BYTES_SQL = `(
	length(CAST(slot_key AS BLOB)) +
	length(CAST(content AS BLOB)) +
	length(CAST(related_files AS BLOB)) + 2
)`;

export interface GlobalHardSafetyOffender {
	itemId: number;
	slotKey: string;
	priority: number;
	payloadBytes: number;
	tokens?: number;
}

export interface GlobalHardSafetyInspection {
	ok: boolean;
	count: number;
	maxItemTokens: number | null;
	maxItemBytes: number;
	totalTokens: number | null;
	totalBytes: number;
	offenders: GlobalHardSafetyOffender[];
}

interface FootprintRow {
	count: number;
	max_item_bytes: number;
	total_bytes: number;
}

interface SafetyRow {
	item_id: number;
	slot_key: string;
	content: string;
	priority: number;
	payload_bytes: number;
}

function formatRule(slotKey: string, content: string): string {
	return `- **${slotKey}**: ${content}`;
}

function compactSlotKey(slotKey: string): string {
	return slotKey.length <= 80 ? slotKey : `${slotKey.slice(0, 77)}...`;
}

function byteOffenders(db: Database.Database, now: string): GlobalHardSafetyOffender[] {
	return (
		db
			.prepare(`
				SELECT item_id, substr(slot_key, 1, 80) AS slot_key, priority,
					${PAYLOAD_BYTES_SQL} AS payload_bytes
				FROM memory_items
				WHERE ${ACTIVE_GLOBAL_HARD_FILTER}
				ORDER BY payload_bytes DESC, item_id ASC
				LIMIT 10
			`)
			.all(now) as Array<{
			item_id: number;
			slot_key: string;
			priority: number;
			payload_bytes: number;
		}>
	).map((row) => ({
		itemId: row.item_id,
		slotKey: compactSlotKey(row.slot_key),
		priority: row.priority,
		payloadBytes: row.payload_bytes,
	}));
}

export function inspectGlobalHardSafety(
	db: Database.Database,
	now = new Date().toISOString(),
): GlobalHardSafetyInspection {
	const footprint = db
		.prepare(`
			SELECT COUNT(*) AS count,
				COALESCE(MAX(${PAYLOAD_BYTES_SQL}), 0) AS max_item_bytes,
				COALESCE(SUM(${PAYLOAD_BYTES_SQL}), 0) AS total_bytes
			FROM memory_items
			WHERE ${ACTIVE_GLOBAL_HARD_FILTER}
		`)
		.get(now) as FootprintRow;
	const byteSafe =
		footprint.count <= MAX_ACTIVE_GLOBAL_HARD_RULES &&
		footprint.max_item_bytes <= MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES &&
		footprint.total_bytes <= MAX_GLOBAL_HARD_TOTAL_PAYLOAD_BYTES;
	if (!byteSafe) {
		return {
			ok: false,
			count: footprint.count,
			maxItemTokens: null,
			maxItemBytes: footprint.max_item_bytes,
			totalTokens: null,
			totalBytes: footprint.total_bytes,
			offenders: byteOffenders(db, now),
		};
	}

	const rows = db
		.prepare(`
			SELECT item_id, slot_key, content, priority,
				${PAYLOAD_BYTES_SQL} AS payload_bytes
			FROM memory_items
			WHERE ${ACTIVE_GLOBAL_HARD_FILTER}
			ORDER BY item_id ASC
		`)
		.all(now) as SafetyRow[];
	const measured = rows.map((row) => ({
		row,
		tokens: estimateTokens(formatRule(row.slot_key, row.content)),
	}));
	const maxItemTokens = measured.reduce((max, item) => Math.max(max, item.tokens), 0);
	const body = rows.map((row) => formatRule(row.slot_key, row.content)).join('\n');
	const totalTokens = body ? estimateTokens(`## 行为约束\n${body}`) : 0;
	const tokenSafe =
		maxItemTokens <= MAX_GLOBAL_HARD_ITEM_TOKENS && totalTokens <= MAX_GLOBAL_HARD_TOTAL_TOKENS;
	const offenders = tokenSafe
		? []
		: measured
				.sort(
					(left, right) =>
						right.tokens - left.tokens ||
						right.row.payload_bytes - left.row.payload_bytes ||
						left.row.item_id - right.row.item_id,
				)
				.slice(0, 10)
				.map(({ row, tokens }) => ({
					itemId: row.item_id,
					slotKey: compactSlotKey(row.slot_key),
					priority: row.priority,
					payloadBytes: row.payload_bytes,
					tokens,
				}));
	return {
		ok: tokenSafe,
		count: footprint.count,
		maxItemTokens,
		maxItemBytes: footprint.max_item_bytes,
		totalTokens,
		totalBytes: footprint.total_bytes,
		offenders,
	};
}

export function describeGlobalHardSafety(inspection: GlobalHardSafetyInspection): string {
	const metrics = [
		`条目 ${inspection.count}/${MAX_ACTIVE_GLOBAL_HARD_RULES}`,
		inspection.maxItemTokens === null
			? null
			: `最大单条 ${inspection.maxItemTokens}/${MAX_GLOBAL_HARD_ITEM_TOKENS} tokens`,
		`最大单条 ${inspection.maxItemBytes}/${MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES} bytes`,
		inspection.totalTokens === null
			? null
			: `合计 ${inspection.totalTokens}/${MAX_GLOBAL_HARD_TOTAL_TOKENS} tokens`,
		`合计 ${inspection.totalBytes}/${MAX_GLOBAL_HARD_TOTAL_PAYLOAD_BYTES} bytes`,
	].filter((item): item is string => item !== null);
	const offenders = inspection.offenders.length
		? `；候选 item_id：${inspection.offenders
				.map(
					(item) =>
						`${item.itemId}(${item.slotKey}, ${item.payloadBytes} bytes${item.tokens === undefined ? '' : `, ${item.tokens} tokens`})`,
				)
				.join('、')}`
		: '';
	return `${metrics.join('；')}${offenders}`;
}

export class GlobalHardRuleLimitError extends Error {
	readonly code = 'GLOBAL_HARD_RULE_LIMIT';
	readonly inspection?: GlobalHardSafetyInspection;

	constructor(message: string, inspection?: GlobalHardSafetyInspection) {
		super(message);
		this.name = 'GlobalHardRuleLimitError';
		this.inspection = inspection;
	}
}

export function assertGlobalHardItemSafety(input: {
	slotKey: string;
	content: string;
	relatedFiles: string[];
}): void {
	const payloadBytes =
		Buffer.byteLength(input.slotKey, 'utf8') +
		Buffer.byteLength(input.content, 'utf8') +
		Buffer.byteLength(JSON.stringify(input.relatedFiles), 'utf8') +
		2;
	if (payloadBytes > MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES) {
		throw new GlobalHardRuleLimitError(
			`全局 hard 规则触发单条运行时安全上限：tokens 未计算，${payloadBytes}/${MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES} bytes。本次写入已拒绝，数据库未发生变更。`,
		);
	}
	const tokens = estimateTokens(formatRule(input.slotKey, input.content));
	if (tokens <= MAX_GLOBAL_HARD_ITEM_TOKENS) {
		return;
	}
	throw new GlobalHardRuleLimitError(
		`全局 hard 规则触发单条运行时安全上限：${tokens}/${MAX_GLOBAL_HARD_ITEM_TOKENS} tokens，${payloadBytes}/${MAX_GLOBAL_HARD_ITEM_PAYLOAD_BYTES} bytes。本次写入已拒绝，数据库未发生变更。`,
	);
}

export function assertGlobalHardSafety(
	db: Database.Database,
	options: { now?: string; operation?: 'read' | 'write' } = {},
): GlobalHardSafetyInspection {
	const inspection = inspectGlobalHardSafety(db, options.now);
	if (inspection.ok) return inspection;
	const consequence =
		options.operation === 'write'
			? '本次写入已回滚。'
			: '为避免生成无界上下文，系统没有截断或静默省略任何 hard 规则，当前上下文生成已停止。';
	throw new GlobalHardRuleLimitError(
		`全局 hard 规则触发运行时安全上限：${describeGlobalHardSafety(inspection)}。${consequence}请运行 lifeos doctor <vault> 查看 item_id，再执行 lifeos rules archive <vault> --id <item_id> --reason "缩减全局 hard 规则"。`,
		inspection,
	);
}
