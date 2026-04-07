import { describe, expect, it } from 'vitest';
import {
	ALLOWED_COUNT_TABLES,
	BUCKET_TYPE_MAP,
	coerceNow,
	compactText,
	containsCjk,
	estimateTokens,
	loadsJsonList,
	normalizeWikilinkValue,
	parseDetailObject,
} from '../../src/utils/shared.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
	it('ALLOWED_COUNT_TABLES contains correct tables', () => {
		expect(ALLOWED_COUNT_TABLES.has('vault_index')).toBe(true);
		expect(ALLOWED_COUNT_TABLES.has('unknown_table')).toBe(false);
	});

	it('BUCKET_TYPE_MAP contains correct bucket mappings', () => {
		expect(BUCKET_TYPE_MAP['daily'].has('daily')).toBe(true);
		expect(BUCKET_TYPE_MAP['daily'].has('diary')).toBe(true);
		expect(BUCKET_TYPE_MAP['draft'].has('draft')).toBe(true);
		expect(BUCKET_TYPE_MAP['project'].has('project')).toBe(true);
		expect(BUCKET_TYPE_MAP['knowledge'].has('knowledge')).toBe(true);
		expect(BUCKET_TYPE_MAP['knowledge'].has('note')).toBe(true);
		expect(BUCKET_TYPE_MAP['knowledge'].has('revise-record')).toBe(true);
	});
});

// ─── coerceNow ────────────────────────────────────────────────────────────────

describe('coerceNow', () => {
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
	it.each([null, undefined, ''])('returns empty array for %s', (input) => {
		expect(loadsJsonList(input)).toEqual([]);
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

	it.each(['', '123!@#'])('returns false for non-CJK content: %s', (input) => {
		expect(containsCjk(input)).toBe(false);
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
