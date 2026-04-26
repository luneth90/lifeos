import { unlinkSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultConfig, _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import {
	fullScan,
	indexSingleFile,
	parseMarkdown,
	shouldIndex,
} from '../../src/utils/vault-indexer.js';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let vault: TempVault;
let db: Database.Database;

beforeEach(() => {
	vault = createTempVault();
	db = createTestDb(vault.dbPath);
	initDb(db);
});

afterEach(() => {
	db.close();
	vault.cleanup();
	_resetDefaultInstance();
});

// ─── shouldIndex ──────────────────────────────────────────────────────────────

describe('shouldIndex()', () => {
	it('returns false for non-.md files', () => {
		const config = new VaultConfig(vault.root);
		expect(shouldIndex('00_草稿/note.txt', config)).toBe(false);
		expect(shouldIndex('00_草稿/image.png', config)).toBe(false);
		expect(shouldIndex('00_草稿/data.json', config)).toBe(false);
	});

	it('returns true for .md files under scan_prefixes', () => {
		const config = new VaultConfig(vault.root);
		expect(shouldIndex('00_草稿/note.md', config)).toBe(true);
		expect(shouldIndex('20_项目/my-project.md', config)).toBe(true);
		expect(shouldIndex('40_知识/笔记/Math/algebra.md', config)).toBe(true);
	});

	it('returns false for .md files under excluded_prefixes', () => {
		const config = new VaultConfig(vault.root);
		expect(shouldIndex('90_系统/模板/Daily_Template.md', config)).toBe(false);
		expect(shouldIndex('90_系统/规范/Frontmatter_Schema.md', config)).toBe(false);
	});

	it('returns false for .md files not matching any prefix', () => {
		const config = new VaultConfig(vault.root);
		expect(shouldIndex('some-root-file.md', config)).toBe(false);
		expect(shouldIndex('unknown_dir/note.md', config)).toBe(false);
	});

	it('works without config argument (no global config)', () => {
		// Without config, should return false since no scan rules available
		// The function should handle undefined config gracefully
		expect(() => shouldIndex('00_草稿/note.md')).not.toThrow();
	});
});

// ─── parseMarkdown ────────────────────────────────────────────────────────────

describe('parseMarkdown()', () => {
	it('returns null for files without frontmatter', () => {
		expect(parseMarkdown('# Just a title\n\nsome content', 'note.md')).toBeNull();
		expect(parseMarkdown('plain text', 'note.md')).toBeNull();
		expect(parseMarkdown('', 'note.md')).toBeNull();
	});

	it('returns null for incomplete frontmatter delimiter', () => {
		expect(parseMarkdown('---\ntitle: test\n', 'note.md')).toBeNull();
	});

	it('returns null for empty frontmatter', () => {
		expect(parseMarkdown('---\n---\n\nbody', 'note.md')).toBeNull();
	});

	it('parses basic frontmatter fields', () => {
		const content = `---
title: "My Note"
type: project
status: active
domain: "[[Math]]"
category: learning
---

This is the body.`;
		const result = parseMarkdown(content, 'my-note.md');
		expect(result).not.toBeNull();
		expect(result!.title).toBe('My Note');
		expect(result!.type).toBe('project');
		expect(result!.status).toBe('active');
		expect(result!.domain).toBe('[[Math]]');
		expect(result!.category).toBe('learning');
	});

	it('falls back to file stem for title when title is absent', () => {
		const content = `---
type: draft
status: pending
---

body content`;
		const result = parseMarkdown(content, 'my-draft-note.md');
		expect(result).not.toBeNull();
		expect(result!.title).toBe('my-draft-note');
	});

	it('handles tags as array', () => {
		const content = `---
title: test
tags: [math, algebra, linear]
---`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const tags = JSON.parse(result!.tags);
		expect(tags).toEqual(['math', 'algebra', 'linear']);
	});

	it('handles tags as single string', () => {
		const content = `---
title: test
tags: math
---`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const tags = JSON.parse(result!.tags);
		expect(tags).toEqual(['math']);
	});

	it('handles missing tags as empty array', () => {
		const content = `---
title: test
---`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const tags = JSON.parse(result!.tags);
		expect(tags).toEqual([]);
	});

	it('handles aliases as array', () => {
		const content = `---
title: test
aliases: [alias1, alias2]
---`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const aliases = JSON.parse(result!.aliases);
		expect(aliases).toEqual(['alias1', 'alias2']);
	});

	it('extracts wikilinks from body', () => {
		const content = `---
title: test
---

This references [[ProjectA]] and [[Math/Algebra]] and also [[Note With Spaces]].`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const wikilinks = JSON.parse(result!.wikilinks);
		expect(wikilinks).toContain('ProjectA');
		expect(wikilinks).toContain('Math/Algebra');
		expect(wikilinks).toContain('Note With Spaces');
	});

	it('normalizes wikilink aliases and headings', () => {
		const content = `---
title: test
---

This references [[ProjectA|项目 A]] and [[Math/Algebra#定义]].`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const wikilinks = JSON.parse(result!.wikilinks);
		expect(wikilinks).toContain('ProjectA');
		expect(wikilinks).toContain('Math/Algebra');
		expect(wikilinks).not.toContain('ProjectA|项目 A');
		expect(wikilinks).not.toContain('Math/Algebra#定义');
	});

	it('extracts section_heads from body', () => {
		const content = `---
title: test
---

## Introduction
Some text.
### Sub section
More text.
# Top Level`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		const heads = JSON.parse(result!.sectionHeads);
		expect(heads).toContain('Introduction');
		expect(heads).toContain('Sub section');
		expect(heads).toContain('Top Level');
	});

	it('generates summary truncated to 500 chars, content_hash, search_hints, and default fields', () => {
		const longBody = 'A'.repeat(600);
		const content = `---
title: 线性代数笔记
tags: [math, algebra]
---

${longBody}`;
		const result = parseMarkdown(content, 'test.md');
		expect(result).not.toBeNull();
		// summary truncation
		expect(result!.summary.length).toBeLessThanOrEqual(500);
		// content_hash is 32-char hex
		expect(result!.contentHash).toMatch(/^[0-9a-f]{32}$/);
		// search_hints from segmenter
		expect(typeof result!.searchHints).toBe('string');
		expect(result!.searchHints.length).toBeGreaterThan(0);
		// backlinks default to empty array
		expect(JSON.parse(result!.backlinks)).toEqual([]);
	});
});

// ─── fullScan ─────────────────────────────────────────────────────────────────

describe('fullScan()', () => {
	it('scans and indexes markdown files in included directories', () => {
		writeTestNote(
			vault.root,
			'00_草稿/note1.md',
			{ title: 'Note 1', type: 'draft', status: 'pending' },
			'Draft content',
		);
		writeTestNote(
			vault.root,
			'20_项目/project1.md',
			{ title: 'Project 1', type: 'project', status: 'active' },
			'Project content',
		);
		writeTestNote(
			vault.root,
			'40_知识/笔记/Math/algebra.md',
			{ title: 'Algebra', type: 'note', status: 'draft' },
			'Knowledge content',
		);

		const result = fullScan(vault.root, vault.dbPath);

		expect(result.indexed).toBe(3);
		expect(result.skipped).toBeGreaterThanOrEqual(0);

		// Verify DB contains the indexed files
		const rows = db
			.prepare('SELECT file_path, title FROM vault_index ORDER BY file_path')
			.all() as Array<{ file_path: string; title: string }>;
		expect(rows).toHaveLength(3);
		const paths = rows.map((r) => r.file_path);
		expect(paths).toContain('00_草稿/note1.md');
		expect(paths).toContain('20_项目/project1.md');
		expect(paths).toContain('40_知识/笔记/Math/algebra.md');
	});

	it('skips files in excluded directories', () => {
		writeTestNote(vault.root, '90_系统/模板/Daily_Template.md', {
			title: 'Template',
			type: 'template',
		});
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});

		const result = fullScan(vault.root, vault.dbPath);

		expect(result.indexed).toBe(1);
		const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
			file_path: string;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].file_path).toBe('00_草稿/note.md');
	});

	it('skips files without valid frontmatter', () => {
		// Write a plain markdown file (no frontmatter)
		const { writeFileSync } = require('fs');
		writeFileSync(
			join(vault.root, '00_草稿/no-frontmatter.md'),
			'# Just a title\n\nno frontmatter here',
			'utf-8',
		);
		writeTestNote(vault.root, '00_草稿/with-frontmatter.md', {
			title: 'Valid',
			type: 'draft',
			status: 'pending',
		});

		const result = fullScan(vault.root, vault.dbPath);

		expect(result.indexed).toBe(1);
		const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
			file_path: string;
		}>;
		expect(rows[0].file_path).toBe('00_草稿/with-frontmatter.md');
	});

	it('returns counts with zero when vault is empty', () => {
		const result = fullScan(vault.root, vault.dbPath);
		expect(result.indexed).toBe(0);
		expect(result.skipped).toBe(0);
	});

	it('accepts VaultConfig as optional third argument', () => {
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});
		const config = new VaultConfig(vault.root);
		const result = fullScan(vault.root, vault.dbPath, config);
		expect(result.indexed).toBe(1);
	});

	it('removes stale index entries for deleted files', () => {
		writeTestNote(vault.root, '00_草稿/keep.md', {
			title: 'Keep',
			type: 'draft',
			status: 'pending',
		});
		writeTestNote(vault.root, '00_草稿/delete-me.md', {
			title: 'Delete',
			type: 'draft',
			status: 'pending',
		});

		// First scan indexes both
		const first = fullScan(vault.root, vault.dbPath);
		expect(first.indexed).toBe(2);
		expect(first.unchanged).toBe(0);
		expect(first.removed).toBe(0);

		// Delete one file, then rescan — keep.md is unchanged (incremental skip)
		unlinkSync(join(vault.root, '00_草稿/delete-me.md'));
		const second = fullScan(vault.root, vault.dbPath);

		expect(second.unchanged).toBe(1);
		expect(second.removed).toBe(1);

		const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
			file_path: string;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].file_path).toBe('00_草稿/keep.md');
	});

	it('does not remove entries for inaccessible files (non-ENOENT errors)', () => {
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});

		// Index the file
		fullScan(vault.root, vault.dbPath);

		// Make the file's parent directory unreadable so walkMdFiles skips it,
		// but the file still exists on disk — prune must NOT delete the row.
		const { chmodSync } = require('fs');
		const dir = join(vault.root, '00_草稿');
		chmodSync(dir, 0o000);

		try {
			const result = fullScan(vault.root, vault.dbPath);
			// Walk couldn't enter the directory, so nothing was indexed
			expect(result.indexed).toBe(0);
			// But the row must survive because the file still exists (EACCES, not ENOENT)
			expect(result.removed).toBe(0);

			const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
				file_path: string;
			}>;
			expect(rows).toHaveLength(1);
		} finally {
			chmodSync(dir, 0o755);
		}
	});

	it('returns removed count of zero when no stale entries exist', () => {
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});
		const result = fullScan(vault.root, vault.dbPath);
		expect(result.removed).toBe(0);
	});

	it('prunes stale row when the last file in the vault is deleted', () => {
		writeTestNote(vault.root, '00_草稿/only-file.md', {
			title: 'Only',
			type: 'draft',
			status: 'pending',
		});

		// Index the single file
		const first = fullScan(vault.root, vault.dbPath);
		expect(first.indexed).toBe(1);

		// Delete the only file — vault directories still exist, just no .md files
		unlinkSync(join(vault.root, '00_草稿/only-file.md'));
		const second = fullScan(vault.root, vault.dbPath);

		expect(second.indexed).toBe(0);
		expect(second.removed).toBe(1);

		const rows = db.prepare('SELECT file_path FROM vault_index').all();
		expect(rows).toHaveLength(0);
	});

	it('skips pruning entirely when vault root is inaccessible', () => {
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});

		// Index the file
		fullScan(vault.root, vault.dbPath);

		// Point fullScan at a non-existent vault root — simulates unmounted volume.
		// Without the safety guard this would ENOENT every file and purge all rows.
		const bogusRoot = join(vault.root, '__does_not_exist__');
		const result = fullScan(bogusRoot, vault.dbPath);

		expect(result.indexed).toBe(0);
		expect(result.removed).toBe(0);

		// Original row must survive
		const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
			file_path: string;
		}>;
		expect(rows).toHaveLength(1);
	});

	it('skips pruning when vault root is readable but empty (stale mountpoint)', () => {
		const { mkdirSync } = require('fs');
		writeTestNote(vault.root, '00_草稿/note.md', {
			title: 'Note',
			type: 'draft',
			status: 'pending',
		});

		// Index the file
		fullScan(vault.root, vault.dbPath);

		// Create an empty directory to simulate a readable but empty mountpoint
		const emptyRoot = join(vault.root, '__empty_mount__');
		mkdirSync(emptyRoot);
		const result = fullScan(emptyRoot, vault.dbPath);

		expect(result.indexed).toBe(0);
		// Walk found zero files → pruning must be skipped
		expect(result.removed).toBe(0);

		// Original row must survive
		const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{
			file_path: string;
		}>;
		expect(rows).toHaveLength(1);
	});

	it('computes backlinks by title, path stem, and alias', () => {
		writeTestNote(
			vault.root,
			'20_项目/target-file.md',
			{ title: 'Target Note', type: 'project', status: 'active', aliases: ['目标别名'] },
			'Target content',
		);
		writeTestNote(
			vault.root,
			'00_草稿/source.md',
			{ title: 'Source', type: 'draft', status: 'pending' },
			'Links: [[Target Note]] [[20_项目/target-file]] [[目标别名|显示名称]].',
		);

		fullScan(vault.root, vault.dbPath);

		const row = db
			.prepare('SELECT backlinks FROM vault_index WHERE file_path = ?')
			.get('20_项目/target-file.md') as { backlinks: string };
		expect(JSON.parse(row.backlinks)).toEqual(['00_草稿/source.md']);
	});

	it('removes stale backlinks after linked source file is deleted', () => {
		writeTestNote(vault.root, '20_项目/target.md', {
			title: 'Target',
			type: 'project',
			status: 'active',
		});
		writeTestNote(
			vault.root,
			'00_草稿/source.md',
			{ title: 'Source', type: 'draft', status: 'pending' },
			'[[Target]]',
		);

		fullScan(vault.root, vault.dbPath);
		unlinkSync(join(vault.root, '00_草稿/source.md'));
		fullScan(vault.root, vault.dbPath);

		const row = db
			.prepare('SELECT backlinks FROM vault_index WHERE file_path = ?')
			.get('20_项目/target.md') as { backlinks: string };
		expect(JSON.parse(row.backlinks)).toEqual([]);
	});
});

