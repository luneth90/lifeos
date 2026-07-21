import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { EN_REFLECTION_SUBS, ZH_REFLECTION_SUBS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assertVaultPathSafe } from '../../utils/safe-path.js';
import { ensureDir } from './assets.js';
import {
	type InstallMode,
	type InstallResult,
	installPrompts,
	installRules,
	installSchema,
	installSkills,
	installTemplates,
} from './install-assets.js';
import {
	type ManagedAssetsMap,
	cloneManagedAssets,
	isManagedAssetRecord,
	sha256Content,
} from './managed-assets.js';
import type { MergeMode } from './mcp-register.js';
import { registerMcp } from './mcp-register.js';

const isWindows = process.platform === 'win32';

interface SyncVaultOptions {
	lang: 'zh' | 'en';
	assetMode: InstallMode;
	skillMode: InstallMode;
	ensureMcp: boolean;
	mcpMode: MergeMode;
	rulesMode: InstallMode;
	assetVersion: string;
}

export async function syncVault(
	targetPath: string,
	config: LifeOSConfig,
	options: SyncVaultOptions,
): Promise<InstallResult> {
	ensureDir(targetPath);
	ensureDirectoryStructure(targetPath, config, options.lang);

	const previousManagedAssets = cloneManagedAssets(config.managed_assets);
	let managedAssets = cloneManagedAssets(previousManagedAssets);
	const currentManagedPaths = new Set<string>();
	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };
	const templateResult = installTemplates(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...templateResult.updated);
	result.skipped.push(...templateResult.skipped);
	result.unchanged.push(...templateResult.unchanged);
	trackManagedPaths(currentManagedPaths, templateResult);
	managedAssets = templateResult.managedAssets ?? managedAssets;

	const schemaResult = installSchema(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...schemaResult.updated);
	result.skipped.push(...schemaResult.skipped);
	result.unchanged.push(...schemaResult.unchanged);
	trackManagedPaths(currentManagedPaths, schemaResult);
	managedAssets = schemaResult.managedAssets ?? managedAssets;

	const promptResult = installPrompts(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...promptResult.updated);
	result.skipped.push(...promptResult.skipped);
	result.unchanged.push(...promptResult.unchanged);
	trackManagedPaths(currentManagedPaths, promptResult);
	managedAssets = promptResult.managedAssets ?? managedAssets;

	const skillResult = installSkills(targetPath, options.lang, options.skillMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...skillResult.updated);
	result.skipped.push(...skillResult.skipped);
	result.unchanged.push(...skillResult.unchanged);
	trackManagedPaths(currentManagedPaths, skillResult);
	managedAssets = skillResult.managedAssets ?? managedAssets;

	ensureClaudeSkillsLink(targetPath);

	const rulesResult = installRules(targetPath, options.lang, options.rulesMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...rulesResult.updated);
	result.skipped.push(...rulesResult.skipped);
	result.unchanged.push(...rulesResult.unchanged);
	trackManagedPaths(currentManagedPaths, rulesResult);
	managedAssets = rulesResult.managedAssets ?? managedAssets;

	if (
		options.assetMode === 'overwrite' &&
		options.skillMode === 'overwrite' &&
		options.rulesMode === 'overwrite'
	) {
		removeUnmodifiedObsoleteAssets(targetPath, previousManagedAssets, currentManagedPaths);
		managedAssets = rebuildManagedAssets(managedAssets, currentManagedPaths);
	}

	if (options.ensureMcp) {
		await registerMcp(targetPath, options.mcpMode);
	}

	result.managedAssets = managedAssets;
	return result;
}

function trackManagedPaths(paths: Set<string>, result: InstallResult): void {
	for (const path of [...result.updated, ...result.skipped, ...result.unchanged]) paths.add(path);
}

function safeManagedAssetPath(targetPath: string, managedPath: string): string | null {
	if (
		!managedPath ||
		managedPath.includes('\0') ||
		isAbsolute(managedPath) ||
		win32.isAbsolute(managedPath)
	) {
		return null;
	}
	const root = resolve(targetPath);
	const candidate = resolve(root, managedPath);
	const rel = relative(root, candidate);
	if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	try {
		return assertVaultPathSafe(root, candidate);
	} catch {
		return null;
	}
}

/**
 * 整包覆盖时，旧清单中已退出当前包的文件不再继续受管。
 * 只有内容仍与旧托管哈希一致的普通文件才会删除；用户修改、符号链接和不安全路径均保留。
 */
function removeUnmodifiedObsoleteAssets(
	targetPath: string,
	previousManagedAssets: ManagedAssetsMap,
	currentManagedPaths: ReadonlySet<string>,
): void {
	for (const [managedPath, record] of Object.entries(previousManagedAssets)) {
		if (currentManagedPaths.has(managedPath) || !isManagedAssetRecord(record)) continue;
		const fullPath = safeManagedAssetPath(targetPath, managedPath);
		if (!fullPath || !existsSync(fullPath)) continue;
		const stat = lstatSync(fullPath);
		if (!stat.isFile() || stat.isSymbolicLink()) continue;
		// 历史 managed_assets 使用 UTF-8 文本哈希；沿用同一算法判断文件是否仍未修改。
		if (sha256Content(readFileSync(fullPath, 'utf-8')) === record.sha256) unlinkSync(fullPath);
	}
}

function rebuildManagedAssets(
	managedAssets: ManagedAssetsMap,
	currentManagedPaths: ReadonlySet<string>,
): ManagedAssetsMap {
	const rebuilt: ManagedAssetsMap = {};
	for (const managedPath of [...currentManagedPaths].sort()) {
		const record = managedAssets[managedPath];
		if (isManagedAssetRecord(record)) rebuilt[managedPath] = record;
	}
	return rebuilt;
}

function ensureDirectoryStructure(
	targetPath: string,
	config: LifeOSConfig,
	lang: 'zh' | 'en',
): void {
	for (const dirName of Object.values(config.directories)) {
		ensureDir(join(targetPath, dirName));
	}

	for (const [parentLogical, group] of Object.entries(config.subdirectories)) {
		const parentDir = config.directories[parentLogical];
		if (!parentDir) continue;
		for (const subValue of Object.values(group as Record<string, unknown>)) {
			if (typeof subValue === 'string') {
				ensureDir(join(targetPath, parentDir, subValue));
			} else if (typeof subValue === 'object' && subValue !== null) {
				for (const nestedValue of Object.values(subValue as Record<string, string>)) {
					ensureDir(join(targetPath, parentDir, nestedValue));
				}
			}
		}
	}

	const reflectionDir = config.directories.reflection;
	const reflectionSubs = lang === 'zh' ? ZH_REFLECTION_SUBS : EN_REFLECTION_SUBS;
	for (const sub of reflectionSubs) {
		ensureDir(join(targetPath, reflectionDir, sub));
	}
}

function ensureClaudeSkillsLink(targetPath: string): void {
	const claudeDir = join(targetPath, '.claude');
	ensureDir(claudeDir);

	const claudeSkillsLink = join(claudeDir, 'skills');
	if (existsSync(claudeSkillsLink)) return;

	if (isWindows) {
		symlinkSync(resolve(targetPath, '.agents', 'skills'), claudeSkillsLink, 'junction');
	} else {
		symlinkSync(join('..', '.agents', 'skills'), claudeSkillsLink);
	}
}
