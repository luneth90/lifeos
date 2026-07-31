import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'assets', 'skills', '_shared', 'scripts', 'path_safety.mjs');

async function loadModule(): Promise<typeof import('../../assets/skills/_shared/scripts/path_safety.mjs')> {
	return import(scriptPath);
}

describe('路径安全脚本', () => {
	it('将文件名归一到 NFC 并折叠空白', async () => {
		const { normalizeFilenameComponent: normalize } = await loadModule();
		expect(normalize('Cafe\u0301  周报')).toBe('Café 周报');
	});

	it.each(['', '   ', '.', '..', '../secret', 'a/b', 'a\\b', 'bad\u0000name', 'CON', 'aux.md'])(
		'拒绝不安全的文件名组件 %j',
		async (value) => {
			const { normalizeFilenameComponent: normalize } = await loadModule();
			expect(() => normalize(value)).toThrow('unsafe_path_component');
		},
	);

	it('拒绝跳出 Vault 的相对路径', async () => {
		const { resolveVaultPath: resolve } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		expect(() => resolve(root, '../../outside.md')).toThrow('vault_escape');
	});

	it('拒绝通过已存在的符号链接逃离 Vault', async () => {
		const { resolveVaultPath: resolve } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, 'safe'));
		symlinkSync(outside, join(root, 'safe', 'link'));
		expect(() => resolve(realpathSync(root), 'safe/link/report.md')).toThrow('vault_escape');
	});

	it('CLI 以机器可读错误和非零退出码拒绝不安全输入', () => {
		const result = spawnSync('node', [scriptPath], {
			encoding: 'utf8',
			input: JSON.stringify({ mode: 'normalize', value: '../secret' }),
		});
		expect(result.status).not.toBe(0);
		expect(JSON.parse(result.stderr)).toMatchObject({ error: 'unsafe_path_component' });
	});
});
