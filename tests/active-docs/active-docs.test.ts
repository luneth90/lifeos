import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureActiveDocsExist,
	refreshTaskboard,
	refreshUserprofile,
} from '../../src/active-docs/index.js';
import { buildTaskboardSections } from '../../src/active-docs/taskboard.js';
import { buildUserprofileSections } from '../../src/active-docs/userprofile.js';
import { VaultConfig, _resetDefaultInstance, setVaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { upsertRule } from '../../src/services/capture.js';
import { createTempVault } from '../setup.js';

function createInMemoryDb(): Database.Database {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	initDb(db);
	return db;
}

// ─── ensureActiveDocsExist ─────────────────────────────────────────────────────

describe('ensureActiveDocsExist', () => {
	it('creates TaskBoard.md and UserProfile.md when missing', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			ensureActiveDocsExist(vault.root);

			const memDir = vc.memoryDir();
			expect(existsSync(join(memDir, 'TaskBoard.md'))).toBe(true);
			expect(existsSync(join(memDir, 'UserProfile.md'))).toBe(true);
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('does not overwrite existing files', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			const memDir = vc.memoryDir();
			const tbPath = join(memDir, 'TaskBoard.md');

			ensureActiveDocsExist(vault.root);
			const originalContent = readFileSync(tbPath, 'utf-8');

			// Call again — should not overwrite
			ensureActiveDocsExist(vault.root);
			const afterContent = readFileSync(tbPath, 'utf-8');

			expect(afterContent).toBe(originalContent);
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});
});

// ─── buildTaskboardSections ───────────────────────────────────────────────────

describe('buildTaskboardSections', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns expected section keys and focus mentions active project', () => {
		db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, modified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('20_项目/MyProject.md', 'My Project', 'project', 'active', new Date().toISOString());

		const sections = buildTaskboardSections(db, '/tmp/vault');
		expect(Object.keys(sections)).toEqual(
			expect.arrayContaining(['focus', 'active-projects', 'revises']),
		);
		expect(sections['focus']).toContain('My Project');
		expect(sections['active-projects']).toContain('My Project');
	});

	it('does not include frozen projects in active-projects', () => {
		db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, modified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
			'20_项目/FrozenProject.md',
			'Frozen Project',
			'project',
			'frozen',
			new Date().toISOString(),
		);

		const sections = buildTaskboardSections(db, '/tmp/vault');
		expect(sections['active-projects']).not.toContain('Frozen Project');
	});
});

// ─── buildUserprofileSections ─────────────────────────────────────────────────

describe('buildUserprofileSections', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('returns expected section keys', () => {
		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(Object.keys(sections)).toEqual(
			expect.arrayContaining(['profile-summary', 'rules']),
		);
	});

	it('rules section includes upserted rules', () => {
		upsertRule(db, { slotKey: 'content:language', content: '必须使用中文', source: 'correction' });
		upsertRule(db, { slotKey: 'format:latex', content: '数学公式用 LaTeX', source: 'preference' });

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['rules']).toContain('content:language');
		expect(sections['rules']).toContain('必须使用中文');
		expect(sections['rules']).toContain('format:latex');
	});

it('rules section excludes profile:summary from memory_items', () => {
		upsertRule(db, { slotKey: 'content:language', content: '必须使用中文', source: 'correction' });
		upsertRule(db, { slotKey: 'profile:summary', content: '用户正在学习抽象代数', source: 'preference' });

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['rules']).toContain('content:language');
		expect(sections['rules']).not.toContain('profile:summary');
		expect(sections['rules']).not.toContain('抽象代数');
		expect(sections['profile-summary']).toContain('抽象代数');
	});

it('profile-summary shows learning domains from active learning projects', () => {
		db.prepare(`
      INSERT INTO vault_index (file_path, title, type, category, status, domain, modified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
			'20_项目/MathProject.md',
			'Math Project',
			'project',
			'learning',
			'active',
			'Math',
			new Date().toISOString(),
		);

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['profile-summary']).toContain('Math');
	});
});

// ─── refreshTaskboard ─────────────────────────────────────────────────────────

describe('refreshTaskboard', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => {
		db.close();
	});

	it('creates and writes TaskBoard.md with AUTO sections', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			const result = refreshTaskboard(db, vault.root);
			expect(result.status).toBe('ok');

			const tbPath = join(vc.memoryDir(), 'TaskBoard.md');
			expect(existsSync(tbPath)).toBe(true);

			const content = readFileSync(tbPath, 'utf-8');
			expect(content).toContain('<!-- BEGIN AUTO:focus -->');
			expect(content).toContain('<!-- END AUTO:focus -->');
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('replaces AUTO section content when refreshed', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			refreshTaskboard(db, vault.root);

			db.prepare(`
        INSERT INTO vault_index (file_path, title, type, status, modified_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
				'20_项目/TestProject.md',
				'Test Project',
				'project',
				'active',
				new Date().toISOString(),
			);

			refreshTaskboard(db, vault.root);

			const content = readFileSync(join(vc.memoryDir(), 'TaskBoard.md'), 'utf-8');
			expect(content).toContain('Test Project');
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('preserves manual content outside AUTO markers', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			refreshTaskboard(db, vault.root);

			const tbPath = join(vc.memoryDir(), 'TaskBoard.md');
			const existing = readFileSync(tbPath, 'utf-8');
			const withManual = existing + '\n\n## 手动记录\n我的手动笔记内容\n';
			writeFileSync(tbPath, withManual, 'utf-8');

			refreshTaskboard(db, vault.root);

			const afterContent = readFileSync(tbPath, 'utf-8');
			expect(afterContent).toContain('手动记录');
			expect(afterContent).toContain('我的手动笔记内容');
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('removes obsolete AUTO sections on full rebuild', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);

			// Create UserProfile with obsolete 'decisions' and 'preferences'/'corrections' AUTO blocks
			const memDir = vc.memoryDir();
			mkdirSync(memDir, { recursive: true });
			const upPath = join(memDir, 'UserProfile.md');
			writeFileSync(
				upPath,
				[
					'---',
					'type: userprofile',
					'---',
					'',
					'# UserProfile',
					'',
					'## 用户摘要',
					'<!-- BEGIN AUTO:profile-summary -->',
					'旧摘要',
					'<!-- END AUTO:profile-summary -->',
					'',
					'## 偏好设置',
					'<!-- BEGIN AUTO:preferences -->',
					'旧偏好',
					'<!-- END AUTO:preferences -->',
					'',
					'## 纠错记录',
					'<!-- BEGIN AUTO:corrections -->',
					'旧纠错',
					'<!-- END AUTO:corrections -->',
					'',
					'## 近期决策',
					'<!-- BEGIN AUTO:decisions -->',
					'决策记录',
					'<!-- END AUTO:decisions -->',
					'',
					'## 学习进度',
					'<!-- BEGIN AUTO:learning-progress -->',
					'旧进度',
					'<!-- END AUTO:learning-progress -->',
					'',
				].join('\n'),
				'utf-8',
			);

			// Full refresh — obsolete sections should be removed
			refreshUserprofile(db, vault.root);

			const content = readFileSync(upPath, 'utf-8');
			expect(content).not.toContain('AUTO:decisions');
			expect(content).not.toContain('AUTO:preferences');
			expect(content).not.toContain('AUTO:corrections');
			expect(content).not.toContain('近期决策');
			// New sections should exist
			expect(content).toContain('AUTO:profile-summary');
			expect(content).toContain('AUTO:rules');
			expect(content).not.toContain('AUTO:learning-progress');
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});
});
