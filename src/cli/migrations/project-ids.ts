import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fchmodSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import type { LifeOSConfig } from '../../config.js';
import { assertVaultPathSafe, canonicalVaultRoot } from '../../utils/safe-path.js';
import type { ScopeMapProject } from './v4-scope-map.js';

const PORTABLE_PROJECT_ID = /^[a-z0-9][a-z0-9._-]*$/;
const FRONTMATTER = /^(\uFEFF?---)(\r?\n)([\s\S]*?)(\r?\n)---(?=\r?\n|$)/;

export type ProjectIdReason = 'ascii-slug' | 'path-hash' | 'conflict';

export interface ProjectIdChange {
	filePath: string;
	relativePath: string;
	id: string;
	reason: ProjectIdReason;
}

export interface ProjectIdPlan {
	vaultRoot: string;
	projectsRoot: string;
	scannedMarkdownFiles: number;
	changes: readonly ProjectIdChange[];
	catalog: readonly ScopeMapProject[];
}

export interface AppliedProjectIds {
	updated: string[];
	catalog: ScopeMapProject[];
}

export interface ApplyProjectIdPlanOptions {
	/** 所有 CAS 校验通过、即将首次写入项目文件时调用。 */
	beforeWrite?: () => void;
}

interface MarkdownSnapshot {
	filePath: string;
	relativePath: string;
	content: string;
	contentHash: string;
	mode: number;
}

interface ParsedFrontmatter {
	metadata: Record<string, unknown>;
	match: RegExpExecArray;
	emptyIdRange?: { start: number; end: number };
}

interface ProjectRecord {
	file: MarkdownSnapshot;
	frontmatter: ParsedFrontmatter;
	id?: string;
	generatedId?: string;
	reason?: ProjectIdReason;
}

interface PlannedWrite {
	file: MarkdownSnapshot;
	updatedContent: string;
}

interface InternalPlan {
	projectsDirectory: string;
	snapshotHash: string;
	writes: PlannedWrite[];
}

const internalPlans = new WeakMap<ProjectIdPlan, InternalPlan>();

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

function portableRelative(root: string, path: string): string {
	return relative(root, path).replaceAll('\\', '/');
}

function scanMarkdown(vaultRoot: string, projectsRoot: string): MarkdownSnapshot[] {
	if (!existsSync(projectsRoot)) return [];
	const files: MarkdownSnapshot[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
			const filePath = join(directory, entry);
			const stat = lstatSync(filePath);
			if (stat.isSymbolicLink()) {
				throw new Error(`项目目录包含符号链接，拒绝自动配置项目 id：${filePath}`);
			}
			if (stat.isDirectory()) {
				visit(filePath);
				continue;
			}
			if (!stat.isFile()) {
				throw new Error(`项目目录包含非普通文件，拒绝自动配置项目 id：${filePath}`);
			}
			if (extname(entry).toLowerCase() !== '.md') continue;
			const content = readFileSync(filePath, 'utf8');
			files.push({
				filePath,
				relativePath: portableRelative(vaultRoot, filePath),
				content,
				contentHash: sha256(content),
				mode: stat.mode & 0o7777,
			});
		}
	};
	visit(projectsRoot);
	return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function parseFrontmatter(file: MarkdownSnapshot): ParsedFrontmatter | null {
	const hasOpeningDelimiter =
		file.content.startsWith('---') || file.content.startsWith('\uFEFF---');
	if (!hasOpeningDelimiter) return null;
	const match = FRONTMATTER.exec(file.content);
	if (!match) throw new Error(`项目文件 frontmatter 未正确闭合：${file.filePath}`);
	const yamlSource = match[3] ?? '';
	const document = parseDocument(yamlSource, { keepSourceTokens: true });
	if (document.errors.length > 0) {
		const reason = document.errors.map((error) => error.message).join('\n');
		throw new Error(`项目文件 frontmatter YAML 非法：${file.filePath}\n${reason}`);
	}
	const value: unknown = document.toJS();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`项目文件 frontmatter 必须是 YAML 对象：${file.filePath}`);
	}
	const metadata = value as Record<string, unknown>;
	if (metadata.type !== undefined && typeof metadata.type !== 'string') {
		throw new Error(`项目文件 frontmatter 的 type 必须是字符串：${file.filePath}`);
	}
	let emptyIdRange: ParsedFrontmatter['emptyIdRange'];
	if (
		Object.prototype.hasOwnProperty.call(metadata, 'id') &&
		(metadata.id === null || metadata.id === '')
	) {
		if (!isMap(document.contents)) {
			throw new Error(`项目文件 frontmatter 的 id 不是顶层映射字段：${file.filePath}`);
		}
		const idPairs = document.contents.items.filter(
			(pair) => isScalar(pair.key) && pair.key.value === 'id',
		);
		const range = idPairs[0]?.value?.range;
		if (idPairs.length !== 1 || !range) {
			throw new Error(`无法安全定位项目的空 id 字段：${file.filePath}`);
		}
		emptyIdRange = { start: range[0], end: range[1] };
	}
	return { metadata, match, emptyIdRange };
}

