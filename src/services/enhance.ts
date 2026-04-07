/**
 * enhance.ts — 搜索增强工具函数。
 *
 * Generates enhanced search terms for vault index records.
 * Called during indexing to populate search_hints column.
 */

import { tokenize } from '../utils/segmenter.js';
import { normalizeWikilinkValue } from '../utils/shared.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnhanceInput {
	title: string | null;
	type: string | null;
	domain: string | null;
	status: string | null;
	summary: string;
	aliases: string; // JSON array string
	sectionHeads: string; // JSON array string
}

// ─── generateEnhancedSearchTerms ─────────────────────────────────────────────

function loadsJsonList(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/**
 * Generate enhanced search term tokens for a vault record.
 */
export function generateEnhancedSearchTerms(input: EnhanceInput): string[] {
	const extras: string[] = [];
	const title = (input.title ?? '').trim();
	const noteType = (input.type ?? '').trim();
	const status = (input.status ?? '').trim();
	const domain = normalizeWikilinkValue(input.domain);
	const aliases = loadsJsonList(input.aliases);
	const sectionHeads = loadsJsonList(input.sectionHeads)
		.map((h: string) => h.replace(/^#{1,6}\s*/, '').trim())
		.filter(Boolean);
	const summary = input.summary.trim();

	if (title) extras.push(title);
	extras.push(...aliases);
	if (domain) extras.push(domain);
	if (noteType) extras.push(noteType);
	if (status) extras.push(status);
	extras.push(...sectionHeads.slice(0, 5));
	extras.push(...summary.split('\n').slice(0, 2));

	return tokenize(extras.filter(Boolean).join(' '));
}

// ─── mergeSearchHints ────────────────────────────────────────────────────────

/**
 * Merge base search hints with extra terms, deduplicating.
 * Returns a JSON array string.
 */
export function mergeSearchHints(
	baseHints: string | string[] | null | undefined,
	extraTerms: string[],
): string {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const term of [...loadsJsonList(baseHints as string), ...extraTerms.filter(Boolean)]) {
		const normalized = term.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		merged.push(normalized);
	}
	return JSON.stringify(merged);
}
