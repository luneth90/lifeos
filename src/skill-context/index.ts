/**
 * skill-context/index.ts — 技能上下文组装入口。
 *
 * buildSkillContext assembles vault results, recent events, and memory items
 * for a skill execution using the named seed profile's bias configuration.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { getVaultConfig, resolveConfig } from '../config.js';
import { extractAutoSection } from '../services/layer0.js';
import type { MemoryItem, SessionEvent, VaultQueryResult } from '../services/retrieval.js';
import {
	queryMemoryItems,
	queryRecentEvents,
	queryVaultIndex,
	queryVaultIndexByDomainsOrTags,
	queryVaultIndexByPaths,
} from '../services/retrieval.js';
import type { SeedProfileConfig, SkillContextResult } from './base.js';
import { getProfile } from './seed-profiles.js';

// ─── Reranking helpers ────────────────────────────────────────────────────────

/**
 * Apply profile ranking bias to vault results.
 * Adds bonus score based on the result's type matching rankingBias keys.
 */
function rerankVaultResults(
	results: VaultQueryResult[],
	rankingBias: Record<string, number>,
): VaultQueryResult[] {
	if (Object.keys(rankingBias).length === 0) return results;

	const scored = results.map((r) => {
		let bonus = 0;
		// Check type match
		if (r.type && rankingBias[r.type] != null) {
			bonus += rankingBias[r.type];
		}
		// Check status match (e.g. 'review', 'draft')
		if (r.status && rankingBias[r.status] != null) {
			bonus += rankingBias[r.status];
		}
		return { result: r, finalScore: r.score + bonus };
	});

	scored.sort((a, b) => b.finalScore - a.finalScore);
	return scored.map((s) => s.result);
}

/**
 * Apply profile recent event bias to session events.
 */
function rerankRecentEvents(
	events: SessionEvent[],
	recentEventBias: Record<string, number>,
): SessionEvent[] {
	if (Object.keys(recentEventBias).length === 0) return events;

	const scored = events.map((e) => ({
		event: e,
		bonus: recentEventBias[e.entryType] ?? 0,
	}));
	scored.sort((a, b) => b.bonus - a.bonus || 0);
	return scored.map((s) => s.event);
}

// ─── TaskBoard summary loader ─────────────────────────────────────────────────

function loadTaskboardSummary(vaultRoot: string): string | undefined {
	const vc = getVaultConfig() ?? resolveConfig(vaultRoot);
	const memDir = vc.memoryDir();
	const tbPath = join(memDir, 'TaskBoard.md');

	if (!existsSync(tbPath)) return undefined;

	const content = readFileSync(tbPath, 'utf-8');
	const focus = extractAutoSection(content, 'focus');
	return focus || undefined;
}

// ─── Domain/tag fallback ──────────────────────────────────────────────────────

/**
 * Extract domain names from related file paths.
 * Uses vault config to infer domains.
 */
function inferDomainsFromFiles(filePaths: string[], vaultRoot: string): string[] {
	const vc = getVaultConfig() ?? resolveConfig(vaultRoot);
	const domains = new Set<string>();
	for (const fp of filePaths) {
		const domain = vc.inferDomainFromPath(fp);
		if (domain) domains.add(domain);
	}
	return [...domains];
}

// ─── buildSkillContext ────────────────────────────────────────────────────────

export interface BuildSkillContextOpts {
	/** Profile name — must be registered in seed-profiles registry */
	skillProfile: string;
	/** Explicitly related file paths to include in vault lookup */
	relatedFiles?: string[];
	/** Free-text query for vault + event search */
	query?: string;
	/** Override the vault query limit from the profile config */
	limit?: number;
}

/**
 * Assemble skill context from DB and active docs.
 *
 * Steps:
 * 1. Resolve profile config
 * 2. Query vault_index: related_files (exact) + query (FTS)
 * 3. Apply profile ranking bias
 * 4. Query recent session events with profile event bias
 * 5. Query active memory items
 * 6. Optionally load TaskBoard focus section
 * 7. Return assembled SkillContextResult
 */
export function buildSkillContext(
	db: Database.Database,
	vaultRoot: string,
	opts: BuildSkillContextOpts,
): SkillContextResult {
	const { skillProfile, relatedFiles = [], query = '', limit } = opts;

	// 1. Resolve profile config
	const profile: SeedProfileConfig = getProfile(skillProfile) ?? {
		name: skillProfile,
		loadTaskboard: false,
		allowDomainTagFallback: false,
		rankingBias: {},
		recentEventBias: {},
		vaultQueryLimit: 10,
		recentEventLimit: 10,
		recentEventDays: 30,
	};

	const vaultLimit = limit ?? profile.vaultQueryLimit;

	// 2a. Exact lookup for related files
	let vaultResults: VaultQueryResult[] = [];
	if (relatedFiles.length > 0) {
		const { results: exactResults } = queryVaultIndexByPaths(db, relatedFiles);
		vaultResults.push(...exactResults);
	}

	// 2b. FTS / keyword query
	if (query.trim()) {
		const { results: queryResults } = queryVaultIndex(
			db,
			query,
			null,
			vaultLimit * 2, // Over-fetch for reranking
			null,
		);
		// Merge, avoiding duplicates
		const existingPaths = new Set(vaultResults.map((r) => r.filePath));
		for (const r of queryResults) {
			if (!existingPaths.has(r.filePath)) {
				vaultResults.push(r);
				existingPaths.add(r.filePath);
			}
		}
	}

	// 2c. Domain/tag fallback when allowed and results are sparse
	if (profile.allowDomainTagFallback && vaultResults.length < 3) {
		const domains = inferDomainsFromFiles(relatedFiles, vaultRoot);
		if (domains.length > 0) {
			const { results: domainResults } = queryVaultIndexByDomainsOrTags(db, {
				domains,
				limit: vaultLimit,
			});
			const existingPaths = new Set(vaultResults.map((r) => r.filePath));
			for (const r of domainResults) {
				if (!existingPaths.has(r.filePath)) {
					vaultResults.push(r);
				}
			}
		}
	}

	// 3. Rerank vault results by profile bias
	vaultResults = rerankVaultResults(vaultResults, profile.rankingBias);
	vaultResults = vaultResults.slice(0, vaultLimit);

	// 4. Query recent session events
	let { events: recentEvents } = queryRecentEvents(db, {
		days: profile.recentEventDays,
		limit: profile.recentEventLimit * 2, // Over-fetch for reranking
	});
	recentEvents = rerankRecentEvents(recentEvents, profile.recentEventBias);
	recentEvents = recentEvents.slice(0, profile.recentEventLimit);

	// 5. Query active memory items (both targets)
	const { items: tbItems } = queryMemoryItems(db, {
		target: 'TaskBoard',
		statusFilter: 'active',
		limit: 20,
	});
	const { items: upItems } = queryMemoryItems(db, {
		target: 'UserProfile',
		statusFilter: 'active',
		limit: 20,
	});
	const memoryItems: MemoryItem[] = [...tbItems, ...upItems];

	// 6. Optionally load TaskBoard focus section
	let taskboardSummary: string | undefined;
	if (profile.loadTaskboard) {
		taskboardSummary = loadTaskboardSummary(vaultRoot);
	}

	return {
		profile: profile.name,
		vaultResults,
		recentEvents,
		memoryItems,
		taskboardSummary,
	};
}

// Re-export types for convenience
export type { SeedProfileConfig, SkillContextResult } from './base.js';
