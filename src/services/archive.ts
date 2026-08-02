// 归档核心服务：预检 → 移动（obsidian move 自动更新 wikilink）→ archived 字段 → 报告
// 设计原则：确定性操作、幂等重跑、失败输出清单，不引入事务/恢复协议。
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmdirSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export type ArchiveEntityType = 'project' | 'draft' | 'plan' | 'diary';

export interface ArchiveCandidate {
	type: ArchiveEntityType;
	/** Vault 相对源路径（文件或目录） */
	source: string;
	/** Vault 相对目标路径 */
	target: string;
	/** project/draft/plan 的主文件（Vault 相对路径，位于 source 下） */
	main_file?: string;
	/** project 候选的稳定项目 ID */
	project_id?: string;
}

export interface ArchiveMove {
	from: string;
	to: string;
}

export interface ArchiveIssue {
	path: string;
	reason: string;
}

export interface ArchiveReport {
	dryRun: boolean;
	archiveDate: string;
	moved: ArchiveMove[];
	skipped: ArchiveIssue[];
	failed: ArchiveIssue[];
	conflicts: ArchiveIssue[];
}

export type MoveRunner = (source: string, target: string) => { ok: boolean; error?: string };

export interface RunArchiveOptions {
	vaultRoot: string;
	candidates: ArchiveCandidate[];
	/** 归档日期 YYYY-MM-DD */
	archiveDate: string;
	dryRun?: boolean;
	/** 可注入的移动执行器（默认调用 obsidian CLI） */
	moveRunner?: MoveRunner;
}

const ENTITY_TYPES: ReadonlySet<string> = new Set(['project', 'draft', 'plan', 'diary']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 默认移动执行器：调用 obsidian move（自动更新全库 wikilink）。路径为 Vault 相对路径。 */
function defaultMoveRunner(): MoveRunner {
	return (source, target) => {
		const result = spawnSync('obsidian', ['move', `path=${source}`, `to=${target}`], {
			encoding: 'utf8',
		});
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
		if (result.status !== 0 || !/^Moved:/m.test(output)) {
			return { ok: false, error: output.trim().slice(0, 200) || 'obsidian move failed' };
		}
		return { ok: true };
	};
}

interface Frontmatter {
	type?: string;
	status?: string;
	archived?: string;
	parsed: boolean;
	/** archived 行的插入位置（frontmatter 结束标记前） */
	insertPos?: number;
}

function parseFrontmatter(content: string): Frontmatter {
	const result: Frontmatter = { parsed: false };
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return result;
	result.parsed = true;
	const values: Record<string, string | undefined> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1];
		if (!['type', 'status', 'archived'].includes(key)) continue;
		let value = kv[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	result.type = values.type;
	result.status = values.status;
	result.archived = values.archived;
	const endMarker = match[0].lastIndexOf('\n---');
	result.insertPos = (match.index ?? 0) + endMarker + 1;
	return result;
}

interface PreparedCandidate {
	candidate: ArchiveCandidate;
	sourceAbs: string;
	targetAbs: string;
	isDirectory: boolean;
}

/** 把 main_file 的源前缀替换为目标前缀 */
function relocatedPath(source: string, target: string, path: string): string {
	if (path === source) return target;
	if (path.startsWith(`${source}/`)) return `${target}${path.slice(source.length)}`;
	throw new Error(`main_file 不在候选 source 下: ${path}`);
}

function collectFiles(directory: string, base = ''): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...collectFiles(join(directory, entry.name), rel));
		} else if (entry.isFile()) {
			files.push(rel);
		}
	}
	return files.sort((a, b) => a.localeCompare(b));
}

/** 从深到浅移除目录树的空目录（包括根目录本身） */
function removeEmptyDirs(directory: string): void {
	const dirs: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				walk(join(dir, entry.name));
				dirs.push(join(dir, entry.name));
			}
		}
	};
	walk(directory);
	for (const dir of dirs.sort((a, b) => b.length - a.length)) {
		rmdirSync(dir);
	}
	rmdirSync(directory);
}

