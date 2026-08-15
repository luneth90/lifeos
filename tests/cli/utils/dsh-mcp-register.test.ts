import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { registerMcp } from '../../../src/cli/utils/mcp-register.js';

/**
 * 从解析后的 patch 顶层数组中收集所有 id 为 mcp-lifeos 的条目。
 * DSH 的 cordis.patch.yml 是顶层数组，元素为 `{ insert: [...] }` 形态。
 */
function lifeosEntries(parsed: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(parsed)) return [];
	const found: Array<Record<string, unknown>> = [];
	for (const item of parsed) {
		if (
			!item ||
			typeof item !== 'object' ||
			!Array.isArray((item as { insert?: unknown[] }).insert)
		) {
			continue;
		}
		for (const entry of (item as { insert: unknown[] }).insert) {
			if (entry && typeof entry === 'object' && (entry as { id?: string }).id === 'mcp-lifeos') {
				found.push(entry as Record<string, unknown>);
			}
		}
	}
	return found;
}

describe('registerMcp DSH 注册', () => {
	const temporaryRoots: string[] = [];

	function makeRoot(): string {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-dsh-register-'));
		temporaryRoots.push(root);
		return root;
	}

	function makeDshHome(root: string): string {
		return join(root, 'dsh-home');
	}

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('DSH home 不存在时也强制创建目录并写入 cordis.patch.yml', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		expect(existsSync(dshHome)).toBe(false);

		await registerMcp(root, 'replace', { dshHome });

		const path = join(dshHome, 'cordis.patch.yml');
		expect(existsSync(path)).toBe(true);
		const entries = lifeosEntries(parseYaml(readFileSync(path, 'utf-8')));
		expect(entries).toHaveLength(1);
	});

	it('首次注册生成 mcp-lifeos 插件条目，指向当前 vault', async () => {
		const root = makeRoot();
		await registerMcp(root, 'replace', { dshHome: makeDshHome(root) });

		const parsed = parseYaml(
			readFileSync(join(makeDshHome(root), 'cordis.patch.yml'), 'utf-8'),
		) as unknown;
		const entries = lifeosEntries(parsed);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			id: 'mcp-lifeos',
			name: '@deepseek-ai/dsh-mcp-client',
			config: {
				serverName: 'lifeos',
				transport: 'stdio',
				command: 'lifeos',
				args: ['--vault-root', root],
			},
		});
	});

	it('重复注册幂等：mcp-lifeos 条目不重复插入', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);

		await registerMcp(root, 'replace', { dshHome });
		await registerMcp(root, 'replace', { dshHome });

		const parsed = parseYaml(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')) as unknown;
		expect(lifeosEntries(parsed)).toHaveLength(1);
	});

	it('replace 模式更新已有 mcp-lifeos 条目的 vaultRoot', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		const staleVault = join(root, 'stale-vault');
		mkdirSync(dshHome, { recursive: true });
		writeFileSync(
			join(dshHome, 'cordis.patch.yml'),
			[
				'- insert:',
				'    - id: mcp-lifeos',
				"      name: '@deepseek-ai/dsh-mcp-client'",
				'      config:',
				'        serverName: lifeos',
				'        transport: stdio',
				'        command: lifeos',
				'        args:',
				"          - '--vault-root'",
				`          - '${staleVault}'`,
				'',
			].join('\n'),
			'utf-8',
		);

		await registerMcp(root, 'replace', { dshHome });

		const parsed = parseYaml(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')) as unknown;
		const entries = lifeosEntries(parsed);
		expect(entries).toHaveLength(1);
		const config = entries[0].config as { args: string[] };
		expect(config.args).toEqual(['--vault-root', root]);
	});

	it('merge-missing 模式保留已有 mcp-lifeos 条目', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		const staleVault = join(root, 'stale-vault');
		mkdirSync(dshHome, { recursive: true });
		writeFileSync(
			join(dshHome, 'cordis.patch.yml'),
			[
				'- insert:',
				'    - id: mcp-lifeos',
				"      name: '@deepseek-ai/dsh-mcp-client'",
				'      config:',
				'        serverName: lifeos',
				'        transport: stdio',
				'        command: lifeos',
				'        args:',
				"          - '--vault-root'",
				`          - '${staleVault}'`,
				'',
			].join('\n'),
			'utf-8',
		);

		await registerMcp(root, 'merge-missing', { dshHome });

		const parsed = parseYaml(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')) as unknown;
		const entries = lifeosEntries(parsed);
		expect(entries).toHaveLength(1);
		const config = entries[0].config as { args: string[] };
		expect(config.args).toEqual(['--vault-root', staleVault]);
	});

	it('merge-missing 模式在 mcp-lifeos 不存在时仍会插入条目', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		mkdirSync(dshHome, { recursive: true });
		writeFileSync(
			join(dshHome, 'cordis.patch.yml'),
			[
				'- insert:',
				'    - id: mcp-other',
				"      name: '@deepseek-ai/dsh-mcp-client'",
				'      config:',
				'        serverName: other',
				'        transport: stdio',
				'        command: other-tool',
				'',
			].join('\n'),
			'utf-8',
		);

		await registerMcp(root, 'merge-missing', { dshHome });

		const parsed = parseYaml(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')) as unknown;
		const entries = lifeosEntries(parsed);
		expect(entries).toHaveLength(1);
		const config = entries[0].config as { args: string[] };
		expect(config.args).toEqual(['--vault-root', root]);
	});

	it('合并时保留已有其他 insert 条目与顶层条目', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		mkdirSync(dshHome, { recursive: true });
		writeFileSync(
			join(dshHome, 'cordis.patch.yml'),
			[
				'# 用户已有注释',
				'- insert:',
				'    - id: mcp-other',
				"      name: '@deepseek-ai/dsh-mcp-client'",
				'      config:',
				'        serverName: other',
				'        transport: stdio',
				'        command: other-tool',
				'',
			].join('\n'),
			'utf-8',
		);

		await registerMcp(root, 'replace', { dshHome });

		const parsed = parseYaml(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')) as unknown;
		expect(parsed).toHaveLength(1);
		const insert = (parsed as Array<{ insert: unknown[] }>)[0].insert;
		const ids = insert.map((entry) => (entry as { id?: string }).id).sort();
		expect(ids).toEqual(['mcp-lifeos', 'mcp-other']);
		expect(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')).toContain('# 用户已有注释');
	});

	it('现有 cordis.patch.yml 根节点不是数组时拒绝覆盖并保留原文', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		mkdirSync(dshHome, { recursive: true });
		const original = 'someKey: value\n';
		writeFileSync(join(dshHome, 'cordis.patch.yml'), original, 'utf-8');

		await expect(registerMcp(root, 'replace', { dshHome })).rejects.toThrow(/根节点必须是数组/);
		expect(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')).toBe(original);
	});

	it('现有 cordis.patch.yml 无法解析时拒绝覆盖并保留原文', async () => {
		const root = makeRoot();
		const dshHome = makeDshHome(root);
		mkdirSync(dshHome, { recursive: true });
		const malformed = 'config: "unterminated\n';
		writeFileSync(join(dshHome, 'cordis.patch.yml'), malformed, 'utf-8');

		await expect(registerMcp(root, 'replace', { dshHome })).rejects.toThrow(/无法解析，拒绝覆盖/);
		expect(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf-8')).toBe(malformed);
	});
});
