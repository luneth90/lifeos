import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createCutover } from '../src/cli/utils/cutover.js';
import { VERSION } from '../src/cli/utils/version.js';
import { resolveConfig } from '../src/config.js';
import { acquireCutoverLock, releaseCutoverLock } from '../src/cutover-lock.js';
import {
	RuntimeContractError,
	assertRuntimeContract,
	runtimePackageSha256,
	validateRuntimeContract,
	writeFreshInstallReceipt,
	writeRuntimeReceipt,
} from '../src/runtime-contract.js';
import { createTempVault, prepareRuntimeVault } from './setup.js';

function hash(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

describe('runtime contract 最终 V2/V4 门禁', () => {
	let vault: ReturnType<typeof createTempVault>;
	let receiptPath: string;

	beforeEach(async () => {
		vault = createTempVault();
		receiptPath = join(vault.root, '90_系统', '记忆', 'runtime-receipt.json');
		await prepareRuntimeVault(vault);
	});

	afterEach(() => vault.cleanup());

	it('接受 V4 DB、opened 收据与全量 managed assets 的完整 runtime', () => {
		const db = new Database(vault.dbPath, { fileMustExist: true });
		try {
			const result = validateRuntimeContract({
				vaultRoot: vault.root,
				db,
				runtimeVersion: VERSION,
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
		const db = new Database(vault.dbPath, { fileMustExist: true });
		try {
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
		const packageSha256 = runtimePackageSha256();
		const cutover = createCutover(vault.root, '1.8.3', VERSION, packageSha256);
		const { journalPath } = cutover;
		const cutoverId = cutover.journal.cutover_id;
		mkdirSync(cutover.journal.backup_path);
		writeRuntimeReceipt(vault.root, {
			contract_version: 2,
			schema_version: 4,
			kind: 'upgrade',
			state: 'opened',
			runtime_version: VERSION,
			installed_at: new Date().toISOString(),
			journal_path: journalPath,
			cutover_id: cutoverId,
			package_sha256: packageSha256,
		});
		const journal = {
			state: 'verified',
			contract_version: 2,
			schema_version: 4,
			package_sha256: packageSha256,
			cutover_id: cutoverId,
			vault_root: vault.root,
			to_version: VERSION,
			backup_sha256: 'a'.repeat(64),
			backup_path: cutover.journal.backup_path,
		};
		try {
			writeFileSync(journalPath, JSON.stringify(journal), 'utf-8');
			expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
				'cutover journal 状态不是 opened',
			);

			writeFileSync(journalPath, JSON.stringify({ ...journal, state: 'opened' }), 'utf-8');
			const valid = validateRuntimeContract({ vaultRoot: vault.root });
			expect(valid.issues).toEqual([]);
			expect(valid.ok).toBe(true);
		} finally {
			rmSync(cutover.dir, { recursive: true, force: true });
		}
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

	it('活动 cutover 写闸阻断普通 runtime，仅允许升级器在显式校验阶段穿透', () => {
		const lock = acquireCutoverLock(vault.root);
		try {
			const blocked = validateRuntimeContract({ vaultRoot: vault.root });
			expect(blocked.ok).toBe(false);
			expect(blocked.issues).toContain(`cutover 写闸已关闭（pid=${process.pid}）`);
			expect(validateRuntimeContract({ vaultRoot: vault.root, allowActiveCutover: true }).ok).toBe(
				true,
			);
		} finally {
			releaseCutoverLock(vault.root, lock.token);
		}
	});

	it('managed asset 缺失、越界或哈希变化均阻断最终 runtime', () => {
		const assetPath = 'AGENTS.md';
		const fullPath = join(vault.root, assetPath);
		const yamlPath = join(vault.root, 'lifeos.yaml');
		const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
		const managedAssets = config.managed_assets as Record<
			string,
			{ version: string; sha256: string }
		>;
		const baselineYaml = stringifyYaml(config);
		const baselineAsset = readFileSync(fullPath, 'utf-8');
		expect(managedAssets[assetPath]).toBeDefined();
		expect(validateRuntimeContract({ vaultRoot: vault.root }).ok).toBe(true);

		delete managedAssets[assetPath];
		writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			`managed asset 清单缺少：${assetPath}`,
		);

		writeFileSync(yamlPath, baselineYaml, 'utf-8');
		writeFileSync(fullPath, 'tampered', 'utf-8');
		expect(validateRuntimeContract({ vaultRoot: vault.root }).issues).toContain(
			`managed asset 哈希不匹配：${assetPath}`,
		);

		writeFileSync(fullPath, baselineAsset, 'utf-8');
		const withIllegalPath = parseYaml(baselineYaml) as Record<string, unknown>;
		(withIllegalPath.managed_assets as Record<string, unknown>)['../outside.md'] = {
			version: VERSION,
			sha256: hash('x'),
		};
		writeFileSync(yamlPath, stringifyYaml(withIllegalPath), 'utf-8');
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
