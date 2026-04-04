import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';
import { initDb } from '../../src/db/schema.js';
import { _resetDefaultInstance } from '../../src/config.js';

// Services under test
import { runStartup } from '../../src/services/startup.js';
import {
  buildLayer0Summary,
  extractAutoSection,
  trimToBudget,
} from '../../src/services/layer0.js';
import {
  generateSemanticSummary,
  queueFileForEnhance,
  processEnhanceQueue,
  generateEnhancedSearchTerms,
  mergeSearchHints,
  matchEnhancePriority,
  enqueueChangedPathsForEnhance,
} from '../../src/services/enhance.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

// ─── layer0: extractAutoSection ───────────────────────────────────────────────

describe('extractAutoSection', () => {
  it('extracts content between BEGIN/END markers', () => {
    const content = `# Doc
<!-- BEGIN AUTO:profile-summary -->
line one
line two
<!-- END AUTO:profile-summary -->
rest`;
    expect(extractAutoSection(content, 'profile-summary')).toBe('line one\nline two');
  });

  it('returns empty string when marker is absent', () => {
    expect(extractAutoSection('no markers here', 'focus')).toBe('');
  });

  it('handles markers with special regex characters', () => {
    const content = `<!-- BEGIN AUTO:my.marker -->
content
<!-- END AUTO:my.marker -->`;
    expect(extractAutoSection(content, 'my.marker')).toBe('content');
  });
});

// ─── layer0: trimToBudget ─────────────────────────────────────────────────────

describe('trimToBudget', () => {
  it.each([
    ['short text', 1000, 'short text'],
    ['some text', 0, ''],
    ['   ', 100, ''],
  ] as const)('returns expected result for input=%j budget=%d', (input, budget, expected) => {
    expect(trimToBudget(input, budget)).toBe(expected);
  });

  it('truncates text exceeding budget with continuation marker', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `这是第${i + 1}行内容`);
    const text = lines.join('\n');
    const result = trimToBudget(text, 10);
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith('- ...')).toBe(true);
  });

  it('trims line-by-line, skipping empty lines', () => {
    const text = '行一\n\n行二\n行三';
    const result = trimToBudget(text, 5);
    expect(result).not.toContain('\n\n');
  });
});

// ─── layer0: buildLayer0Summary ───────────────────────────────────────────────

describe('buildLayer0Summary', () => {
  let vault: TempVault;

  beforeEach(() => {
    vault = createTempVault();
    _resetDefaultInstance();
  });

  afterEach(() => {
    vault.cleanup();
    _resetDefaultInstance();
  });

  it('returns empty string when no files exist', () => {
    const policy = { layer0_total: 1800, userprofile_summary: 200, userprofile_rules: 1000, taskboard_focus: 500, userprofile_doc_limit: 2000, taskboard_doc_limit: 3000 };
    const result = buildLayer0Summary(vault.root, policy);
    expect(result).toBe('');
  });

  it('includes UserProfile section when AUTO block exists', () => {
    const memoryDir = join(vault.root, '90_系统', '记忆');
    writeFileSync(
      join(memoryDir, 'UserProfile.md'),
      `# UserProfile\n<!-- BEGIN AUTO:profile-summary -->\n用户偏好：简洁风格\n<!-- END AUTO:profile-summary -->`,
      'utf-8',
    );
    const policy = { layer0_total: 1800, userprofile_summary: 200, userprofile_rules: 1000, taskboard_focus: 500, userprofile_doc_limit: 2000, taskboard_doc_limit: 3000 };
    const result = buildLayer0Summary(vault.root, policy);
    expect(result).toContain('UserProfile 速览');
    expect(result).toContain('用户偏好：简洁风格');
  });

  it('includes TaskBoard section when AUTO block exists', () => {
    const memoryDir = join(vault.root, '90_系统', '记忆');
    writeFileSync(
      join(memoryDir, 'TaskBoard.md'),
      `# TaskBoard\n<!-- BEGIN AUTO:focus -->\n当前焦点：完成测试套件\n<!-- END AUTO:focus -->`,
      'utf-8',
    );
    const policy = { layer0_total: 1800, userprofile_summary: 200, userprofile_rules: 1000, taskboard_focus: 500, userprofile_doc_limit: 2000, taskboard_doc_limit: 3000 };
    const result = buildLayer0Summary(vault.root, policy);
    expect(result).toContain('TaskBoard 当前焦点');
    expect(result).toContain('当前焦点：完成测试套件');
  });

  it('includes rules section when rules AUTO block exists', () => {
    const memoryDir = join(vault.root, '90_系统', '记忆');
    writeFileSync(
      join(memoryDir, 'UserProfile.md'),
      [
        '# UserProfile',
        '<!-- BEGIN AUTO:profile-summary -->',
        '用户偏好：简洁风格',
        '<!-- END AUTO:profile-summary -->',
        '<!-- BEGIN AUTO:rules -->',
        '- **content:language**: 输出语言使用中文',
        '- **format:no-emoji**: 不要用英文回复',
        '<!-- END AUTO:rules -->',
      ].join('\n'),
      'utf-8',
    );
    const policy = { layer0_total: 1800, userprofile_summary: 200, userprofile_rules: 1000, taskboard_focus: 500, userprofile_doc_limit: 2000, taskboard_doc_limit: 3000 };
    const result = buildLayer0Summary(vault.root, policy);
    expect(result).toContain('行为约束');
    expect(result).toContain('输出语言使用中文');
    expect(result).toContain('UserProfile 速览');
  });
});

