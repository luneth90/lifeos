import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { initDb } from '../../src/db/schema.js';
import { VaultConfig, setVaultConfig, _resetDefaultInstance } from '../../src/config.js';
import {
  ensureActiveDocsExist,
  refreshTaskboard,
  refreshUserprofile,
  taskboardCitations,
  userprofileCitations,
} from '../../src/active-docs/index.js';
import { buildTaskboardSections } from '../../src/active-docs/taskboard.js';
import { buildUserprofileSections } from '../../src/active-docs/userprofile.js';
import { getCitations } from '../../src/active-docs/citations.js';
import { buildLongTermItems } from '../../src/active-docs/long-term-profile.js';
import { logEvent } from '../../src/services/capture.js';
import { createTempVault } from '../setup.js';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

// ─── ensureActiveDocsExist ─────────────────────────────────────────────────────

describe('ensureActiveDocsExist', () => {
  it('creates TaskBoard.md and UserProfile.md when missing', () => {
    const vault = createTempVault();
    try {
      _resetDefaultInstance();
      const vc = new VaultConfig(vault.root);
      setVaultConfig(vc);

      ensureActiveDocsExist(vault.root);

      const memDir = vc.memoryDir();
      expect(existsSync(join(memDir, 'TaskBoard.md'))).toBe(true);
      expect(existsSync(join(memDir, 'UserProfile.md'))).toBe(true);
    } finally {
      _resetDefaultInstance();
      vault.cleanup();
    }
  });

  it('does not overwrite existing files', () => {
    const vault = createTempVault();
    try {
      _resetDefaultInstance();
      const vc = new VaultConfig(vault.root);
      setVaultConfig(vc);

      const memDir = vc.memoryDir();
      const tbPath = join(memDir, 'TaskBoard.md');

      ensureActiveDocsExist(vault.root);
      const originalContent = readFileSync(tbPath, 'utf-8');

      // Call again — should not overwrite
      ensureActiveDocsExist(vault.root);
      const afterContent = readFileSync(tbPath, 'utf-8');

      expect(afterContent).toBe(originalContent);
    } finally {
      _resetDefaultInstance();
      vault.cleanup();
    }
  });
});

// ─── buildTaskboardSections ───────────────────────────────────────────────────

describe('buildTaskboardSections', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns all expected section keys and focus mentions active project', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, modified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('20_项目/MyProject.md', 'My Project', 'project', 'active', new Date().toISOString());

    const sections = buildTaskboardSections(db, '/tmp/vault');
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining(['focus', 'active-projects', 'revises', 'decisions', 'update-log'])
    );
    expect(sections['focus']).toContain('My Project');
    expect(sections['active-projects']).toContain('My Project');
  });

  it('decisions section shows recent decision events', () => {
    logEvent(db, {
      entryType: 'decision',
      importance: 4,
      summary: '选择使用 TypeScript 重写项目',
    });

    const sections = buildTaskboardSections(db, '/tmp/vault');
    expect(sections['decisions']).toContain('TypeScript');
  });

  it('update-log shows recent events by importance', () => {
    logEvent(db, {
      entryType: 'milestone',
      importance: 3,
      summary: '完成了第一个里程碑',
    });

    const sections = buildTaskboardSections(db, '/tmp/vault');
    expect(sections['update-log']).toContain('里程碑');
  });
});

// ─── buildUserprofileSections ─────────────────────────────────────────────────

describe('buildUserprofileSections', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns expected section keys and preferences include logged events', () => {
    logEvent(db, {
      entryType: 'preference',
      importance: 3,
      summary: '偏好使用简洁中文写作风格',
    });

    const sections = buildUserprofileSections(db, '/tmp/vault');
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining(['profile-summary', 'preferences', 'corrections', 'decisions', 'learning-progress'])
    );
    expect(sections['preferences']).toContain('简洁中文');
  });

  it('corrections section includes logged correction events', () => {
    logEvent(db, {
      entryType: 'correction',
      importance: 4,
      summary: '不要在文件名中使用空格',
    });

    const sections = buildUserprofileSections(db, '/tmp/vault');
    expect(sections['corrections']).toContain('空格');
  });
});

// ─── refreshTaskboard ─────────────────────────────────────────────────────────

