/**
 * enhance.ts — 增强服务。
 *
 * Processes the enhance queue: generates semantic summaries and enhanced
 * search terms for indexed vault files.
 */

import type Database from 'better-sqlite3';
import { queryOne } from '../db/index.js';
import type { VaultIndexRow } from '../types.js';
import { ENHANCE_STATUS_LABELS, NOTE_TYPE_LABELS } from '../types.js';
import { tokenize } from '../utils/segmenter.js';
import { coerceNow, loadsJsonList, normalizeWikilinkValue } from '../utils/shared.js';

// ─── generateSemanticSummary ──────────────────────────────────────────────────

/**
 * Generate a natural language description of a vault_index record.
 * Used to populate the semantic_summary column.
 */
export function generateSemanticSummary(record: VaultIndexRow): string {
	const title = String(record.title ?? '').trim();
	const noteType = String(record.type ?? '').trim();
	const domain = normalizeWikilinkValue(record.domain);
	const status = String(record.status ?? '').trim();
	const summary = String(record.summary ?? '')
		.trim()
		.replace(/\n/g, ' ');

	const subject = title || '该条目';
	let s1 = `${subject}是一份${NOTE_TYPE_LABELS[noteType] ?? '笔记'}`;
	if (domain) s1 += `，主要关联 ${domain} 领域`;
	s1 += '。';

	let s2 = ENHANCE_STATUS_LABELS[status] ? `当前状态为${ENHANCE_STATUS_LABELS[status]}` : '';
	if (summary && !s2) s2 = summary.slice(0, 48);
	if (s2 && !s2.endsWith('。')) s2 += '。';

	return `${s1}${s2}`.trim() || `${subject}是一条待补充增强摘要的记忆条目。`;
}

// ─── queueFileForEnhance ──────────────────────────────────────────────────────

/**
 * Add a file to the enhance queue.
 * If the file is already queued with a higher priority, it is skipped.
 */
export function queueFileForEnhance(
	db: Database.Database,
	filePath: string,
	priority: number,
	source: string,
	now?: Date | string | null,
): void {
	const queuedAt = coerceNow(now).toISOString();
	const existing = db
		.prepare('SELECT priority FROM enhance_queue WHERE file_path = ?')
		.get(filePath) as { priority: number } | undefined;
	if (existing && existing.priority > priority) return;
	db.prepare(`
    INSERT OR REPLACE INTO enhance_queue
    (file_path, priority, queued_at, source, status, attempts, last_attempt_at, error_message)
    VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL)
  `).run(filePath, priority, queuedAt, source);
}

// ─── matchEnhancePriority ─────────────────────────────────────────────────────

/**
 * Return the first matching enhance priority for a file path,
 * checking each prefix in the enhancePriority map in insertion order.
 * Returns null if no prefix matches.
 */
export function matchEnhancePriority(
	filePath: string,
	enhancePriority: Record<string, number>,
): number | null {
	for (const [prefix, priority] of Object.entries(enhancePriority)) {
		if (filePath.startsWith(prefix)) return priority;
	}
	return null;
}

// ─── enqueueChangedPathsForEnhance ────────────────────────────────────────────

/**
 * Queue a list of changed file paths for enhancement, using the configured
 * priority map. Files with no matching prefix are skipped.
 * Returns the number of files actually queued.
 */
export function enqueueChangedPathsForEnhance(
	db: Database.Database,
	changedPaths: string[],
	enhancePriority: Record<string, number>,
	now?: Date | string | null,
): number {
	let queued = 0;
	for (const fp of changedPaths) {
		const priority = matchEnhancePriority(fp, enhancePriority);
		if (priority === null) continue;
		queueFileForEnhance(db, fp, priority, 'startup_scan', now);
		queued++;
	}
	return queued;
}

// ─── generateEnhancedSearchTerms ─────────────────────────────────────────────

/**
 * Generate enhanced search term tokens for a vault_index record.
 * Combines title, aliases, domain, type, status, section heads, and summary
 * into a deduplicated list of tokens via the segmenter.
 */
export function generateEnhancedSearchTerms(record: VaultIndexRow): string[] {
	const extras: string[] = [];
	const title = String(record.title ?? '').trim();
	const noteType = String(record.type ?? '').trim();
	const status = String(record.status ?? '').trim();
	const domain = normalizeWikilinkValue(record.domain);
	const aliases = loadsJsonList(record.aliases);
	const sectionHeads = loadsJsonList(record.section_heads)
		.map((h: string) => h.replace(/^#{1,6}\s*/, '').trim())
		.filter(Boolean);
	const summary = String(record.summary ?? '').trim();

	if (title) extras.push(title);
	extras.push(...aliases);
	if (domain) extras.push(domain);
	if (noteType) extras.push(noteType);
	if (status) extras.push(status);
	extras.push(...sectionHeads.slice(0, 5));
	extras.push(...summary.split('\n').slice(0, 2));

	if (noteType === 'project') extras.push('项目', '计划', '进展', '任务', '当前状态');
	else if (noteType === 'note') extras.push('概念', '定义', '知识点', '章节', '复习');
	else if (noteType === 'research') extras.push('研究', '报告', '结论', '发现');
	if (status === 'done') extras.push('完成', '复盘');

	return tokenize(extras.filter(Boolean).join(' '));
}

// ─── mergeSearchHints ─────────────────────────────────────────────────────────

/**
 * Merge base search hints (JSON array or raw string) with extra terms,
 * deduplicating while preserving insertion order.
 * Returns a JSON array string.
 */
export function mergeSearchHints(
	baseHints: string | string[] | null | undefined,
	extraTerms: string[],
): string {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const term of [...loadsJsonList(baseHints), ...extraTerms.filter(Boolean)]) {
		const normalized = term.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		merged.push(normalized);
	}
	return JSON.stringify(merged);
}

// ─── processEnhanceQueue ──────────────────────────────────────────────────────

/**
 * Process up to `limit` pending items from the enhance queue.
 * For each item, generates semantic summary and enhanced search hints,
 * then marks the item as done (or error on failure).
 */
export function processEnhanceQueue(
	db: Database.Database,
	_vaultRoot: string,
	limit = 5,
): { processed: number; errors: number } {
	const rows = db
		.prepare(`
      SELECT file_path, priority FROM enhance_queue
      WHERE status = 'pending'
      ORDER BY priority DESC, queued_at ASC
      LIMIT ?
    `)
		.all(limit) as { file_path: string; priority: number }[];

	let processed = 0;
	let errors = 0;

	for (const row of rows) {
		try {
			const record = queryOne<VaultIndexRow>(
				db,
				'SELECT * FROM vault_index WHERE file_path = ?',
				row.file_path,
			);
			if (!record) {
				db.prepare("UPDATE enhance_queue SET status = 'done' WHERE file_path = ?").run(
					row.file_path,
				);
				continue;
			}

			const semanticSummary = generateSemanticSummary(record);
			const enhancedTerms = generateEnhancedSearchTerms(record);
			const mergedHints = mergeSearchHints(record.search_hints, enhancedTerms);

			db.prepare(`
        UPDATE vault_index SET semantic_summary = ?, search_hints = ? WHERE file_path = ?
      `).run(semanticSummary, mergedHints, row.file_path);

			db.prepare("UPDATE enhance_queue SET status = 'done' WHERE file_path = ?").run(row.file_path);
			processed++;
		} catch {
			db.prepare(`
        UPDATE enhance_queue
        SET status = 'error', attempts = attempts + 1, error_message = 'enhance failed'
        WHERE file_path = ?
      `).run(row.file_path);
			errors++;
		}
	}

	return { processed, errors };
}
