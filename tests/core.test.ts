/**
 * core.test.ts — Tests for core.ts dispatch layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createTempVault, writeTestNote } from './setup.js';
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

  it('creates both active docs during startup', () => {
    memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
    });

    const memoryDir = join(vault.root, '90_系统', '记忆');
    const taskboardPath = join(memoryDir, 'TaskBoard.md');
    const userProfilePath = join(memoryDir, 'UserProfile.md');

    expect(existsSync(taskboardPath)).toBe(true);
    expect(existsSync(userProfilePath)).toBe(true);
    expect(readFileSync(userProfilePath, 'utf-8')).toContain('<!-- BEGIN AUTO:profile-summary -->');
  });

  it('does not warn about missing vault-indexer module during startup', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    memoryStartup({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
    });

    expect(
      warnSpy.mock.calls.some(
        (call) => call[0] === '[lifeos] vault scan failed:',
      ),
    ).toBe(false);

    warnSpy.mockRestore();
  });
});

// ─── memoryLog ────────────────────────────────────────────────────────────────

describe('memoryLog', () => {
  it('logs an event and returns eventId and timestamp', () => {
    const result = memoryLog({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
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
      vaultRoot: vault.root,
      entryType: 'decision',
      importance: 4,
      summary: '决定使用 TypeScript 重写全部模块',
      scope: 'lifeos',
    });

    expect(result.eventId).toBeTruthy();
    expect(result.status).toBe('ok');
  });

  it('logs a skill_completion event with skillName', () => {
    const result = memoryLog({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
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
        vaultRoot: vault.root,
        entryType: 'invalid_type',
        importance: 3,
        summary: '测试',
      }),
    ).toThrow('Invalid entry_type: invalid_type');
  });

  it.each([0, 6])('throws for importance=%d (out of 1-5 range)', (importance) => {
    expect(() =>
      memoryLog({
        dbPath: vault.dbPath,
        vaultRoot: vault.root,
        entryType: 'milestone',
        importance,
        summary: '测试',
      }),
    ).toThrow('importance must be 1-5');
  });
});

// ─── memoryQuery ──────────────────────────────────────────────────────────────

describe('memoryQuery', () => {
  it.each([
    ['with query', { query: '知识管理' }],
    ['with filters', { filters: { type: 'project' } }],
    ['with no query and no filters', {}],
  ] as const)('returns results array %s', (_label, opts) => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryQuery({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      ...opts,
    });

    expect(Array.isArray(result.results)).toBe(true);
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
      vaultRoot: vault.root,
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
      vaultRoot: vault.root,
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
  it('writes active docs into the temp vault when vaultRoot is provided', () => {
    const repoSystemDir = join(process.cwd(), '90_系统');
    rmSync(repoSystemDir, { recursive: true, force: true });

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      corrections: [{ summary: '活跃文档应该写入临时 Vault' }],
    });

    expect(result.capturedCount).toBe(1);
    expect(existsSync(join(vault.root, '90_系统', '记忆', 'UserProfile.md'))).toBe(true);
    expect(existsSync(repoSystemDir)).toBe(false);
  });

  it('captures corrections, decisions, and preferences', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
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
      vaultRoot: vault.root,
      corrections: [{ summary: '重复的纠错' }, { summary: '重复的纠错' }],
    });

    expect(result.capturedCount).toBe(1);
  });

  it('returns 0 when nothing to capture', () => {
    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryAutoCapture({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
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

  it('indexes an existing markdown file instead of returning error', () => {
    writeTestNote(
      vault.root,
      '20_项目/my-project.md',
      { title: 'My Project', type: 'project', status: 'active' },
      '项目内容',
    );

    memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
    _resetDefaultInstance();

    const result = memoryNotify({
      dbPath: vault.dbPath,
      vaultRoot: vault.root,
      filePath: '20_项目/my-project.md',
    });

    expect(result.filePath).toBe('20_项目/my-project.md');
    expect(result.action).toBe('indexed');
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
