import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../../src/db/schema.js';
import {
	queryMemoryItems,
	queryVaultIndex,
	queryVaultIndexByDomainsOrTags,
	queryVaultIndexByPaths,
	queryVaultIndexByPrefixes,
	queryVaultIndexByTitles,
} from '../../src/services/retrieval.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	initDb(db);
	return db;
}

function insertVaultNote(
	db: Database.Database,
	opts: {
		filePath: string;
		title: string;
		type?: string;
		status?: string;
		domain?: string;
		summary?: string;
		semanticSummary?: string;
		searchHints?: string;
		tags?: string;
		aliases?: string;
		wikilinks?: string;
		backlinks?: string;
		modifiedAt?: string;
	},
): void {
	db.prepare(`
    INSERT INTO vault_index (
      file_path, title, type, status, domain, summary,
      semantic_summary, search_hints, tags, aliases, wikilinks, backlinks, modified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		opts.filePath,
		opts.title,
		opts.type ?? 'knowledge',
		opts.status ?? 'draft',
		opts.domain ?? null,
		opts.summary ?? null,
		opts.semanticSummary ?? null,
		opts.searchHints ?? null,
		opts.tags ?? null,
		opts.aliases ?? null,
		opts.wikilinks ?? null,
		opts.backlinks ?? null,
		opts.modifiedAt ?? new Date().toISOString(),
	);
}

// ─── queryVaultIndex ──────────────────────────────────────────────────────────

describe('queryVaultIndex', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('FTS5 search returns matching results', () => {
		insertVaultNote(db, {
			filePath: '20_项目/my-project.md',
			title: 'TypeScript Project',
			type: 'project',
			summary: 'A TypeScript migration project',
			searchHints: 'typescript migration',
		});
		insertVaultNote(db, {
			filePath: '40_知识/unrelated.md',
			title: 'Unrelated Note',
			summary: 'Something else entirely',
		});

		const { results } = queryVaultIndex(db, 'TypeScript', null, 10);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].filePath).toBe('20_项目/my-project.md');
	});

	it.each([
		['type', { type: 'project' }, '20_项目/proj.md'],
		['status', { status: 'active' }, '20_项目/active.md'],
		['domain', { domain: 'Math' }, '40_知识/math.md'],
	] as const)('exact filter on %s works when no query', (_field, filter, expectedPath) => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Project Note', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/wiki.md', title: 'Wiki Note', type: 'knowledge' });
		insertVaultNote(db, {
			filePath: '20_项目/active.md',
			title: 'Active Project',
			type: 'project',
			status: 'active',
		});
		insertVaultNote(db, {
			filePath: '20_项目/done.md',
			title: 'Done Project',
			type: 'project',
			status: 'done',
		});
		insertVaultNote(db, { filePath: '40_知识/math.md', title: 'Math Note', domain: 'Math' });
		insertVaultNote(db, {
			filePath: '40_知识/history.md',
			title: 'History Note',
			domain: 'History',
		});

		const { results } = queryVaultIndex(db, '', filter, 10);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.map((r) => r.filePath)).toContain(expectedPath);
		expect(results[0].matchSource).toBe('exact_filter');
	});

	it('Chinese query gets tokenized and matched', () => {
		insertVaultNote(db, {
			filePath: '40_知识/quaternion.md',
			title: '四元数笔记',
			summary: '四元数是一种扩展复数的数学工具',
			searchHints: '四元数 旋转 群论',
		});
		insertVaultNote(db, {
			filePath: '40_知识/linear.md',
			title: '线性代数',
			summary: '矩阵和向量空间',
		});

		const { results } = queryVaultIndex(db, '四元数', null, 10);
		expect(results.length).toBeGreaterThan(0);
		const paths = results.map((r) => r.filePath);
		expect(paths).toContain('40_知识/quaternion.md');
	});

	it('returns empty array for no match', () => {
		insertVaultNote(db, {
			filePath: '40_知识/note.md',
			title: 'A Note',
			summary: 'Something',
		});

		const { results } = queryVaultIndex(db, 'xyzzy_nonexistent_term', null, 10);
		expect(results).toHaveLength(0);
	});

	it('respects limit', () => {
		for (let i = 0; i < 5; i++) {
			insertVaultNote(db, {
				filePath: `40_知识/note-${i}.md`,
				title: `Note ${i}`,
				type: 'knowledge',
				summary: 'common search term shared',
			});
		}

		const { results } = queryVaultIndex(db, 'common', null, 3);
		expect(results.length).toBeLessThanOrEqual(3);
	});

	it('result has expected fields', () => {
		insertVaultNote(db, {
			filePath: '20_项目/proj.md',
			title: 'My Project',
			type: 'project',
			status: 'active',
			domain: 'Engineering',
			summary: 'Engineering project summary',
			tags: '["ts", "node"]',
			modifiedAt: '2025-01-01T00:00:00Z',
		});

		const { results } = queryVaultIndex(db, '', { type: 'project' }, 10);
		expect(results.length).toBe(1);
		const r = results[0];
		expect(r.filePath).toBe('20_项目/proj.md');
		expect(r.title).toBe('My Project');
		expect(r.type).toBe('project');
		expect(r.status).toBe('active');
		expect(r.domain).toBe('Engineering');
		expect(r.score).toBeGreaterThan(0);
		expect(r.matchSource).toBeTruthy();
		expect(Array.isArray(r.matchedFields)).toBe(true);
		expect(r.displaySummary).toBeTruthy();
		expect(r.modifiedAt).toBe('2025-01-01T00:00:00Z');
	});

	it('query + filter combination works', () => {
		insertVaultNote(db, {
			filePath: '20_项目/ts-project.md',
			title: 'TypeScript Project',
			type: 'project',
			summary: 'TypeScript node project',
		});
		insertVaultNote(db, {
			filePath: '40_知识/ts-note.md',
			title: 'TypeScript Notes',
			type: 'knowledge',
			summary: 'TypeScript knowledge',
		});

		const { results } = queryVaultIndex(db, 'TypeScript', { type: 'project' }, 10);
		expect(results.every((r) => r.type === 'project')).toBe(true);
	});

	it('returns empty for no query and no filters', () => {
		insertVaultNote(db, {
			filePath: '40_知识/note.md',
			title: 'A Note',
		});

		const { results } = queryVaultIndex(db, '', null, 10);
		expect(results).toHaveLength(0);
	});
});

// ─── queryVaultIndexByPaths ───────────────────────────────────────────────────

describe('queryVaultIndexByPaths', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns results matching given paths', () => {
		insertVaultNote(db, { filePath: '20_项目/proj-a.md', title: 'Project A', type: 'project' });
		insertVaultNote(db, { filePath: '20_项目/proj-b.md', title: 'Project B', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'Note', type: 'knowledge' });

		const { results } = queryVaultIndexByPaths(db, ['20_项目/proj-a.md', '40_知识/note.md']);
		expect(results.length).toBe(2);
		const paths = results.map((r) => r.filePath);
		expect(paths).toContain('20_项目/proj-a.md');
		expect(paths).toContain('40_知识/note.md');
	});

	it('returns empty for empty paths array', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Project', type: 'project' });
		const { results } = queryVaultIndexByPaths(db, []);
		expect(results).toHaveLength(0);
	});

	it('returns results in requested order', () => {
		insertVaultNote(db, { filePath: '20_项目/proj-a.md', title: 'Project A', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'Note', type: 'knowledge' });
		insertVaultNote(db, { filePath: '20_项目/proj-b.md', title: 'Project B', type: 'project' });

		const requestedPaths = ['40_知识/note.md', '20_项目/proj-a.md', '20_项目/proj-b.md'];
		const { results } = queryVaultIndexByPaths(db, requestedPaths);
		expect(results.length).toBe(3);
		expect(results[0].filePath).toBe('40_知识/note.md');
		expect(results[1].filePath).toBe('20_项目/proj-a.md');
		expect(results[2].filePath).toBe('20_项目/proj-b.md');
	});
});

// ─── queryVaultIndexByTitles ──────────────────────────────────────────────────

describe('queryVaultIndexByTitles', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns results matching given titles', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'My Project', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'My Note', type: 'knowledge' });
		insertVaultNote(db, { filePath: '40_知识/other.md', title: 'Other', type: 'knowledge' });

		const { results } = queryVaultIndexByTitles(db, ['My Project', 'My Note']);
		expect(results.length).toBe(2);
		const titles = results.map((r) => r.title);
		expect(titles).toContain('My Project');
		expect(titles).toContain('My Note');
	});

	it('filters by pathPrefix', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Shared Title', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'Shared Title', type: 'knowledge' });

		const { results } = queryVaultIndexByTitles(db, ['Shared Title'], '40_知识/');
		expect(results.length).toBe(1);
		expect(results[0].filePath).toBe('40_知识/note.md');
	});

	it('returns empty for empty titles array', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Project', type: 'project' });
		const { results } = queryVaultIndexByTitles(db, []);
		expect(results).toHaveLength(0);
	});
});

// ─── queryVaultIndexByPrefixes ────────────────────────────────────────────────

describe('queryVaultIndexByPrefixes', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns notes matching path prefix', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Project', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'Note', type: 'knowledge' });

		const { results } = queryVaultIndexByPrefixes(db, { prefixes: ['20_项目/'], limit: 10 });
		expect(results.length).toBe(1);
		expect(results[0].filePath).toBe('20_项目/proj.md');
	});

	it('returns notes matching multiple prefixes', () => {
		insertVaultNote(db, { filePath: '20_项目/proj.md', title: 'Project', type: 'project' });
		insertVaultNote(db, { filePath: '40_知识/note.md', title: 'Note', type: 'knowledge' });
		insertVaultNote(db, { filePath: '00_草稿/draft.md', title: 'Draft', type: 'draft' });

		const { results } = queryVaultIndexByPrefixes(db, {
			prefixes: ['20_项目/', '40_知识/'],
			limit: 10,
		});
		expect(results.length).toBe(2);
		const paths = results.map((r) => r.filePath);
		expect(paths).toContain('20_项目/proj.md');
		expect(paths).toContain('40_知识/note.md');
	});

	it('filters by type within prefixes', () => {
		insertVaultNote(db, { filePath: '40_知识/wiki.md', title: 'Wiki', type: 'knowledge' });
		insertVaultNote(db, { filePath: '40_知识/revise.md', title: 'Revise', type: 'revise-record' });

		const { results } = queryVaultIndexByPrefixes(db, {
			prefixes: ['40_知识/'],
			typeFilter: 'knowledge',
			limit: 10,
		});
		expect(results.length).toBe(1);
		expect(results[0].filePath).toBe('40_知识/wiki.md');
	});
});

// ─── queryVaultIndexByDomainsOrTags ──────────────────────────────────────────

describe('queryVaultIndexByDomainsOrTags', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns notes matching domain', () => {
		insertVaultNote(db, { filePath: '40_知识/math.md', title: 'Math Note', domain: 'Math' });
		insertVaultNote(db, {
			filePath: '40_知识/history.md',
			title: 'History Note',
			domain: 'History',
		});

		const { results } = queryVaultIndexByDomainsOrTags(db, { domains: ['Math'], limit: 10 });
		expect(results.length).toBe(1);
		expect(results[0].domain).toBe('Math');
	});

	it('returns notes matching tags', () => {
		insertVaultNote(db, {
			filePath: '40_知识/ts-note.md',
			title: 'TypeScript Note',
			tags: '["typescript", "node"]',
		});
		insertVaultNote(db, { filePath: '40_知识/other.md', title: 'Other', tags: '["python"]' });

		const { results } = queryVaultIndexByDomainsOrTags(db, { tags: ['typescript'], limit: 10 });
		expect(results.length).toBe(1);
		expect(results[0].filePath).toBe('40_知识/ts-note.md');
	});

	it('combines domains and tags with OR logic', () => {
		insertVaultNote(db, {
			filePath: '40_知识/math.md',
			title: 'Math Note',
			domain: 'Math',
			tags: '["algebra"]',
		});
		insertVaultNote(db, {
			filePath: '40_知识/ts-note.md',
			title: 'TypeScript Note',
			domain: 'Engineering',
			tags: '["typescript"]',
		});
		insertVaultNote(db, {
			filePath: '40_知识/other.md',
			title: 'Other',
			domain: 'Biology',
			tags: '["cells"]',
		});

		const { results } = queryVaultIndexByDomainsOrTags(db, {
			domains: ['Math'],
			tags: ['typescript'],
			limit: 10,
		});
		expect(results.length).toBe(2);
		const paths = results.map((r) => r.filePath);
		expect(paths).toContain('40_知识/math.md');
		expect(paths).toContain('40_知识/ts-note.md');
	});
});

// ─── queryMemoryItems ─────────────────────────────────────────────────────────

describe('queryMemoryItems', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	function insertMemoryItem(
		db: Database.Database,
		opts: {
			slotKey: string;
			content: string;
			source?: string;
			status?: string;
			updatedAt?: string;
		},
	): void {
		db.prepare(`
      INSERT INTO memory_items (slot_key, content, source, status, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
			opts.slotKey,
			opts.content,
			opts.source ?? 'preference',
			opts.status ?? 'active',
			opts.updatedAt ?? new Date().toISOString(),
		);
	}

	it('returns active memory items', () => {
		insertMemoryItem(db, {
			slotKey: 'format:note-style',
			content: 'Prefer concise notes',
			status: 'active',
		});
		insertMemoryItem(db, {
			slotKey: 'format:commit-msg',
			content: 'Use conventional commits',
			status: 'expired',
		});

		const { items } = queryMemoryItems(db, { statusFilter: 'active' });
		expect(items.length).toBe(1);
		expect(items[0].slotKey).toBe('format:note-style');
	});

	it('filters by slot_key', () => {
		insertMemoryItem(db, { slotKey: 'format:style', content: 'Concise style' });
		insertMemoryItem(db, { slotKey: 'workflow:tdd', content: 'Use TDD' });

		const { items } = queryMemoryItems(db, { slotKey: 'format:style' });
		expect(items.length).toBe(1);
		expect(items[0].slotKey).toBe('format:style');
	});

	it('supports pattern matching with %', () => {
		insertMemoryItem(db, { slotKey: 'format:style', content: 'Concise style' });
		insertMemoryItem(db, { slotKey: 'format:commit', content: 'Commit style' });
		insertMemoryItem(db, { slotKey: 'workflow:tdd', content: 'Use TDD' });

		const { items } = queryMemoryItems(db, { slotKey: 'format:%' });
		expect(items.length).toBe(2);
	});

	it('returns all items when no filters', () => {
		insertMemoryItem(db, { slotKey: 'format:style', content: 'Active item', status: 'active' });
		insertMemoryItem(db, { slotKey: 'format:old-style', content: 'Old item', status: 'expired' });

		const { items } = queryMemoryItems(db, {});
		expect(items.length).toBe(2);
	});

	it('returns memory item with expected fields', () => {
		insertMemoryItem(db, {
			slotKey: 'format:note-style',
			content: 'Prefer bullet points',
			source: 'correction',
		});

		const { items } = queryMemoryItems(db, {});
		expect(items.length).toBe(1);
		const item = items[0];
		expect(item.slotKey).toBe('format:note-style');
		expect(item.content).toBe('Prefer bullet points');
		expect(item.source).toBe('correction');
		expect(item.status).toBe('active');
		expect(typeof item.manualFlag).toBe('boolean');
		expect(typeof item.updatedAt).toBe('string');
	});
});