// ─── indexSingleFile ──────────────────────────────────────────────────────────

describe('indexSingleFile()', () => {
	it('indexes a single file and writes to DB', () => {
		writeTestNote(
			vault.root,
			'00_草稿/single.md',
			{ title: 'Single Note', type: 'draft', status: 'pending' },
			'Content here',
		);

		const result = indexSingleFile(vault.root, vault.dbPath, '00_草稿/single.md');

		expect(result.status).toBe('indexed');
		expect(result.filePath).toBe('00_草稿/single.md');

		const row = db
			.prepare('SELECT title, type FROM vault_index WHERE file_path = ?')
			.get('00_草稿/single.md') as { title: string; type: string } | undefined;
		expect(row).toBeDefined();
		expect(row!.title).toBe('Single Note');
		expect(row!.type).toBe('draft');
	});

	it('accepts absolute file path and converts to relative', () => {
		writeTestNote(vault.root, '00_草稿/abs.md', {
			title: 'Abs Note',
			type: 'draft',
			status: 'pending',
		});
		const absPath = join(vault.root, '00_草稿/abs.md');

		const result = indexSingleFile(vault.root, vault.dbPath, absPath);
		expect(result.status).toBe('indexed');
		expect(result.filePath).toBe('00_草稿/abs.md');
	});

	it('updates existing index entry on re-index', () => {
		writeTestNote(vault.root, '20_项目/proj.md', {
			title: 'Old Title',
			type: 'project',
			status: 'active',
		});
		indexSingleFile(vault.root, vault.dbPath, '20_项目/proj.md');

		// Overwrite with new content
		writeTestNote(vault.root, '20_项目/proj.md', {
			title: 'New Title',
			type: 'project',
			status: 'done',
		});
		indexSingleFile(vault.root, vault.dbPath, '20_项目/proj.md');

		const row = db
			.prepare('SELECT title, status FROM vault_index WHERE file_path = ?')
			.get('20_项目/proj.md') as { title: string; status: string } | undefined;
		expect(row!.title).toBe('New Title');
		expect(row!.status).toBe('done');

		// Only one row in DB
		const count = db.prepare('SELECT COUNT(*) as n FROM vault_index').get() as { n: number };
		expect(count.n).toBe(1);
	});

	it('returns skipped when file is in excluded directory', () => {
		writeTestNote(vault.root, '90_系统/模板/template.md', { title: 'Template', type: 'template' });
		const config = new VaultConfig(vault.root);

		const result = indexSingleFile(vault.root, vault.dbPath, '90_系统/模板/template.md', config);
		expect(result.status).toBe('skipped');
		expect(result.reason).toBeDefined();
	});

	it('returns skipped for file without valid frontmatter', () => {
		const { writeFileSync } = require('fs');
		writeFileSync(join(vault.root, '00_草稿/bare.md'), '# Bare\n\nno frontmatter', 'utf-8');

		const result = indexSingleFile(vault.root, vault.dbPath, '00_草稿/bare.md');
		expect(result.status).toBe('skipped');
		expect(result.reason).toContain('frontmatter');
	});

	it('removes entry from DB when file is deleted', () => {
		writeTestNote(vault.root, '00_草稿/to-delete.md', {
			title: 'Delete Me',
			type: 'draft',
			status: 'pending',
		});
		indexSingleFile(vault.root, vault.dbPath, '00_草稿/to-delete.md');

		// Verify it's indexed
		const before = db.prepare('SELECT COUNT(*) as n FROM vault_index').get() as { n: number };
		expect(before.n).toBe(1);

		// Delete the file
		unlinkSync(join(vault.root, '00_草稿/to-delete.md'));

		const result = indexSingleFile(vault.root, vault.dbPath, '00_草稿/to-delete.md');
		expect(result.status).toBe('removed');

		const after = db.prepare('SELECT COUNT(*) as n FROM vault_index').get() as { n: number };
		expect(after.n).toBe(0);
	});

	it('preserves incoming backlinks when reindexing a target with no outgoing links', () => {
		writeTestNote(vault.root, '20_项目/target.md', {
			title: 'Target',
			type: 'project',
			status: 'active',
		});
		writeTestNote(
			vault.root,
			'00_草稿/source.md',
			{ title: 'Source', type: 'draft', status: 'pending' },
			'[[Target]]',
		);
		fullScan(vault.root, vault.dbPath);

		writeTestNote(
			vault.root,
			'20_项目/target.md',
			{ title: 'Target', type: 'project', status: 'active' },
			'Updated target content',
		);
		indexSingleFile(vault.root, vault.dbPath, '20_项目/target.md');

		const row = db
			.prepare('SELECT backlinks FROM vault_index WHERE file_path = ?')
			.get('20_项目/target.md') as { backlinks: string };
		expect(JSON.parse(row.backlinks)).toEqual(['00_草稿/source.md']);
	});
});
