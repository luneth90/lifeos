import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { LifeOSConfig } from '../../config.js';
import { bold, green, log, parseArgs } from '../utils/ui.js';

export interface RenameResult {
	logical: string;
	oldPhysical: string;
	newPhysical: string;
	wikilinksUpdated: number;
}

export default async function rename(args: string[]): Promise<RenameResult> {
	const { positionals, flags } = parseArgs(args, {
		logical: {},
		name: {},
	});

	const targetPath = resolve(positionals[0] ?? '.');
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (!existsSync(yamlPath)) {
		throw new Error('No lifeos.yaml found. Run `lifeos init` first.');
	}

	const config = parseYaml(readFileSync(yamlPath, 'utf-8')) as LifeOSConfig;
	const dirs = config.directories;

	// Build selection list: [{ logical, physical, isSubdir, parentLogical? }]
	const items: Array<{
		logical: string;
		physical: string;
		isSubdir: boolean;
		parentLogical?: string;
		childKey?: string;
	}> = [];

	// Top-level directories
	for (const [logical, physical] of Object.entries(dirs)) {
		items.push({ logical, physical, isSubdir: false });
	}

	// Subdirectories (nested structure)
	for (const [parentLogical, group] of Object.entries(config.subdirectories)) {
		if (typeof group !== 'object' || group === null) continue;
		for (const [childKey, value] of Object.entries(group as Record<string, unknown>)) {
			if (typeof value === 'string') {
				const parentDir = dirs[parentLogical] ?? parentLogical;
				items.push({
					logical: `${parentLogical}/${childKey}`,
					physical: `${parentDir}/${value}`,
					isSubdir: true,
					parentLogical,
					childKey,
				});
			} else if (typeof value === 'object' && value !== null) {
				// Nested group like archive: { projects, drafts, plans }
				for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, string>)) {
					const parentDir = dirs[parentLogical] ?? parentLogical;
					items.push({
						logical: `${parentLogical}/${childKey}/${nestedKey}`,
						physical: `${parentDir}/${nestedValue}`,
						isSubdir: true,
						parentLogical,
						childKey: `${childKey}.${nestedKey}`,
					});
				}
			}
		}
	}

	let selectedItem: (typeof items)[number];
	let newPhysical: string;

	if (typeof flags.logical === 'string' && typeof flags.name === 'string') {
		// Script mode
		const found = items.find((i) => i.logical === flags.logical);
		if (!found) throw new Error(`Unknown logical name: ${flags.logical}`);
		selectedItem = found;
		newPhysical = flags.name as string;
	} else {
		// Interactive mode
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			console.log(`\n${bold('当前目录配置:\n')}`);
			console.log('  顶级目录:');
			items.forEach((item, i) => {
				if (!item.isSubdir) {
					console.log(
						`   ${String(i + 1).padStart(2)}) ${item.logical.padEnd(15)} → ${item.physical}`,
					);
				}
			});
			console.log('\n  子目录:');
			items.forEach((item, i) => {
				if (item.isSubdir) {
					console.log(
						`   ${String(i + 1).padStart(2)}) ${item.logical.padEnd(25)} → ${item.physical}`,
					);
				}
			});

			const numStr = await rl.question('\n? 选择要重命名的目录 [编号]: ');
			const idx = Number.parseInt(numStr, 10) - 1;
			if (Number.isNaN(idx) || idx < 0 || idx >= items.length) {
				throw new Error('Invalid selection');
			}
			selectedItem = items[idx];

			newPhysical = await rl.question(
				`? 新名称 (当前: ${selectedItem.isSubdir ? selectedItem.physical.split('/').pop() : selectedItem.physical}): `,
			);
			if (!newPhysical.trim()) throw new Error('Name cannot be empty');
		} finally {
			rl.close();
		}
	}

	const oldPhysical = selectedItem.physical;
	let managedAssetsNewPrefix = newPhysical;

	if (selectedItem.isSubdir) {
		// For subdirectories, only rename the leaf part
		// Update config
		const parentLogical = selectedItem.parentLogical as string;
		const parts = (selectedItem.childKey as string).split('.');
		const subGroup = config.subdirectories as unknown as Record<string, Record<string, unknown>>;
		if (parts.length === 1) {
			subGroup[parentLogical][parts[0]] = newPhysical;
		} else {
			// Nested: archive.projects
			const nested = subGroup[parentLogical][parts[0]] as Record<string, string>;
			nested[parts[1]] = newPhysical;
		}

		// Rename physical directory
		const parentDir = dirs[parentLogical];
		managedAssetsNewPrefix = join(parentDir, newPhysical);
		const oldPath = join(targetPath, parentDir, oldPhysical.split('/').slice(1).join('/'));
		const newPath = join(targetPath, parentDir, newPhysical);
		if (existsSync(oldPath)) {
			renameSync(oldPath, newPath);
		}
	} else {
		// Top-level directory
		(config.directories as Record<string, string>)[selectedItem.logical] = newPhysical;

		// Rename physical directory
		const oldPath = join(targetPath, oldPhysical);
		const newPath = join(targetPath, newPhysical);
		if (existsSync(oldPath)) {
			renameSync(oldPath, newPath);
		}
	}

	if (config.managed_assets) {
		config.managed_assets = rewriteManagedAssetKeys(
			config.managed_assets,
			oldPhysical,
			managedAssetsNewPrefix,
		);
	}

	// Write updated config
	writeFileSync(yamlPath, stringifyYaml(config), 'utf-8');

	// Batch replace wikilinks
	const replaced = replaceWikilinks(targetPath, oldPhysical, newPhysical);

	// Print summary
	log(green('✔'), bold('重命名完成'));
	log('  ', `目录:  ${oldPhysical} → ${newPhysical}`);
	log('  ', '配置:  lifeos.yaml 已更新');
	log('  ', `链接:  ${replaced} 个 wikilinks 已更新`);

	return {
		logical: selectedItem.logical,
		oldPhysical,
		newPhysical,
		wikilinksUpdated: replaced,
	};
}

function rewriteManagedAssetKeys(
	managedAssets: Record<string, { version: string; sha256: string }>,
	oldPrefix: string,
	newPrefix: string,
): Record<string, { version: string; sha256: string }> {
	const next: Record<string, { version: string; sha256: string }> = {};

	for (const [key, value] of Object.entries(managedAssets)) {
		if (key === oldPrefix || key.startsWith(`${oldPrefix}/`)) {
			next[`${newPrefix}${key.slice(oldPrefix.length)}`] = value;
			continue;
		}
		next[key] = value;
	}

	return next;
}

function replaceWikilinks(vaultRoot: string, oldPrefix: string, newPrefix: string): number {
	let count = 0;
	walkMdFiles(vaultRoot, (filePath) => {
		const content = readFileSync(filePath, 'utf-8');
		const updated = content
			.replaceAll(`[[${oldPrefix}/`, `[[${newPrefix}/`)
			.replaceAll(`[[${oldPrefix}]]`, `[[${newPrefix}]]`)
			.replaceAll(`](${oldPrefix}/`, `](${newPrefix}/`);
		if (updated !== content) {
			writeFileSync(filePath, updated);
			count++;
		}
	});
	return count;
}

function walkMdFiles(dir: string, callback: (filePath: string) => void): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.name.startsWith('.')) continue;
		if (entry.isDirectory()) {
			walkMdFiles(full, callback);
		} else if (entry.name.endsWith('.md')) {
			callback(full);
		}
	}
}
