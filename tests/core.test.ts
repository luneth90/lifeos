/**
 * core.test.ts — Tests for core.ts dispatch layer.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDefaultInstance } from '../src/config.js';
import { memoryLog, memoryNotify, memoryQuery, memoryStartup } from '../src/core.js';
import { createTempVault, writeTestNote } from './setup.js';

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

		expect(warnSpy.mock.calls.some((call) => call[0] === '[lifeos] vault scan failed:')).toBe(
			false,
		);

		warnSpy.mockRestore();
	});
});

// ─── memoryLog ────────────────────────────────────────────────────────────────

describe('memoryLog', () => {
	it('upserts a rule and returns slotKey', () => {
		const result = memoryLog({
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'format:latex',
			content: 'Always use LaTeX for math',
		});

		expect(result.slotKey).toBe('format:latex');
		expect(result.action).toBe('created');
	});

	it('updates an existing rule', () => {
		memoryLog({
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'content:language',
			content: 'Use Chinese',
			source: 'correction',
		});
		_resetDefaultInstance();

		const result = memoryLog({
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'content:language',
			content: 'Use Chinese v2',
		});

		expect(result.action).toBe('updated');
	});

	it('refreshes UserProfile rules section after upsert', () => {
		memoryStartup({ dbPath: vault.dbPath, vaultRoot: vault.root });
		_resetDefaultInstance();

		memoryLog({
			dbPath: vault.dbPath,
			vaultRoot: vault.root,
			slotKey: 'format:latex',
			content: 'Always use LaTeX',
		});

		const memoryDir = join(vault.root, '90_系统', '记忆');
		const upContent = readFileSync(join(memoryDir, 'UserProfile.md'), 'utf-8');
		expect(upContent).toContain('format:latex');
		expect(upContent).toContain('Always use LaTeX');
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