function validateExistingId(value: unknown, path: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string' || value !== value.trim()) {
		throw new Error(`项目 id 必须是无首尾空白的字符串：${path}`);
	}
	if (
		value === 'Project_Template' ||
		value.includes('{{') ||
		value.toLowerCase().includes('placeholder')
	) {
		throw new Error(`项目使用占位 id：${path}`);
	}
	if (!PORTABLE_PROJECT_ID.test(value)) {
		throw new Error(`项目 id 必须是可移植的小写 ASCII 标识符：${value}（${path}）`);
	}
	return value;
}

function asciiSlug(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const slug = value
		.normalize('NFKD')
		.replace(/\p{Mark}+/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!slug || slug.includes('placeholder') || slug === 'project-template') return null;
	return slug;
}

function pathDigest(relativePath: string): string {
	return sha256(relativePath.normalize('NFC').replaceAll('\\', '/'));
}

function allocateHashedId(prefix: string, relativePath: string, used: Set<string>): string {
	const digest = pathDigest(relativePath);
	for (let length = 10; length <= digest.length; length += 2) {
		const candidate = `${prefix}-${digest.slice(0, length)}`;
		if (!used.has(candidate)) return candidate;
	}
	let suffix = 2;
	while (used.has(`${prefix}-${digest}-${suffix}`)) suffix += 1;
	return `${prefix}-${digest}-${suffix}`;
}

function insertProjectId(record: ProjectRecord, id: string): string {
	const { match } = record.frontmatter;
	const closingNewline = match[4] ?? '\n';
	let yamlSource = match[3] ?? '';
	const yamlId = JSON.stringify(id);
	if (record.frontmatter.emptyIdRange) {
		const { start, end } = record.frontmatter.emptyIdRange;
		let replacementValue = yamlSource[start - 1] === ':' ? ` ${yamlId}` : yamlId;
		if (yamlSource[end] === '#') replacementValue += ' ';
		yamlSource = `${yamlSource.slice(0, start)}${replacementValue}${yamlSource.slice(end)}`;
	} else {
		yamlSource = `${yamlSource}${closingNewline}id: ${yamlId}`;
	}
	const replacement = `${match[1]}${match[2]}${yamlSource}${closingNewline}---`;
	const updated = `${replacement}${record.file.content.slice(match[0].length)}`;
	const reparsed = parseFrontmatter({
		...record.file,
		content: updated,
		contentHash: sha256(updated),
	});
	if (reparsed?.metadata.id !== id) {
		throw new Error(`无法在不重写 frontmatter 的情况下安全添加项目 id：${record.file.filePath}`);
	}
	return updated;
}

function aliasesFor(record: ProjectRecord): string[] {
	const metadata = record.frontmatter.metadata;
	const values = [
		metadata.title,
		basename(record.file.filePath, extname(record.file.filePath)),
		metadata.aliases,
	]
		.flatMap((value) => (Array.isArray(value) ? value : [value]))
		.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
		.map((value) => value.trim());
	return [...new Set(values)];
}

