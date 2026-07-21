import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Content } from '../../../src/cli/utils/managed-assets.js';
import { syncVault } from '../../../src/cli/utils/sync-vault.js';
import { ZH_PRESET } from '../../../src/config.js';
import type { LifeOSConfig } from '../../../src/config.js';

describe('syncVault 整包覆盖托管资产', () => {
	const temporaryRoots: string[] = [];

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('按当前包重建清单，删除未修改旧资产并保留用户修改和不安全路径', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'lifeos-sync-managed-assets-'));
		temporaryRoots.push(parent);
		const root = join(parent, 'vault');
		const staleCache =
			'.agents/skills/digest/references/__pycache__/rss-arxiv-script.cpython-313.pyc';
		const missingCache =
			'.agents/skills/digest/references/__pycache__/rss-arxiv-script.cpython-314.pyc';
		const modifiedLegacy = '.agents/skills/digest/references/legacy-user-note.md';
		const outside = join(parent, 'outside.txt');
		const staleBytes = Buffer.from([0x42, 0x0d, 0x0a, 0xff, 0x00, 0x7f]);
		const originalUserNote = '旧包生成内容\n';

		mkdirSync(join(root, '.agents', 'skills', 'digest', 'references', '__pycache__'), {
			recursive: true,
		});
		writeFileSync(join(root, staleCache), staleBytes);
		writeFileSync(join(root, modifiedLegacy), '用户已修改，必须保留\n', 'utf-8');
		writeFileSync(outside, 'Vault 外文件不得删除\n', 'utf-8');

		const config: LifeOSConfig = structuredClone(ZH_PRESET);
		config.managed_assets = {
			[staleCache]: {
				version: '1.8.3',
				sha256: sha256Content(staleBytes.toString('utf-8')),
			},
			[missingCache]: {
				version: '1.8.3',
				sha256: sha256Content('已不存在'),
			},
			[modifiedLegacy]: {
				version: '1.8.3',
				sha256: sha256Content(originalUserNote),
			},
			'../outside.txt': {
				version: '1.8.3',
				sha256: sha256Content('Vault 外文件不得删除\n'),
			},
		};

		const result = await syncVault(root, config, {
			lang: 'zh',
			assetMode: 'overwrite',
			skillMode: 'overwrite',
			ensureMcp: false,
			mcpMode: 'replace',
			rulesMode: 'overwrite',
			assetVersion: '2.0.0',
		});

		const managedAssets = result.managedAssets ?? {};
		expect(managedAssets[staleCache]).toBeUndefined();
		expect(managedAssets[missingCache]).toBeUndefined();
		expect(managedAssets[modifiedLegacy]).toBeUndefined();
		expect(managedAssets['../outside.txt']).toBeUndefined();
		expect(existsSync(join(root, staleCache))).toBe(false);
		expect(readFileSync(join(root, modifiedLegacy), 'utf-8')).toBe('用户已修改，必须保留\n');
		expect(readFileSync(outside, 'utf-8')).toBe('Vault 外文件不得删除\n');
		expect(Object.values(managedAssets).length).toBeGreaterThan(0);
		expect(Object.values(managedAssets).every((record) => record.version === '2.0.0')).toBe(true);
	});
});
