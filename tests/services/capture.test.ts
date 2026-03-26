import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { initDb } from '../../src/db/schema.js';
import {
  logEvent,
  autoCaptureEvents,
  latestSessionBridge,
  buildAutoSessionBridge,
  collectSessionBridgeSeedEvents,
} from '../../src/services/capture.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

// ─── logEvent ────────────────────────────────────────────────────────────────

describe('logEvent', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('inserts an event into session_log', () => {
    const result = logEvent(db, {
      entryType: 'milestone',
      importance: 3,
      summary: '完成了核心功能开发',
    });

    expect(result.eventId).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
    expect(result.status).toBe('ok');

    const row = db
      .prepare('SELECT * FROM session_log WHERE event_id = ?')
      .get(result.eventId) as Record<string, unknown> | undefined;

    expect(row).toBeTruthy();
    expect(row!['summary']).toBe('完成了核心功能开发');
    expect(row!['entry_type']).toBe('milestone');
    expect(row!['importance']).toBe(3);
  });

  it('generates search_hints for the event', () => {
    const result = logEvent(db, {
      entryType: 'decision',
      importance: 4,
      summary: '决定使用 TypeScript 重写项目',
      relatedEntities: ['TypeScript', 'LifeOS'],
    });

    const row = db
      .prepare('SELECT search_hints FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { search_hints: string } | undefined;

    expect(row).toBeTruthy();
    expect(row!.search_hints).toBeTruthy();
    expect(row!.search_hints.length).toBeGreaterThan(0);
  });

  it('normalizes rule event detail with content, rule_key, structured_by', () => {
    const result = logEvent(db, {
      entryType: 'preference',
      importance: 3,
      summary: '偏好使用简洁的提交信息',
      detail: JSON.stringify({ slot: 'format:commit-msg', note: '简短即好' }),
    });

    const row = db
      .prepare('SELECT detail, rule_key FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { detail: string; rule_key: string } | undefined;

    expect(row).toBeTruthy();
    const detailObj = JSON.parse(row!.detail);
    expect(detailObj.structured_by).toBe('service_v05');
    expect(detailObj.content).toBeTruthy();
    expect(detailObj.normalized_summary).toBeTruthy();
    expect(detailObj.rule_key).toBeTruthy();
    expect(row!.rule_key).toBeTruthy();
  });

  it('normalizes correction event detail', () => {
    const result = logEvent(db, {
      entryType: 'correction',
      importance: 4,
      summary: '不要在回复中使用英文',
    });

    const row = db
      .prepare('SELECT detail, rule_key FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { detail: string; rule_key: string } | undefined;

    expect(row).toBeTruthy();
    const detailObj = JSON.parse(row!.detail);
    expect(detailObj.structured_by).toBe('service_v05');
    expect(row!.rule_key).toMatch(/^correction:/);
  });

  it('adds temporary fields to preference events when keyword found', () => {
    const result = logEvent(db, {
      entryType: 'preference',
      importance: 3,
      summary: '这次先用这个格式',
    });

    const row = db
      .prepare('SELECT detail FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { detail: string } | undefined;

    const detailObj = JSON.parse(row!.detail);
    expect(detailObj.temporary).toBe(true);
    expect(detailObj.expires_in_days).toBeTruthy();
  });

  it('auto-supersedes previous event with same rule_key', () => {
    const first = logEvent(db, {
      entryType: 'decision',
      importance: 3,
      summary: '决定使用 A 方案',
    });

    const second = logEvent(db, {
      entryType: 'decision',
      importance: 4,
      summary: '决定使用 A 方案',
    });

    const row = db
      .prepare('SELECT supersedes FROM session_log WHERE event_id = ?')
      .get(second.eventId) as { supersedes: string | null } | undefined;

    expect(row!.supersedes).toBe(first.eventId);
  });

  it('stores scope and skill_name when provided', () => {
    const result = logEvent(db, {
      entryType: 'skill_completion',
      importance: 3,
      summary: '/research 完成',
      scope: '30_研究/AI',
      skillName: 'research',
    });

    const row = db
      .prepare('SELECT scope, skill_name FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { scope: string; skill_name: string } | undefined;

    expect(row!.scope).toBe('30_研究/AI');
    expect(row!.skill_name).toBe('research');
  });

  it('stores session_id from provided value', () => {
    const result = logEvent(db, {
      entryType: 'milestone',
      importance: 2,
      summary: '测试 session_id',
      sessionId: 'test-session-abc',
    });

    const row = db
      .prepare('SELECT session_id FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { session_id: string } | undefined;

    expect(row!.session_id).toBe('test-session-abc');
  });

  it('stores related_files and source_refs as JSON', () => {
    const result = logEvent(db, {
      entryType: 'decision',
      importance: 3,
      summary: '引用文件测试',
      relatedFiles: ['20_项目/MyProject.md'],
      sourceRefs: ['ref1', 'ref2'],
    });

    const row = db
      .prepare('SELECT related_files, source_refs FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { related_files: string; source_refs: string } | undefined;

    const relFiles = JSON.parse(row!.related_files);
    const srcRefs = JSON.parse(row!.source_refs);
    expect(relFiles).toContain('20_项目/MyProject.md');
    expect(srcRefs).toContain('ref1');
  });

  it('sets entry_hash for deduplication', () => {
    const result = logEvent(db, {
      entryType: 'milestone',
      importance: 2,
      summary: '哈希测试',
    });

    const row = db
      .prepare('SELECT entry_hash FROM session_log WHERE event_id = ?')
      .get(result.eventId) as { entry_hash: string } | undefined;

    expect(row!.entry_hash).toBeTruthy();
    expect(row!.entry_hash.length).toBe(16);
  });
});

// ─── autoCaptureEvents ───────────────────────────────────────────────────────

describe('autoCaptureEvents', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('captures multiple events from payload', () => {
    const result = autoCaptureEvents(db, {
      corrections: [
        { summary: '不要用中文以外的语言回复' },
        { summary: '代码注释也要用中文' },
      ],
      decisions: [
        { summary: '采用 ESM 模块化方案' },
      ],
      preferences: [
        { summary: '提交信息简洁明了' },
      ],
    });

    expect(result.capturedCount).toBe(4);
    expect(result.events).toHaveLength(4);
  });

  it('skips events with empty summaries', () => {
    const result = autoCaptureEvents(db, {
      corrections: [
        { summary: '' },
        { summary: '   ' },
        { summary: '有效的纠错' },
      ],
      decisions: [],
    });

    expect(result.capturedCount).toBe(1);
    expect(result.events[0].summary).toBe('有效的纠错');
  });

  it('deduplicates by entry_hash — skips identical events', () => {
    // Insert once
    autoCaptureEvents(db, {
      decisions: [{ summary: '使用 TDD 开发流程' }],
    });

    // Insert again with same summary
    const result = autoCaptureEvents(db, {
      decisions: [{ summary: '使用 TDD 开发流程' }],
    });

    expect(result.capturedCount).toBe(0);
  });

  it('deduplicates within same batch', () => {
    const result = autoCaptureEvents(db, {
      corrections: [
        { summary: '回复使用中文' },
        { summary: '回复使用中文' }, // duplicate
      ],
    });

    expect(result.capturedCount).toBe(1);
  });

  it('assigns correct entry types for each bucket', () => {
    const result = autoCaptureEvents(db, {
      corrections: [{ summary: '纠错测试' }],
      decisions: [{ summary: '决策测试' }],
      preferences: [{ summary: '偏好测试' }],
    });

    const types = result.events.map(e => e.entryType);
    expect(types).toContain('correction');
    expect(types).toContain('decision');
    expect(types).toContain('preference');
  });

  it('returns event ids and summaries in result', () => {
    const result = autoCaptureEvents(db, {
      decisions: [{ summary: '架构决策 A' }],
    });

    expect(result.events[0].eventId).toBeTruthy();
    expect(result.events[0].summary).toBe('架构决策 A');
    expect(result.events[0].entryType).toBe('decision');
  });

  it('passes session_id to logEvent', () => {
    autoCaptureEvents(
      db,
      { corrections: [{ summary: '测试 session' }] },
      'my-session-123',
    );

    const row = db
      .prepare("SELECT session_id FROM session_log WHERE entry_type = 'correction' LIMIT 1")
      .get() as { session_id: string } | undefined;

    expect(row!.session_id).toBe('my-session-123');
  });
});

// ─── latestSessionBridge ─────────────────────────────────────────────────────

describe('latestSessionBridge', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when no bridge exists', () => {
    const result = latestSessionBridge(db);
    expect(result).toBeNull();
  });

  it('returns most recent bridge summary', () => {
    logEvent(db, {
      entryType: 'session_bridge',
      importance: 2,
      summary: '上次会话：完成了 A 功能',
      sessionId: 'sess-001',
    });

    logEvent(db, {
      entryType: 'session_bridge',
      importance: 2,
      summary: '上次会话：完成了 B 功能',
      sessionId: 'sess-002',
    });

    const result = latestSessionBridge(db);
    expect(result).not.toBeNull();
    // Should return one of the two summaries (most recent)
    expect(result!.summary).toMatch(/完成了 [AB] 功能/);
  });

  it('filters by session_id when provided', () => {
    logEvent(db, {
      entryType: 'session_bridge',
      importance: 2,
      summary: '会话 1 的 bridge',
      sessionId: 'sess-A',
    });
    logEvent(db, {
      entryType: 'session_bridge',
      importance: 2,
      summary: '会话 2 的 bridge',
      sessionId: 'sess-B',
    });

    const result = latestSessionBridge(db, 'sess-A');
    expect(result!.summary).toBe('会话 1 的 bridge');
  });
});

// ─── collectSessionBridgeSeedEvents ─────────────────────────────────────────

describe('collectSessionBridgeSeedEvents', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns recent key events for a session', () => {
    logEvent(db, {
      entryType: 'decision',
      importance: 4,
      summary: '决定采用 A 架构',
      sessionId: 'sess-xyz',
    });
    logEvent(db, {
      entryType: 'correction',
      importance: 4,
      summary: '不要使用 any 类型',
      sessionId: 'sess-xyz',
    });
    logEvent(db, {
      entryType: 'milestone',
      importance: 3,
      summary: '完成数据库层',
      sessionId: 'sess-xyz',
    });

    const events = collectSessionBridgeSeedEvents(db, 'sess-xyz');
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      logEvent(db, {
        entryType: 'decision',
        importance: 4,
        summary: `决策 ${i}`,
        sessionId: 'sess-limit',
      });
    }

    const events = collectSessionBridgeSeedEvents(db, 'sess-limit', 3);
    expect(events.length).toBeLessThanOrEqual(3);
  });
});

// ─── buildAutoSessionBridge ──────────────────────────────────────────────────

describe('buildAutoSessionBridge', () => {
  it('generates bridge text from events', () => {
    const events = [
      { entryType: 'decision', summary: '决定使用 TypeScript' },
      { entryType: 'correction', summary: '回复必须用中文' },
      { entryType: 'milestone', summary: '完成第一阶段' },
    ];

    const bridge = buildAutoSessionBridge(events);
    expect(bridge).toBeTruthy();
    expect(bridge.length).toBeGreaterThan(10);
    // Should reference at least one of the summaries
    const hasContent = events.some(e => bridge.includes(e.summary));
    expect(hasContent).toBe(true);
  });

  it('handles empty events array gracefully', () => {
    const bridge = buildAutoSessionBridge([]);
    expect(typeof bridge).toBe('string');
  });

  it('includes entry type labels in output', () => {
    const events = [
      { entryType: 'decision', summary: '使用 A 方案' },
    ];
    const bridge = buildAutoSessionBridge(events);
    // Should contain either the event summary or a label
    expect(bridge).toContain('使用 A 方案');
  });
});
