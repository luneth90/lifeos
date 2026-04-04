import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSearchTokens, loadCustomDict, tokenize } from '../../src/utils/segmenter.js';

describe('segmenter', () => {
	describe('tokenize', () => {
		it('segments Chinese text into words', () => {
			const result = tokenize('机器学习的旋转表示');
			expect(result).toContain('机器');
			expect(result).toContain('学习');
			expect(result).toContain('旋转');
			expect(result).toContain('表示');
		});

		it('handles mixed Chinese and English', () => {
			const result = tokenize('Hello World 机器学习');
			expect(result).toContain('hello');
			expect(result).toContain('world');
			expect(result).toContain('机器');
			expect(result).toContain('学习');
		});

		it('returns empty array for empty string', () => {
			expect(tokenize('')).toEqual([]);
		});

		it('returns empty array for whitespace only', () => {
			expect(tokenize('   ')).toEqual([]);
		});

		it('lowercases English words', () => {
			const result = tokenize('TypeScript Node');
			expect(result).toContain('typescript');
			expect(result).toContain('node');
		});

		it('handles numbers', () => {
			const result = tokenize('第3章 Node16');
			expect(result.some((t) => t.includes('3') || t.includes('16'))).toBe(true);
		});

		it('deduplicates tokens', () => {
			const result = tokenize('学习 学习 学习');
			const count = result.filter((t) => t === '学习').length;
			expect(count).toBe(1);
		});

		it('filters out punctuation-only tokens', () => {
			const result = tokenize('你好！世界。');
			for (const token of result) {
				expect(token).toMatch(/[\u4e00-\u9fffA-Za-z0-9_]/);
			}
		});

		it('normalizes markdown wikilinks', () => {
			const result = tokenize('链接到 [[群论]] 概念');
			expect(result).toContain('群论');
			expect(result).toContain('概念');
		});

		it('segments academic Chinese terms accurately', () => {
			const result = tokenize('子群与商群的关系');
			expect(result).toContain('子群');
			expect(result).toContain('商群');
		});

		it('handles mathematical terms with English', () => {
			const result = tokenize('子群与Lagrange定理的应用');
			expect(result).toContain('lagrange');
			expect(result).toContain('定理');
		});

		it('produces fewer tokens than n-gram approach', () => {
			const result = tokenize('机器学习的旋转表示');
			// jieba precise mode should not produce n-gram fragments
			expect(result.length).toBeLessThan(10);
		});
	});

	describe('loadCustomDict', () => {
		it('recognizes custom words after loading dict', () => {
			const dictPath = join(tmpdir(), 'test_custom_dict.txt');
			writeFileSync(dictPath, '四元数群 5 n\n四元数 5 n\n');

			loadCustomDict(dictPath);
			const result = tokenize('四元数群的旋转表示');
			expect(result).toContain('四元数群');

			unlinkSync(dictPath);
		});
	});

	describe('buildSearchTokens', () => {
		it('returns space-separated tokens', () => {
			const result = buildSearchTokens('机器学习入门');
			expect(typeof result).toBe('string');
			expect(result.length).toBeGreaterThan(0);
			const parts = result.split(' ');
			expect(parts.length).toBeGreaterThanOrEqual(1);
		});

		it('returns empty string for empty input', () => {
			expect(buildSearchTokens('')).toBe('');
		});

		it('combines multiple text sources', () => {
			const result = buildSearchTokens('群论', '旋转', null, ['子群']);
			expect(result).toContain('群论');
			expect(result).toContain('旋转');
			expect(result).toContain('子群');
		});
	});
});
