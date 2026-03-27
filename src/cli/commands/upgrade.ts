import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { LifeOSConfig } from '../../config.js';
import {
	installPrompts,
	installSchema,
	installSkills,
	installTemplates,
} from '../utils/install-assets.js';
import { bold, green, log, parseArgs } from '../utils/ui.js';
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
	const config = parseYaml(yamlContent) as LifeOSConfig;

	const result: UpgradeResult = { updated: [], skipped: [], unchanged: [] };

	// 3. Version check
	const installedAssets = config.installed_versions?.assets ?? '0.0.0';
	if (installedAssets === VERSION) {
		log(green('✔'), 'Already up to date.');
		return result;
	}

	const lang = (config.language as 'zh' | 'en') ?? 'zh';

	// 4. Tier 1 — Templates + Schema + Prompts
	result.updated.push(...installTemplates(targetPath, config));
	result.updated.push(...installSchema(targetPath, config));
	result.updated.push(...installPrompts(targetPath, config));

	// 5. Tier 2 — Skills
	const skillResult = installSkills(targetPath, lang, 'smart-merge');
	result.updated.push(...skillResult.updated);
	result.skipped.push(...skillResult.skipped);
	result.unchanged.push(...skillResult.unchanged);

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
