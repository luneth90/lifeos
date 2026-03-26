import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from '../utils/assets.js';
import { resolveSkillFiles } from '../utils/lang.js';
import { bold, green, log, parseArgs, yellow } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

export interface UpgradeResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
}

export default async function upgrade(args: string[]): Promise<UpgradeResult> {
	const { positionals } = parseArgs(args, {});

	// 1. Parse args
	const targetPath = resolve(positionals[0] ?? '.');

	// 2. Read lifeos.yaml
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}

	const yamlContent = readFileSync(yamlPath, 'utf-8');
	const config = parseYaml(yamlContent) as LifeOSConfig & {
		installed_versions?: { cli?: string; assets?: string };
	};

	const result: UpgradeResult = { updated: [], skipped: [], unchanged: [] };

	// 3. Version check
	const installedAssets = config.installed_versions?.assets ?? '0.0.0';
	if (installedAssets === VERSION) {
		log(green('✔'), 'Already up to date.');
		return result;
	}

	const lang = (config.language as 'zh' | 'en') ?? 'zh';
	const dirs = config.directories;
	const subdirs = config.subdirectories;

	// 4. Tier 1 — Templates
	const templatesSrc = join(assetsDir(), 'templates', lang);
	const templatesDest = join(targetPath, dirs.system, subdirs.templates);
	if (existsSync(templatesSrc)) {
		ensureDir(templatesDest);
		for (const file of readdirSync(templatesSrc)) {
			const srcFile = join(templatesSrc, file);
			const destFile = join(templatesDest, file);
			const relPath = `${dirs.system}/${subdirs.templates}/${file}`;
			copyFileSync(srcFile, destFile);
			result.updated.push(relPath);
		}
	}

	// 5. Tier 1 — Schema
	const schemaSrc = join(assetsDir(), 'schema');
	const schemaDest = join(targetPath, dirs.system, subdirs.schema);
	if (existsSync(schemaSrc)) {
		ensureDir(schemaDest);
		for (const file of readdirSync(schemaSrc)) {
			const srcFile = join(schemaSrc, file);
			const destFile = join(schemaDest, file);
			const relPath = `${dirs.system}/${subdirs.schema}/${file}`;
			copyFileSync(srcFile, destFile);
			result.updated.push(relPath);
		}
	}

	// 6. Tier 2 — Skills
	const skillsSrc = join(assetsDir(), 'skills');
	const skillsDest = join(targetPath, '.agents', 'skills');
	if (existsSync(skillsSrc)) {
		for (const skillName of readdirSync(skillsSrc)) {
			if (skillName === 'lifeos-init') continue;

			const skillSrcDir = join(skillsSrc, skillName);
			const fileMap = resolveSkillFiles(skillSrcDir, lang);

			for (const [destRelPath, srcPath] of fileMap) {
				const destPath = join(skillsDest, skillName, destRelPath);
				const displayPath = `.agents/skills/${skillName}/${destRelPath}`;

				if (!existsSync(destPath)) {
					// New file — copy
					ensureDir(join(destPath, '..'));
					copyFileSync(srcPath, destPath);
					result.updated.push(displayPath);
				} else {
					const existingContent = readFileSync(destPath, 'utf-8');
					const newContent = readFileSync(srcPath, 'utf-8');

					if (existingContent === newContent) {
						// Identical — skip
						result.unchanged.push(displayPath);
					} else {
						// Modified by user — skip + warn
						result.skipped.push(displayPath);
						log(yellow('⚠'), `Skipping modified: ${displayPath}`);
					}
				}
			}
		}
	}

	// 7. Update installed_versions
	if (!config.installed_versions) {
		config.installed_versions = {};
	}
	config.installed_versions.cli = VERSION;
	config.installed_versions.assets = VERSION;
	writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');

	// 8. Print summary
	log(green('✔'), bold('LifeOS vault upgraded'));
	log('  ', `Version:  ${installedAssets} → ${VERSION}`);
	log('  ', `Updated:  ${result.updated.length} files`);
	log('  ', `Skipped:  ${result.skipped.length} files (user-modified)`);
	log('  ', `Unchanged: ${result.unchanged.length} files`);

	return result;
}
