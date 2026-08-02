// 归档核心服务：预检 → 移动（obsidian move 自动更新 wikilink）→ archived 字段 → 报告
// 设计原则：确定性操作、幂等重跑、失败输出清单，不引入事务/恢复协议。
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmdirSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { resolveConfig } from '../config.js';

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
	updated: string[];
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

/** 默认移动执行器：显式绑定 Vault 后调用 obsidian move。路径为 Vault 相对路径。 */
function defaultMoveRunner(vaultRoot: string): MoveRunner {
	const vaultName = basename(resolve(vaultRoot));
	return (source, target) => {
		const result = spawnSync(
			'obsidian',
			[`vault=${vaultName}`, 'move', `path=${source}`, `to=${target}`],
			{ encoding: 'utf8' },
		);
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
	id?: string;
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
		if (!['type', 'status', 'id', 'archived'].includes(key)) continue;
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
	result.id = values.id;
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

interface MetadataRepair {
	target: string;
	targetAbs: string;
}

interface ArchivePaths {
	sourceRoot: string;
	targetRoot: string;
}

function candidatePaths(vaultRoot: string, type: ArchiveEntityType): ArchivePaths {
	const config = resolveConfig(vaultRoot).rawConfig;
	const sourceRoots: Record<ArchiveEntityType, string> = {
		project: config.directories.projects,
		draft: config.directories.drafts,
		plan: config.directories.plans,
		diary: config.directories.diary,
	};
	const archive = config.subdirectories.system.archive;
	const targetLeaves: Record<ArchiveEntityType, string> = {
		project: archive.projects,
		draft: archive.drafts,
		plan: archive.plans,
		diary: archive.diary,
	};
	return {
		sourceRoot: sourceRoots[type],
		targetRoot: `${config.directories.system}/${targetLeaves[type]}`,
	};
}

function unsafeRelativePath(path: string): boolean {
	if (!path || path.includes('\0') || path.includes('\\')) return true;
	if (isAbsolute(path) || win32.isAbsolute(path)) return true;
	const parts = path.split('/');
	return parts.some((part) => !part || part === '.' || part === '..');
}

function dateParts(value: string): { year: string; month: string; time: number } | null {
	if (!DATE_PATTERN.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	const time = Date.UTC(year, month - 1, day);
	const date = new Date(time);
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() + 1 !== month ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return { year: String(year).padStart(4, '0'), month: String(month).padStart(2, '0'), time };
}

function validateCandidatePath(
	vaultRoot: string,
	candidate: ArchiveCandidate,
	archiveDate: string,
): ArchiveIssue | null {
	for (const [field, value] of [
		['source', candidate.source],
		['target', candidate.target],
		['main_file', candidate.main_file],
	] as const) {
		if (value !== undefined && unsafeRelativePath(value)) {
			return { path: value, reason: `${field}_outside_vault` };
		}
	}

	const { sourceRoot, targetRoot } = candidatePaths(vaultRoot, candidate.type);
	if (dirname(candidate.source) !== sourceRoot) {
		return { path: candidate.source, reason: `invalid_source_location:${candidate.type}` };
	}
	if (candidate.type !== 'project' && !candidate.source.endsWith('.md')) {
		return { path: candidate.source, reason: `invalid_source_shape:${candidate.type}` };
	}
	if (candidate.type !== 'diary') {
		const mainFile = candidate.main_file;
		if (!mainFile) return { path: candidate.source, reason: 'main_file_missing' };
		if (candidate.source.endsWith('.md')) {
			if (mainFile !== candidate.source) {
				return { path: mainFile, reason: 'main_file_outside_source' };
			}
		} else if (!mainFile.startsWith(`${candidate.source}/`)) {
			return { path: mainFile, reason: 'main_file_outside_source' };
		}
	}

	const targetRelative = relative(targetRoot, candidate.target).replace(/\\/g, '/');
	const targetParts = targetRelative.split('/');
	const sourceName = basename(candidate.source);
	if (candidate.type === 'project') {
		if (
			targetParts.length !== 2 ||
			!/^\d{4}$/.test(targetParts[0]) ||
			targetParts[1] !== sourceName
		) {
			return { path: candidate.target, reason: 'invalid_target_location:project' };
		}
	} else if (candidate.type === 'draft') {
		const archived = dateParts(archiveDate);
		if (
			!archived ||
			targetParts.length !== 3 ||
			targetParts[0] !== archived.year ||
			targetParts[1] !== archived.month ||
			targetParts[2] !== sourceName
		) {
			return { path: candidate.target, reason: 'invalid_target_location:draft' };
		}
	} else if (candidate.type === 'plan') {
		if (targetParts.length !== 1 || targetParts[0] !== sourceName) {
			return { path: candidate.target, reason: 'invalid_target_location:plan' };
		}
	} else {
		const diaryName = sourceName.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
		const diaryDate = diaryName ? dateParts(diaryName[0].slice(0, -3)) : null;
		const archived = dateParts(archiveDate);
		if (!diaryName || !diaryDate || !archived || diaryDate.time >= archived.time - 6 * 86_400_000) {
			return { path: candidate.source, reason: 'diary_inside_retention_window' };
		}
		if (
			targetParts.length !== 3 ||
			targetParts[0] !== diaryName[1] ||
			targetParts[1] !== diaryName[2] ||
			targetParts[2] !== sourceName
		) {
			return { path: candidate.target, reason: 'invalid_target_location:diary' };
		}
	}
	return null;
}

function validateMainFile(
	candidate: ArchiveCandidate,
	mainPath: string,
	content: string,
	archiveDate: string,
): ArchiveIssue | null {
	const frontmatter = parseFrontmatter(content);
	if (frontmatter.type !== candidate.type) {
		return { path: mainPath, reason: `type_mismatch:${frontmatter.type ?? 'none'}` };
	}
	if (frontmatter.status !== 'done') {
		return { path: mainPath, reason: `status_not_done:${frontmatter.status ?? 'none'}` };
	}
	if (candidate.type === 'project' && frontmatter.id !== candidate.project_id) {
		return { path: mainPath, reason: `project_id_mismatch:${frontmatter.id ?? 'none'}` };
	}
	if (frontmatter.archived !== undefined && frontmatter.archived !== archiveDate) {
		return { path: mainPath, reason: `archived_date_conflict:${frontmatter.archived}` };
	}
	return null;
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

/** 源目录树是否仅剩空目录（无普通文件、符号链接或特殊条目）；扫描异常失败关闭返回 false */
function isEmptyTreeExceptDirs(directory: string): boolean {
	try {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!isEmptyTreeExceptDirs(join(directory, entry.name))) return false;
			} else {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

/** 在目录树中查找符号链接或特殊条目，返回相对路径名；未找到或扫描异常返回 null */
function findUnsupportedEntry(directory: string): string | null {
	try {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				const found = findUnsupportedEntry(join(directory, entry.name));
				if (found) return found;
			} else if (!entry.isFile()) {
				return entry.name;
			}
		}
	} catch {
		return null;
	}
	return null;
}

function moveFile(item: PreparedCandidate, move: MoveRunner, report: ArchiveReport): boolean {
	const { candidate } = item;
	if (report.dryRun) {
		report.moved.push({ from: candidate.source, to: candidate.target });
		return true;
	}
	const result = move(candidate.source, candidate.target);
	if (!result.ok) {
		report.failed.push({ path: candidate.source, reason: result.error ?? 'move_failed' });
		return false;
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
	const mainRel = candidate.main_file?.slice(candidate.source.length + 1);
	const orderedFiles =
		mainRel && files.includes(mainRel)
			? [mainRel, ...files.filter((file) => file !== mainRel)]
			: files;
	for (const rel of orderedFiles) {
		const targetAbs = join(item.targetAbs, rel);
		mkdirSync(dirname(targetAbs), { recursive: true });
		const result = move(`${candidate.source}/${rel}`, `${candidate.target}/${rel}`);
		if (!result.ok) {
			report.failed.push({
				path: `${candidate.source}/${rel}`,
				reason: result.error ?? 'move_failed',
			});
			return false;
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
		// 仅当源树确认仅剩空目录时清理失败不阻断元数据；无法确认或有残留则保持失败
		if (!isEmptyTreeExceptDirs(item.sourceAbs)) return false;
	}
	return true;
}

/** 幂等写入 archived 字段（保留 status: done；已有同值日期则跳过）；dry-run 不做任何文件操作 */
type WriteArchivedResult = 'changed' | 'unchanged' | 'failed';

function writeArchived(
	targetAbs: string,
	archiveDate: string,
	report: ArchiveReport,
): WriteArchivedResult {
	if (report.dryRun) return 'unchanged';
	let content: string;
	try {
		content = readFileSync(targetAbs, 'utf8');
	} catch (error) {
		report.failed.push({ path: targetAbs, reason: `read_failed:${(error as Error).message}` });
		return 'failed';
	}
	const frontmatter = parseFrontmatter(content);
	if (!frontmatter.parsed) {
		report.failed.push({ path: targetAbs, reason: 'frontmatter_missing' });
		return 'failed';
	}
	if (frontmatter.archived !== undefined) {
		if (frontmatter.archived === archiveDate) return 'unchanged';
		report.failed.push({
			path: targetAbs,
			reason: `archived_date_conflict:${frontmatter.archived}`,
		});
		return 'failed';
	}
	const insertPos = frontmatter.insertPos ?? 0;
	try {
		writeFileSync(
			targetAbs,
			`${content.slice(0, insertPos)}archived: "${archiveDate}"\n${content.slice(insertPos)}`,
		);
		return 'changed';
	} catch (error) {
		report.failed.push({ path: targetAbs, reason: `write_failed:${(error as Error).message}` });
		return 'failed';
	}
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
	if (!dateParts(options.archiveDate)) {
		throw new Error(`无效归档日期: ${options.archiveDate}（应为 YYYY-MM-DD）`);
	}
	const report: ArchiveReport = {
		dryRun: Boolean(options.dryRun),
		archiveDate: options.archiveDate,
		moved: [],
		updated: [],
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
	const repairs: MetadataRepair[] = [];
	for (const candidate of options.candidates) {
		const pathIssue = validateCandidatePath(options.vaultRoot, candidate, options.archiveDate);
		if (pathIssue) {
			report.conflicts.push(pathIssue);
			continue;
		}
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
				if (candidate.type !== 'diary') {
					const mainFile = candidate.main_file as string;
					const targetMain = relocatedPath(candidate.source, candidate.target, mainFile);
					const targetMainAbs = join(options.vaultRoot, targetMain);
					if (!existsSync(targetMainAbs)) {
						report.conflicts.push({ path: targetMain, reason: 'main_file_missing' });
						continue;
					}
					let content: string;
					try {
						content = readFileSync(targetMainAbs, 'utf8');
					} catch (error) {
						report.conflicts.push({
							path: targetMain,
							reason: `read_failed:${(error as Error).message}`,
						});
						continue;
					}
					const issue = validateMainFile(candidate, targetMain, content, options.archiveDate);
					if (issue) {
						report.conflicts.push(issue);
						continue;
					}
					if (parseFrontmatter(content).archived === undefined) {
						repairs.push({ target: targetMain, targetAbs: targetMainAbs });
					}
				}
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
		if (sourceStat.isDirectory()) {
			// 预检拒绝源树内的符号链接与特殊条目，避免被 collectFiles 忽略后残留
			const unsupported = findUnsupportedEntry(sourceAbs);
			if (unsupported) {
				report.conflicts.push({
					path: `${candidate.source}/${unsupported}`,
					reason: 'source_contains_symlink',
				});
				continue;
			}
			// 空源目录续跑：文件全部移动成功但清理失败后的现场
			if (collectFiles(sourceAbs).length === 0) {
				if (!existsSync(targetAbs)) {
					report.failed.push({ path: candidate.source, reason: 'empty_directory' });
					continue;
				}
				if (!lstatSync(targetAbs).isDirectory()) {
					report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
					continue;
				}
				if (candidate.type !== 'diary') {
					const mainFile = candidate.main_file as string;
					const targetMain = relocatedPath(candidate.source, candidate.target, mainFile);
					const targetMainAbs = join(options.vaultRoot, targetMain);
					if (!existsSync(targetMainAbs)) {
						report.conflicts.push({ path: targetMain, reason: 'main_file_missing' });
						continue;
					}
					let content: string;
					try {
						content = readFileSync(targetMainAbs, 'utf8');
					} catch (error) {
						report.conflicts.push({
							path: targetMain,
							reason: `read_failed:${(error as Error).message}`,
						});
						continue;
					}
					const issue = validateMainFile(candidate, targetMain, content, options.archiveDate);
					if (issue) {
						report.conflicts.push(issue);
						continue;
					}
					if (parseFrontmatter(content).archived === undefined) {
						repairs.push({ target: targetMain, targetAbs: targetMainAbs });
					}
				}
				try {
					removeEmptyDirs(sourceAbs);
				} catch (error) {
					report.failed.push({
						path: candidate.source,
						reason: `cleanup_failed:${(error as Error).message}`,
					});
					if (!isEmptyTreeExceptDirs(sourceAbs)) continue;
				}
				report.skipped.push({ path: candidate.source, reason: 'already_moved' });
				continue;
			}
		}
		const targetExists = existsSync(targetAbs);
		if (targetExists && !sourceStat.isDirectory()) {
			report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
			continue;
		}
		if (candidate.type !== 'diary') {
			const mainFile = candidate.main_file;
			if (!mainFile) {
				// 结构校验已保证存在；此处仅用于类型收窄
				continue;
			}
			const targetMain = relocatedPath(candidate.source, candidate.target, mainFile);
			const sourceMainAbs = join(options.vaultRoot, mainFile);
			const targetMainAbs = join(options.vaultRoot, targetMain);
			const mainPath = existsSync(sourceMainAbs)
				? mainFile
				: existsSync(targetMainAbs)
					? targetMain
					: null;
			if (!mainPath) {
				report.conflicts.push({ path: mainFile, reason: 'main_file_missing' });
				continue;
			}
			const mainAbs = join(options.vaultRoot, mainPath);
			let content: string;
			try {
				content = readFileSync(mainAbs, 'utf8');
			} catch (error) {
				report.conflicts.push({
					path: mainPath,
					reason: `read_failed:${(error as Error).message}`,
				});
				continue;
			}
			const issue = validateMainFile(candidate, mainPath, content, options.archiveDate);
			if (issue) {
				report.conflicts.push(issue);
				continue;
			}
		}
		if (targetExists) {
			if (!sourceStat.isDirectory() || !lstatSync(targetAbs).isDirectory()) {
				report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
				continue;
			}
			const targetFiles = collectFiles(targetAbs);
			const targetMain = candidate.main_file
				? relocatedPath(candidate.source, candidate.target, candidate.main_file)
				: null;
			if (
				targetFiles.length > 0 &&
				(!targetMain || !existsSync(join(options.vaultRoot, targetMain)))
			) {
				report.conflicts.push({ path: candidate.target, reason: 'target_collision' });
				continue;
			}
			const collision = collectFiles(sourceAbs).find((file) => existsSync(join(targetAbs, file)));
			if (collision) {
				report.conflicts.push({
					path: `${candidate.target}/${collision}`,
					reason: 'partial_file_collision',
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
	const move = options.moveRunner ?? defaultMoveRunner(options.vaultRoot);
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
		if (
			writeArchived(join(options.vaultRoot, targetMain), options.archiveDate, report) === 'changed'
		) {
			report.updated.push(targetMain);
		}
	}
	for (const repair of repairs) {
		if (writeArchived(repair.targetAbs, options.archiveDate, report) === 'changed') {
			report.updated.push(repair.target);
		}
	}

	return report;
}
