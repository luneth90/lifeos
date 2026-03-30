import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolveConfig } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { syncVault } from '../utils/sync-vault.js';
import { bold, green, log, parseArgs, yellow } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

export interface UpgradeResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
}

export default async function upgrade(args: string[]): Promise<UpgradeResult> {
	const { positionals, flags } = parseArgs(args, {
		lang: { alias: 'l' },
		override: {},
	});

	// 1. Parse args
	const targetPath = resolve(positionals[0] ?? '.');

	// 2. Read lifeos.yaml
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}

	const yamlContent = readFileSync(yamlPath, 'utf-8');
	const rawConfig = (parseYaml(yamlContent) as Record<string, unknown> | null) ?? {};
	const config = resolveConfig(targetPath, rawConfig).rawConfig as LifeOSConfig;

	const result: UpgradeResult = { updated: [], skipped: [], unchanged: [] };
	const override = flags.override === true;

	// 3. Version check
	const installedAssets = config.installed_versions?.assets ?? '0.0.0';
	if (installedAssets === VERSION) {
		log(green('✔'), 'Assets version already current. Syncing files anyway.');
	}

	const lang: 'zh' | 'en' =
		flags.lang && flags.lang !== true
			? (flags.lang as 'zh' | 'en')
			: ((config.language as 'zh' | 'en') ?? 'zh');

	// Update config language if overridden by flag
	if (flags.lang && flags.lang !== true && config.language !== lang) {
		config.language = lang;
	}

	migrateLegacyDigestDirectory(targetPath, config);

	// 4. Reuse the same vault sync path as init, but in conservative upgrade mode.
	const syncResult = await syncVault(targetPath, config, {
		lang,
		assetMode: override ? 'overwrite' : 'smart-merge',
		skillMode: override ? 'overwrite' : 'smart-merge',
		ensureMcp: true,
		mcpMode: override ? 'replace' : 'merge-missing',
		rulesMode: override ? 'overwrite' : 'preserve',
		assetVersion: VERSION,
	});
	result.updated.push(...syncResult.updated);
	result.skipped.push(...syncResult.skipped);
	result.unchanged.push(...syncResult.unchanged);

	// 7. Update installed_versions
	if (!config.installed_versions) {
		config.installed_versions = {};
	}
	config.managed_assets = syncResult.managedAssets ?? config.managed_assets ?? {};
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

function migrateLegacyDigestDirectory(targetPath: string, config: LifeOSConfig): void {
	const systemDir = config.directories.system;
	const digestDir = config.subdirectories.system.digest;
	const legacyDigestName = '信息';

	if (!systemDir || !digestDir || digestDir === legacyDigestName) return;

	const legacyPath = join(targetPath, systemDir, legacyDigestName);
	if (!existsSync(legacyPath)) return;

	const targetPathname = join(targetPath, systemDir, digestDir);
	if (existsSync(targetPathname)) {
		log(
			yellow('⚠'),
			`Legacy digest directory kept because target already exists: ${systemDir}/${legacyDigestName}`,
		);
		return;
	}

	renameSync(legacyPath, targetPathname);
	log(green('✔'), `Migrated digest directory to ${systemDir}/${digestDir}`);
}
