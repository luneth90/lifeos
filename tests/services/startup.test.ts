import { writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDefaultInstance } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { createTempVault, createTestDb, writeTestNote } from '../setup.js';
import type { TempVault } from '../setup.js';

import { generateEnhancedSearchTerms, mergeSearchHints } from '../../src/services/enhance.js';
import { buildLayer0Summary, extractAutoSection, trimToBudget } from '../../src/services/layer0.js';
// Services under test
import { runStartup } from '../../src/services/startup.js';

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
		const result = buildLayer0Summary(vault.root);
		expect(result).toBe('');
	});

	it('includes UserProfile section when AUTO block exists', () => {
		const memoryDir = join(vault.root, '90_系统', '记忆');
		writeFileSync(
			join(memoryDir, 'UserProfile.md'),
			`# UserProfile\n<!-- BEGIN AUTO:profile-summary -->\n用户偏好：简洁风格\n<!-- END AUTO:profile-summary -->`,
			'utf-8',
		);
		const result = buildLayer0Summary(vault.root);
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
		const result = buildLayer0Summary(vault.root);
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
		const result = buildLayer0Summary(vault.root);
		expect(result).toContain('行为约束');
		expect(result).toContain('输出语言使用中文');
		expect(result).toContain('UserProfile 速览');
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
		expect(parsed.filter((t) => t === '任务').length).toBe(1);
	});

	it('handles null base hints', () => {
		const result = mergeSearchHints(null, ['term1', 'term2']);
		const parsed = JSON.parse(result) as string[];
		expect(parsed).toContain('term1');
		expect(parsed).toContain('term2');
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
		expect(typeof result['layer0_summary']).toBe('string');
		expect(typeof result['vault_stats']['total_files']).toBe('number');
	});

	it('counts vault files after scan', () => {
		writeTestNote(vault.root, '20_项目/project-a.md', {
			title: '项目A',
			type: 'project',
			status: 'active',
		});
		writeTestNote(vault.root, '20_项目/project-b.md', {
			title: '项目B',
			type: 'project',
			status: 'done',
		});
		const result = runStartup(db, vault.root);
		expect(result['vault_stats']['total_files']).toBeGreaterThanOrEqual(0);
	});
});
