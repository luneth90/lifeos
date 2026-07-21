import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import type { RepositoryBindings } from '../../config.js';
import type { LegacyMemoryInventoryItem } from './v4-scope-map.js';

export type RepositoryPathEvidenceSource = 'related_files' | 'content';

export interface RepositoryPathEvidence {
	legacyIdentity: string;
	slotKey: string;
	source: RepositoryPathEvidenceSource;
	path: string;
}

export interface DiscoveredRepositoryBinding {
	key: string;
	roots: string[];
	evidence: RepositoryPathEvidence[];
}

export type RepositoryBindingAmbiguityReason =
	| 'missing_path_evidence'
	| 'path_not_found'
	| 'not_git_repository'
	| 'vault_repository'
	| 'multiple_repositories'
	| 'repository_key_unavailable'
	| 'repository_key_mismatch'
	| 'explicit_binding_conflict'
	| 'repository_key_conflict';

export interface RepositoryBindingAmbiguity {
	reason: RepositoryBindingAmbiguityReason;
	legacyIdentities: string[];
	slotKeys: string[];
	candidatePaths: string[];
	repositoryRoots: string[];
	proposedKey?: string;
	message: string;
}

export interface RepositoryBindingDiscoveryResult {
	/** 现有显式配置与全部无歧义发现的稳定合并结果。 */
	bindings: RepositoryBindings;
	discovered: DiscoveredRepositoryBinding[];
	/** 非空时调用方必须停止自动配置，不能猜测或写入部分结果。 */
	ambiguities: RepositoryBindingAmbiguity[];
}

export type GitRootResolution =
	| { status: 'resolved'; root: string }
	| { status: 'path_not_found' }
	| { status: 'not_git_repository' };

export type GitRootResolver = (path: string) => GitRootResolution;

export interface DiscoverRepositoryBindingsOptions {
	inventory: readonly LegacyMemoryInventoryItem[];
	existingBindings?: Readonly<RepositoryBindings>;
	vaultRoot: string;
	/** 测试或特殊宿主可注入只读解析器；默认仅沿祖先检查安全的 `.git` 标记。 */
	resolveGitRoot?: GitRootResolver;
}

interface RepositoryRecord {
	item: LegacyMemoryInventoryItem;
	hint: string;
}

interface ProposedBinding {
	key: string;
	root: string;
	evidence: RepositoryPathEvidence[];
}

const PORTABLE_REPOSITORY_KEY = /^[a-z0-9][a-z0-9._-]*$/;

function sortUnique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function normalizeExistingBindings(bindings: Readonly<RepositoryBindings>): RepositoryBindings {
	return Object.fromEntries(
		Object.entries(bindings)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, roots]) => [key, sortUnique(roots)]),
	);
}

function isInsideOrEqual(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function overlapsVault(vaultRoot: string, repositoryRoot: string): boolean {
	return isInsideOrEqual(vaultRoot, repositoryRoot) || isInsideOrEqual(repositoryRoot, vaultRoot);
}

function portableKey(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/[-._]{2,}/g, '-')
		.replace(/^[-._]+|[-._]+$/g, '');
}

const SOURCE_LOCATION_CONTENT =
	/(?:源码|源代码|代码仓库|git\s*仓库|仓库)(?:的)?(?:根)?(?:路径|目录)|\b(?:source(?:\s+code)?|repository|repo)(?:\s+root)?\s+(?:path|directory|dir|root)\b/iu;

function hasProjectNoteEvidence(item: LegacyMemoryInventoryItem, vaultRoot: string): boolean {
	for (const relatedFile of item.relatedFiles) {
		if (isAbsolute(relatedFile) || win32.isAbsolute(relatedFile)) continue;
		const candidate = resolve(vaultRoot, relatedFile);
		if (!isInsideOrEqual(vaultRoot, candidate) || !existsSync(candidate)) continue;
		try {
			const canonical = realpathSync.native(candidate);
			if (!isInsideOrEqual(vaultRoot, canonical) || !statSync(canonical).isFile()) continue;
			const content = readFileSync(canonical, 'utf8');
			const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1];
			if (frontmatter && /^\s*type\s*:\s*["']?project["']?\s*(?:#.*)?$/imu.test(frontmatter)) {
				return true;
			}
		} catch {
			// 无法读取的关联文件不作为项目或仓库证据。
		}
	}
	return false;
}

