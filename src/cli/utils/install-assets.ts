import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, copyDir, ensureDir } from './assets.js';
import { resolveSkillFiles } from './lang.js';
import { log, yellow } from './ui.js';

export interface InstallResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
}

/**
 * Copy language-specific templates from assets to vault.
 * Always overwrites existing files (Tier 1).
 */
export function installTemplates(targetPath: string, config: LifeOSConfig): string[] {
	const lang = config.language === 'en' ? 'en' : 'zh';
	const src = join(assetsDir(), 'templates', lang);
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.templates);
	if (!existsSync(src)) return [];

	ensureDir(dest);
	copyDir(src, dest);

	return readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => `${config.directories.system}/${config.subdirectories.system.templates}/${f}`);
}

/**
 * Copy schema files from assets to vault.
 * Always overwrites existing files (Tier 1).
 */
export function installSchema(targetPath: string, config: LifeOSConfig): string[] {
	const src = join(assetsDir(), 'schema');
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.schema);
	if (!existsSync(src)) return [];

	ensureDir(dest);
	copyDir(src, dest);

	return readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => `${config.directories.system}/${config.subdirectories.system.schema}/${f}`);
}

/**
 * Copy language-specific prompt files from assets to vault.
 * Files are named `Foo_Prompt.zh.md` / `Foo_Prompt.en.md`;
 * only the matching language is copied, with the lang suffix stripped.
 * Always overwrites existing files (Tier 1).
 */
export function installPrompts(targetPath: string, config: LifeOSConfig): string[] {
	const lang = config.language === 'en' ? 'en' : 'zh';
	const suffix = `.${lang}.md`;
	const src = join(assetsDir(), 'prompts');
	const dest = join(targetPath, config.directories.system, config.subdirectories.system.prompts);
	if (!existsSync(src)) return [];

	ensureDir(dest);
	const copied: string[] = [];

	for (const file of readdirSync(src)) {
		if (!file.endsWith(suffix)) continue;
		const destName = file.replace(suffix, '.md');
		copyFileSync(join(src, file), join(dest, destName));
		copied.push(`${config.directories.system}/${config.subdirectories.system.prompts}/${destName}`);
	}

	return copied;
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
	mode: 'overwrite' | 'smart-merge',
): InstallResult {
	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };
	const skillsSrc = join(assetsDir(), 'skills');
	const skillsDest = join(targetPath, '.agents', 'skills');
	if (!existsSync(skillsSrc)) return result;

	for (const skillName of readdirSync(skillsSrc)) {
		const skillSrcDir = join(skillsSrc, skillName);
		const fileMap = resolveSkillFiles(skillSrcDir, lang);

		for (const [destRelPath, srcPath] of fileMap) {
			const destPath = join(skillsDest, skillName, destRelPath);
			const displayPath = `.agents/skills/${skillName}/${destRelPath}`;

			if (mode === 'overwrite') {
				ensureDir(join(destPath, '..'));
				copyFileSync(srcPath, destPath);
				result.updated.push(displayPath);
			} else {
				// smart-merge
				if (!existsSync(destPath)) {
					ensureDir(join(destPath, '..'));
					copyFileSync(srcPath, destPath);
					result.updated.push(displayPath);
				} else {
					const existing = readFileSync(destPath, 'utf-8');
					const incoming = readFileSync(srcPath, 'utf-8');
					if (existing === incoming) {
						result.unchanged.push(displayPath);
					} else {
						result.skipped.push(displayPath);
						log(yellow('⚠'), `Skipping modified: ${displayPath}`);
					}
				}
			}
		}
	}

	return result;
}
