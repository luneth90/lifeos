import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
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
			leaf: { state: 'missing' },
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

	it('创建 guard 时拒绝已是符号链接的叶节点', async () => {
		const { createVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, 'parent'));
		writeFileSync(join(outside, 'escaped.md'), 'outside', 'utf8');
		symlinkSync(join(outside, 'escaped.md'), join(root, 'parent', 'report.md'));
		expect(() => createVaultPathGuard(root, 'parent/report.md')).toThrow('vault_escape');
	});

	it('预期不存在的叶节点在复核前变成符号链接时失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, 'parent'));
		writeFileSync(join(outside, 'escaped.md'), 'outside', 'utf8');
		const guard = createVaultPathGuard(root, 'parent/report.md');
		symlinkSync(join(outside, 'escaped.md'), join(root, 'parent', 'report.md'));
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});

	it('已有普通文件被同路径新 inode 替换后复核失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'parent'));
		writeFileSync(join(root, 'parent', 'report.md'), 'before', 'utf8');
		const guard = createVaultPathGuard(root, 'parent/report.md');
		expect(guard.leaf).toMatchObject({
			state: 'existing',
			type: 'file',
			dev: expect.any(String),
			ino: expect.any(String),
			realpath: join(realpathSync(root), 'parent', 'report.md'),
		});
		renameSync(join(root, 'parent', 'report.md'), join(root, 'parent', 'report-original.md'));
		writeFileSync(join(root, 'parent', 'report.md'), 'after', 'utf8');
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});

	it('已有普通文件被删除后复核失败', async () => {
		const { createVaultPathGuard, revalidateVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'parent'));
		writeFileSync(join(root, 'parent', 'report.md'), 'before', 'utf8');
		const guard = createVaultPathGuard(root, 'parent/report.md');
		unlinkSync(join(root, 'parent', 'report.md'));
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
	});

	it('显式推进新目标 missing 到 existing 后可继续复核', async () => {
		const { advanceVaultPathGuard, createVaultPathGuard, revalidateVaultPathGuard } =
			await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'parent'));
		const guard = createVaultPathGuard(root, 'parent/report.md');
		writeFileSync(join(root, 'parent', 'report.md'), 'created', 'utf8');
		expect(() => revalidateVaultPathGuard(guard)).toThrow('path_guard_changed');
		const advanced = advanceVaultPathGuard(guard, {
			before: 'missing',
			after: 'existing',
		});
		expect(advanced.leaf).toMatchObject({ state: 'existing', type: 'file' });
		expect(revalidateVaultPathGuard(advanced)).toBe(
			join(realpathSync(root), 'parent', 'report.md'),
		);
	});

	it('显式推进移动源和目标的 existing/missing 状态后可继续复核', async () => {
		const { advanceVaultPathGuard, createVaultPathGuard, revalidateVaultPathGuard } =
			await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		mkdirSync(join(root, 'source'));
		mkdirSync(join(root, 'target'));
		writeFileSync(join(root, 'source', 'report.md'), 'source', 'utf8');
		const sourceGuard = createVaultPathGuard(root, 'source/report.md');
		const targetGuard = createVaultPathGuard(root, 'target/report.md');
		renameSync(join(root, 'source', 'report.md'), join(root, 'target', 'report.md'));
		const advancedSource = advanceVaultPathGuard(sourceGuard, {
			before: 'existing',
			after: 'missing',
		});
		const advancedTarget = advanceVaultPathGuard(targetGuard, {
			before: 'missing',
			after: 'existing',
		});
		expect(revalidateVaultPathGuard(advancedSource)).toBe(
			join(realpathSync(root), 'source', 'report.md'),
		);
		expect(revalidateVaultPathGuard(advancedTarget)).toBe(
			join(realpathSync(root), 'target', 'report.md'),
		);
	});

	it('创建后叶节点被替换为 Vault 外符号链接时推进失败', async () => {
		const { advanceVaultPathGuard, createVaultPathGuard } = await loadModule();
		const root = mkdtempSync(join(tmpdir(), 'lifeos-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'lifeos-outside-'));
		mkdirSync(join(root, 'parent'));
		writeFileSync(join(outside, 'escaped.md'), 'outside', 'utf8');
		const guard = createVaultPathGuard(root, 'parent/report.md');
		writeFileSync(join(root, 'parent', 'report.md'), 'created', 'utf8');
		unlinkSync(join(root, 'parent', 'report.md'));
		symlinkSync(join(outside, 'escaped.md'), join(root, 'parent', 'report.md'));
		expect(() => advanceVaultPathGuard(guard, { before: 'missing', after: 'existing' })).toThrow(
			'path_guard_changed',
		);
	});
});