function catalogFor(
	vaultRoot: string,
	projectsRoot: string,
	records: readonly ProjectRecord[],
): ScopeMapProject[] {
	return records
		.map((record) => {
			const id = record.id ?? record.generatedId;
			if (!id) throw new Error(`项目缺少计划 id：${record.file.filePath}`);
			const parent = dirname(record.file.filePath);
			const paths = [record.file.relativePath];
			if (parent !== projectsRoot) paths.push(portableRelative(vaultRoot, parent));
			return { id, aliases: aliasesFor(record), paths };
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

function snapshotHash(files: readonly MarkdownSnapshot[]): string {
	return sha256(
		files.map((file) => `${file.relativePath}\u0000${file.contentHash}`).join('\u0000'),
	);
}

function buildPlan(vaultRootInput: string, projectsDirectory: string): ProjectIdPlan {
	const vaultRoot = canonicalVaultRoot(vaultRootInput);
	const projectsRoot = assertVaultPathSafe(vaultRoot, join(vaultRoot, projectsDirectory));
	const files = scanMarkdown(vaultRoot, projectsRoot);
	const records: ProjectRecord[] = [];
	const existingIds = new Map<string, string>();

	for (const file of files) {
		const frontmatter = parseFrontmatter(file);
		if (!frontmatter || frontmatter.metadata.type !== 'project') continue;
		const id = validateExistingId(frontmatter.metadata.id, file.filePath);
		if (id) {
			const existing = existingIds.get(id);
			if (existing) throw new Error(`项目 id 重复：${id}（${existing}、${file.filePath}）`);
			existingIds.set(id, file.filePath);
		}
		records.push({ file, frontmatter, id });
	}

	const missing = records.filter((record) => !record.id);
	const bases = new Map<string, ProjectRecord[]>();
	for (const record of missing) {
		const metadata = record.frontmatter.metadata;
		const base =
			asciiSlug(metadata.title) ??
			asciiSlug(basename(record.file.filePath, extname(record.file.filePath)));
		if (!base) continue;
		const grouped = bases.get(base) ?? [];
		grouped.push(record);
		bases.set(base, grouped);
	}

	const used = new Set(existingIds.keys());
	for (const record of missing.sort((a, b) =>
		a.file.relativePath.localeCompare(b.file.relativePath),
	)) {
		const metadata = record.frontmatter.metadata;
		const base =
			asciiSlug(metadata.title) ??
			asciiSlug(basename(record.file.filePath, extname(record.file.filePath)));
		if (!base) {
			record.generatedId = allocateHashedId('project', record.file.relativePath, used);
			record.reason = 'path-hash';
		} else if ((bases.get(base)?.length ?? 0) === 1 && !used.has(base)) {
			record.generatedId = base;
			record.reason = 'ascii-slug';
		} else {
			record.generatedId = allocateHashedId(base, record.file.relativePath, used);
			record.reason = 'conflict';
		}
		used.add(record.generatedId);
	}

	const writes = missing.map((record) => ({
		file: record.file,
		updatedContent: insertProjectId(record, record.generatedId as string),
	}));
	const changes = missing.map((record) => ({
		filePath: record.file.filePath,
		relativePath: record.file.relativePath,
		id: record.generatedId as string,
		reason: record.reason as ProjectIdReason,
	}));
	const plan: ProjectIdPlan = {
		vaultRoot,
		projectsRoot,
		scannedMarkdownFiles: files.length,
		changes,
		catalog: catalogFor(vaultRoot, projectsRoot, records),
	};
	internalPlans.set(plan, {
		projectsDirectory,
		snapshotHash: snapshotHash(files),
		writes,
	});
	return plan;
}

/** 扫描项目树并生成可审计的自动补 ID 计划；此函数不会修改任何文件。 */
export function planProjectIds(vaultRoot: string, config: LifeOSConfig): ProjectIdPlan {
	return buildPlan(vaultRoot, config.directories.projects);
}

function fsyncParent(path: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(dirname(path), 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function atomicWrite(path: string, content: string, mode: number): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	let descriptor: number | null = null;
	try {
		descriptor = openSync(temporary, 'wx', mode);
		writeFileSync(descriptor, content, 'utf8');
		fchmodSync(descriptor, mode);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = null;
		renameSync(temporary, path);
		fsyncParent(path);
	} catch (error) {
		if (descriptor !== null) closeSync(descriptor);
		if (existsSync(temporary)) unlinkSync(temporary);
		throw error;
	}
}

/** 原子应用同一进程生成的计划，并返回应用后的项目 catalog。 */
export function applyProjectIdPlan(
	plan: ProjectIdPlan,
	options: ApplyProjectIdPlanOptions = {},
): AppliedProjectIds {
	const internal = internalPlans.get(plan);
	if (!internal) throw new Error('项目 id 计划不是由当前进程生成，拒绝应用');
	const current = buildPlan(plan.vaultRoot, internal.projectsDirectory);
	const currentInternal = internalPlans.get(current) as InternalPlan;
	if (currentInternal.snapshotHash !== internal.snapshotHash) {
		throw new Error('项目文件在生成 id 计划后发生变化，请重新生成计划');
	}
	if (JSON.stringify(current.changes) !== JSON.stringify(plan.changes)) {
		throw new Error('项目 id 计划已过期，请重新生成计划');
	}

	for (const write of internal.writes) {
		const safePath = assertVaultPathSafe(plan.vaultRoot, write.file.filePath);
		const stat = lstatSync(safePath);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error(`项目文件不再是普通文件：${safePath}`);
		}
		if (sha256(readFileSync(safePath)) !== write.file.contentHash) {
			throw new Error(`项目文件在应用 id 前发生变化：${safePath}`);
		}
	}
	if (internal.writes.length > 0) options.beforeWrite?.();
	for (const write of internal.writes) {
		atomicWrite(write.file.filePath, write.updatedContent, write.file.mode);
	}

	const applied = buildPlan(plan.vaultRoot, internal.projectsDirectory);
	if (applied.changes.length > 0) {
		throw new Error('项目 id 自动配置后仍存在未应用的变更');
	}
	return {
		updated: internal.writes.map((write) => write.file.filePath),
		catalog: [...applied.catalog],
	};
}
