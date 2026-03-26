import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveSessionId,
  coerceNow,
  loadsJsonList,
  estimateTokens,
  containsCjk,
  normalizeWikilinkValue,
  compactText,
  normalizeRuleSummary,
  buildDefaultRuleKey,
  extractRuleKeyValue,
  resolveRuleKey,
  inferTemporaryPreference,
  parseDetailObject,
  isArchiveSummary,
  SESSION_ID_ENV_KEYS,
  ALLOWED_COUNT_TABLES,
  KEY_ENTRY_TYPES,
  VALID_ENTRY_TYPES,
  ACTIVE_DOC_TARGETS,
  RULE_KEY_PREFIXES,
  TEMPORARY_PREFERENCE_KEYWORDS,
  STABLE_PREFERENCE_KEYWORDS,
  DEFAULT_TEMPORARY_PREFERENCE_DAYS,
  ALL_TIME_DAYS,
  FALLBACK_THRESHOLD,
  SUMMARY_MAX_LEN,
  BUCKET_TYPE_MAP,
} from '../../src/utils/shared.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('SESSION_ID_ENV_KEYS includes expected keys', () => {
    expect(SESSION_ID_ENV_KEYS).toContain('LIFEOS_SESSION_ID');
    expect(SESSION_ID_ENV_KEYS).toContain('CLAUDE_SESSION_ID');
    expect(SESSION_ID_ENV_KEYS).toContain('CODEX_SESSION_ID');
    expect(SESSION_ID_ENV_KEYS).toContain('OPENCODE_SESSION_ID');
  });

  it('ALLOWED_COUNT_TABLES contains correct tables', () => {
    expect(ALLOWED_COUNT_TABLES.has('vault_index')).toBe(true);
    expect(ALLOWED_COUNT_TABLES.has('enhance_queue')).toBe(true);
    expect(ALLOWED_COUNT_TABLES.has('session_log')).toBe(true);
    expect(ALLOWED_COUNT_TABLES.has('unknown_table')).toBe(false);
  });

  it('KEY_ENTRY_TYPES contains decision/correction/preference', () => {
    expect(KEY_ENTRY_TYPES.has('decision')).toBe(true);
    expect(KEY_ENTRY_TYPES.has('correction')).toBe(true);
    expect(KEY_ENTRY_TYPES.has('preference')).toBe(true);
  });

  it('VALID_ENTRY_TYPES includes all expected types', () => {
    for (const t of ['skill_completion', 'decision', 'preference', 'correction', 'blocker', 'milestone', 'session_bridge']) {
      expect(VALID_ENTRY_TYPES.has(t)).toBe(true);
    }
  });

  it('ACTIVE_DOC_TARGETS contains TaskBoard and UserProfile', () => {
    expect(ACTIVE_DOC_TARGETS.has('TaskBoard')).toBe(true);
    expect(ACTIVE_DOC_TARGETS.has('UserProfile')).toBe(true);
  });

  it('RULE_KEY_PREFIXES maps entry types to prefixes', () => {
    expect(RULE_KEY_PREFIXES['decision']).toBe('decision');
    expect(RULE_KEY_PREFIXES['correction']).toBe('correction');
    expect(RULE_KEY_PREFIXES['preference']).toBe('prefer');
  });

  it('numeric constants have correct values', () => {
    expect(DEFAULT_TEMPORARY_PREFERENCE_DAYS).toBe(14);
    expect(ALL_TIME_DAYS).toBe(3650);
    expect(FALLBACK_THRESHOLD).toBe(3);
    expect(SUMMARY_MAX_LEN).toBe(500);
  });

  it('BUCKET_TYPE_MAP contains correct bucket mappings', () => {
    expect(BUCKET_TYPE_MAP['daily'].has('daily')).toBe(true);
    expect(BUCKET_TYPE_MAP['daily'].has('diary')).toBe(true);
    expect(BUCKET_TYPE_MAP['draft'].has('draft')).toBe(true);
    expect(BUCKET_TYPE_MAP['project'].has('project')).toBe(true);
    expect(BUCKET_TYPE_MAP['knowledge'].has('knowledge')).toBe(true);
    expect(BUCKET_TYPE_MAP['knowledge'].has('note')).toBe(true);
    expect(BUCKET_TYPE_MAP['knowledge'].has('review-record')).toBe(true);
  });
});

