import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Jieba } from '@node-rs/jieba';

// @node-rs/jieba/dict is CJS-only (no ESM exports), so we use createRequire
const require = createRequire(import.meta.url);
const { dict } = require('@node-rs/jieba/dict') as { dict: Uint8Array };

// Singleton jieba instance with default dictionary
const jieba = Jieba.withDict(dict);

// Regex for meaningful characters (Chinese, alphanumeric, underscore)
const MEANINGFUL_CHAR_RE = /[\u4e00-\u9fffA-Za-z0-9_]/;

/**
 * Normalize markdown text for tokenization.
 * Removes wikilink brackets and hash symbols.
 */
function normalizeSearchText(text: string): string {
	let normalized = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
	normalized = normalized.replace(/#/g, ' ');
	return normalized;
}

/**
 * Load a custom dictionary file into the jieba instance.
 * File format: one word per line, optionally followed by frequency and POS tag.
 * Example: "四元数群 5 n"
 *
 * Converts the text-based dict to the binary format jieba expects.
 */
export function loadCustomDict(dictPath: string): void {
	const content = readFileSync(dictPath);
	jieba.loadDict(content);
}

/**
 * Tokenize text into words using jieba.
 * Handles Chinese, English, and mixed text.
 * Returns deduplicated, lowercased word tokens.
 */
export function tokenize(text: string): string[] {
	const normalized = normalizeSearchText(text).trim();
	if (!normalized) return [];

	const words = jieba.cut(normalized, false);
	const tokens: string[] = [];
	const seen = new Set<string>();

	for (const word of words) {
		const trimmed = word.trim().toLowerCase();
		if (!trimmed || seen.has(trimmed)) continue;
		if (!MEANINGFUL_CHAR_RE.test(trimmed)) continue;
		seen.add(trimmed);
		tokens.push(trimmed);
	}

	return tokens;
}

/**
 * Build space-separated search tokens from multiple text sources.
 * Accepts strings, arrays, or null values.
 */
export function buildSearchTokens(...parts: (string | string[] | null | undefined)[]): string {
	const chunks: string[] = [];
	for (const part of parts) {
		if (part == null) continue;
		if (Array.isArray(part)) {
			for (const item of part) {
				if (item != null) chunks.push(String(item));
			}
		} else {
			chunks.push(String(part));
		}
	}
	return tokenize(chunks.join(' ')).join(' ');
}
