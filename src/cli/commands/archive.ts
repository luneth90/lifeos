// lifeos archive：按候选清单归档 done 项目/草稿/计划和旧日记
// 用法：
//   lifeos archive [vault-root] --candidates <file> [--date YYYY-MM-DD] [--dry-run] [--skip-notify]
//   cat candidates.json | lifeos archive [vault-root] [--date YYYY-MM-DD] [--dry-run]
// 输出：JSON 报告（stdout）；退出码 0=全部成功 1=有失败 2=有冲突（未移动）
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { memoryNotify } from '../../core.js';
import {
	type ArchiveCandidate,
	type ArchiveReport,
	type MoveRunner,
	runArchive,
} from '../../services/archive.js';
import { parseArgs } from '../utils/ui.js';

export interface ArchiveDeps {
	moveRunner?: MoveRunner;
	notify?: (filePath: string, previousFilePath?: string) => void;
}

export interface ArchiveCommandResult {
	dryRun: boolean;
	archiveDate: string;
	moved: number;
	updated: number;
	skipped: number;
	failed: number;
	conflicts: number;
	notifyApplied: boolean;
	report: ArchiveReport;
}

function today(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function archiveCommand(
	args: string[],
	deps: ArchiveDeps = {},
): ArchiveCommandResult {
	const { positionals, flags } = parseArgs(args, {
		candidates: {},
		date: {},
		'dry-run': {},
		'skip-notify': {},
	});
	const vaultRoot = resolve(positionals[0] ?? '.');
	const yamlPath = join(vaultRoot, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}

	const raw =
		typeof flags.candidates === 'string'
			? readFileSync(resolve(flags.candidates), 'utf8')
			: readFileSync(0, 'utf8'); // 缺省从 stdin 读取
	let candidates: ArchiveCandidate[];
	try {
		candidates = JSON.parse(raw) as ArchiveCandidate[];
	} catch (error) {
		throw new Error(`候选 JSON 解析失败: ${(error as Error).message}`);
	}
	const archiveDate = typeof flags.date === 'string' ? flags.date : today();
	const dryRun = flags['dry-run'] !== undefined;
	const skipNotify = flags['skip-notify'] !== undefined;

	const report = runArchive({
		vaultRoot,
		candidates,
		archiveDate,
		dryRun,
		moveRunner: deps.moveRunner,
	});

	// 通知记忆索引（移动的 .md 文件；失败不阻断但记入报告）
	let notifyApplied = false;
	if (!dryRun && !skipNotify && report.conflicts.length === 0) {
		const notify =
			deps.notify ??
			((filePath: string, previousFilePath?: string) => {
				memoryNotify({ contractVersion: 2, vaultRoot, filePath, previousFilePath });
			});
		const notifiedTargets = new Set<string>();
		for (const move of report.moved) {
			if (!move.to.endsWith('.md')) continue;
			try {
				notify(move.to, move.from);
				notifiedTargets.add(move.to);
				notifyApplied = true;
			} catch (error) {
				report.failed.push({ path: move.to, reason: `notify_failed:${(error as Error).message}` });
			}
		}
		for (const path of report.updated) {
			if (!path.endsWith('.md') || notifiedTargets.has(path)) continue;
			try {
				notify(path, undefined);
				notifyApplied = true;
			} catch (error) {
				report.failed.push({ path, reason: `notify_failed:${(error as Error).message}` });
			}
		}
	}

	const result: ArchiveCommandResult = {
		dryRun,
		archiveDate,
		moved: report.moved.length,
		updated: report.updated.length,
		skipped: report.skipped.length,
		failed: report.failed.length,
		conflicts: report.conflicts.length,
		notifyApplied,
		report,
	};
	console.log(JSON.stringify(result));
	if (report.conflicts.length > 0) process.exitCode = 2;
	else if (report.failed.length > 0) process.exitCode = 1;
	return result;
}
