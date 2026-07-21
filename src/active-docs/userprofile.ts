import type Database from 'better-sqlite3';
import { listMemoryItems } from '../services/memory-items.js';
import type { ScopedMemoryItem } from '../types.js';

function globalProfileItems(db: Database.Database): ScopedMemoryItem[] {
	return listMemoryItems(db, {
		scope: { type: 'global', key: '' },
		itemKind: 'profile',
		status: 'active',
		limit: 10_000,
	});
}

function prefixedItems(items: ScopedMemoryItem[], prefix: string, used: Set<number>): string[] {
	return items
		.filter((item) => item.slotKey.startsWith(prefix))
		.map((item) => {
			used.add(item.itemId);
			const key = item.slotKey.slice(prefix.length);
			return key ? `- \`${key}\`: ${item.content}` : `- ${item.content}`;
		});
}

function structuredSummary(items: ScopedMemoryItem[]): string {
	const sections: string[] = [];
	const used = new Set<number>();
	const single = (key: string, title: string) => {
		const item = items.find((candidate) => candidate.slotKey === key);
		if (item) {
			used.add(item.itemId);
			sections.push(`**${title}**\n- ${item.content}`);
		}
	};
	single('profile:work_style', '工作方式');
	for (const [prefix, title] of [
		['profile:weak.', '薄弱点'],
		['profile:strong.', '已掌握'],
		['profile:motivation.', '项目动机'],
	] as const) {
		const lines = prefixedItems(items, prefix, used);
		if (lines.length) sections.push(`**${title}**\n${lines.join('\n')}`);
	}
	single('profile:context_switch_pattern', '切换模式');
	single('profile:thinking_preference', '思考偏好');
	const other = items
		.filter((item) => !used.has(item.itemId))
		.map((item) => `- \`${item.slotKey.slice('profile:'.length)}\`: ${item.content}`);
	if (other.length) sections.push(`**其他画像**\n${other.join('\n')}`);
	return sections.join('\n\n');
}

export function buildGlobalProfileSummary(db: Database.Database): string {
	const items = globalProfileItems(db);
	if (items.length) return structuredSummary(items);
	const domains = db
		.prepare(`
			SELECT domain, COUNT(*) AS count
			FROM vault_index
			WHERE type = 'project' AND category = 'learning'
			  AND status = 'active' AND domain IS NOT NULL
			GROUP BY domain
			ORDER BY count DESC
			LIMIT 3
		`)
		.all() as Array<{ domain: string; count: number }>;
	return domains.length
		? `**学习重心：** ${domains.map((row) => row.domain).join('、')}`
		: '用户画像数据尚未积累。';
}

export function buildGlobalRulesSection(db: Database.Database): string {
	const items = listMemoryItems(db, {
		scope: { type: 'global', key: '' },
		itemKind: 'rule',
		status: 'active',
		limit: 10_000,
	});
	return items.length
		? items.map((item) => `- **${item.slotKey}**: ${item.content}`).join('\n')
		: '暂无全局行为约束。';
}

export function buildScopedRulesIndexSection(db: Database.Database): string {
	const rows = db
		.prepare(`
			SELECT scope_type, scope_key, COUNT(*) AS item_count, MAX(updated_at) AS updated_at
			FROM memory_items
			WHERE status = 'active' AND scope_type != 'global'
			GROUP BY scope_type, scope_key
			ORDER BY scope_type, scope_key
		`)
		.all() as Array<{
		scope_type: string;
		scope_key: string;
		item_count: number;
		updated_at: string;
	}>;
	return rows.length
		? rows
				.map(
					(row) =>
						`- **${row.scope_type}:${row.scope_key}**：${row.item_count} 条 | 更新：${row.updated_at.slice(0, 10)}`,
				)
				.join('\n')
		: '暂无作用域记忆。';
}

export function buildUserprofileSections(
	db: Database.Database,
	_vaultRoot: string,
): Record<string, string> {
	return {
		'profile-summary': buildGlobalProfileSummary(db),
		'global-rules': buildGlobalRulesSection(db),
		'scoped-rules-index': buildScopedRulesIndexSection(db),
	};
}
