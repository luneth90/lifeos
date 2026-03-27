import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import initCommand from '../../src/cli/commands/init.js';
import renameCommand from '../../src/cli/commands/rename.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-rename-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('lifeos rename', () => {
	test('renames top-level directory and updates lifeos.yaml', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const result = await renameCommand([dir, '--logical', 'drafts', '--name', '00_Inbox']);
			expect(result.logical).toBe('drafts');
			expect(result.oldPhysical).toBe('00_草稿');
			expect(result.newPhysical).toBe('00_Inbox');
			expect(existsSync(join(dir, '00_Inbox'))).toBe(true);
			expect(existsSync(join(dir, '00_草稿'))).toBe(false);
			const yaml = parseYaml(readFileSync(join(dir, 'lifeos.yaml'), 'utf-8'));
			expect(yaml.directories.drafts).toBe('00_Inbox');
		} finally {
			cleanup();
		}
	});

	test('updates wikilinks in markdown files', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			writeFileSync(join(dir, '10_日记', 'test.md'), '链接到 [[00_草稿/idea]]');
			const result = await renameCommand([dir, '--logical', 'drafts', '--name', '00_Inbox']);
			const content = readFileSync(join(dir, '10_日记', 'test.md'), 'utf-8');
			expect(content).toBe('链接到 [[00_Inbox/idea]]');
			expect(result.wikilinksUpdated).toBe(1);
		} finally {
			cleanup();
		}
	});

	test('rewrites managed asset keys when renaming top-level directories', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);

			await renameCommand([dir, '--logical', 'system', '--name', '99_系统']);

			const yaml = parseYaml(readFileSync(join(dir, 'lifeos.yaml'), 'utf-8')) as {
				managed_assets?: Record<string, { version?: string; sha256?: string }>;
			};

			expect(yaml.managed_assets?.['99_系统/模板/Daily_Template.md']).toBeDefined();
			expect(yaml.managed_assets?.['90_系统/模板/Daily_Template.md']).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	test('throws for unknown logical name', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			await expect(
				renameCommand([dir, '--logical', 'nonexistent', '--name', 'foo']),
			).rejects.toThrow(/Unknown logical name/);
		} finally {
			cleanup();
		}
	});

	test('throws when no lifeos.yaml', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await expect(
				renameCommand([dir, '--logical', 'drafts', '--name', 'foo']),
			).rejects.toThrow(/No lifeos.yaml/);
		} finally {
			cleanup();
		}
	});

	test('en vault rename works', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'en', '--no-mcp']);
			const result = await renameCommand([dir, '--logical', 'drafts', '--name', 'Inbox']);
			expect(existsSync(join(dir, 'Inbox'))).toBe(true);
			expect(existsSync(join(dir, '00_Drafts'))).toBe(false);
		} finally {
			cleanup();
		}
	});
});
