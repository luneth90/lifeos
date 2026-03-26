/**
 * core.test.ts — Tests for core.ts dispatch layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTempVault } from './setup.js';
import {
  memoryStartup,
  memoryLog,
  memoryQuery,
  memoryRecent,
  memoryAutoCapture,
  memoryNotify,
  memoryCheckpoint,
} from '../src/core.js';
import { _resetDefaultInstance } from '../src/config.js';

// ─── Setup helpers ────────────────────────────────────────────────────────────

let vault: ReturnType<typeof createTempVault>;

beforeEach(() => {
  _resetDefaultInstance();
  vault = createTempVault();
});

afterEach(() => {
  _resetDefaultInstance();
  vault.cleanup();
});

// ─── memoryStartup ────────────────────────────────────────────────────────────

describe('memoryStartup', () => {
  it('initializes DB and returns vault stats and layer0_summary', () => {
    const result = memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      sessionId: 'test-session-001',
    });

    expect(result).toBeTruthy();
    expect(result.vault_stats).toBeTruthy();
    expect(typeof result.vault_stats.total_files).toBe('number');
    expect(typeof result.vault_stats.updated_since_last).toBe('number');
    expect(typeof result.layer0_summary).toBe('string');
  });

  it('returns enhance_queue_size as a number', () => {
    const result = memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
    });

    expect(typeof result.enhance_queue_size).toBe('number');
  });
});

// ─── memoryLog ────────────────────────────────────────────────────────────────

describe('memoryLog', () => {
  it('logs an event and returns eventId and timestamp', () => {
    const result = memoryLog({
      dbPath: vault.dbPath,
      entryType: 'milestone',
      importance: 3,
      summary: '完成 core.ts 实现',
    });

    expect(result.eventId).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
    expect(result.status).toBe('ok');
  });

  it('logs a decision event with scope', () => {
    const result = memoryLog({
      dbPath: vault.dbPath,
      entryType: 'decision',
      importance: 4,
      summary: '决定使用 TypeScript 重写全部模块',
      scope: 'lifeos-memory',
    });

    expect(result.eventId).toBeTruthy();
    expect(result.status).toBe('ok');
  });

  it('logs a skill_completion event with skillName', () => {
    const result = memoryLog({
      dbPath: vault.dbPath,
      entryType: 'skill_completion',
      importance: 4,
      summary: '/knowledge 完成知识整理',
      skillName: '/knowledge',
    });

    expect(result.eventId).toBeTruthy();
    expect(result.status).toBe('ok');
  });

  it('throws for invalid entry_type', () => {
    expect(() =>
      memoryLog({
        dbPath: vault.dbPath,
        entryType: 'invalid_type',
        importance: 3,
        summary: '测试',
      }),
    ).toThrow('Invalid entry_type: invalid_type');
  });

  it('throws for importance < 1', () => {
    expect(() =>
      memoryLog({
        dbPath: vault.dbPath,
        entryType: 'milestone',
        importance: 0,
        summary: '测试',
      }),
    ).toThrow('importance must be 1-5');
  });

  it('throws for importance > 5', () => {
    expect(() =>
      memoryLog({
        dbPath: vault.dbPath,
        entryType: 'milestone',
        importance: 6,
        summary: '测试',
      }),
    ).toThrow('importance must be 1-5');
  });
});

// ─── memoryQuery ──────────────────────────────────────────────────────────────

describe('memoryQuery', () => {
  it('returns results array (possibly empty)', () => {
    // Startup first to initialize schema
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryQuery({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      query: '知识管理',
    });

    expect(result).toBeTruthy();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('handles empty query with filters', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryQuery({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      filters: { type: 'project' },
    });

    expect(Array.isArray(result.results)).toBe(true);
  });

  it('returns empty results when no query and no filters', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryQuery({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
    });

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBe(0);
  });
});

// ─── memoryRecent ─────────────────────────────────────────────────────────────

describe('memoryRecent', () => {
  it('returns events array (possibly empty)', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryRecent({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      days: 7,
    });

    expect(result).toBeTruthy();
    expect(Array.isArray(result.events)).toBe(true);
  });

  it('returns events logged in the same session', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root, sessionId: 'test-s' });
    _resetDefaultInstance();

    memoryLog({
      dbPath: vault.dbPath,
      entryType: 'milestone',
      importance: 3,
      summary: '完成测试阶段',
      sessionId: 'test-s',
    });
    _resetDefaultInstance();

    const result = memoryRecent({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      days: 1,
      limit: 10,
    });

    expect(result.events.length).toBeGreaterThan(0);
    const summaries = result.events.map((e: any) => e.summary);
    expect(summaries).toContain('完成测试阶段');
  });

  it('filters by entry_type', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    memoryLog({
      dbPath: vault.dbPath,
      entryType: 'decision',
      importance: 4,
      summary: '决定架构方案',
    });
    _resetDefaultInstance();

    const result = memoryRecent({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      days: 1,
      entryType: 'decision',
    });

    expect(Array.isArray(result.events)).toBe(true);
    for (const e of result.events) {
      expect(e.entryType).toBe('decision');
    }
  });
});

// ─── memoryAutoCapture ────────────────────────────────────────────────────────

describe('memoryAutoCapture', () => {
  it('captures corrections, decisions, and preferences', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
      corrections: [{ summary: '不要使用英文输出' }],
      decisions: [{ summary: '选用 better-sqlite3 作为数据库驱动' }],
      preferences: [{ summary: '偏好简洁的代码风格' }],
    });

    expect(result.capturedCount).toBe(3);
    expect(result.events).toHaveLength(3);
    const types = result.events.map((e: any) => e.entryType);
    expect(types).toContain('correction');
    expect(types).toContain('decision');
    expect(types).toContain('preference');
  });

  it('deduplicates identical entries in the same call', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
      corrections: [{ summary: '重复的纠错' }, { summary: '重复的纠错' }],
    });

    expect(result.capturedCount).toBe(1);
  });

  it('returns 0 when nothing to capture', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
    });

    expect(result.capturedCount).toBe(0);
    expect(result.events).toHaveLength(0);
  });
});

// ─── memoryNotify ─────────────────────────────────────────────────────────────

describe('memoryNotify', () => {
  it('returns action and filePath for a non-existent file', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryNotify({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      filePath: '20_项目/my-project.md',
    });

    expect(result.filePath).toBeTruthy();
    expect(typeof result.action).toBe('string');
  });
});

// ─── memoryCheckpoint ─────────────────────────────────────────────────────────

describe('memoryCheckpoint', () => {
  it('closes session and returns session_closed: true', () => {
    memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      sessionId: 'ckpt-session',
    });
    _resetDefaultInstance();

    const result = memoryCheckpoint({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      sessionId: 'ckpt-session',
    });

    expect(result.session_closed).toBe(true);
    expect(result.active_docs_updated).toBe(true);
    expect(typeof result.enhanced_files).toBe('number');
  });

  it('warns when no session_bridge has been logged', () => {
    memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      sessionId: 'no-bridge-session',
    });
    _resetDefaultInstance();

    const result = memoryCheckpoint({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      sessionId: 'no-bridge-session',
    });

    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
