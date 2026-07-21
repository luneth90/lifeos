import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { buildTaskboardFocusSection, countRevisionCandidates } from '../active-docs/taskboard.js';
import { buildGlobalProfileSummary } from '../active-docs/userprofile.js';
import type { ContextBudgets, Layer0Context, ScopedMemoryItem } from '../types.js';
import { estimateTokens } from '../utils/shared.js';
import { listMemoryItems } from './memory-items.js';

function snapshot(value: unknown): string {
	return `ctx-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)}`;
}

function formatRule(item: ScopedMemoryItem): string {
	return `- **${item.slotKey}**: ${item.content}`;
}

function compareRules(a: ScopedMemoryItem, b: ScopedMemoryItem): number {
	if (a.enforcement !== b.enforcement) return a.enforcement === 'hard' ? -1 : 1;
	if (a.priority !== b.priority) return b.priority - a.priority;
	if (a.source !== b.source) return a.source === 'correction' ? -1 : 1;
	const updated = b.updatedAt.localeCompare(a.updatedAt);
	return updated || a.slotKey.localeCompare(b.slotKey);
}

function renderSections(sections: Array<{ title: string; body: string }>): string {
	return sections
		.filter((section) => section.body.trim())
		.map((section) => `## ${section.title}\n${section.body.trim()}`)
		.join('\n\n');
}

function appendTextLines(
	sections: Array<{ title: string; body: string }>,
	title: string,
	text: string,
	sectionBudget: number,
	totalBudget: number,
): { loadedLines: number; totalLines: number } {
	const sourceLines = text
		.split('\n')
		.map((candidate) => candidate.trimEnd())
		.filter(Boolean);
	if (sectionBudget <= 0 || sourceLines.length === 0) {
		return { loadedLines: 0, totalLines: sourceLines.length };
	}
	const lines: string[] = [];
	for (const line of sourceLines) {
		const body = [...lines, line].join('\n');
		if (estimateTokens(body) > sectionBudget) break;
		const candidate = renderSections([...sections, { title, body }]);
		if (estimateTokens(candidate) > totalBudget) break;
		lines.push(line);
	}
	if (lines.length) sections.push({ title, body: lines.join('\n') });
	return { loadedLines: lines.length, totalLines: sourceLines.length };
}

export function buildLayer0Context(
	db: Database.Database,
	vaultRoot: string,
	budgets: ContextBudgets,
): Layer0Context {
	void vaultRoot;
	const now = new Date().toISOString();
	const rules = listMemoryItems(db, {
		scope: { type: 'global', key: '' },
		itemKind: 'rule',
		status: 'active',
		limit: 10_000,
	})
		.filter((item) => !item.expiresAt || item.expiresAt >= now)
		.sort(compareRules);
	const hard = rules.filter((item) => item.enforcement === 'hard');
	const soft = rules.filter((item) => item.enforcement !== 'hard');
	const loaded: ScopedMemoryItem[] = [];
	const omittedSlotKeys: string[] = [];
	const oversizedItems: string[] = [];
	const warnings: string[] = [];
	const sections: Array<{ title: string; body: string }> = [];
	const singleMax = Math.max(0, budgets.single_item_max);

	for (const item of hard) {
		if (singleMax === 0 || estimateTokens(formatRule(item)) > singleMax) {
			oversizedItems.push(item.slotKey);
			warnings.push(`全局硬规则超过单条预算：${item.slotKey}`);
		}
		loaded.push(item);
	}
	for (const item of soft) {
		if (singleMax === 0 || estimateTokens(formatRule(item)) > singleMax) {
			oversizedItems.push(item.slotKey);
			continue;
		}
		const candidate = [...loaded, item];
		const ruleBody = candidate.map(formatRule).join('\n');
		const trial = renderSections([{ title: '行为约束', body: ruleBody }]);
		if (
			estimateTokens(ruleBody) > budgets.global_rules ||
			estimateTokens(trial) > budgets.layer0_total
		) {
			omittedSlotKeys.push(item.slotKey);
			continue;
		}
		loaded.push(item);
	}
	if (loaded.length) {
		sections.push({ title: '行为约束', body: loaded.map(formatRule).join('\n') });
	}
	const taskboardResult = appendTextLines(
		sections,
		'TaskBoard 当前焦点',
		buildTaskboardFocusSection(db),
		budgets.taskboard_focus,
		budgets.layer0_total,
	);
	if (taskboardResult.loadedLines < taskboardResult.totalLines) {
		warnings.push('TaskBoard 当前焦点已按预算裁剪');
	}
	const profileResult = appendTextLines(
		sections,
		'UserProfile 速览',
		buildGlobalProfileSummary(db),
		budgets.userprofile_summary,
		budgets.layer0_total,
	);
	if (profileResult.loadedLines < profileResult.totalLines) {
		warnings.push('UserProfile 速览已按预算裁剪');
	}
	const revisionCount = countRevisionCandidates(db);
	let revisionReminderLoaded = 0;
	if (revisionCount > 0) {
		const reminder = { title: '复习提醒', body: `待复习笔记：${revisionCount} 篇` };
		if (estimateTokens(renderSections([...sections, reminder])) <= budgets.layer0_total) {
			sections.push(reminder);
			revisionReminderLoaded = 1;
		} else {
			warnings.push('复习提醒因 Layer 0 总预算被省略');
		}
	}
	const text = renderSections(sections);
	const tokenEstimate = estimateTokens(text);
	if (estimateTokens(hard.map(formatRule).join('\n')) > budgets.global_rules) {
		warnings.push('全局硬规则总量超过 global_rules 预算');
	}
	if (tokenEstimate > budgets.layer0_total) {
		warnings.push('全局硬规则导致 Layer 0 超过总预算');
	}
	const meta = {
		tokenEstimate,
		tokenBudget: budgets.layer0_total,
		globalItemsTotal: rules.length,
		globalItemsLoaded: loaded.length,
		omittedSlotKeys,
		oversizedItems,
		warnings,
		sections: {
			globalRules: {
				total: rules.length,
				loaded: loaded.length,
				omitted: rules.length - loaded.length,
			},
			taskboardFocus: {
				total: taskboardResult.totalLines,
				loaded: taskboardResult.loadedLines,
				omitted: taskboardResult.totalLines - taskboardResult.loadedLines,
			},
			userprofileSummary: {
				total: profileResult.totalLines,
				loaded: profileResult.loadedLines,
				omitted: profileResult.totalLines - profileResult.loadedLines,
			},
			revisionReminder: {
				total: revisionCount > 0 ? 1 : 0,
				loaded: revisionReminderLoaded,
				omitted: revisionCount > 0 ? 1 - revisionReminderLoaded : 0,
			},
		},
	};
	return {
		text,
		snapshotId: snapshot({
			text,
			items: loaded.map((item) => [item.itemId, item.updatedAt, item.content]),
			meta,
		}),
		meta,
	};
}