// ─── resolveSessionId ─────────────────────────────────────────────────────────

describe('resolveSessionId', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of SESSION_ID_ENV_KEYS) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns the provided session_id when given', () => {
    expect(resolveSessionId('my-session-123')).toBe('my-session-123');
  });

  it('trims whitespace from provided session_id', () => {
    expect(resolveSessionId('  abc  ')).toBe('abc');
  });

  it('returns untracked when no session_id and no env vars', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    expect(resolveSessionId()).toBe('untracked');
  });

  it('falls back to LIFEOS_SESSION_ID env var', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    process.env['LIFEOS_SESSION_ID'] = 'env-session-abc';
    expect(resolveSessionId()).toBe('env-session-abc');
  });

  it('falls back to CLAUDE_SESSION_ID when LIFEOS_SESSION_ID not set', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    process.env['CLAUDE_SESSION_ID'] = 'claude-session-xyz';
    expect(resolveSessionId()).toBe('claude-session-xyz');
  });

  it('prefers earlier env var when multiple are set', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    process.env['LIFEOS_SESSION_ID'] = 'first';
    process.env['CLAUDE_SESSION_ID'] = 'second';
    expect(resolveSessionId()).toBe('first');
  });

  it('returns untracked when session_id is empty string', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    expect(resolveSessionId('')).toBe('untracked');
  });

  it('returns untracked when session_id is whitespace only', () => {
    for (const key of SESSION_ID_ENV_KEYS) delete process.env[key];
    expect(resolveSessionId('   ')).toBe('untracked');
  });
});

// ─── coerceNow ────────────────────────────────────────────────────────────────

