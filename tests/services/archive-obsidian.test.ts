import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0, stdout: 'Moved: ok', stderr: '' })));

vi.mock('node:child_process', () => ({ spawnSync }));

import { runArchive } from '../../src/services/archive.js';

describe('archive Obsidian CLI 边界', () => {
	it('默认移动命令显式绑定 vaultRoot 对应的 Vault 名称', () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-vault-name-'));
		try {
			mkdirSync(join(root, '10_日记'), { recursive: true });
			writeFileSync(join(root, '10_日记/2026-07-01.md'), '# diary', 'utf8');
			runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'diary',
						source: '10_日记/2026-07-01.md',
						target: '90_系统/归档/日记/2026/07/2026-07-01.md',
					},
				],
			});
			expect(spawnSync).toHaveBeenCalledWith(
				'obsidian',
				[
					`vault=${basename(root)}`,
					'move',
					'path=10_日记/2026-07-01.md',
					'to=90_系统/归档/日记/2026/07/2026-07-01.md',
				],
				{ encoding: 'utf8' },
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
