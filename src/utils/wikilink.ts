/**
 * wikilink.ts — Wikilink 解析与归一化。
 *
 * Normalizes Obsidian wikilinks: strips aliases (|display) and
 * heading references (#section), returning only the clean target.
 */

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/**
 * Normalize a wikilink target string extracted from [[target]].
 * Strips the alias (after `|`) and heading reference (after `#`).
 *
 * Examples:
 *   "My Note|display"  → "My Note"
 *   "My Note#section"  → "My Note"
 *   "My Note"          → "My Note"
 */
export function normalizeWikilink(raw: string): string {
	let target = raw.trim();

	if (target.startsWith('[[') && target.endsWith(']]')) {
		target = target.slice(2, -2).trim();
	}

	const pipeIdx = target.indexOf('|');
	if (pipeIdx !== -1) {
		target = target.slice(0, pipeIdx);
	}

	const hashIdx = target.indexOf('#');
	if (hashIdx !== -1) {
		target = target.slice(0, hashIdx);
	}

	return target.trim();
}

/**
 * Extract all wikilinks from markdown body text, returning only
 * the normalized targets (no aliases, no headings).
 */
export function extractWikilinks(body: string): string[] {
	const matches: string[] = [];
	WIKILINK_RE.lastIndex = 0;
	const allMatches = body.matchAll(WIKILINK_RE);
	for (const m of allMatches) {
		const target = normalizeWikilink(m[1]);
		if (target) matches.push(target);
	}
	return matches;
}
