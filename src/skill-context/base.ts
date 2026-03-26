/**
 * skill-context/base.ts — 技能上下文公共类型定义。
 */

import type { MemoryItem, SessionEvent, VaultQueryResult } from '../services/retrieval.js';

// ─── SeedProfileConfig ────────────────────────────────────────────────────────

/**
 * Configuration for a skill context seed profile.
 * Controls how vault results, recent events, and memory items are selected.
 */
export interface SeedProfileConfig {
	/** Profile identifier (e.g. 'review_strict') */
	name: string;
	/** Whether to load and include the TaskBoard summary */
	loadTaskboard: boolean;
	/** Whether to fall back to domain/tag matching when no direct results are found */
	allowDomainTagFallback: boolean;
	/**
	 * Ranking bias map: bucket/type name → bonus score added when reranking vault results.
	 * Higher values push matching items to the top.
	 * Example: { review: 50, knowledge: 30 }
	 */
	rankingBias: Record<string, number>;
	/**
	 * Recent event bias map: entry_type → bonus score for reranking session events.
	 * Example: { correction: 40, skill_completion: 20 }
	 */
	recentEventBias: Record<string, number>;
	/** Maximum number of vault index results to return */
	vaultQueryLimit: number;
	/** Maximum number of recent session events to return */
	recentEventLimit: number;
	/** Look-back window in days for recent events */
	recentEventDays: number;
}

// ─── SkillContextResult ───────────────────────────────────────────────────────

/**
 * Output of buildSkillContext — assembled context for a skill execution.
 */
export interface SkillContextResult {
	/** Profile name used to assemble this context */
	profile: string;
	/** Vault index search results, reranked by profile bias */
	vaultResults: VaultQueryResult[];
	/** Recent session events, reranked by profile bias */
	recentEvents: SessionEvent[];
	/** Active memory items for all active-doc targets */
	memoryItems: MemoryItem[];
	/** Optional TaskBoard focus section content (loaded when profile.loadTaskboard=true) */
	taskboardSummary?: string;
}
