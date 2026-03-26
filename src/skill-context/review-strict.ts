/**
 * review-strict.ts — /review 技能上下文画像。
 *
 * Strictly focused on knowledge/review items and corrections.
 * Does NOT fall back to domain tags. Heavily weights correction events.
 */

import type { SeedProfileConfig } from './base.js';

export const REVIEW_STRICT: SeedProfileConfig = {
	name: 'review_strict',
	loadTaskboard: false,
	allowDomainTagFallback: false,
	rankingBias: {
		review: 50,
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