function repositoryRecord(
	item: LegacyMemoryInventoryItem,
	vaultRoot: string,
): RepositoryRecord | null {
	const slotKey = item.slotKey.trim();
	const explicit = /^repository:(.+)$/i.exec(slotKey);
	if (explicit?.[1]?.trim()) return { item, hint: portableKey(explicit[1]) };
	// 项目自身的 source-path 事实属于 project scope，不能据此创建 repository binding。
	if (hasProjectNoteEvidence(item, vaultRoot)) return null;

	const tail = slotKey.split(':').slice(1).join(':').trim();
	const semanticSuffix =
		/^(.*?)[-_.](?:source(?:[-_.]code)?|repository|repo)[-_.](?:path|dir|directory|root)$/i.exec(
			tail,
		);
	if (semanticSuffix) {
		return { item, hint: portableKey(semanticSuffix[1] ?? '') };
	}
	if (SOURCE_LOCATION_CONTENT.test(item.content) && contentAbsolutePaths(item.content).length > 0) {
		return { item, hint: '' };
	}
	return null;
}

function hintMatchesKey(hint: string, key: string): boolean {
	if (!key) return false;
	// 内容明确声明“源码/仓库路径”时可能没有稳定槽位提示，此时 Git 根目录名是唯一 key 证据。
	if (!hint) return true;
	if (hint === key) return true;
	for (const separator of ['-', '_', '.']) {
		if (hint.startsWith(`${key}${separator}`) || key.startsWith(`${hint}${separator}`)) return true;
	}
	return false;
}

