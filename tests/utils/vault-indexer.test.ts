import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';
import {
  shouldIndex,
  parseMarkdown,
  fullScan,
  indexSingleFile,
} from '../../src/utils/vault-indexer.js';
import { VaultConfig, _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';

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
    expect(shouldIndex('40_知识/Notes/Math/algebra.md', config)).toBe(true);
  });

  it('returns false for .md files under excluded_prefixes', () => {
    const config = new VaultConfig(vault.root);
    expect(shouldIndex('90_系统/模板/Daily_Template.md', config)).toBe(false);
    expect(shouldIndex('90_系统/Schema/Frontmatter_Schema.md', config)).toBe(false);
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

  it('generates summary from first 500 chars of body', () => {
    const longBody = 'A'.repeat(600);
    const content = `---
title: test
---

${longBody}`;
    const result = parseMarkdown(content, 'test.md');
    expect(result).not.toBeNull();
    expect(result!.summary.length).toBeLessThanOrEqual(500);
  });

  it('generates content_hash', () => {
    const content = `---
title: test
---
body`;
    const result = parseMarkdown(content, 'test.md');
    expect(result).not.toBeNull();
    expect(result!.contentHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates search_hints using segmenter', () => {
    const content = `---
title: 线性代数笔记
tags: [math, algebra]
---

矩阵运算基础`;
    const result = parseMarkdown(content, 'test.md');
    expect(result).not.toBeNull();
    expect(result!.searchHints).toBeTruthy();
    expect(typeof result!.searchHints).toBe('string');
    // Should contain tokenized content
    expect(result!.searchHints.length).toBeGreaterThan(0);
  });

  it('sets backlinks to empty array', () => {
    const content = `---
title: test
---`;
    const result = parseMarkdown(content, 'test.md');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.backlinks)).toEqual([]);
  });

  it('sets semanticSummary to null', () => {
    const content = `---
title: test
---`;
    const result = parseMarkdown(content, 'test.md');
    expect(result).not.toBeNull();
    expect(result!.semanticSummary).toBeNull();
  });
});

// ─── fullScan ─────────────────────────────────────────────────────────────────

describe('fullScan()', () => {
  it('scans and indexes markdown files in included directories', () => {
    writeTestNote(vault.root, '00_草稿/note1.md', { title: 'Note 1', type: 'draft', status: 'pending' }, 'Draft content');
    writeTestNote(vault.root, '20_项目/project1.md', { title: 'Project 1', type: 'project', status: 'active' }, 'Project content');
    writeTestNote(vault.root, '40_知识/Notes/Math/algebra.md', { title: 'Algebra', type: 'note', status: 'draft' }, 'Knowledge content');

    const result = fullScan(vault.root, vault.dbPath);

    expect(result.indexed).toBe(3);
    expect(result.skipped).toBeGreaterThanOrEqual(0);

    // Verify DB contains the indexed files
    const rows = db.prepare('SELECT file_path, title FROM vault_index ORDER BY file_path').all() as Array<{ file_path: string; title: string }>;
    expect(rows).toHaveLength(3);
    const paths = rows.map(r => r.file_path);
    expect(paths).toContain('00_草稿/note1.md');
    expect(paths).toContain('20_项目/project1.md');
    expect(paths).toContain('40_知识/Notes/Math/algebra.md');
  });

  it('skips files in excluded directories', () => {
    writeTestNote(vault.root, '90_系统/模板/Daily_Template.md', { title: 'Template', type: 'template' });
    writeTestNote(vault.root, '00_草稿/note.md', { title: 'Note', type: 'draft', status: 'pending' });

    const result = fullScan(vault.root, vault.dbPath);

    expect(result.indexed).toBe(1);
    const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{ file_path: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].file_path).toBe('00_草稿/note.md');
  });

  it('skips files without valid frontmatter', () => {
    // Write a plain markdown file (no frontmatter)
    const { writeFileSync } = require('fs');
    writeFileSync(join(vault.root, '00_草稿/no-frontmatter.md'), '# Just a title\n\nno frontmatter here', 'utf-8');
    writeTestNote(vault.root, '00_草稿/with-frontmatter.md', { title: 'Valid', type: 'draft', status: 'pending' });

    const result = fullScan(vault.root, vault.dbPath);

    expect(result.indexed).toBe(1);
    const rows = db.prepare('SELECT file_path FROM vault_index').all() as Array<{ file_path: string }>;
    expect(rows[0].file_path).toBe('00_草稿/with-frontmatter.md');
  });

  it('returns counts with zero when vault is empty', () => {
    const result = fullScan(vault.root, vault.dbPath);
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('accepts VaultConfig as optional third argument', () => {
    writeTestNote(vault.root, '00_草稿/note.md', { title: 'Note', type: 'draft', status: 'pending' });
    const config = new VaultConfig(vault.root);
    const result = fullScan(vault.root, vault.dbPath, config);
    expect(result.indexed).toBe(1);
  });
});

// ─── indexSingleFile ──────────────────────────────────────────────────────────

describe('indexSingleFile()', () => {
  it('indexes a single file and writes to DB', () => {
    writeTestNote(vault.root, '00_草稿/single.md', { title: 'Single Note', type: 'draft', status: 'pending' }, 'Content here');

    const result = indexSingleFile(vault.root, vault.dbPath, '00_草稿/single.md');

    expect(result.status).toBe('indexed');
    expect(result.filePath).toBe('00_草稿/single.md');

    const row = db.prepare('SELECT title, type FROM vault_index WHERE file_path = ?').get('00_草稿/single.md') as { title: string; type: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.title).toBe('Single Note');
    expect(row!.type).toBe('draft');
  });

  it('accepts absolute file path and converts to relative', () => {
    writeTestNote(vault.root, '00_草稿/abs.md', { title: 'Abs Note', type: 'draft', status: 'pending' });
    const absPath = join(vault.root, '00_草稿/abs.md');

    const result = indexSingleFile(vault.root, vault.dbPath, absPath);
    expect(result.status).toBe('indexed');
    expect(result.filePath).toBe('00_草稿/abs.md');
  });

  it('updates existing index entry on re-index', () => {
    writeTestNote(vault.root, '20_项目/proj.md', { title: 'Old Title', type: 'project', status: 'active' });
    indexSingleFile(vault.root, vault.dbPath, '20_项目/proj.md');

    // Overwrite with new content
    writeTestNote(vault.root, '20_项目/proj.md', { title: 'New Title', type: 'project', status: 'done' });
    indexSingleFile(vault.root, vault.dbPath, '20_项目/proj.md');

    const row = db.prepare('SELECT title, status FROM vault_index WHERE file_path = ?').get('20_项目/proj.md') as { title: string; status: string } | undefined;
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
    writeTestNote(vault.root, '00_草稿/to-delete.md', { title: 'Delete Me', type: 'draft', status: 'pending' });
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
});
