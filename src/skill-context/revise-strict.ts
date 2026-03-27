/**
 * revise-strict.ts — /revise 技能上下文画像。
 *
 * Strictly focused on knowledge/revise items and corrections.
 * Does NOT fall back to domain tags. Heavily weights correction events.
 */

import type { SeedProfileConfig } from './base.js';

export const REVISE_STRICT: SeedProfileConfig = {
	name: 'revise_strict',
	loadTaskboard: false,
	allowDomainTagFallback: false,
	rankingBias: {
		revise: 50,
		knowledge: 30,
		correction: 90,
		note: 25,
	},
	recentEventBias: {
		correction: 40,
		skill_completion: 20,
		milestone: 15,
	},
	vaultQueryLimit: 8,
	recentEventLimit: 10,
	recentEventDays: 30,
};
