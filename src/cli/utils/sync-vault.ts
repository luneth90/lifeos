import { existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EN_REFLECTION_SUBS, ZH_REFLECTION_SUBS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from './assets.js';
import {
	type InstallMode,
	type InstallResult,
	installPrompts,
	installRules,
	installSchema,
	installSkills,
	installTemplates,
} from './install-assets.js';
import { cloneManagedAssets } from './managed-assets.js';
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

	let managedAssets = cloneManagedAssets(config.managed_assets);
	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };
	const templateResult = installTemplates(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...templateResult.updated);
	result.skipped.push(...templateResult.skipped);
	result.unchanged.push(...templateResult.unchanged);
	managedAssets = templateResult.managedAssets ?? managedAssets;

	const schemaResult = installSchema(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...schemaResult.updated);
	result.skipped.push(...schemaResult.skipped);
	result.unchanged.push(...schemaResult.unchanged);
	managedAssets = schemaResult.managedAssets ?? managedAssets;

	const promptResult = installPrompts(targetPath, config, options.assetMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...promptResult.updated);
	result.skipped.push(...promptResult.skipped);
	result.unchanged.push(...promptResult.unchanged);
	managedAssets = promptResult.managedAssets ?? managedAssets;

	const skillResult = installSkills(targetPath, options.lang, options.skillMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...skillResult.updated);
	result.skipped.push(...skillResult.skipped);
	result.unchanged.push(...skillResult.unchanged);
	managedAssets = skillResult.managedAssets ?? managedAssets;

	ensureClaudeSkillsLink(targetPath);

	const rulesResult = installRules(targetPath, options.lang, options.rulesMode, {
		managedAssets,
		version: options.assetVersion,
	});
	result.updated.push(...rulesResult.updated);
	result.skipped.push(...rulesResult.skipped);
	result.unchanged.push(...rulesResult.unchanged);
	managedAssets = rulesResult.managedAssets ?? managedAssets;

	if (options.ensureMcp) {
		await registerMcp(targetPath, options.mcpMode);
	}

	result.managedAssets = managedAssets;
	return result;
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
