/**
 * seed-profiles.ts — 技能画像注册表。
 *
 * Registry mapping profile names to SeedProfileConfig objects.
 * Additional profiles (research_seed, project_seed) use defaults from context-policy.
 */

import { ASK_GLOBAL } from './ask-global.js';
import type { SeedProfileConfig } from './base.js';
import { DAILY_GLOBAL } from './daily-global.js';
import { KNOWLEDGE_STRICT } from './knowledge-strict.js';
import { REVIEW_STRICT } from './review-strict.js';

// ─── Additional profiles defined inline ────────────────────────────────────────

const RESEARCH_SEED: SeedProfileConfig = {
	name: 'research_seed',
	loadTaskboard: false,
	allowDomainTagFallback: true,
	rankingBias: {
		draft: 60,
		research: 50,
		resource: 40,
	},
	recentEventBias: {
		decision: 20,
		preference: 15,
		skill_completion: 15,
		milestone: 10,
	},
	vaultQueryLimit: 12,
	recentEventLimit: 10,
	recentEventDays: 30,
};

const PROJECT_SEED: SeedProfileConfig = {
	name: 'project_seed',
	loadTaskboard: false,
	allowDomainTagFallback: true,
	rankingBias: {
		project: 60,
		research: 45,
		resource: 35,
		draft: 20,
	},
	recentEventBias: {
		decision: 30,
		milestone: 20,
		skill_completion: 15,
		correction: 10,
	},
	vaultQueryLimit: 10,
	recentEventLimit: 10,
	recentEventDays: 30,
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const PROFILE_REGISTRY: Map<string, SeedProfileConfig> = new Map([
	['review_strict', REVIEW_STRICT],
	['ask_global', ASK_GLOBAL],
	['daily_global', DAILY_GLOBAL],
	['knowledge_strict', KNOWLEDGE_STRICT],
	['research_seed', RESEARCH_SEED],
	['project_seed', PROJECT_SEED],
]);

/**
 * Get a SeedProfileConfig by name.
 * Returns null if the profile name is not registered.
 */
export function getProfile(name: string): SeedProfileConfig | null {
	return PROFILE_REGISTRY.get(name) ?? null;
}

/**
 * List all registered profile names.
 */
export function listProfiles(): string[] {
	return [...PROFILE_REGISTRY.keys()];
}

/**
 * Register a custom profile.
 * Overwrites an existing profile with the same name.
 */
export function registerProfile(config: SeedProfileConfig): void {
	PROFILE_REGISTRY.set(config.name, config);
}
