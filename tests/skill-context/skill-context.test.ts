import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../src/db/schema.js';
import { logEvent } from '../../src/services/capture.js';
import { buildSkillContext } from '../../src/skill-context/index.js';
import { getProfile, listProfiles, registerProfile } from '../../src/skill-context/seed-profiles.js';
import { REVIEW_STRICT } from '../../src/skill-context/review-strict.js';
import { ASK_GLOBAL } from '../../src/skill-context/ask-global.js';
import { DAILY_GLOBAL } from '../../src/skill-context/daily-global.js';
import { KNOWLEDGE_STRICT } from '../../src/skill-context/knowledge-strict.js';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

// ─── Profile configs ──────────────────────────────────────────────────────────

describe('SeedProfileConfig properties', () => {
  it.each([
    ['review_strict', REVIEW_STRICT, { loadTaskboard: false, allowDomainTagFallback: false, biasKey: 'correction', biasMin: 50 }],
    ['ask_global', ASK_GLOBAL, { loadTaskboard: false, allowDomainTagFallback: true, biasKey: null, biasMin: 0 }],
    ['daily_global', DAILY_GLOBAL, { loadTaskboard: true, allowDomainTagFallback: false, biasKey: 'project', biasMin: 0 }],
    ['knowledge_strict', KNOWLEDGE_STRICT, { loadTaskboard: false, allowDomainTagFallback: false, biasKey: 'knowledge', biasMin: 50 }],
  ] as const)('%s has expected properties', (name, profile, expected) => {
    expect(profile.name).toBe(name);
    expect(profile.loadTaskboard).toBe(expected.loadTaskboard);
    expect(profile.allowDomainTagFallback).toBe(expected.allowDomainTagFallback);
    if (expected.biasKey) {
      expect(profile.rankingBias[expected.biasKey]).toBeGreaterThan(expected.biasMin);
    }
    expect(profile.vaultQueryLimit).toBeGreaterThan(0);
    expect(profile.recentEventDays).toBeGreaterThan(0);
  });
});

// ─── getProfile registry ──────────────────────────────────────────────────────

describe('getProfile', () => {
  it('returns null for unknown profile', () => {
    expect(getProfile('nonexistent_profile')).toBeNull();
  });

  it('returns config for known profiles', () => {
    expect(getProfile('review_strict')).toBeTruthy();
    expect(getProfile('ask_global')).toBeTruthy();
    expect(getProfile('daily_global')).toBeTruthy();
    expect(getProfile('knowledge_strict')).toBeTruthy();
    expect(getProfile('research_seed')).toBeTruthy();
    expect(getProfile('project_seed')).toBeTruthy();
  });
});

describe('listProfiles', () => {
  it('returns at least 6 profiles', () => {
    const profiles = listProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(6);
    expect(profiles).toContain('review_strict');
    expect(profiles).toContain('ask_global');
  });
});

describe('registerProfile', () => {
  it('registers and retrieves a custom profile', () => {
    registerProfile({
      name: 'custom_test_profile',
      loadTaskboard: true,
      allowDomainTagFallback: true,
      rankingBias: { project: 100 },
      recentEventBias: {},
      vaultQueryLimit: 5,
      recentEventLimit: 5,
      recentEventDays: 7,
    });

    const profile = getProfile('custom_test_profile');
    expect(profile).toBeTruthy();
    expect(profile!.rankingBias['project']).toBe(100);
  });
});

// ─── buildSkillContext ────────────────────────────────────────────────────────

describe('buildSkillContext', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns correct profile name in result', () => {
    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'ask_global',
    });
    expect(result.profile).toBe('ask_global');
  });

  it('returns empty arrays when DB is empty', () => {
    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'review_strict',
    });
    expect(result.vaultResults).toEqual([]);
    expect(result.recentEvents).toEqual([]);
    expect(result.memoryItems).toEqual([]);
    expect(result.taskboardSummary).toBeUndefined();
  });

  it('includes recent events when they exist', () => {
    logEvent(db, {
      entryType: 'correction',
      importance: 4,
      summary: '不要在 frontmatter 中使用 emoji',
    });

    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'review_strict',
    });
    expect(result.recentEvents.length).toBeGreaterThan(0);
  });

  it('reranks correction events higher for review_strict', () => {
    logEvent(db, { entryType: 'milestone', importance: 3, summary: '里程碑事件' });
    logEvent(db, { entryType: 'correction', importance: 3, summary: '纠错事件' });

    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'review_strict',
    });

    // Correction should appear before milestone due to bias
    const eventTypes = result.recentEvents.map(e => e.entryType);
    const corrIdx = eventTypes.indexOf('correction');
    const mileIdx = eventTypes.indexOf('milestone');
    if (corrIdx !== -1 && mileIdx !== -1) {
      expect(corrIdx).toBeLessThan(mileIdx);
    }
  });

  it('respects vaultQueryLimit', () => {
    // Insert multiple vault records
    for (let i = 0; i < 20; i++) {
      db.prepare(`
        INSERT INTO vault_index (file_path, title, type, status, modified_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(`20_项目/Project${i}.md`, `Project ${i}`, 'project', 'active', new Date().toISOString());
    }

    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'daily_global',
      query: 'Project',
    });

    expect(result.vaultResults.length).toBeLessThanOrEqual(DAILY_GLOBAL.vaultQueryLimit);
  });

  it('uses unknown profile gracefully with fallback defaults', () => {
    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'totally_unknown_profile',
    });
    expect(result.profile).toBe('totally_unknown_profile');
    expect(result.vaultResults).toEqual([]);
  });

  it('taskboardSummary is undefined for non-taskboard profiles', () => {
    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'review_strict',
    });
    expect(result.taskboardSummary).toBeUndefined();
  });

  it('includes vault results when related_files are provided', () => {
    db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, modified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('20_项目/MyProject.md', 'My Project', 'project', 'active', new Date().toISOString());

    const result = buildSkillContext(db, '/tmp/vault', {
      skillProfile: 'ask_global',
      relatedFiles: ['20_项目/MyProject.md'],
    });

    expect(result.vaultResults.length).toBeGreaterThan(0);
    expect(result.vaultResults[0].filePath).toBe('20_项目/MyProject.md');
  });
});
