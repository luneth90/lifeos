import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { upsertMemoryItem } from '../../src/services/memory-items.js';
import { createTempVault } from '../setup.js';

function createInMemoryDb(): Database.Database {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');
	initDb(db);
	return db;
}

function putGlobal(
	db: Database.Database,
	slotKey: string,
	content: string,
	itemKind: 'rule' | 'profile',
	source: 'preference' | 'correction' = 'preference',
): void {
	upsertMemoryItem(db, {
		slotKey,
		content,
		itemKind,
		scope: { type: 'global', key: '' },
		source,
	});
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
		expect(sections.focus).toContain('My Project');
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

	it('excludes revision notes linked to frozen project with wikilink alias', () => {
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
		db.prepare(`
      INSERT INTO vault_index (file_path, title, type, status, project, modified_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
			'40_知识/笔记/FrozenNote.md',
			'Frozen Note',
			'note',
			'review',
			'[[Frozen Project|项目别名]]',
			new Date().toISOString(),
		);

		const sections = buildTaskboardSections(db, '/tmp/vault');
		expect(sections.revises).not.toContain('Frozen Note');
		expect(sections.revises).toContain('暂无待复习的知识笔记');
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
		expect(Object.keys(sections)).toEqual([
			'profile-summary',
			'global-rules',
			'scoped-rules-index',
		]);
	});

	it('rules section includes upserted rules', () => {
		putGlobal(db, 'content:language', '必须使用中文', 'rule', 'correction');
		putGlobal(db, 'format:latex', '数学公式用 LaTeX', 'rule');

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['global-rules']).toContain('content:language');
		expect(sections['global-rules']).toContain('必须使用中文');
		expect(sections['global-rules']).toContain('format:latex');
	});

	it('scoped-rules-index 只给出局部 scope 摘要，不泄露规则正文', () => {
		upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '项目中的敏感规则正文',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-algebra' },
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:terminology',
			content: '翻译技能术语事实',
			itemKind: 'fact',
			scope: { type: 'skill', key: 'translate' },
		});
		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['scoped-rules-index']).toContain('project:project-algebra');
		expect(sections['scoped-rules-index']).toContain('skill:translate');
		expect(sections['scoped-rules-index']).not.toContain('敏感规则正文');
		expect(sections['global-rules']).not.toContain('format:answer');
	});

	it('global-rules 只展示 rule，不混入 profile 条目', () => {
		putGlobal(db, 'content:language', '必须使用中文', 'rule', 'correction');
		putGlobal(db, 'profile:work_style', '偏好结构化学习', 'profile');

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['global-rules']).toContain('content:language');
		expect(sections['global-rules']).not.toContain('profile:work_style');
		expect(sections['global-rules']).not.toContain('结构化学习');
		expect(sections['profile-summary']).toContain('结构化学习');
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

	it('profile-summary 汇总结构化画像条目', () => {
		putGlobal(db, 'profile:work_style', '偏好单日单主线收敛', 'profile');
		putGlobal(
			db,
			'profile:weak.math_group_theory',
			'子群判定条件容易混淆',
			'profile',
			'correction',
		);

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['profile-summary']).toContain('工作方式');
		expect(sections['profile-summary']).toContain('偏好单日单主线收敛');
		expect(sections['profile-summary']).toContain('薄弱点');
		expect(sections['profile-summary']).toContain('math_group_theory');
		expect(sections['profile-summary']).toContain('子群判定条件容易混淆');
	});

	it('profile-summary keeps unrecognized structured profile slots visible', () => {
		putGlobal(db, 'profile:custom_signal', '这是未来扩展用的画像信号', 'profile');

		const sections = buildUserprofileSections(db, '/tmp/vault');
		expect(sections['profile-summary']).toContain('其他画像');
		expect(sections['profile-summary']).toContain('custom_signal');
		expect(sections['profile-summary']).toContain('这是未来扩展用的画像信号');
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
			const withManual = `${existing}\n\n## 手动记录\n我的手动笔记内容\n`;
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

	it('拒绝运行时改写旧 AUTO 结构，要求先执行显式升级', () => {
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

			const before = readFileSync(upPath, 'utf-8');
			expect(() => refreshUserprofile(db, vault.root)).toThrow(/不是最终 AUTO 区块格式/);
			expect(readFileSync(upPath, 'utf-8')).toBe(before);
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});
});

describe('refreshUserprofile 最终区块协议', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = createInMemoryDb();
	});

	afterEach(() => db.close());

	it('新建文档只包含最终三个 AUTO 标记', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);
			refreshUserprofile(db, vault.root);
			const content = readFileSync(join(vc.memoryDir(), 'UserProfile.md'), 'utf-8');
			expect([...content.matchAll(/<!-- BEGIN AUTO:(\S+) -->/g)].map((match) => match[1])).toEqual(
				['profile-summary', 'global-rules', 'scoped-rules-index'],
			);
			expect(content).not.toContain('AUTO:rules');
			expect(content).not.toContain('AUTO:preferences');
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('section 刷新只修改目标区块，并拒绝未知 marker', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);
			putGlobal(db, 'profile:work_style', '旧画像', 'profile');
			refreshUserprofile(db, vault.root);
			putGlobal(db, 'profile:work_style', '新画像', 'profile');
			putGlobal(db, 'content:language', '必须使用中文', 'rule');

			const result = refreshUserprofile(db, vault.root, { section: 'global-rules' });
			const content = readFileSync(join(vc.memoryDir(), 'UserProfile.md'), 'utf-8');
			expect(result.updatedSection).toBe('global-rules');
			expect(content).toContain('旧画像');
			expect(content).not.toContain('新画像');
			expect(content).toContain('必须使用中文');
			expect(() =>
				refreshUserprofile(db, vault.root, { section: 'unknown-section' }),
			).toThrow(/未知 AUTO 区块/);
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});

	it('AUTO 区块正文中的美元替换符按原文写入', () => {
		const vault = createTempVault();
		try {
			_resetDefaultInstance();
			const vc = new VaultConfig(vault.root);
			setVaultConfig(vc);
			putGlobal(db, 'profile:work_style', '保留 $1、$& 与 $$ 原文', 'profile');
			refreshUserprofile(db, vault.root);
			const content = readFileSync(join(vc.memoryDir(), 'UserProfile.md'), 'utf-8');
			expect(content).toContain('保留 $1、$& 与 $$ 原文');
			expect(content.match(/BEGIN AUTO:profile-summary/g)).toHaveLength(1);
		} finally {
			_resetDefaultInstance();
			vault.cleanup();
		}
	});
});
