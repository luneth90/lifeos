import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runArchive, type ArchiveCandidate, type ArchiveReport, type MoveRunner } from '../../src/services/archive.js';

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
			write(
				root,
				'20_项目/Demo/Demo.md',
				`---\ntype: project\nstatus: done\nid: demo\n---\n# Demo\n`,
			);
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

	it('拒绝逃出 Vault 的候选路径', () => {
		const { root, cleanup } = makeTmp();
		const outside = `${root}-outside.md`;
		try {
			writeFileSync(outside, '# outside', 'utf8');
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'diary',
						source: `../${outside.slice(outside.lastIndexOf('/') + 1)}`,
						target: '90_系统/归档/日记/2026/07/outside.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([
				{
					path: `../${outside.slice(outside.lastIndexOf('/') + 1)}`,
					reason: 'source_outside_vault',
				},
			]);
			expect(existsSync(outside)).toBe(true);
		} finally {
			rmSync(outside, { force: true });
			cleanup();
		}
	});

	it('拒绝把非日记目录中的文件伪装成日记', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/Active.md', `---\ntype: project\nstatus: active\nid: active\n---\n`);
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'diary',
						source: '20_项目/Active.md',
						target: '90_系统/归档/日记/2026/07/2026-07-01.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([
				{ path: '20_项目/Active.md', reason: 'invalid_source_location:diary' },
			]);
			expect(existsSync(join(root, '20_项目/Active.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('拒绝把文件夹项目的 done 子文件单独归档', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/App/App.md', `---\ntype: project\nstatus: active\nid: app\n---\n`);
			write(root, '20_项目/App/版本/V1.md', `---\ntype: project\nstatus: done\nid: app-v1\n---\n`);
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project',
						source: '20_项目/App/版本/V1.md',
						target: '90_系统/归档/项目/2026/V1.md',
						main_file: '20_项目/App/版本/V1.md',
						project_id: 'app-v1',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([
				{ path: '20_项目/App/版本/V1.md', reason: 'invalid_source_location:project' },
			]);
		} finally {
			cleanup();
		}
	});

	it('project_id 必须与主文件稳定 id 一致', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/Demo.md', `---\ntype: project\nstatus: done\nid: demo\n---\n`);
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project',
						source: '20_项目/Demo.md',
						target: '90_系统/归档/项目/2026/Demo.md',
						main_file: '20_项目/Demo.md',
						project_id: 'another-project',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([
				{ path: '20_项目/Demo.md', reason: 'project_id_mismatch:demo' },
			]);
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
					{
						type: 'draft',
						source: '00_草稿/a.md',
						target: '90_系统/归档/草稿/2026/08/a.md',
						main_file: '00_草稿/a.md',
					},
					{
						type: 'draft',
						source: '00_草稿/b.md',
						target: '90_系统/归档/草稿/2026/08/b.md',
						main_file: '00_草稿/b.md',
					},
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
					{
						type: 'draft',
						source: '00_草稿/pending.md',
						target: '90_系统/归档/草稿/2026/08/pending.md',
						main_file: '00_草稿/pending.md',
					},
					{
						type: 'project',
						source: '20_项目/X.md',
						target: '90_系统/归档/项目/2026/X.md',
						main_file: '20_项目/X.md',
						project_id: 'x',
					},
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
					{
						type: 'diary',
						source: '10_日记/2026-07-01.md',
						target: '90_系统/归档/日记/2026/07/2026-07-01.md',
					},
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
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
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
			// moved 只含文件条目，不含目录自身条目（与真实执行语义一致）
			expect(report.moved).toEqual([
				{
					from: '20_项目/GTS学习/路线.md',
					to: '90_系统/归档/项目/2026/GTS学习/路线.md',
				},
			]);
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
					{
						type: 'draft',
						source: '00_草稿/a.md',
						target: '90_系统/归档/草稿/2026/08/a.md',
						main_file: '00_草稿/a.md',
					},
					{
						type: 'draft',
						source: '00_草稿/b.md',
						target: '90_系统/归档/草稿/2026/08/b.md',
						main_file: '00_草稿/b.md',
					},
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

	it('文件夹项目部分移动失败后可用同一候选幂等续跑', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/P/P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
			write(root, '20_项目/P/z.md', '# z');
			const candidate = {
				type: 'project' as const,
				source: '20_项目/P',
				target: '90_系统/归档/项目/2026/P',
				main_file: '20_项目/P/P.md',
				project_id: 'p',
			};
			const first = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root, (rel) => rel.endsWith('/z.md')),
			});
			expect(first.failed).toEqual([
				{ path: '20_项目/P/z.md', reason: 'injected failure: 20_项目/P/z.md' },
			]);
			expect(existsSync(join(root, '90_系统/归档/项目/2026/P/P.md'))).toBe(true);
			expect(existsSync(join(root, '20_项目/P/z.md'))).toBe(true);

			const rerun = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(rerun.conflicts).toEqual([]);
			expect(rerun.failed).toEqual([]);
			expect(existsSync(join(root, '20_项目/P'))).toBe(false);
			expect(existsSync(join(root, '90_系统/归档/项目/2026/P/z.md'))).toBe(true);
			expect(readFileSync(join(root, '90_系统/归档/项目/2026/P/P.md'), 'utf8')).toContain(
				'archived: "2026-08-02"',
			);
		} finally {
			cleanup();
		}
	});

	it('文件夹项目的非 Markdown 资源也通过 moveRunner 移动', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/P/P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
			write(root, '20_项目/P/assets/logo.png', 'png');
			const calls: string[] = [];
			const runner: MoveRunner = (source, target) => {
				calls.push(`${source} -> ${target}`);
				renameSync(join(root, source), join(root, target));
				return { ok: true };
			};
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project',
						source: '20_项目/P',
						target: '90_系统/归档/项目/2026/P',
						main_file: '20_项目/P/P.md',
						project_id: 'p',
					},
				],
				moveRunner: runner,
			});
			expect(report.failed).toEqual([]);
			expect(calls).toContain(
				'20_项目/P/assets/logo.png -> 90_系统/归档/项目/2026/P/assets/logo.png',
			);
		} finally {
			cleanup();
		}
	});

	it('移动后的 archived 写入失败会报告，修复后重跑可补写元数据', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			chmodSync(join(root, '00_草稿/idea.md'), 0o444);
			const candidate = {
				type: 'draft' as const,
				source: '00_草稿/idea.md',
				target: '90_系统/归档/草稿/2026/08/idea.md',
				main_file: '00_草稿/idea.md',
			};
			const first = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(first.failed[0]?.reason).toMatch(/^write_failed:/);
			const target = join(root, candidate.target);
			chmodSync(target, 0o644);

			const rerun = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(rerun.failed).toEqual([]);
			expect(rerun.skipped).toEqual([{ path: candidate.source, reason: 'already_moved' }]);
			expect(readFileSync(target, 'utf8')).toContain('archived: "2026-08-02"');
		} finally {
			cleanup();
		}
	});

	it('archived 日期冲突在移动前整体停止', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(
				root,
				'00_草稿/idea.md',
				`---\ntype: draft\nstatus: done\narchived: "2026-07-01"\n---\n# idea\n`,
			);
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
			expect(report.conflicts).toEqual([
				{ path: '00_草稿/idea.md', reason: 'archived_date_conflict:2026-07-01' },
			]);
			expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(true);
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
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			const rerunSame = runArchive({
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
			expect(rerunSame.skipped).toHaveLength(1);
			// 已归档文件若再次出现于候选（源恢复场景），日期冲突时失败
			write(root, '00_草稿/idea.md', draftNote('idea'));
			write(
				root,
				'90_系统/归档/草稿/2026/08/idea.md',
				`---\ntype: draft\nstatus: done\narchived: "2026-07-01"\n---\n# idea\n`,
			);
			write(root, '00_草稿/idea2.md', draftNote('idea2'));
			const conflict = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'draft',
						source: '00_草稿/idea.md',
						target: '90_系统/归档/草稿/2026/08/idea.md',
						main_file: '00_草稿/idea.md',
					},
					{
						type: 'draft',
						source: '00_草稿/idea2.md',
						target: '90_系统/归档/草稿/2026/08/idea2.md',
						main_file: '00_草稿/idea2.md',
					},
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

	it('清理失败（源树仅剩空目录）不阻断元数据，恢复权限后空源目录续跑闭环', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(
				root,
				'20_项目/Demo/Demo.md',
				`---\ntype: project\nstatus: done\nid: demo\n---\n# Demo\n`,
			);
			write(root, '20_项目/Demo/文档/guide.md', '# Guide');
			write(root, '20_项目/Demo/assets/logo.png', 'png');
			const candidate = {
				type: 'project' as const,
				source: '20_项目/Demo',
				target: '90_系统/归档/项目/2026/Demo',
				main_file: '20_项目/Demo/Demo.md',
				project_id: 'demo',
			};
			// 最后一次移动后把源目录的父目录设为只读，使 removeEmptyDirs 最后一步 rmdirSync 失败
			let moves = 0;
			const runner: MoveRunner = (source, target) => {
				renameSync(join(root, source), join(root, target));
				moves++;
				if (moves === 3) chmodSync(join(root, '20_项目'), 0o555);
				return { ok: true };
			};
			const first = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: runner,
			});
			expect(first.failed[0]?.reason).toMatch(/^cleanup_failed:/);
			expect(first.updated).toEqual(['90_系统/归档/项目/2026/Demo/Demo.md']);
			expect(
				readFileSync(join(root, '90_系统/归档/项目/2026/Demo/Demo.md'), 'utf8'),
			).toContain('archived: "2026-08-02"');
			expect(existsSync(join(root, '20_项目/Demo'))).toBe(true);
			chmodSync(join(root, '20_项目'), 0o755);

			const rerun = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(rerun.conflicts).toEqual([]);
			expect(rerun.failed).toEqual([]);
			expect(rerun.updated).toEqual([]);
			expect(rerun.skipped).toEqual([{ path: '20_项目/Demo', reason: 'already_moved' }]);
			expect(existsSync(join(root, '20_项目/Demo'))).toBe(false);
			expect(
				readFileSync(join(root, '90_系统/归档/项目/2026/Demo/Demo.md'), 'utf8'),
			).toContain('archived: "2026-08-02"');
		} finally {
			chmodSync(join(root, '20_项目'), 0o755);
			cleanup();
		}
	});

	it('预检拒绝文件夹项目内的符号链接', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(
				root,
				'20_项目/Demo/Demo.md',
				`---\ntype: project\nstatus: done\nid: demo\n---\n# Demo\n`,
			);
			writeFileSync(join(root, 'outside.md'), '# outside', 'utf8');
			symlinkSync(join(root, 'outside.md'), join(root, '20_项目/Demo/链接'));
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
			expect(report.conflicts).toEqual([
				{ path: '20_项目/Demo/链接', reason: 'source_contains_symlink' },
			]);
			expect(report.moved).toEqual([]);
			expect(existsSync(join(root, '20_项目/Demo/Demo.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('清理失败且仍有普通文件残留时失败关闭，不写 archived', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/P/P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
			write(root, '20_项目/P/z.md', '# z');
			// 对非主文件假装移动成功但不实际移动，制造「源目录仍有内容」的清理失败
			const runner: MoveRunner = (source, target) => {
				if (source.endsWith('/z.md')) return { ok: true };
				renameSync(join(root, source), join(root, target));
				return { ok: true };
			};
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						type: 'project',
						source: '20_项目/P',
						target: '90_系统/归档/项目/2026/P',
						main_file: '20_项目/P/P.md',
						project_id: 'p',
					},
				],
				moveRunner: runner,
			});
			expect(report.failed[0]?.reason).toMatch(/^cleanup_failed:/);
			expect(report.updated).toEqual([]);
			expect(
				readFileSync(join(root, '90_系统/归档/项目/2026/P/P.md'), 'utf8'),
			).not.toContain('archived:');
			expect(existsSync(join(root, '20_项目/P/z.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('重跑时目标主文件不可读转为冲突报告（already_moved 分支）', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			const candidate = {
				type: 'draft' as const,
				source: '00_草稿/idea.md',
				target: '90_系统/归档/草稿/2026/08/idea.md',
				main_file: '00_草稿/idea.md',
			};
			runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			const targetAbs = join(root, candidate.target);
			chmodSync(targetAbs, 0o000);
			let rerun: ArchiveReport;
			try {
				expect(() => {
					rerun = runArchive({
						vaultRoot: root,
						archiveDate: '2026-08-02',
						candidates: [candidate],
						moveRunner: fakeMove(root),
					});
				}).not.toThrow();
				expect(rerun!.conflicts).toEqual([
					{ path: candidate.target, reason: expect.stringMatching(/^read_failed:/) },
				]);
				expect(existsSync(join(root, '00_草稿/idea.md'))).toBe(false);
			} finally {
				chmodSync(targetAbs, 0o644);
			}
		} finally {
			cleanup();
		}
	});

	it('预检时源主文件不可读转为冲突报告（常规预检分支）', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '00_草稿/idea.md', draftNote('idea'));
			const candidate = {
				type: 'draft' as const,
				source: '00_草稿/idea.md',
				target: '90_系统/归档/草稿/2026/08/idea.md',
				main_file: '00_草稿/idea.md',
			};
			const sourceAbs = join(root, '00_草稿/idea.md');
			chmodSync(sourceAbs, 0o000);
			let report: ArchiveReport;
			try {
				expect(() => {
					report = runArchive({
						vaultRoot: root,
						archiveDate: '2026-08-02',
						candidates: [candidate],
						moveRunner: fakeMove(root),
					});
				}).not.toThrow();
				expect(report!.conflicts).toEqual([
					{ path: candidate.source, reason: expect.stringMatching(/^read_failed:/) },
				]);
				expect(report!.moved).toEqual([]);
			} finally {
				chmodSync(sourceAbs, 0o644);
			}
		} finally {
			cleanup();
		}
	});

	it('空源目录续跑时目标主文件不可读转为冲突报告（续跑分支）', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '20_项目/P/P.md', `---\ntype: project\nstatus: done\nid: p\n---\n`);
			write(root, '20_项目/P/z.md', '# z');
			const candidate = {
				type: 'project' as const,
				source: '20_项目/P',
				target: '90_系统/归档/项目/2026/P',
				main_file: '20_项目/P/P.md',
				project_id: 'p',
			};
			// 首次归档制造「源目录残留为空目录」的现场
			let moves = 0;
			const runner: MoveRunner = (source, target) => {
				renameSync(join(root, source), join(root, target));
				moves++;
				if (moves === 2) chmodSync(join(root, '20_项目'), 0o555);
				return { ok: true };
			};
			runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: runner,
			});
			const targetMainAbs = join(root, candidate.target, 'P.md');
			chmodSync(targetMainAbs, 0o000);
			chmodSync(join(root, '20_项目'), 0o755);
			let report: ArchiveReport;
			try {
				expect(() => {
					report = runArchive({
						vaultRoot: root,
						archiveDate: '2026-08-02',
						candidates: [candidate],
						moveRunner: fakeMove(root),
					});
				}).not.toThrow();
				expect(report!.conflicts).toEqual([
					{ path: `${candidate.target}/P.md`, reason: expect.stringMatching(/^read_failed:/) },
				]);
			} finally {
				chmodSync(targetMainAbs, 0o644);
			}
		} finally {
			chmodSync(join(root, '20_项目'), 0o755);
			cleanup();
		}
	});

	const safetyCases: Array<{
		name: string;
		candidate: ArchiveCandidate;
		conflict: { path: string; reason: string };
	}> = [
		{
			name: 'project 目标年份非法',
			candidate: {
				type: 'project',
				source: '20_项目/Demo.md',
				target: '90_系统/归档/项目/20XX/Demo.md',
				main_file: '20_项目/Demo.md',
				project_id: 'demo',
			},
			conflict: { path: '90_系统/归档/项目/20XX/Demo.md', reason: 'invalid_target_location:project' },
		},
		{
			name: 'project 目标名称与源不符',
			candidate: {
				type: 'project',
				source: '20_项目/Demo.md',
				target: '90_系统/归档/项目/2026/Other.md',
				main_file: '20_项目/Demo.md',
				project_id: 'demo',
			},
			conflict: { path: '90_系统/归档/项目/2026/Other.md', reason: 'invalid_target_location:project' },
		},
		{
			name: 'draft 目标年月与归档日期不符',
			candidate: {
				type: 'draft',
				source: '00_草稿/x.md',
				target: '90_系统/归档/草稿/2026/09/x.md',
				main_file: '00_草稿/x.md',
			},
			conflict: { path: '90_系统/归档/草稿/2026/09/x.md', reason: 'invalid_target_location:draft' },
		},
		{
			name: 'plan 目标带子目录',
			candidate: {
				type: 'plan',
				source: '60_计划/x.md',
				target: '90_系统/归档/计划/子/x.md',
				main_file: '60_计划/x.md',
			},
			conflict: { path: '90_系统/归档/计划/子/x.md', reason: 'invalid_target_location:plan' },
		},
		{
			name: 'diary 目标年月与日记名不符',
			candidate: {
				type: 'diary',
				source: '10_日记/2026-07-01.md',
				target: '90_系统/归档/日记/2026/08/2026-07-01.md',
			},
			conflict: {
				path: '90_系统/归档/日记/2026/08/2026-07-01.md',
				reason: 'invalid_target_location:diary',
			},
		},
		{
			name: 'draft 源非 .md',
			candidate: {
				type: 'draft',
				source: '00_草稿/note.txt',
				target: '90_系统/归档/草稿/2026/08/note.txt',
				main_file: '00_草稿/note.txt',
			},
			conflict: { path: '00_草稿/note.txt', reason: 'invalid_source_shape:draft' },
		},
		{
			name: '单文件项目 main_file 与 source 不一致',
			candidate: {
				type: 'project',
				source: '20_项目/Demo.md',
				target: '90_系统/归档/项目/2026/Demo.md',
				main_file: '20_项目/Other.md',
				project_id: 'demo',
			},
			conflict: { path: '20_项目/Other.md', reason: 'main_file_outside_source' },
		},
		{
			name: '文件夹项目 main_file 不在 source 下',
			candidate: {
				type: 'project',
				source: '20_项目/Demo',
				target: '90_系统/归档/项目/2026/Demo',
				main_file: '20_项目/Other.md',
				project_id: 'demo',
			},
			conflict: { path: '20_项目/Other.md', reason: 'main_file_outside_source' },
		},
	];

	it.each(safetyCases)('安全校验拒绝：$name', ({ candidate, conflict }) => {
		const { root, cleanup } = makeTmp();
		try {
			const report = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(report.conflicts).toEqual([conflict]);
			expect(report.moved).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it('日历非法日期 2026-02-30 被 dateParts 拒绝（回归断言）', () => {
		const { root, cleanup } = makeTmp();
		try {
			expect(() =>
				runArchive({
					vaultRoot: root,
					archiveDate: '2026-02-30',
					candidates: [],
				}),
			).toThrow(/无效归档日期/);
		} finally {
			cleanup();
		}
	});

	it('diary 源缺失且目标已存在时 skipped(already_moved)，无 updated 与 repair', () => {
		const { root, cleanup } = makeTmp();
		try {
			write(root, '10_日记/2026-07-01.md', '# 2026-07-01');
			const candidate = {
				type: 'diary' as const,
				source: '10_日记/2026-07-01.md',
				target: '90_系统/归档/日记/2026/07/2026-07-01.md',
			};
			runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			const rerun = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(rerun.skipped).toEqual([
				{ path: '10_日记/2026-07-01.md', reason: 'already_moved' },
			]);
			expect(rerun.updated).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it('自定义 lifeos.yaml 目录映射驱动源位置校验与归档', () => {
		const { root, cleanup } = makeTmp();
		try {
			const yaml = readFileSync('assets/lifeos.yaml', 'utf8').replace(
				'drafts: "00_草稿"',
				'drafts: "01_收件箱"',
			);
			writeFileSync(join(root, 'lifeos.yaml'), yaml, 'utf8');
			const candidate = {
				type: 'draft' as const,
				source: '00_草稿/x.md',
				target: '90_系统/归档/草稿/2026/08/x.md',
				main_file: '00_草稿/x.md',
			};
			const rejected = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [candidate],
				moveRunner: fakeMove(root),
			});
			expect(rejected.conflicts).toEqual([
				{ path: '00_草稿/x.md', reason: 'invalid_source_location:draft' },
			]);
			write(root, '01_收件箱/x.md', draftNote('x'));
			const accepted = runArchive({
				vaultRoot: root,
				archiveDate: '2026-08-02',
				candidates: [
					{
						...candidate,
						source: '01_收件箱/x.md',
						main_file: '01_收件箱/x.md',
					},
				],
				moveRunner: fakeMove(root),
			});
			expect(accepted.conflicts).toEqual([]);
			expect(accepted.failed).toEqual([]);
			expect(accepted.moved).toEqual([
				{ from: '01_收件箱/x.md', to: '90_系统/归档/草稿/2026/08/x.md' },
			]);
		} finally {
			cleanup();
		}
	});
});