describe('refreshTaskboard', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates and writes TaskBoard.md with AUTO sections', () => {
    const vault = createTempVault();
    try {
      _resetDefaultInstance();
      const vc = new VaultConfig(vault.root);
      setVaultConfig(vc);

      const result = refreshTaskboard(db, vault.root);
      expect(result.status).toBe('ok');

      const tbPath = join(vc.memoryDir(), 'TaskBoard.md');
      expect(existsSync(tbPath)).toBe(true);

      const content = readFileSync(tbPath, 'utf-8');
      expect(content).toContain('<!-- BEGIN AUTO:focus -->');
      expect(content).toContain('<!-- END AUTO:focus -->');
    } finally {
      _resetDefaultInstance();
      vault.cleanup();
    }
  });

  it('replaces AUTO section content when refreshed', () => {
    const vault = createTempVault();
    try {
      _resetDefaultInstance();
      const vc = new VaultConfig(vault.root);
      setVaultConfig(vc);

      // First refresh
      refreshTaskboard(db, vault.root);

      // Add a project and refresh again
      db.prepare(`
        INSERT INTO vault_index (file_path, title, type, status, modified_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('20_项目/TestProject.md', 'Test Project', 'project', 'active', new Date().toISOString());

      refreshTaskboard(db, vault.root);

      const content = readFileSync(join(vc.memoryDir(), 'TaskBoard.md'), 'utf-8');
      expect(content).toContain('Test Project');
    } finally {
      _resetDefaultInstance();
      vault.cleanup();
    }
  });

  it('preserves manual content outside AUTO markers', () => {
    const vault = createTempVault();
    try {
      _resetDefaultInstance();
      const vc = new VaultConfig(vault.root);
      setVaultConfig(vc);

      // Initial refresh
      refreshTaskboard(db, vault.root);

      // Manually add content outside AUTO markers
      const tbPath = join(vc.memoryDir(), 'TaskBoard.md');
      const existing = readFileSync(tbPath, 'utf-8');
      const withManual = existing + '\n\n## 手动记录\n我的手动笔记内容\n';
      writeFileSync(tbPath, withManual, 'utf-8');

      // Refresh again
      refreshTaskboard(db, vault.root);

      const afterContent = readFileSync(tbPath, 'utf-8');
      expect(afterContent).toContain('手动记录');
      expect(afterContent).toContain('我的手动笔记内容');
    } finally {
      _resetDefaultInstance();
      vault.cleanup();
    }
  });
});

// ─── getCitations ─────────────────────────────────────────────────────────────

describe('getCitations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty items when no memory_items exist', () => {
    const result = getCitations(db, 'UserProfile');
    expect(result.target).toBe('UserProfile');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns items for matching target', () => {
    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
    `).run('item-1', 'UserProfile', 'preferences', 'tool:editor', 'VSCode 是首选编辑器', new Date().toISOString());

    const result = getCitations(db, 'UserProfile');
    expect(result.total).toBe(1);
    expect(result.items[0].slotKey).toBe('tool:editor');
  });

  it('filters by section when provided', () => {
    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
    `).run('item-2', 'UserProfile', 'preferences', 'k1', 'pref content', new Date().toISOString());
    db.prepare(`
      INSERT INTO memory_items
        (item_id, target, section, slot_key, content, manual_flag, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?)
    `).run('item-3', 'UserProfile', 'corrections', 'k2', 'corr content', new Date().toISOString());

    const result = getCitations(db, 'UserProfile', { section: 'preferences' });
    expect(result.total).toBe(1);
    expect(result.items[0].section).toBe('preferences');
  });
});

// ─── buildLongTermItems ───────────────────────────────────────────────────────

describe('buildLongTermItems', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no key events exist', () => {
    const items = buildLongTermItems(db);
    expect(items).toEqual([]);
  });

  it('groups by rule_key and returns stable preferences', () => {
    // Log same preference twice
    logEvent(db, {
      entryType: 'preference',
      importance: 3,
      summary: '使用简洁风格',
    });
    logEvent(db, {
      entryType: 'preference',
      importance: 4,
      summary: '使用简洁风格',
    });

    const items = buildLongTermItems(db);
    // Should have at least one item for this preference
    expect(items.length).toBeGreaterThan(0);
    const found = items.find(i => i.summary.includes('简洁风格'));
    expect(found).toBeTruthy();
    expect(found!.occurrences).toBeGreaterThanOrEqual(1);
  });

  it('sorts by importance descending', () => {
    logEvent(db, { entryType: 'decision', importance: 2, summary: '低优先级决策' });
    logEvent(db, { entryType: 'correction', importance: 5, summary: '高优先级纠错' });

    const items = buildLongTermItems(db);
    if (items.length >= 2) {
      expect(items[0].importance).toBeGreaterThanOrEqual(items[1].importance);
    }
  });
});
