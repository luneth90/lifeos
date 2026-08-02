import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initCommand from '../../src/cli/commands/init.js';
import archiveCommand from '../../src/cli/commands/archive.js';
import type { MoveRunner } from '../../src/services/archive.js';

function makeTmp() {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-cli-'));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function write(root: string, rel: string, content: string) {
	const abs = join(root, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content, 'utf8');
}

function fakeMove(root: string): MoveRunner {
	return (source, target) => {
		try {
			renameSync(join(root, source), join(root, target));
			return { ok: true };
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
	};
}

afterEach(() => {
	process.exitCode = undefined;
});

describe('lifeos archive 命令', () => {
	it('从候选文件归档并通知记忆索引', async () => {
		const { root, cleanup } = makeTmp();
		try {
			await initCommand([root, '--lang', 'zh', '--no-mcp']);
			write(root, '00_草稿/idea.md', `---\ntype: draft\nstatus: done\n---\n# idea\n`);
			const candidatesFile = join(root, 'candidates.json');
			write(
				root,
				'candidates.json',
				JSON.stringify([
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				]),
			);
			const notify = vi.fn();
			const result = archiveCommand(
				[root, '--candidates', candidatesFile, '--date', '2026-08-02'],
				{ moveRunner: fakeMove(root), notify },
			);
			expect(result.conflicts).toBe(0);
			expect(result.failed).toBe(0);
			expect(result.moved).toBe(1);
			expect(result.notifyApplied).toBe(true);
			expect(notify).toHaveBeenCalledWith('90_系统/归档/草稿/2026/08/idea.md', '00_草稿/idea.md');
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(false);
			expect(readFileSync(join(root, '90_系统/归档/草稿/2026/08/idea.md'), 'utf8')).toContain(
				'archived: "2026-08-02"',
			);
		} finally {
			cleanup();
		}
	});

	it('冲突时退出码 2 且不通知', async () => {
		const { root, cleanup } = makeTmp();
		try {
			await initCommand([root, '--lang', 'zh', '--no-mcp']);
			write(root, '00_草稿/idea.md', `---\ntype: draft\nstatus: pending\n---\n# idea\n`);
			const candidatesFile = join(root, 'candidates.json');
			write(
				root,
				'candidates.json',
				JSON.stringify([
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				]),
			);
			const notify = vi.fn();
			const result = archiveCommand(
				[root, '--candidates', candidatesFile, '--date', '2026-08-02'],
				{ moveRunner: fakeMove(root), notify },
			);
			expect(result.conflicts).toBe(1);
			expect(result.moved).toBe(0);
			expect(result.notifyApplied).toBe(false);
			expect(notify).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(2);
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('dry-run 不移动不通知', async () => {
		const { root, cleanup } = makeTmp();
		try {
			await initCommand([root, '--lang', 'zh', '--no-mcp']);
			write(root, '00_草稿/idea.md', `---\ntype: draft\nstatus: done\n---\n# idea\n`);
			const candidatesFile = join(root, 'candidates.json');
			write(
				root,
				'candidates.json',
				JSON.stringify([
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				]),
			);
			const notify = vi.fn();
			const result = archiveCommand(
				[root, '--candidates', candidatesFile, '--date', '2026-08-02', '--dry-run'],
				{ moveRunner: fakeMove(root), notify },
			);
			expect(result.dryRun).toBe(true);
			expect(result.moved).toBe(1);
			expect(result.notifyApplied).toBe(false);
			expect(notify).not.toHaveBeenCalled();
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('已移动文件补写 archived 后重新通知记忆索引', async () => {
		const { root, cleanup } = makeTmp();
		try {
			await initCommand([root, '--lang', 'zh', '--no-mcp']);
			write(root, '00_草稿/idea.md', `---\ntype: draft\nstatus: done\n---\n# idea\n`);
			chmodSync(join(root, '00_草稿/idea.md'), 0o444);
			const candidatesFile = join(root, 'candidates.json');
			write(
				root,
				'candidates.json',
				JSON.stringify([
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				]),
			);
			const notify = vi.fn();
			archiveCommand([root, '--candidates', candidatesFile, '--date', '2026-08-02'], {
				moveRunner: fakeMove(root),
				notify,
			});
			const target = join(root, '90_系统/归档/草稿/2026/08/idea.md');
			chmodSync(target, 0o644);
			notify.mockClear();

			const result = archiveCommand(
				[root, '--candidates', candidatesFile, '--date', '2026-08-02'],
				{ moveRunner: fakeMove(root), notify },
			);
			expect(result.failed).toBe(0);
			expect(notify).toHaveBeenCalledWith('90_系统/归档/草稿/2026/08/idea.md', undefined);
		} finally {
			cleanup();
		}
	});

	it('无 lifeos.yaml 时抛错', () => {
		const { root, cleanup } = makeTmp();
		try {
			expect(() => archiveCommand([root])).toThrow(/No lifeos.yaml/);
		} finally {
			cleanup();
		}
	});
});
