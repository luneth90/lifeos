/**
 * knowledge-strict.ts — /knowledge 技能上下文画像。
 *
 * Strictly focused on knowledge notes and project files.
 * Does NOT fall back to domain tags. Heavily weights knowledge-type items.
 */

import type { SeedProfileConfig } from './base.js';

export const KNOWLEDGE_STRICT: SeedProfileConfig = {
	name: 'knowledge_strict',
	loadTaskboard: false,
	allowDomainTagFallback: false,
	rankingBias: {
		knowledge: 70,
		project: 35,
		resource: 25,
		note: 60,
	},
	recentEventBias: {
		correction: 35,
		decision: 15,
		skill_completion: 10,
	},
	vaultQueryLimit: 8,
	recentEventLimit: 8,
	recentEventDays: 30,
};
