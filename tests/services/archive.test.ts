import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runArchive, type MoveRunner } from '../../src/services/archive.js';

function makeTmp() {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-archive-svc-'));
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function write(root: string, rel: string, content: string) {
	const abs = join(root, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content, 'utf8');
}

/** 用 fs rename 模拟 obsidian move（测试不依赖运行中的 Obsidian） */
function fakeMove(root: string, failFor?: (rel: string) => boolean): MoveRunner {
	return (source, target) => {
		if (failFor?.(source)) return { ok: false, error: `injected failure: ${source}` };
		try {
			renameSync(join(root, source), join(root, target));
			return { ok: true };
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
	};
}

function draftNote(name: string, status = 'done'): string {
	return `---
title: "${name}"
type: draft
status: ${status}
---

# ${name}
`;
}

describe('runArchive', () => {
	it('归档单文件草稿：移动并幂等写入 archived', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([]);
			expect(report.failed).toEqual([]);
			expect(report.moved).toEqual([
				{ from: '00_草稿/idea.md', to: '90_系统/归档/草稿/2026/08/idea.md' },
			]);
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(false);
			const archived = readFileSync(join(root, '90_系统/归档/草稿/2026/08/idea.md'), 'utf8');
			expect(archived).toContain('archived: "2026-08-02"');
			expect(archived).toContain('status: done');
			// 幂等重跑：视为已完成
			const rerun = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(rerun.skipped).toEqual([{ path: '00_草稿/idea.md', reason: 'already_moved' }]);
			expect(rerun.moved).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it('归档文件夹项目：整体移动目录并给主文件写 archived', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/Demo/Demo.md', `---\ntype: project\nstatus: done\nid: demo\n---\n# Demo\n`);
			write(root, '20_项目/Demo/文档/guide.md', '# Guide');
			write(root, '20_项目/Demo/assets/logo.png', 'png');
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project',
						source: '20_项目/Demo',
						target: '90_系统/归档/项目/2026/Demo',
						main_file: '20_项目/Demo/Demo.md',
						project_id: 'demo',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([]);
			expect(report.failed).toEqual([]);
			expect(existsSync(join(root, '20_项目/Demo'))).toBe(false);
			for (const rel of [
				'90_系统/归档/项目/2026/Demo/Demo.md',
				'90_系统/归档/项目/2026/Demo/文档/guide.md',
				'90_系统/归档/项目/2026/Demo/assets/logo.png',
			]) {
				expect(existsSync(join(root, rel)), rel).toBe(true);
			}
			const main = readFileSync(join(root, '90_系统/归档/项目/2026/Demo/Demo.md'), 'utf8');
			expect(main).toContain('archived: "2026-08-02"');
			expect(main).toContain('status: done');
		} finally {
			cleanup();
		}
	});

	it('目标冲突时整体停止，不移动任何内容', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/a.md', draftNote('a'));
			write(root, '00_草稿/b.md', draftNote('b'));
			write(root, '90_系统/归档/草稿/2026/08/b.md', '# occupied');
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/a.md', target: '90_系统/归档/草稿/2026/08/a.md', main_file: '00_草稿/a.md' },
					{ type: 'draft', source: '00_草稿/b.md', target: '90_系统/归档/草稿/2026/08/b.md', main_file: '00_草稿/b.md' },
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([
				{ path: '90_系统/归档/草稿/2026/08/b.md', reason: 'target_collision' },
			]);
			expect(report.moved).toEqual([]);
			expect(existsSync(join(root, '00_草稿/a.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('主文件 status 非 done 或 type 不匹配时拒绝归档', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/pending.md', draftNote('pending', 'pending'));
			write(root, '20_项目/X.md', `---\ntype: project-doc\nstatus: done\n---\n# X\n`);
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/pending.md', target: '90_系统/归档/草稿/2026/08/pending.md', main_file: '00_草稿/pending.md' },
					{ type: 'project', source: '20_项目/X.md', target: '90_系统/归档/项目/2026/X.md', main_file: '20_项目/X.md', project_id: 'x' },
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts.map((c) => c.reason)).toEqual([
				'status_not_done:pending',
				'type_mismatch:project-doc',
			]);
			expect(report.moved).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it('日记归档不写 archived 字段', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '10_日记/2026-07-01.md', '# 2026-07-01');
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'diary', source: '10_日记/2026-07-01.md', target: '90_系统/归档/日记/2026/07/2026-07-01.md' },
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([]);
			expect(report.failed).toEqual([]);
			const content = readFileSync(join(root, '90_系统/归档/日记/2026/07/2026-07-01.md'), 'utf8');
			expect(content).not.toContain('archived:');
		} finally {
			cleanup();
		}
	});

	it('dry-run 只预检，不产生任何副作用', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				dryRun: true,
				candidates: [
					{ type: 'draft', source: '00_草稿/idea.md', target: '90_系统/归档/草稿/2026/08/idea.md', main_file: '00_草稿/idea.md' },
				],
				moveRunner: fakeMove(root),
			});
			expect(report.dryRun).toBe(true);
			expect(report.moved).toEqual([
				{ from: '00_草稿/idea.md', to: '90_系统/归档/草稿/2026/08/idea.md' },
			]);
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(true);
			expect(existsSync(join(root, '90_系统/归档/草稿/2026/08/idea.md'))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('dry-run 不创建任何目标目录（含文件夹项目）', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(
				root,
				'20_项目/GTS学习/路线.md',
				`---\ntitle: "路线"\ntype: project\nstatus: done\nid: gts-learning\n---\n\n# 路线\n`,
			);
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				dryRun: true,
				candidates: [
					{
						type: 'project',
						source: '20_项目/GTS学习',
						target: '90_系统/归档/项目/2026/GTS学习',
						main_file: '20_项目/GTS学习/路线.md',
						project_id: 'gts-learning',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.dryRun).toBe(true);
			expect(report.conflicts).toEqual([]);
			// 目标目录及其父链均不应被创建，重跑正式执行不会 target_collision
			expect(existsSync(join(root, '90_系统/归档/项目/2026/GTS学习'))).toBe(false);
			expect(existsSync(join(root, '90_系统/归档/项目/2026'))).toBe(false);
			expect(existsSync(join(root, '20_项目/GTS学习/路线.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('单候选失败不中断其他候选，失败项写入报告', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/a.md', draftNote('a'));
			write(root, '00_草稿/b.md', draftNote('b'));
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/a.md', target: '90_系统/归档/草稿/2026/08/a.md', main_file: '00_草稿/a.md' },
					{ type: 'draft', source: '00_草稿/b.md', target: '90_系统/归档/草稿/2026/08/b.md', main_file: '00_草稿/b.md' },
				],
				moveRunner: fakeMove(root, (rel) => rel.includes('a.md')),
			});
			expect(report.failed).toHaveLength(1);
			expect(report.failed[0]?.path).toBe('00_草稿/a.md');
			expect(report.moved).toEqual([
				{ from: '00_草稿/b.md', to: '90_系统/归档/草稿/2026/08/b.md' },
			]);
			expect(existsSync(join(root, '00_草稿/a.md'))).toBe(true);
			expect(existsSync(join(root, '90_系统/归档/草稿/2026/08/b.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('archived 已存在同值日期时幂等跳过，异值时报错', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/idea.md', target: '90_系统/归档/草稿/2026/08/idea.md', main_file: '00_草稿/idea.md' },
				],
				moveRunner: fakeMove(root),
			});
			const rerunSame = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/idea.md', target: '90_系统/归档/草稿/2026/08/idea.md', main_file: '00_草稿/idea.md' },
				],
				moveRunner: fakeMove(root),
			});
			expect(rerunSame.skipped).toHaveLength(1);
			// 已归档文件若再次出现于候选（源恢复场景），日期冲突时失败
			write(root, '00_草稿/idea.md', draftNote('idea'));
			write(root, '90_系统/归档/草稿/2026/08/idea.md', `---\ntype: draft\nstatus: done\narchived: "2026-07-01"\n---\n# idea\n`);
			write(root, '00_草稿/idea2.md', draftNote('idea2'));
			const conflict = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{ type: 'draft', source: '00_草稿/idea.md', target: '90_系统/归档/草稿/2026/08/idea.md', main_file: '00_草稿/idea.md' },
					{ type: 'draft', source: '00_草稿/idea2.md', target: '90_系统/归档/草稿/2026/08/idea2.md', main_file: '00_草稿/idea2.md' },
				],
				moveRunner: fakeMove(root),
			});
			expect(conflict.conflicts).toHaveLength(1);
			expect(conflict.conflicts[0]?.reason).toBe('target_collision');
		} finally {
			cleanup();
		}
	});

	it('无效日期直接抛错', () => {
		const { root, cleanup } = makeTmp();
		try {
			expect(() =>
				runArchive({
					vaultRoot: root,
					archiveDate: '2026-8-2',
					candidates: [],
				}),
			).toThrow(/无效归档日期/);
		} finally {
			cleanup();
		}
	});
});