function cleanExtractedPath(value: string): string {
	return value
		.trim()
		.replace(/[，。；：！？,;!?)\]}]+$/gu, '')
		.replace(/[#?][^/]*$/u, '');
}

function contentAbsolutePaths(content: string): string[] {
	const found: string[] = [];
	const quoted = /(["'`])((?:\/|[a-z]:[\\/])[^"'`\r\n]+)\1/giu;
	for (const match of content.matchAll(quoted)) {
		if (match[2]) found.push(cleanExtractedPath(match[2]));
	}
	const unquotedContent = content.replace(quoted, (value) => ' '.repeat(value.length));
	const unquoted = /(?:\/|[a-z]:[\\/])[^\s"'`<>|，。；：！？]+/giu;
	for (const match of unquotedContent.matchAll(unquoted)) {
		if (match[0]) found.push(cleanExtractedPath(match[0]));
	}
	return sortUnique(found).filter((path) => isAbsolute(path) || win32.isAbsolute(path));
}

function evidenceFor(record: RepositoryRecord, vaultRoot: string): RepositoryPathEvidence[] {
	const evidence: RepositoryPathEvidence[] = [];
	for (const value of record.item.relatedFiles) {
		const path = cleanExtractedPath(value);
		// Vault 相对路径是知识关联，而不是源码仓库位置，不能据此发现 repository。
		if (!isAbsolute(path) && !win32.isAbsolute(path)) continue;
		evidence.push({
			legacyIdentity: record.item.legacyIdentity,
			slotKey: record.item.slotKey,
			source: 'related_files',
			path,
		});
	}
	for (const path of contentAbsolutePaths(record.item.content)) {
		evidence.push({
			legacyIdentity: record.item.legacyIdentity,
			slotKey: record.item.slotKey,
			source: 'content',
			path,
		});
	}
	const unique = new Map<string, RepositoryPathEvidence>();
	for (const item of evidence) {
		const normalized =
			win32.isAbsolute(item.path) && !isAbsolute(item.path) ? item.path : resolve(item.path);
		// 即使内容显式写了 Vault 内绝对路径，也不能把它提升为源码仓库证据。
		if (isAbsolute(normalized) && isInsideOrEqual(vaultRoot, normalized)) continue;
		unique.set(`${item.source}\u0000${normalized}`, { ...item, path: normalized });
	}
	return [...unique.values()].sort(
		(a, b) => a.path.localeCompare(b.path) || a.source.localeCompare(b.source),
	);
}

function isValidGitDirectory(path: string): boolean {
	try {
		const directory = lstatSync(path);
		if (directory.isSymbolicLink() || !directory.isDirectory()) return false;
		const head = lstatSync(join(path, 'HEAD'));
		return !head.isSymbolicLink() && head.isFile();
	} catch {
		return false;
	}
}

function gitMarkerAt(path: string): 'absent' | 'valid' | 'invalid' {
	const marker = join(path, '.git');
	try {
		const stat = lstatSync(marker);
		if (stat.isSymbolicLink()) return 'invalid';
		if (stat.isDirectory()) return isValidGitDirectory(marker) ? 'valid' : 'invalid';
		if (!stat.isFile() || stat.size > 16 * 1024) return 'invalid';
		const match = /^gitdir:[ \t]*(.+?)[ \t]*\r?\n?$/u.exec(readFileSync(marker, 'utf8'));
		if (!match?.[1]) return 'invalid';
		const target = isAbsolute(match[1]) ? match[1] : resolve(path, match[1]);
		return isValidGitDirectory(target) ? 'valid' : 'invalid';
	} catch (error) {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
			? 'absent'
			: 'invalid';
	}
}

export function resolveGitRoot(path: string): GitRootResolution {
	if (!existsSync(path)) return { status: 'path_not_found' };
	let canonical: string;
	try {
		canonical = realpathSync.native(path);
		const stat = statSync(canonical);
		if (!stat.isDirectory()) canonical = dirname(canonical);
	} catch {
		return { status: 'path_not_found' };
	}
	let cursor = canonical;
	while (true) {
		const marker = gitMarkerAt(cursor);
		if (marker === 'valid') return { status: 'resolved', root: cursor };
		if (marker === 'invalid') return { status: 'not_git_repository' };
		const parent = dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	return { status: 'not_git_repository' };
}

function existingKeysByCanonicalRoot(
	bindings: Readonly<RepositoryBindings>,
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const [key, roots] of Object.entries(bindings)) {
		for (const root of roots) {
			if (!existsSync(root)) continue;
			let canonical: string;
			try {
				canonical = realpathSync.native(root);
			} catch {
				continue;
			}
			const keys = result.get(canonical) ?? [];
			if (!keys.includes(key)) keys.push(key);
			result.set(
				canonical,
				keys.sort((a, b) => a.localeCompare(b)),
			);
		}
	}
	return result;
}

function ambiguity(
	reason: RepositoryBindingAmbiguityReason,
	records: readonly RepositoryRecord[],
	options: {
		candidatePaths?: readonly string[];
		repositoryRoots?: readonly string[];
		proposedKey?: string;
		message: string;
	},
): RepositoryBindingAmbiguity {
	return {
		reason,
		legacyIdentities: sortUnique(records.map(({ item }) => item.legacyIdentity)),
		slotKeys: sortUnique(records.map(({ item }) => item.slotKey)),
		candidatePaths: sortUnique(options.candidatePaths ?? []),
		repositoryRoots: sortUnique(options.repositoryRoots ?? []),
		...(options.proposedKey ? { proposedKey: options.proposedKey } : {}),
		message: options.message,
	};
}

/**
 * 从旧 repository 槽位或明确的源码位置记录中，只读发现 Git 仓库绑定。
 *
 * 该函数不搜索整台机器、不修改配置，也不把 Vault 相对文件当作源码路径。
 * `ambiguities` 非空表示证据不足，调用方必须停止自动写入并交给用户处理。
 */
export function discoverRepositoryBindings(
	options: DiscoverRepositoryBindingsOptions,
): RepositoryBindingDiscoveryResult {
	if (!existsSync(options.vaultRoot) || !statSync(options.vaultRoot).isDirectory()) {
		throw new Error(`Vault 根目录不存在或不是目录：${options.vaultRoot}`);
	}
	const vaultRoot = realpathSync.native(options.vaultRoot);
	const existing = normalizeExistingBindings(options.existingBindings ?? {});
	const explicitRoots = existingKeysByCanonicalRoot(existing);
	const gitRootResolver = options.resolveGitRoot ?? resolveGitRoot;
	const records = options.inventory
		.map((item) => repositoryRecord(item, vaultRoot))
		.filter((record): record is RepositoryRecord => record !== null)
		.sort((a, b) => a.item.legacyIdentity.localeCompare(b.item.legacyIdentity));
	const proposals: Array<ProposedBinding & { record: RepositoryRecord }> = [];
	const ambiguities: RepositoryBindingAmbiguity[] = [];

	for (const record of records) {
		const evidence = evidenceFor(record, vaultRoot);
		if (evidence.length === 0) {
			const matchingExplicitKeys = record.hint
				? Object.keys(existing).filter((key) => hintMatchesKey(record.hint, key))
				: [];
			if (matchingExplicitKeys.length === 1) {
				// 无路径的普通 repository 规则可由唯一显式 key 满足，无需重复发现其根目录。
				continue;
			}
			if (matchingExplicitKeys.length > 1) {
				ambiguities.push(
					ambiguity('explicit_binding_conflict', [record], {
						repositoryRoots: matchingExplicitKeys.flatMap((key) => existing[key] ?? []),
						message: `槽位 ${record.item.slotKey} 同时匹配多个显式 repository key：${matchingExplicitKeys.join('、')}`,
					}),
				);
				continue;
			}
			ambiguities.push(
				ambiguity('missing_path_evidence', [record], {
					message: `${record.item.slotKey} 没有 Vault 外的绝对路径证据`,
				}),
			);
			continue;
		}
		const roots = new Set<string>();
		let failed = false;
		for (const item of evidence) {
			const resolution = gitRootResolver(item.path);
			if (resolution.status !== 'resolved') {
				failed = true;
				ambiguities.push(
					ambiguity(resolution.status, [record], {
						candidatePaths: [item.path],
						message:
							resolution.status === 'path_not_found'
								? `路径不存在，不能自动绑定 repository：${item.path}`
								: `路径不属于可解析的 Git 仓库：${item.path}`,
					}),
				);
				continue;
			}
			let root: string;
			try {
				root = realpathSync.native(resolution.root);
			} catch {
				failed = true;
				ambiguities.push(
					ambiguity('path_not_found', [record], {
						candidatePaths: [item.path],
						repositoryRoots: [resolution.root],
						message: `Git 返回的仓库根目录不存在：${resolution.root}`,
					}),
				);
				continue;
			}
			if (overlapsVault(vaultRoot, root)) {
				failed = true;
				ambiguities.push(
					ambiguity('vault_repository', [record], {
						candidatePaths: [item.path],
						repositoryRoots: [root],
						message: `候选 Git 根目录与 Vault 重叠，拒绝将其当作源码仓库：${root}`,
					}),
				);
				continue;
			}
			roots.add(root);
		}
		if (failed) continue;
		if (roots.size !== 1) {
			ambiguities.push(
				ambiguity('multiple_repositories', [record], {
					candidatePaths: evidence.map(({ path }) => path),
					repositoryRoots: [...roots],
					message: `${record.item.slotKey} 同时指向多个 Git 仓库，不能自动选择`,
				}),
			);
			continue;
		}
		const root = [...roots][0];
		if (!root) continue;
		const explicitKeys = explicitRoots.get(root) ?? [];
		if (explicitKeys.length > 1) {
			ambiguities.push(
				ambiguity('explicit_binding_conflict', [record], {
					repositoryRoots: [root],
					message: `仓库根目录已被多个显式 repository key 绑定：${explicitKeys.join('、')}`,
				}),
			);
			continue;
		}
		if (explicitKeys.length === 1) {
			// 显式配置优先且绝不改写；路径已被绑定即视为满足。
			continue;
		}
		const key = portableKey(basename(root));
		if (!key || !PORTABLE_REPOSITORY_KEY.test(key)) {
			ambiguities.push(
				ambiguity('repository_key_unavailable', [record], {
					repositoryRoots: [root],
					message: `无法从 Git 根目录生成可移植 repository key：${root}`,
				}),
			);
			continue;
		}
		if (!hintMatchesKey(record.hint, key)) {
			ambiguities.push(
				ambiguity('repository_key_mismatch', [record], {
					repositoryRoots: [root],
					proposedKey: key,
					message: `槽位标识 ${record.hint} 与 Git 根目录标识 ${key} 不一致`,
				}),
			);
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(existing, key)) {
			ambiguities.push(
				ambiguity('explicit_binding_conflict', [record], {
					repositoryRoots: [root, ...(existing[key] ?? [])],
					proposedKey: key,
					message: `显式 repository key ${key} 已绑定其他路径，自动发现不会覆盖`,
				}),
			);
			continue;
		}
		proposals.push({ key, root, evidence, record });
	}

	const proposalsByKey = new Map<string, Array<ProposedBinding & { record: RepositoryRecord }>>();
	for (const proposal of proposals) {
		const group = proposalsByKey.get(proposal.key) ?? [];
		group.push(proposal);
		proposalsByKey.set(proposal.key, group);
	}
	const discovered: DiscoveredRepositoryBinding[] = [];
	for (const [key, group] of [...proposalsByKey].sort(([a], [b]) => a.localeCompare(b))) {
		const roots = sortUnique(group.map(({ root }) => root));
		if (roots.length !== 1) {
			ambiguities.push(
				ambiguity(
					'repository_key_conflict',
					group.map(({ record }) => record),
					{
						repositoryRoots: roots,
						proposedKey: key,
						message: `自动生成的 repository key ${key} 对应多个 Git 根目录，拒绝猜测`,
					},
				),
			);
			continue;
		}
		const evidence = group
			.flatMap((proposal) => proposal.evidence)
			.sort(
				(a, b) =>
					a.legacyIdentity.localeCompare(b.legacyIdentity) ||
					a.path.localeCompare(b.path) ||
					a.source.localeCompare(b.source),
			);
		discovered.push({ key, roots, evidence });
	}

	const bindings = normalizeExistingBindings(existing);
	for (const binding of discovered) bindings[binding.key] = [...binding.roots];
	return {
		bindings: normalizeExistingBindings(bindings),
		discovered,
		ambiguities: ambiguities.sort(
			(a, b) =>
				a.reason.localeCompare(b.reason) ||
				a.slotKeys.join('\u0000').localeCompare(b.slotKeys.join('\u0000')) ||
				a.candidatePaths.join('\u0000').localeCompare(b.candidatePaths.join('\u0000')),
		),
	};
}