function moveFile(item: PreparedCandidate, move: MoveRunner, report: ArchiveReport): boolean {
	const { candidate } = item;
	if (report.dryRun) {
		report.moved.push({ from: candidate.source, to: candidate.target });
		return true;
	}
	if (candidate.source.endsWith('.md')) {
		const result = move(candidate.source, candidate.target);
		if (!result.ok) {
			report.failed.push({ path: candidate.source, reason: result.error ?? 'move_failed' });
			return false;
		}
	} else {
		try {
			renameSync(item.sourceAbs, item.targetAbs);
		} catch (error) {
			report.failed.push({
				path: candidate.source,
				reason: `rename_failed:${(error as Error).message}`,
			});
			return false;
		}
	}
	report.moved.push({ from: candidate.source, to: candidate.target });
	return true;
}

function moveDirectory(item: PreparedCandidate, move: MoveRunner, report: ArchiveReport): boolean {
	const { candidate } = item;
	const files = collectFiles(item.sourceAbs);
	if (files.length === 0) {
		report.failed.push({ path: candidate.source, reason: 'empty_directory' });
		return false;
	}
	if (report.dryRun) {
		for (const rel of files) {
			report.moved.push({ from: `${candidate.source}/${rel}`, to: `${candidate.target}/${rel}` });
		}
		report.moved.push({ from: candidate.source, to: candidate.target });
		return true;
	}
	for (const rel of files) {
		const targetAbs = join(item.targetAbs, rel);
		mkdirSync(dirname(targetAbs), { recursive: true });
		if (rel.endsWith('.md')) {
			const result = move(`${candidate.source}/${rel}`, `${candidate.target}/${rel}`);
			if (!result.ok) {
				report.failed.push({
					path: `${candidate.source}/${rel}`,
					reason: result.error ?? 'move_failed',
				});
				return false;
			}
		} else {
			try {
				renameSync(join(item.sourceAbs, rel), targetAbs);
			} catch (error) {
				report.failed.push({
					path: `${candidate.source}/${rel}`,
					reason: `rename_failed:${(error as Error).message}`,
				});
				return false;
			}
		}
		report.moved.push({ from: `${candidate.source}/${rel}`, to: `${candidate.target}/${rel}` });
	}
	try {
		removeEmptyDirs(item.sourceAbs);
	} catch (error) {
		report.failed.push({
			path: candidate.source,
			reason: `cleanup_failed:${(error as Error).message}`,
		});
		return false;
	}
	return true;
}

/** 幂等写入 archived 字段（保留 status: done；已有同值日期则跳过）；dry-run 不做任何文件操作 */
function writeArchived(targetAbs: string, archiveDate: string, report: ArchiveReport): void {
	if (report.dryRun) return;
	let content: string;
	try {
		content = readFileSync(targetAbs, 'utf8');
	} catch (error) {
		report.failed.push({ path: targetAbs, reason: `read_failed:${(error as Error).message}` });
		return;
	}
	const frontmatter = parseFrontmatter(content);
	if (!frontmatter.parsed) {
		report.failed.push({ path: targetAbs, reason: 'frontmatter_missing' });
		return;
	}
	if (frontmatter.archived !== undefined) {
		if (frontmatter.archived === archiveDate) return;
		report.failed.push({
			path: targetAbs,
			reason: `archived_date_conflict:${frontmatter.archived}`,
		});
		return;
	}
	const insertPos = frontmatter.insertPos ?? 0;
	writeFileSync(
		targetAbs,
		`${content.slice(0, insertPos)}archived: "${archiveDate}"\n${content.slice(insertPos)}`,
	);
}

/**
 * 执行归档。
 *
 * 语义：
 * - 任一候选冲突（源缺失、目标冲突、主文件非 done 等）→ 整体停止，不移动任何内容
 * - 源缺失且目标已存在 → skipped(already_moved)，视为已完成（幂等重跑）
 * - 单候选失败不中断其他候选，失败项写入报告
 * - dryRun 只预检与列计划，不产生任何副作用
 */
