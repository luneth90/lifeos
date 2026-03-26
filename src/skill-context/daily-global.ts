/**
 * daily-global.ts — /today 技能上下文画像。
 *
 * Used for morning planning: prioritizes active projects and daily notes.
 * Taskboard is loaded. No domain/tag fallback needed.
 */

import type { SeedProfileConfig } from './base.js';

export const DAILY_GLOBAL: SeedProfileConfig = {
	name: 'daily_global',
	loadTaskboard: true,
	allowDomainTagFallback: false,
	rankingBias: {
		project: 60,
		review: 45,
		daily: 30,
	},
	recentEventBias: {
		decision: 35,
		skill_completion: 15,
		milestone: 10,
	},
	vaultQueryLimit: 10,
	recentEventLimit: 15,
	recentEventDays: 7,
};
