import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from './assets.js';
import { resolveSkillFiles } from './lang.js';
import { log, yellow } from './ui.js';

export interface InstallResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
}

export type InstallMode = 'overwrite' | 'smart-merge';

function syncAssetFiles(
	entries: Array<{ srcPath: string; destPath: string; displayPath: string }>,
	mode: InstallMode,
): InstallResult {
	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };

	for (const entry of entries) {
		ensureDir(join(entry.destPath, '..'));

		if (mode === 'overwrite' || !existsSync(entry.destPath)) {
			copyFileSync(entry.srcPath, entry.destPath);
			result.updated.push(entry.displayPath);
			continue;
		}

		const existing = readFileSync(entry.destPath, 'utf-8');
		const incoming = readFileSync(entry.srcPath, 'utf-8');
		if (existing === incoming) {
			result.unchanged.push(entry.displayPath);
			continue;
		}

		result.skipped.push(entry.displayPath);
		log(yellow('⚠'), `Skipping modified: ${entry.displayPath}`);
	}

	return result;
}

/**
 * Copy language-specific templates from assets to vault.
 * Supports overwrite for init and smart-merge for upgrade.
 */
export function installTemplates(
	targetPath: string,
	config: LifeOSConfig,
	mode: InstallMode,
): InstallResult {
	const lang = config.language === 'en' ? 'en' : 'zh';
	const src = join(assetsDir(), 'templates', lang);
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.templates);
	if (!existsSync(src)) return { updated: [], skipped: [], unchanged: [] };

	ensureDir(dest);
	const entries = readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => ({
			srcPath: join(src, f),
			destPath: join(dest, f),
			displayPath: `${config.directories.system}/${config.subdirectories.system.templates}/${f}`,
		}));

	return syncAssetFiles(entries, mode);
}

/**
 * Copy schema files from assets to vault.
 * Supports overwrite for init and smart-merge for upgrade.
 */
export function installSchema(
	targetPath: string,
	config: LifeOSConfig,
	mode: InstallMode,
): InstallResult {
	const src = join(assetsDir(), 'schema');
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.schema);
	if (!existsSync(src)) return { updated: [], skipped: [], unchanged: [] };

	ensureDir(dest);
	const entries = readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => ({
			srcPath: join(src, f),
			destPath: join(dest, f),
			displayPath: `${config.directories.system}/${config.subdirectories.system.schema}/${f}`,
		}));

	return syncAssetFiles(entries, mode);
}

/**
 * Copy language-specific prompt files from assets to vault.
 * Files are named `Foo_Prompt.zh.md` / `Foo_Prompt.en.md`;
 * only the matching language is copied, with the lang suffix stripped.
 * Supports overwrite for init and smart-merge for upgrade.
 */
export function installPrompts(
	targetPath: string,
	config: LifeOSConfig,
	mode: InstallMode,
): InstallResult {
	const lang = config.language === 'en' ? 'en' : 'zh';
	const suffix = `.${lang}.md`;
	const src = join(assetsDir(), 'prompts');
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.prompts);
	if (!existsSync(src)) return { updated: [], skipped: [], unchanged: [] };

	ensureDir(dest);
	const entries = readdirSync(src)
		.filter((file) => file.endsWith(suffix))
		.map((file) => {
			const destName = file.replace(suffix, '.md');
			return {
				srcPath: join(src, file),
				destPath: join(dest, destName),
				displayPath: `${config.directories.system}/${config.subdirectories.system.prompts}/${destName}`,
			};
		});

	return syncAssetFiles(entries, mode);
}

/**
 * Copy skills from assets to vault with language resolution.
 *
 * @param mode
 *   - 'overwrite': Always copy (for init)
 *   - 'smart-merge': Skip user-modified files, copy new/unchanged (for upgrade)
 */
export function installSkills(
	targetPath: string,
	lang: 'zh' | 'en',
	mode: InstallMode,
): InstallResult {
	const skillsSrc = join(assetsDir(), 'skills');
	const skillsDest = join(targetPath, '.agents', 'skills');
	if (!existsSync(skillsSrc)) return { updated: [], skipped: [], unchanged: [] };

	const entries: Array<{ srcPath: string; destPath: string; displayPath: string }> = [];

	for (const skillName of readdirSync(skillsSrc)) {
		const skillSrcDir = join(skillsSrc, skillName);
		const fileMap = resolveSkillFiles(skillSrcDir, lang);

		for (const [destRelPath, srcPath] of fileMap) {
			const destPath = join(skillsDest, skillName, destRelPath);
			const displayPath = `.agents/skills/${skillName}/${destRelPath}`;
			entries.push({ srcPath, destPath, displayPath });
		}
	}

	return syncAssetFiles(entries, mode);
}
