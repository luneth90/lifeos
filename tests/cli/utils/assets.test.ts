import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assetsDir, copyDir, ensureDir } from '../../../src/cli/utils/assets.js';
import { parseArgs } from '../../../src/cli/utils/ui.js';

describe('assetsDir', () => {
	test('points to existing assets/ directory', () => {
		const dir = assetsDir();
		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dir, 'lifeos.yaml'))).toBe(true);
		expect(existsSync(join(dir, 'templates', 'zh'))).toBe(true);
		expect(existsSync(join(dir, 'templates', 'en'))).toBe(true);
	});
});

describe('ensureDir', () => {
	test('creates directory and returns true when it does not exist', () => {
		const dir = join(tmpdir(), `lifeos-test-${Date.now()}`);
		try {
			expect(ensureDir(dir)).toBe(true);
			expect(existsSync(dir)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('returns false when directory already exists', () => {
		const dir = join(tmpdir(), `lifeos-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		try {
			expect(ensureDir(dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('copyDir', () => {
	test('copies directory contents recursively', () => {
		const src = join(tmpdir(), `lifeos-src-${Date.now()}`);
		const dest = join(tmpdir(), `lifeos-dest-${Date.now()}`);
		mkdirSync(join(src, 'sub'), { recursive: true });
		writeFileSync(join(src, 'a.txt'), 'hello');
		writeFileSync(join(src, 'sub', 'b.txt'), 'world');
		try {
			copyDir(src, dest);
			expect(existsSync(join(dest, 'a.txt'))).toBe(true);
			expect(existsSync(join(dest, 'sub', 'b.txt'))).toBe(true);
		} finally {
			rmSync(src, { recursive: true, force: true });
			rmSync(dest, { recursive: true, force: true });
		}
	});
});

describe('parseArgs', () => {
	test('parses --flag value and positionals', () => {
		const result = parseArgs(['init', '/tmp/foo', '--lang', 'zh'], {
			lang: { alias: 'l' },
		});
		expect(result.positionals).toEqual(['init', '/tmp/foo']);
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('parses short alias and boolean flag', () => {
		const result = parseArgs(['/tmp/foo', '-l', 'en', '--no-mcp'], {
			lang: { alias: 'l' },
			'no-mcp': {},
		});
		expect(result.positionals).toEqual(['/tmp/foo']);
		expect(result.flags).toEqual({ lang: 'en', 'no-mcp': true });
	});

	test('parses --flag=value form', () => {
		const result = parseArgs(['--lang=zh'], { lang: { alias: 'l' } });
		expect(result.positionals).toEqual([]);
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('applies default values for missing flags', () => {
		const result = parseArgs([], { lang: { default: 'zh' } });
		expect(result.flags).toEqual({ lang: 'zh' });
	});

	test('explicit value overrides default', () => {
		const result = parseArgs(['--lang', 'en'], { lang: { default: 'zh' } });
		expect(result.flags).toEqual({ lang: 'en' });
	});
});
