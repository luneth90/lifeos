import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultConfig } from '../../src/config.js';
import { initDb } from '../../src/db/schema.js';
import { buildScopeCatalog } from '../../src/services/scope-catalog.js';
import { createTempVault } from '../setup.js';
import type { TempVault } from '../setup.js';

describe('作用域目录', () => {
	let db: Database.Database;
	let vault: TempVault;

	beforeEach(() => {
		vault = createTempVault();
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => {
		db.close();
		vault.cleanup();
	});

	it('独立发现已安装技能、配置绑定与索引对象，并保持确定性排序', () => {
		for (const name of [
			'today',
			'ask',
			'brainstorm',
			'knowledge',
			'research',
			'_shared',
			'.隐藏',
		]) {
			const skillFile = join(vault.root, '.agents', 'skills', name, 'SKILL.md');
			mkdirSync(dirname(skillFile), { recursive: true });
			writeFileSync(skillFile, `# ${name}\n`, 'utf-8');
		}
		mkdirSync(join(vault.root, '.agents', 'skills', '缺少入口'), { recursive: true });

		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES (?,?,?,?,?)
		`).run('40_知识/概念.md', '概念', 'note', 'review', 'note-concept');
		db.prepare(`
			INSERT INTO vault_index(file_path,title,type,status,entity_id)
			VALUES (?,?,?,?,?)
		`).run('20_项目/代数.md', '代数', 'project', 'active', 'project-algebra');

		const config = new VaultConfig(vault.root, {
			memory: {
				repository_bindings: {
					'zeta-repo': ['/workspace/zeta'],
					'alpha-repo': ['/workspace/alpha'],
				},
				tool_bindings: {
					zeta: { commands: ['zeta'], skills: [] },
					alpha: { commands: ['alpha'], skills: ['alpha-cli'] },
				},
			},
		});

		expect(buildScopeCatalog(db, config)).toEqual({
			skills: ['ask', 'brainstorm', 'knowledge', 'research', 'today'],
			tools: {
				alpha: { commands: ['alpha'], skills: ['alpha-cli'] },
				obsidian: { commands: ['obsidian'], skills: ['obsidian-cli'] },
				zeta: { commands: ['zeta'], skills: [] },
			},
			repositories: {
				'alpha-repo': ['/workspace/alpha'],
				'zeta-repo': ['/workspace/zeta'],
			},
			projects: [{ entityId: 'project-algebra', filePath: '20_项目/代数.md' }],
			files: [
				{ entityId: 'project-algebra', filePath: '20_项目/代数.md' },
				{ entityId: 'note-concept', filePath: '40_知识/概念.md' },
			],
		});
	});

	it('不跟随技能目录或 SKILL.md 符号链接', () => {
		const externalVault = createTempVault();
		const externalSkill = join(externalVault.root, 'external', 'SKILL.md');
		mkdirSync(dirname(externalSkill), { recursive: true });
		writeFileSync(externalSkill, '# external\n', 'utf-8');
		const skillsRoot = join(vault.root, '.agents', 'skills');
		mkdirSync(skillsRoot, { recursive: true });
		symlinkSync(dirname(externalSkill), join(skillsRoot, 'linked-directory'));
		const linkedFileRoot = join(skillsRoot, 'linked-file');
		mkdirSync(linkedFileRoot, { recursive: true });
		symlinkSync(externalSkill, join(linkedFileRoot, 'SKILL.md'));

		try {
			const config = new VaultConfig(vault.root);
			expect(buildScopeCatalog(db, config).skills).toEqual([]);
		} finally {
			externalVault.cleanup();
		}
	});
});
