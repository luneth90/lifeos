import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { VERSION } from '../src/cli/utils/version.js';
import { resolveConfig } from '../src/config.js';
import { initDb } from '../src/db/schema.js';
import {
	RuntimeContractError,
	assertRuntimeContract,
	runtimePackageSha256,
	validateRuntimeContract,
	writeFreshInstallReceipt,
	writeRuntimeReceipt,
} from '../src/runtime-contract.js';
import { createTempVault } from './setup.js';

function hash(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

describe('runtime contract 最终 V2/V4 门禁', () => {
	let vault: ReturnType<typeof createTempVault>;
	let receiptPath: string;

	beforeEach(() => {
		vault = createTempVault();
		receiptPath = join(vault.root, '90_系统', '记忆', 'runtime-receipt.json');
		writeFreshInstallReceipt(vault.root, resolveConfig(vault.root), VERSION);
	});

	afterEach(() => vault.cleanup());

	it('接受 contract=2、schema=4、opened 的 fresh install 收据', () => {
		const db = new Database(vault.dbPath);
		try {
			initDb(db);
			const result = validateRuntimeContract({
				vaultRoot: vault.root,
				db,
				runtimeVersion: VERSION,
				verifyManagedAssets: false,
			});
			expect(result).toMatchObject({
				ok: true,
				receipt: {
					contract_version: 2,
					schema_version: 4,
					kind: 'fresh-install',
					state: 'opened',
				},
			});
		} finally {
			db.close();
		}
	});

	it('缺失、损坏或旧版本收据均硬失败', () => {
		unlinkSync(receiptPath);
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			'缺少 runtime-receipt.json',
		);

		writeFileSync(receiptPath, '{broken', 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			'runtime receipt 不是有效 JSON',
		);

		writeFileSync(
			receiptPath,
			JSON.stringify({
				contract_version: 1,
				schema_version: 3,
				kind: 'legacy',
				state: 'shadow',
				runtime_version: VERSION,
				installed_at: new Date().toISOString(),
			}),
			'utf-8',
		);
		const result = validateRuntimeContract({ vaultRoot: vault.root });
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				'receipt contract_version 不是 2',
				'receipt schema_version 不是 4',
				'receipt kind 非法',
				'receipt 尚未 opened',
			]),
		);
	});

	it('数据库不是最终 Schema V4 时拒绝启动，不尝试原地兼容', () => {
		const db = new Database(vault.dbPath);
		try {
			initDb(db);
			db.prepare('UPDATE schema_version SET version = 3').run();
			const result = validateRuntimeContract({
				vaultRoot: vault.root,
				db,
				verifyManagedAssets: false,
			});
			expect(result.ok).toBe(false);
			expect(result.issues).toContain('数据库 Schema 必须为 4，当前为 3');
			expect(() =>
				assertRuntimeContract({
					vaultRoot: vault.root,
					db,
					verifyManagedAssets: false,
				}),
			).toThrow(RuntimeContractError);
		} finally {
			db.close();
		}
	});

	it('upgrade 收据必须引用绝对且 opened 的 V2/V4 cutover journal', () => {
		const journalPath = join(vault.root, 'journal.json');
		const packageSha256 = runtimePackageSha256();
		writeRuntimeReceipt(vault.root, {
			contract_version: 2,
			schema_version: 4,
			kind: 'upgrade',
			state: 'opened',
			runtime_version: VERSION,
			installed_at: new Date().toISOString(),
			journal_path: journalPath,
			package_sha256: packageSha256,
		});
		writeFileSync(
			journalPath,
			JSON.stringify({
				state: 'verified',
				contract_version: 2,
				schema_version: 4,
				package_sha256: packageSha256,
			}),
			'utf-8',
		);
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			'cutover journal 尚未 opened',
		);

		writeFileSync(
			journalPath,
			JSON.stringify({
				state: 'opened',
				contract_version: 2,
				schema_version: 4,
				package_sha256: packageSha256,
			}),
			'utf-8',
		);
		const valid = validateRuntimeContract({ vaultRoot: vault.root });
		expect(valid.issues).toEqual([]);
		expect(valid.ok).toBe(true);
	});

	it('运行版本、CLI 版本和资产版本必须完全一致', () => {
		const result = validateRuntimeContract({
			vaultRoot: vault.root,
			runtimeVersion: '9.9.9',
			verifyManagedAssets: false,
		});
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.stringContaining('receipt runtime_version'),
				'installed_versions.cli 与运行版本不一致',
				'installed_versions.assets 与运行版本不一致',
			]),
		);
	});

	it('managed asset 缺失、越界或哈希变化均阻断最终 runtime', () => {
		const assetPath = '90_系统/模板/contract-test.md';
		const fullPath = join(vault.root, assetPath);
		writeFileSync(fullPath, 'final asset', 'utf-8');
		const yamlPath = join(vault.root, 'lifeos.yaml');
		const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
		config.managed_assets = {
			[assetPath]: { version: VERSION, sha256: hash('final asset') },
		};
		writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).ok).toBe(true);

		writeFileSync(fullPath, 'tampered', 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			`managed asset 哈希不匹配：${assetPath}`,
		);

		config.managed_assets = {
			'../outside.md': { version: VERSION, sha256: hash('x') },
		};
		writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			'managed asset 路径非法：../outside.md',
		);
	});

	it('收据使用原子替换，不遗留临时文件', () => {
		writeFreshInstallReceipt(vault.root, resolveConfig(vault.root), VERSION);
		expect(existsSync(receiptPath)).toBe(true);
		expect(readdirSync(join(vault.root, '90_系统', '记忆'))).not.toEqual(
			expect.arrayContaining([expect.stringMatching(/^runtime-receipt\.json\.tmp-/)]),
		);
	});
});