// ─── enhance: generateSemanticSummary ────────────────────────────────────────

describe('generateSemanticSummary', () => {
  it('generates a summary for a project record', () => {
    const record = {
      title: '机器学习项目',
      type: 'project',
      domain: '[[AI]]',
      status: 'active',
      summary: '',
    };
    const result = generateSemanticSummary(record);
    expect(result).toContain('机器学习项目');
    expect(result).toContain('项目文件');
    expect(result).toContain('AI');
    expect(result).toContain('正在推进');
  });

  it('generates a summary for a note record without domain', () => {
    const record = {
      title: '群论概念',
      type: 'note',
      domain: null,
      status: 'draft',
      summary: '抽象代数基础概念',
    };
    const result = generateSemanticSummary(record);
    expect(result).toContain('群论概念');
    expect(result).toContain('知识笔记');
  });

  it('handles missing title gracefully', () => {
    const record = { title: null, type: 'research', domain: null, status: 'done', summary: '' };
    const result = generateSemanticSummary(record);
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');
  });

  it('returns a non-empty string for empty record', () => {
    const result = generateSemanticSummary({});
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');
    expect(result).toContain('该条目');
  });
});

// ─── enhance: queueFileForEnhance ────────────────────────────────────────────

describe('queueFileForEnhance', () => {
  let db: Database.Database;

  beforeEach(() => { db = createInMemoryDb(); });
  afterEach(() => { db.close(); });

  it('inserts a new file into enhance_queue', () => {
    queueFileForEnhance(db, '20_项目/test.md', 8, 'startup_scan');
    const row = db
      .prepare("SELECT * FROM enhance_queue WHERE file_path = '20_项目/test.md'")
      .get() as Record<string, any> | undefined;
    expect(row).toBeTruthy();
    expect(row!['priority']).toBe(8);
    expect(row!['status']).toBe('pending');
    expect(row!['source']).toBe('startup_scan');
  });

  it.each([
    ['upgrades priority when higher', [3, 9], 9],
    ['does not downgrade priority when lower', [10, 3], 10],
  ] as const)('%s', (_label, [first, second], expected) => {
    queueFileForEnhance(db, '20_项目/test.md', first, 'first');
    queueFileForEnhance(db, '20_项目/test.md', second, 'second');
    const row = db
      .prepare("SELECT priority FROM enhance_queue WHERE file_path = '20_项目/test.md'")
      .get() as { priority: number } | undefined;
    expect(row!['priority']).toBe(expected);
  });
});

// ─── enhance: processEnhanceQueue ────────────────────────────────────────────

describe('processEnhanceQueue', () => {
  let db: Database.Database;
  let vault: TempVault;

  beforeEach(() => {
    vault = createTempVault();
    db = createTestDb(vault.dbPath);
    initDb(db);
    _resetDefaultInstance();
  });

  afterEach(() => {
    db.close();
    vault.cleanup();
    _resetDefaultInstance();
  });

  it('returns zero when queue is empty', () => {
    const result = processEnhanceQueue(db, vault.root, 5);
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('processes pending items and updates vault_index', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO vault_index
      (file_path, title, type, status, domain, category, tags, aliases,
       summary, semantic_summary, search_hints, wikilinks, backlinks,
       section_heads, content_hash, file_size, created_at, modified_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '20_项目/my-project.md', '我的项目', 'project', 'active', '[[AI]]', null,
      '[]', '[]', '项目摘要', null, '[]', '[]', '[]', '[]',
      'abc123', 1024, now, now, now,
    );

    queueFileForEnhance(db, '20_项目/my-project.md', 8, 'test');

    const result = processEnhanceQueue(db, vault.root, 5);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);

    const row = db
      .prepare("SELECT semantic_summary FROM vault_index WHERE file_path = '20_项目/my-project.md'")
      .get() as { semantic_summary: string } | undefined;
    expect(row!['semantic_summary']).toBeTruthy();
    expect(row!['semantic_summary']).toContain('我的项目');
  });

  it('marks item as done when vault_index record not found', () => {
    db.prepare(`
      INSERT INTO enhance_queue (file_path, priority, queued_at, source, status, attempts)
      VALUES ('nonexistent.md', 5, ?, 'test', 'pending', 0)
    `).run(new Date().toISOString());

    const result = processEnhanceQueue(db, vault.root, 5);
    expect(result.processed).toBe(0);

    const row = db
      .prepare("SELECT status FROM enhance_queue WHERE file_path = 'nonexistent.md'")
      .get() as { status: string } | undefined;
    expect(row!['status']).toBe('done');
  });
});

