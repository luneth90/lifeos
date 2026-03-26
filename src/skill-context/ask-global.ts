/**
 * ask-global.ts — /ask 技能上下文画像。
 *
 * General-purpose question answering. Falls back to domain/tag matching.
 * Balanced weights with no strong type bias.
 */

import type { SeedProfileConfig } from './base.js';

export const ASK_GLOBAL: SeedProfileConfig = {
	name: 'ask_global',
	loadTaskboard: false,
	allowDomainTagFallback: true,
	rankingBias: {},
	recentEventBias: {
		decision: 20,
		correction: 20,
		preference: 10,
	},
	vaultQueryLimit: 10,
	recentEventLimit: 8,
	recentEventDays: 14,
};
