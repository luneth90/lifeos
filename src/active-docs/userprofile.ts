/**
 * userprofile.ts — UserProfile active document builder.
 *
 * Builds UserProfile sections from memory_items and vault_index data.
 * Sections: profile-summary, rules.
 */

import type Database from 'better-sqlite3';

// ─── Section builders ─────────────────────────────────────────────────────────

interface ProfileItem {
	slot_key: string;
	content: string;
}

function readStructuredProfileItems(db: Database.Database): ProfileItem[] {
	return db
		.prepare(
			`SELECT slot_key, content FROM memory_items
       WHERE status = 'active'
         AND slot_key LIKE 'profile:%'
         AND slot_key != 'profile:summary'
       ORDER BY updated_at DESC`,
		)
		.all() as ProfileItem[];
}

function formatScopedLines(items: ProfileItem[], slotPrefix: string): string[] {
	return items
		.filter((item) => item.slot_key.startsWith(slotPrefix))
		.map((item) => {
			const scope = item.slot_key.slice(slotPrefix.length);
			return scope ? `- \`${scope}\`: ${item.content}` : `- ${item.content}`;
		});
}

function collectScopedItems(
	items: ProfileItem[],
	slotPrefix: string,
	consumed: Set<string>,
): ProfileItem[] {
	const scopedItems = items.filter((item) => item.slot_key.startsWith(slotPrefix));
	for (const item of scopedItems) {
		consumed.add(item.slot_key);
	}
	return scopedItems;
}

function buildStructuredProfileSummary(items: ProfileItem[]): string {
	const sections: string[] = [];
	const consumed = new Set<string>();

	const workStyle = items.find((item) => item.slot_key === 'profile:work_style');
	if (workStyle) {
		consumed.add(workStyle.slot_key);
		sections.push(`**工作方式**\n- ${workStyle.content}`);
	}

	const weakItems = collectScopedItems(items, 'profile:weak.', consumed);
	const weakLines = formatScopedLines(weakItems, 'profile:weak.');
	if (weakLines.length > 0) {
		sections.push(`**薄弱点**\n${weakLines.join('\n')}`);
	}

	const strongItems = collectScopedItems(items, 'profile:strong.', consumed);
	const strongLines = formatScopedLines(strongItems, 'profile:strong.');
	if (strongLines.length > 0) {
		sections.push(`**已掌握**\n${strongLines.join('\n')}`);
	}

	const motivationItems = collectScopedItems(items, 'profile:motivation.', consumed);
	const motivationLines = formatScopedLines(motivationItems, 'profile:motivation.');
	if (motivationLines.length > 0) {
		sections.push(`**项目动机**\n${motivationLines.join('\n')}`);
	}

	const contextSwitch = items.find((item) => item.slot_key === 'profile:context_switch_pattern');
	if (contextSwitch) {
		consumed.add(contextSwitch.slot_key);
		sections.push(`**切换模式**\n- ${contextSwitch.content}`);
	}

	const thinkingPreference = items.find((item) => item.slot_key === 'profile:thinking_preference');
	if (thinkingPreference) {
		consumed.add(thinkingPreference.slot_key);
		sections.push(`**思考偏好**\n- ${thinkingPreference.content}`);
	}

	const otherLines = items
		.filter((item) => !consumed.has(item.slot_key))
		.map((item) => {
			const key = item.slot_key.slice('profile:'.length);
			return `- \`${key}\`: ${item.content}`;
		});
	if (otherLines.length > 0) {
		sections.push(`**其他画像**\n${otherLines.join('\n')}`);
	}

	return sections.join('\n\n').trim();
}

function buildProfileSummarySection(db: Database.Database): string {
	const structuredItems = readStructuredProfileItems(db);
	if (structuredItems.length > 0) {
		return buildStructuredProfileSummary(structuredItems);
	}

	// Priority 1: manual profile-summary in memory_items
	const item = db
		.prepare(
			`SELECT content FROM memory_items
       WHERE slot_key = 'profile:summary' AND status = 'active'
       LIMIT 1`,
		)
		.get() as { content: string } | undefined;

	if (item) {
		return item.content;
	}

	// Priority 2: auto-aggregate user portrait from DB statistics
	const lines: string[] = [];

	// Learning focus: active learning projects by domain
	const domainRows = db
		.prepare(
			`SELECT domain, COUNT(*) as cnt FROM vault_index
       WHERE type = 'project' AND category = 'learning' AND status = 'active' AND domain IS NOT NULL
       GROUP BY domain ORDER BY cnt DESC LIMIT 3`,
		)
		.all() as Array<{ domain: string; cnt: number }>;

	if (domainRows.length > 0) {
		lines.push(`**学习重心：** ${domainRows.map((r) => r.domain).join('、')}`);
	}

	if (lines.length === 0) {
		return '用户画像数据尚未积累。';
	}

	return lines.join('\n');
}

function buildRulesSection(db: Database.Database): string {
	const items = db
		.prepare(
			`SELECT slot_key, content, source FROM memory_items
       WHERE status = 'active' AND slot_key NOT LIKE 'profile:%'
       ORDER BY CASE source WHEN 'correction' THEN 0 ELSE 1 END, updated_at DESC`,
		)
		.all() as Array<{ slot_key: string; content: string; source: string }>;

	if (items.length === 0) return '暂无行为约束。';

	const lines: string[] = [];
	for (const item of items) {
		lines.push(`- **${item.slot_key}**: ${item.content}`);
	}
	return lines.join('\n');
}

// ─── buildUserprofileSections ─────────────────────────────────────────────────

/**
 * Build all UserProfile sections from DB data.
 * Returns a Record mapping section marker -> markdown content.
 */
export function buildUserprofileSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	return {
		'profile-summary': buildProfileSummarySection(db),
		rules: buildRulesSection(db),
	};
}
