import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'assets', 'skills', '_shared', 'scripts', 'path_safety.mjs');

async function loadModule(): Promise<
	typeof import('../../assets/skills/_shared/scripts/path_safety.mjs')
> {
	return import(scriptPath);
}

describe('路径安全脚本', () => {
	it('将文件名归一到 NFC 并折叠空白', async () => {
		const { normalizeFilenameComponent: normalize } = await loadModule();
		expect(normalize('Cafe\u0301  周报')).toBe('Café 周报');
		expect(normalize('  正常   文件  ')).toBe('正常 文件');
	});

	it.each([
		'',
		'   ',
		'.',
		'..',
		'../secret',
		'a/b',
		'a\\b',
		'bad\u0000name',
		'CON',
		'aux.md',
		'CON .txt',
		'com1 .md',
		'LPT9...',
		'foo.',
		'report:name',
	])('拒绝不安全的文件名组件 %j', async (value) => {
		const { normalizeFilenameComponent: normalize } = await loadModule();
		expect(() => normalize(value)).toThrow('unsafe_path_component');
	});

	it('拒绝跳出 Vault 的相对路径', async () => {
		const { resolveVaultPath: resolve } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		expect(() => resolve(root, '../../outside.md')).toThrow('vault_escape');
	});

	it.each([
		'/etc/passwd',
		'C:\\Windows\\system32',
		'C:/Windows/system32',
		'\\\\server\\share\\file.md',
		'\\\\?\\C:\\file.md',
		'\\\\.\\PhysicalDrive0',
		'\\\\?\\Volume{1234}\\file.md',
	])('拒绝跨平台绝对或设备路径 %j', async (value) => {
		const { resolveVaultPath: resolve } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		expect(() => resolve(root, value)).toThrow('vault_escape');
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

	it('guard 在父目录被替换为 Vault 外符号链接后复核失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, 'parent'));
		const guard = createVaultPathGuard(root, 'parent/report.md');
		expect(guard).toMatchObject({
			contract_version: 1,
			vault_realpath: realpathSync(root),
			relative_path: 'parent/report.md',
			components: ['parent', 'report.md'],
			ancestors: [
				{
					relative_path: '.',
					dev: expect.any(String),
					ino: expect.any(String),
					realpath: realpathSync(root),
				},
				{
					relative_path: 'parent',
					dev: expect.any(String),
					ino: expect.any(String),
					realpath: join(realpathSync(root), 'parent'),
				},
			],
		});
		expect(revalidateVaultPathGuard(guard)).toBe(join(realpathSync(root), 'parent', 'report.md'));

		renameSync(join(root, 'parent'), join(root, 'parent-original'));
		symlinkSync(outside, join(root, 'parent'));
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});

	it('guard 在父目录被同路径新目录替换后按 dev/ino 失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'parent'));
		const guard = createVaultPathGuard(root, 'parent/report.md');
		renameSync(join(root, 'parent'), join(root, 'parent-original'));
		mkdirSync(join(root, 'parent'));
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});

	it('guard 的目标组件被修改后复核失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'parent'));
		const guard = createVaultPathGuard(root, 'parent/report.md');
		guard.components[1] = 'other.md';
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});
});