describe('coerceNow', () => {
  it('returns a Date when called with no arguments', () => {
    const result = coerceNow();
    expect(result).toBeInstanceOf(Date);
  });

  it('returns the same Date object when given a Date', () => {
    const d = new Date('2024-01-15T10:00:00Z');
    const result = coerceNow(d);
    expect(result).toEqual(d);
  });

  it('parses ISO string to Date', () => {
    const result = coerceNow('2024-06-01T12:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-06-01T12:00:00.000Z');
  });

  it('throws on unsupported type', () => {
    expect(() => coerceNow(12345 as unknown as string)).toThrow();
  });

  it('returns current time (approximately) when called with no args', () => {
    const before = Date.now();
    const result = coerceNow();
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

// ─── loadsJsonList ────────────────────────────────────────────────────────────

describe('loadsJsonList', () => {
  it('returns empty array for null', () => {
    expect(loadsJsonList(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(loadsJsonList(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(loadsJsonList('')).toEqual([]);
  });

  it('returns the list as strings when given a JSON array string', () => {
    expect(loadsJsonList('["a", "b", "c"]')).toEqual(['a', 'b', 'c']);
  });

  it('returns array as-is when given a JS array', () => {
    expect(loadsJsonList(['x', 'y'])).toEqual(['x', 'y']);
  });

  it('converts array items to strings', () => {
    expect(loadsJsonList([1, 2, 3])).toEqual(['1', '2', '3']);
  });

  it('filters out null items in arrays', () => {
    expect(loadsJsonList([null, 'a', null, 'b'])).toEqual(['a', 'b']);
  });

  it('wraps a plain string in an array', () => {
    expect(loadsJsonList('hello')).toEqual(['hello']);
  });

  it('wraps a non-array JSON value in an array', () => {
    expect(loadsJsonList('"hello"')).toEqual(['hello']);
  });

  it('returns empty array for JSON null', () => {
    expect(loadsJsonList('null')).toEqual([]);
  });

  it('converts non-string non-array values to string', () => {
    expect(loadsJsonList(42)).toEqual(['42']);
  });
});

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty or whitespace string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
  });

  it('counts CJK characters', () => {
    const result = estimateTokens('你好世界');
    expect(result).toBe(4);
  });

  it('counts Latin words with 1.3x multiplier', () => {
    // "hello world" = 2 words → ceil(2 * 1.3) = 3
    const result = estimateTokens('hello world');
    expect(result).toBe(3);
  });

  it('returns positive value for mixed text', () => {
    const result = estimateTokens('Hello 你好 World');
    expect(result).toBeGreaterThan(0);
  });

  it('handles single word', () => {
    // "hello" = 1 word → ceil(1 * 1.3) = 2
    const result = estimateTokens('hello');
    expect(result).toBe(2);
  });
});

// ─── containsCjk ─────────────────────────────────────────────────────────────

describe('containsCjk', () => {
  it('returns true for Chinese text', () => {
    expect(containsCjk('你好')).toBe(true);
  });

  it('returns false for ASCII text', () => {
    expect(containsCjk('hello world')).toBe(false);
  });

  it('returns true for mixed text', () => {
    expect(containsCjk('hello 世界')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(containsCjk('')).toBe(false);
  });

  it('returns false for numbers and punctuation', () => {
    expect(containsCjk('123!@#')).toBe(false);
  });
});

// ─── normalizeWikilinkValue ───────────────────────────────────────────────────

describe('normalizeWikilinkValue', () => {
  it('returns null for null input', () => {
    expect(normalizeWikilinkValue(null)).toBeNull();
  });

  it('strips [[ and ]] from wikilinks', () => {
    expect(normalizeWikilinkValue('[[MyNote]]')).toBe('MyNote');
  });

  it('returns plain string unchanged', () => {
    expect(normalizeWikilinkValue('MyNote')).toBe('MyNote');
  });

  it('trims whitespace', () => {
    expect(normalizeWikilinkValue('  [[MyNote]]  ')).toBe('MyNote');
  });

  it('trims inner whitespace in wikilinks', () => {
    expect(normalizeWikilinkValue('[[ MyNote ]]')).toBe('MyNote');
  });

  it('converts non-string values to string', () => {
    expect(normalizeWikilinkValue(42)).toBe('42');
  });
});

// ─── compactText ──────────────────────────────────────────────────────────────

describe('compactText', () => {
  it('returns fallback for empty input', () => {
    expect(compactText('')).toBe('暂无摘要');
    expect(compactText(null)).toBe('暂无摘要');
    expect(compactText(undefined)).toBe('暂无摘要');
  });

  it('normalizes whitespace', () => {
    expect(compactText('hello   world')).toBe('hello world');
  });

  it('returns text as-is when within limit', () => {
    const text = 'hello world';
    expect(compactText(text)).toBe(text);
  });

  it('truncates long text with ellipsis', () => {
    const text = 'a'.repeat(200);
    const result = compactText(text, 100);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('uses default limit of 160', () => {
    const text = 'b'.repeat(200);
    const result = compactText(text);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('...')).toBe(true);
  });
});

// ─── normalizeRuleSummary ─────────────────────────────────────────────────────

describe('normalizeRuleSummary', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeRuleSummary('')).toBe('');
    expect(normalizeRuleSummary(null)).toBe('');
  });

  it('normalizes whitespace', () => {
    expect(normalizeRuleSummary('hello   world')).toBe('hello world');
  });

  it('truncates to limit without ellipsis', () => {
    const text = 'c'.repeat(200);
    const result = normalizeRuleSummary(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('...')).toBe(false);
  });
});

// ─── resolveRuleKey ───────────────────────────────────────────────────────────

describe('resolveRuleKey', () => {
  it('returns null when entry type has no prefix and no explicit key', () => {
    expect(resolveRuleKey('blocker', 'some text')).toBeNull();
  });

  it('builds default rule key for decision type', () => {
    const result = resolveRuleKey('decision', 'use TypeScript for all modules');
    expect(result).toBe('decision:use TypeScript for all modules');
  });

  it('builds default rule key for preference type', () => {
    const result = resolveRuleKey('preference', 'keep notes concise');
    expect(result).toBe('prefer:keep notes concise');
  });

  it('uses explicit rule_key from detail_obj', () => {
    const result = resolveRuleKey('decision', 'some text', { rule_key: 'custom:key' });
    expect(result).toBe('custom:key');
  });

  it('uses preference_slot from detail_obj', () => {
    const result = resolveRuleKey('preference', 'some text', { preference_slot: 'format:note-style' });
    expect(result).toBe('format:note-style');
  });

  it('uses constraint_key from detail_obj', () => {
    const result = resolveRuleKey('correction', 'some text', { constraint_key: 'no-english' });
    expect(result).toBe('no-english');
  });

  it('returns null when entry type has no prefix and summary is empty', () => {
    expect(resolveRuleKey('decision', '')).toBeNull();
  });
});

// ─── inferTemporaryPreference ─────────────────────────────────────────────────

describe('inferTemporaryPreference', () => {
  it('returns temporary: false by default for neutral text', () => {
    const result = inferTemporaryPreference('keep code clean');
    expect(result.temporary).toBe(false);
  });

  it('detects stable keywords and returns temporary: false', () => {
    const result = inferTemporaryPreference('长期使用简洁风格');
    expect(result.temporary).toBe(false);
  });

  it('detects temporary keywords and returns temporary: true with expiresInDays', () => {
    const result = inferTemporaryPreference('这次先用英文');
    expect(result.temporary).toBe(true);
    expect(result.expiresInDays).toBe(DEFAULT_TEMPORARY_PREFERENCE_DAYS);
    expect(result.temporarySource).toBe('keyword_fallback');
  });

  it('respects explicit temporary: true in detail_obj', () => {
    const result = inferTemporaryPreference('some text', { temporary: true });
    expect(result.temporary).toBe(true);
    expect(result.temporarySource).toBe('explicit');
  });

  it('respects explicit temporary: false in detail_obj', () => {
    const result = inferTemporaryPreference('这次先用英文', { temporary: false });
    expect(result.temporary).toBe(false);
  });

  it('uses expiresInDays from detail_obj', () => {
    const result = inferTemporaryPreference('some text', { temporary: true, expires_in_days: 7 });
    expect(result.expiresInDays).toBe(7);
  });

  it('uses expiresAt from detail_obj', () => {
    const result = inferTemporaryPreference('some text', { temporary: true, expires_at: '2025-01-01' });
    expect(result.expiresAt).toBe('2025-01-01');
  });

  it('detects 暂时 as temporary keyword', () => {
    const result = inferTemporaryPreference('暂时不用这个格式');
    expect(result.temporary).toBe(true);
  });

  it('detects 默认 as stable keyword', () => {
    const result = inferTemporaryPreference('默认使用简洁风格');
    expect(result.temporary).toBe(false);
  });
});

// ─── parseDetailObject ────────────────────────────────────────────────────────

describe('parseDetailObject', () => {
  it('returns empty object for null', () => {
    expect(parseDetailObject(null)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseDetailObject('')).toEqual({});
  });

  it('parses valid JSON object string', () => {
    const result = parseDetailObject('{"key": "value", "num": 42}');
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseDetailObject('not json')).toEqual({});
  });

  it('returns empty object when JSON is not an object (e.g. array)', () => {
    expect(parseDetailObject('[1, 2, 3]')).toEqual({});
  });

  it('returns empty object when JSON is a primitive', () => {
    expect(parseDetailObject('"hello"')).toEqual({});
  });
});

// ─── isArchiveSummary ─────────────────────────────────────────────────────────

describe('isArchiveSummary', () => {
  it('returns true when entry_type is archive_summary', () => {
    expect(isArchiveSummary('anything', 'archive_summary')).toBe(true);
  });

  it('returns true when summary starts with 归档摘要：', () => {
    expect(isArchiveSummary('归档摘要：some content')).toBe(true);
  });

  it('returns false for normal summary', () => {
    expect(isArchiveSummary('normal summary')).toBe(false);
  });

  it('returns false for null summary without archive_summary type', () => {
    expect(isArchiveSummary(null)).toBe(false);
  });
});