// ─── enhance: mergeSearchHints ────────────────────────────────────────────────

describe('mergeSearchHints', () => {
  it('merges base hints and extra terms without duplicates', () => {
    const base = JSON.stringify(['项目', '任务']);
    const extras = ['任务', '进展', '计划'];
    const result = mergeSearchHints(base, extras);
    const parsed = JSON.parse(result) as string[];
    expect(parsed).toContain('项目');
    expect(parsed).toContain('任务');
    expect(parsed).toContain('进展');
    expect(parsed).toContain('计划');
    expect(parsed.filter(t => t === '任务').length).toBe(1);
  });

  it('handles null base hints', () => {
    const result = mergeSearchHints(null, ['term1', 'term2']);
    const parsed = JSON.parse(result) as string[];
    expect(parsed).toContain('term1');
    expect(parsed).toContain('term2');
  });
});

// ─── enhance: matchEnhancePriority ───────────────────────────────────────────

describe('matchEnhancePriority', () => {
  const priorityMap = { '20_项目/': 8, '40_知识/': 6 };

  it('returns matching priority for known prefix', () => {
    expect(matchEnhancePriority('20_项目/my-project.md', priorityMap)).toBe(8);
    expect(matchEnhancePriority('40_知识/笔记/Math/algebra.md', priorityMap)).toBe(6);
  });

  it('returns null for unmatched path', () => {
    expect(matchEnhancePriority('00_草稿/note.md', priorityMap)).toBeNull();
  });
});

// ─── enhance: enqueueChangedPathsForEnhance ──────────────────────────────────

describe('enqueueChangedPathsForEnhance', () => {
  let db: Database.Database;

  beforeEach(() => { db = createInMemoryDb(); });
  afterEach(() => { db.close(); });

  it('queues matched paths and returns count', () => {
    const priorityMap = { '20_项目/': 8, '40_知识/': 6 };
    const paths = [
      '20_项目/project-a.md',
      '40_知识/笔记/concept.md',
      '00_草稿/ignored.md',
    ];
    const count = enqueueChangedPathsForEnhance(db, paths, priorityMap);
    expect(count).toBe(2);
  });

  it('returns zero when no paths match priority map', () => {
    const priorityMap = { '20_项目/': 8 };
    const count = enqueueChangedPathsForEnhance(db, ['00_草稿/note.md'], priorityMap);
    expect(count).toBe(0);
  });
});

// ─── startup: runStartup ──────────────────────────────────────────────────────

describe('runStartup', () => {
  let db: Database.Database;
  let vault: TempVault;

  beforeEach(() => {
    vault = createTempVault();
    db = createTestDb(vault.dbPath);
    initDb(db);
    _resetDefaultInstance();
  });

  afterEach(() => {
    db.close();
    vault.cleanup();
    _resetDefaultInstance();
  });

  it('returns expected shape with vault_stats and layer0_summary', () => {
    const result = runStartup(db, vault.root);
    expect(result).toHaveProperty('layer0_summary');
    expect(result).toHaveProperty('vault_stats');
    expect(result).toHaveProperty('enhance_queue_size');
    expect(result).toHaveProperty('enhanced_files');
    expect(typeof result['layer0_summary']).toBe('string');
    expect(typeof result['vault_stats']['total_files']).toBe('number');
  });

  it('counts vault files after scan', () => {
    writeTestNote(vault.root, '20_项目/project-a.md', { title: '项目A', type: 'project', status: 'active' });
    writeTestNote(vault.root, '20_项目/project-b.md', { title: '项目B', type: 'project', status: 'done' });
    const result = runStartup(db, vault.root);
    expect(result['vault_stats']['total_files']).toBeGreaterThanOrEqual(0);
  });
});