export function runArchive(options: RunArchiveOptions): ArchiveReport {
	if (!DATE_PATTERN.test(options.archiveDate)) {
		throw new Error(`无效归档日期: ${options.archiveDate}（应为 YYYY-MM-DD）`);
	}
	const report: ArchiveReport = {
		dryRun: Boolean(options.dryRun),
		archiveDate: options.archiveDate,
		moved: [],
		skipped: [],
		failed: [],
		conflicts: [],
	};

	// 1. 候选结构校验
	for (const candidate of options.candidates) {
		if (!ENTITY_TYPES.has(candidate.type)) {
			throw new Error(`未知实体类型: ${candidate.type}`);
		}
		if (!candidate.source || !candidate.target) {
			throw new Error('候选缺少 source/target');
		}
		if (candidate.type === 'project' && !candidate.project_id) {
			throw new Error('project 候选缺少 project_id');
		}
		if (candidate.type !== 'diary' && !candidate.main_file) {
			throw new Error(`${candidate.type} 候选缺少 main_file`);
		}
	}

	// 2. 预检全部候选
	const prepared: PreparedCandidate[] = [];
	for (const candidate of options.candidates) {
		const sourceAbs = join(options.vaultRoot, candidate.source);
		const targetAbs = join(options.vaultRoot, candidate.target);
		let sourceStat = null;
		try {
			sourceStat = lstatSync(sourceAbs);
		} catch {
			sourceStat = null;
		}
		if (!sourceStat) {
			if (existsSync(targetAbs)) {
				report.skipped.push({ path: candidate.source, reason: 'already_moved' });
			} else {
				report.conflicts.push({ path: candidate.source, reason: 'source_missing' });
			}
			continue;
		}
		if (sourceStat.isSymbolicLink()) {
			report.conflicts.push({ path: candidate.source, reason: 'source_is_symlink' });
			continue;
		}
		if (existsSync(targetAbs)) {
			report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
			continue;
		}
		if (candidate.type !== 'diary') {
			const mainFile = candidate.main_file;
			if (!mainFile) {
				// 结构校验已保证存在；此处仅用于类型收窄
				continue;
			}
			const mainAbs = join(options.vaultRoot, mainFile);
			if (!existsSync(mainAbs)) {
				report.conflicts.push({ path: mainFile, reason: 'main_file_missing' });
				continue;
			}
			const frontmatter = parseFrontmatter(readFileSync(mainAbs, 'utf8'));
			if (frontmatter.type !== candidate.type) {
				report.conflicts.push({
					path: mainFile,
					reason: `type_mismatch:${frontmatter.type ?? 'none'}`,
				});
				continue;
			}
			if (frontmatter.status !== 'done') {
				report.conflicts.push({
					path: mainFile,
					reason: `status_not_done:${frontmatter.status ?? 'none'}`,
				});
				continue;
			}
		}
		prepared.push({ candidate, sourceAbs, targetAbs, isDirectory: sourceStat.isDirectory() });
	}

	if (report.conflicts.length > 0) return report;

	// 3. 创建目标父目录（obsidian move 要求目标父目录已存在）；dry-run 不产生任何副作用，跳过
	if (!report.dryRun) {
		for (const item of prepared) {
			if (item.isDirectory) {
				mkdirSync(item.targetAbs, { recursive: true });
			} else {
				mkdirSync(dirname(item.targetAbs), { recursive: true });
			}
		}
	}

	// 4. 移动
	const move = options.moveRunner ?? defaultMoveRunner();
	const movedSources = new Set<string>();
	for (const item of prepared) {
		const ok = item.isDirectory ? moveDirectory(item, move, report) : moveFile(item, move, report);
		if (ok) movedSources.add(item.candidate.source);
	}

	// 5. 主文件写 archived（仅非 diary，且移动成功的候选）
	for (const item of prepared) {
		if (item.candidate.type === 'diary' || !movedSources.has(item.candidate.source)) continue;
		const mainFile = item.candidate.main_file;
		if (!mainFile) continue;
		const targetMain = relocatedPath(item.candidate.source, item.candidate.target, mainFile);
		writeArchived(join(options.vaultRoot, targetMain), options.archiveDate, report);
	}

	return report;
}
