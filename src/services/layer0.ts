/**
 * layer0.ts — Layer 0 context summary builder.
 *
 * Builds the Layer 0 summary from UserProfile.md and TaskBoard.md,
 * trimmed to configured token budgets.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVaultConfig, resolveConfig } from '../config.js';
import { estimateTokens } from '../utils/shared.js';

// ─── extractAutoSection ───────────────────────────────────────────────────────

/**
 * Extract the content between <!-- BEGIN AUTO:marker --> and <!-- END AUTO:marker -->
 * comment blocks in a markdown document. Returns empty string if not found.
 */
export function extractAutoSection(content: string, marker: string): string {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`<!-- BEGIN AUTO:${escaped} -->\\n(.*?)\\n<!-- END AUTO:${escaped} -->`,
		's',
	);
	const match = content.match(pattern);
	return match ? match[1].trim() : '';
}

// ─── trimToBudget ─────────────────────────────────────────────────────────────

/**
 * Trim text to at most `budget` estimated tokens.
 * Returns empty string when budget is 0 or text is blank.
 * Appends '...' continuation marker when text is cut.
 */
export function trimToBudget(text: string, budget: number): string {
	if (budget <= 0 || !text.trim()) return '';
	if (estimateTokens(text) <= budget) return text.trim();

	const pieces: string[] = [];
	let current = 0;
	for (const line of text.split('\n')) {
		const cleanLine = line.trimEnd();
		if (!cleanLine) continue;
		const lineTokens = estimateTokens(cleanLine);
		if (current + lineTokens > budget) {
			if (pieces.length === 0) return `${cleanLine.slice(0, Math.max(1, budget))}...`;
			break;
		}
		pieces.push(cleanLine);
		current += lineTokens;
	}
	if (pieces.length === 0) return '';
	const trimmed = pieces.join('\n').trim();
	return trimmed !== text.trim() ? `${trimmed}\n- ...` : trimmed;
}

// ─── buildLayer0Summary ───────────────────────────────────────────────────────

/**
 * Build the Layer 0 summary string from UserProfile.md and TaskBoard.md.
 * Reads AUTO sections and trims to configured token budgets.
 */
export function buildLayer0Summary(vaultRoot: string): string {
	const vc = getVaultConfig() ?? resolveConfig(vaultRoot);
	const memoryDir = vc.memoryDir();
	const budgets = vc.contextBudgets();

	const upPath = join(memoryDir, 'UserProfile.md');
	const tbPath = join(memoryDir, 'TaskBoard.md');

	const upContent = existsSync(upPath) ? readFileSync(upPath, 'utf-8') : '';
	const tbContent = existsSync(tbPath) ? readFileSync(tbPath, 'utf-8') : '';

	const upBudget = Number(budgets.userprofile_summary ?? 200);
	const rulesBudget = Number(budgets.userprofile_rules ?? 1000);
	const tbBudget = Number(budgets.taskboard_focus ?? 500);
	const totalBudget = Number(budgets.layer0_total ?? 1800);

	let upSummary = trimToBudget(extractAutoSection(upContent, 'profile-summary'), upBudget);

	// Rules section (unified preferences + corrections)
	const rulesRaw = extractAutoSection(upContent, 'rules');
	let upRules = trimToBudget(rulesRaw, rulesBudget);

	let tbFocus = trimToBudget(extractAutoSection(tbContent, 'focus'), tbBudget);

	// Revises summary
	const revisesRaw = extractAutoSection(tbContent, 'revises');
	const revisesCount = (revisesRaw.match(/^- /gm) || []).length;
	const revisesLine = revisesCount > 0 ? `待复习笔记：${revisesCount} 篇` : '';

	// Total budget trimming (priority: rules > focus > summary)
	const combined = estimateTokens(upSummary) + estimateTokens(upRules) + estimateTokens(tbFocus);
	if (combined > totalBudget) {
		upSummary = trimToBudget(upSummary, Math.min(upBudget, Math.floor(totalBudget * 0.1)));
		const remaining = totalBudget - estimateTokens(upSummary);
		upRules = trimToBudget(upRules, Math.min(rulesBudget, Math.floor(remaining * 0.55)));
		tbFocus = trimToBudget(tbFocus, remaining - estimateTokens(upRules));
	}

	const sections: string[] = [];
	if (upSummary) sections.push(`## UserProfile 速览\n${upSummary}`);
	if (upRules) sections.push(`## 行为约束\n${upRules}`);
	if (tbFocus) sections.push(`## TaskBoard 当前焦点\n${tbFocus}`);
	if (revisesLine) sections.push(`## 复习提醒\n${revisesLine}`);
	return sections.join('\n\n').trim();
}
