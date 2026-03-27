import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EN_REFLECTION_SUBS, ZH_REFLECTION_SUBS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from './assets.js';
import {
	type InstallResult,
	installPrompts,
	installSchema,
	installSkills,
	installTemplates,
} from './install-assets.js';
import { registerMcp } from './mcp-register.js';

const GITIGNORE = `# LifeOS
*.db-wal
*.db-shm

# Obsidian
.obsidian/workspace*.json
.obsidian/cache
`;

const isWindows = process.platform === 'win32';

interface SyncVaultOptions {
	lang: 'zh' | 'en';
	skillMode: 'overwrite' | 'smart-merge';
	ensureMcp: boolean;
}

export async function syncVault(
	targetPath: string,
	config: LifeOSConfig,
	options: SyncVaultOptions,
): Promise<InstallResult> {
	ensureDir(targetPath);
	ensureDirectoryStructure(targetPath, config, options.lang);

	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };
	result.updated.push(...installTemplates(targetPath, config));
	result.updated.push(...installSchema(targetPath, config));
	result.updated.push(...installPrompts(targetPath, config));

	const skillResult = installSkills(targetPath, options.lang, options.skillMode);
	result.updated.push(...skillResult.updated);
	result.skipped.push(...skillResult.skipped);
	result.unchanged.push(...skillResult.unchanged);

	ensureClaudeSkillsLink(targetPath);
	ensureRulesFiles(targetPath, options.lang);
	ensureGitRepository(targetPath);
	ensureGitignore(targetPath);

	if (options.ensureMcp) {
		await registerMcp(targetPath, 'merge-missing');
	}

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

function ensureRulesFiles(targetPath: string, lang: 'zh' | 'en'): void {
	const rulesLangSrc = join(assetsDir(), `lifeos-rules.${lang}.md`);
	const rulesFallback = join(assetsDir(), 'lifeos-rules.zh.md');
	const rulesSrc = existsSync(rulesLangSrc) ? rulesLangSrc : rulesFallback;

	const claudePath = join(targetPath, 'CLAUDE.md');
	if (!existsSync(claudePath)) {
		copyFileSync(rulesSrc, claudePath);
	}

	const agentsPath = join(targetPath, 'AGENTS.md');
	if (!existsSync(agentsPath)) {
		copyFileSync(rulesSrc, agentsPath);
	}
}

function ensureGitRepository(targetPath: string): void {
	if (existsSync(join(targetPath, '.git'))) return;

	try {
		execSync('git init', { cwd: targetPath, stdio: 'ignore' });
	} catch {
		// git not available — skip silently
	}
}

function ensureGitignore(targetPath: string): void {
	const gitignorePath = join(targetPath, '.gitignore');
	if (existsSync(gitignorePath)) return;
	writeFileSync(gitignorePath, GITIGNORE, 'utf-8');
}
