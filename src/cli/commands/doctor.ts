import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveConfig } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir } from '../utils/assets.js';
import { bold, green, log, parseArgs, red, yellow } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

export const MIN_NODE_VERSION = '24.14.1';

export interface DoctorResult {
	passed: boolean;
	checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>;
}

function parseNodeVersion(version: string): [major: number, minor: number, patch: number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return null;
	return [
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10),
		Number.parseInt(match[3], 10),
	];
}

export function isNodeVersionSupported(
	version: string,
	minimumVersion = MIN_NODE_VERSION,
): boolean {
	const actual = parseNodeVersion(version);
	const minimum = parseNodeVersion(minimumVersion);
	if (!actual || !minimum) return false;

	for (let index = 0; index < minimum.length; index += 1) {
		if (actual[index] > minimum[index]) return true;
		if (actual[index] < minimum[index]) return false;
	}

	return true;
}

export default async function doctor(args: string[]): Promise<DoctorResult> {
	const { positionals } = parseArgs(args, {});
	const targetPath = resolve(positionals[0] ?? '.');
	const result: DoctorResult = { passed: true, checks: [] };

	function check(name: string, status: 'pass' | 'warn' | 'fail', detail?: string) {
		result.checks.push({ name, status, detail });
		if (status === 'fail') result.passed = false;
		const icon = status === 'pass' ? green('✓') : status === 'warn' ? yellow('⚠') : red('✗');
		const msg = detail ? `${name}: ${detail}` : name;
		log(icon, msg);
	}

	// 1. lifeos.yaml
	const yamlPath = join(targetPath, 'lifeos.yaml');
	let config: Record<string, unknown> | null = null;
	if (!existsSync(yamlPath)) {
		check('lifeos.yaml', 'fail', 'not found');
		printSummary(result);
		return result;
	}
	try {
		config = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
		check('lifeos.yaml', 'pass', 'valid');
	} catch {
		check('lifeos.yaml', 'fail', 'invalid YAML');
		printSummary(result);
		return result;
	}

	const resolvedConfig = resolveConfig(targetPath, config ?? {}).rawConfig as LifeOSConfig;
	const lang = resolvedConfig.language === 'en' ? 'en' : 'zh';

	const templatesSrc = join(assetsDir(), 'templates', lang);
	const expectedTemplates = existsSync(templatesSrc)
		? readdirSync(templatesSrc).filter((f) => f.endsWith('.md'))
		: [];

	// 2. Top-level directories
	for (const dirName of Object.values(resolvedConfig.directories)) {
		if (existsSync(join(targetPath, dirName))) {
			check(`directory: ${dirName}`, 'pass');
		} else {
			check(`directory: ${dirName}`, 'warn', 'missing');
		}
	}

	// 3. Subdirectories
	for (const [parentLogical, group] of Object.entries(resolvedConfig.subdirectories)) {
		const parentDir = resolvedConfig.directories[parentLogical];
		if (!parentDir) continue;
		for (const [, subValue] of Object.entries(group as Record<string, unknown>)) {
			if (typeof subValue === 'string') {
				const fullPath = join(targetPath, parentDir, subValue);
				if (existsSync(fullPath)) {
					check(`subdirectory: ${parentDir}/${subValue}`, 'pass');
				} else {
					check(`subdirectory: ${parentDir}/${subValue}`, 'warn', 'missing');
				}
			} else if (typeof subValue === 'object' && subValue !== null) {
				for (const [, nestedValue] of Object.entries(subValue as Record<string, string>)) {
					const fullPath = join(targetPath, parentDir, nestedValue);
					if (existsSync(fullPath)) {
						check(`subdirectory: ${parentDir}/${nestedValue}`, 'pass');
					} else {
						check(`subdirectory: ${parentDir}/${nestedValue}`, 'warn', 'missing');
					}
				}
			}
		}
	}

	// 4. Templates
	const tplDir = join(
		targetPath,
		resolvedConfig.directories.system,
		resolvedConfig.subdirectories.system.templates,
	);
	for (const tpl of expectedTemplates) {
		if (existsSync(join(tplDir, tpl))) {
			check(`template: ${tpl}`, 'pass');
		} else {
			check(`template: ${tpl}`, 'warn', 'missing');
		}
	}

	// 5. Schema
	const schemaPath = join(
		targetPath,
		resolvedConfig.directories.system,
		resolvedConfig.subdirectories.system.schema,
		'Frontmatter_Schema.md',
	);
	check(
		'Frontmatter_Schema.md',
		existsSync(schemaPath) ? 'pass' : 'warn',
		existsSync(schemaPath) ? undefined : 'missing',
	);

	// 6. Skills
	const skillsExists = existsSync(join(targetPath, '.agents', 'skills'));
	check('.agents/skills/', skillsExists ? 'pass' : 'warn', skillsExists ? undefined : 'missing');

	// 7. CLAUDE.md
	const claudeExists = existsSync(join(targetPath, 'CLAUDE.md'));
	check('CLAUDE.md', claudeExists ? 'pass' : 'warn', claudeExists ? undefined : 'missing');

	// 7b. AGENTS.md
	const agentsExists = existsSync(join(targetPath, 'AGENTS.md'));
	check('AGENTS.md', agentsExists ? 'pass' : 'warn', agentsExists ? undefined : 'missing');

	// 8. Node.js version
	check(
		`Node.js >= ${MIN_NODE_VERSION}`,
		isNodeVersionSupported(process.version) ? 'pass' : 'warn',
		process.version,
	);

	// 9. Version check
	const installedVersion = resolvedConfig.installed_versions?.assets;
	if (installedVersion === VERSION) {
		check('assets version', 'pass', `v${VERSION}`);
	} else if (installedVersion) {
		check('assets version', 'warn', `installed: v${installedVersion}, current: v${VERSION}`);
	} else {
		check('assets version', 'warn', 'no installed_versions in lifeos.yaml');
	}

	printSummary(result);
	return result;
}

function printSummary(result: DoctorResult) {
	const counts = { pass: 0, warn: 0, fail: 0 };
	for (const c of result.checks) counts[c.status]++;
	console.log(
		`\n${bold('Summary:')} ${green(String(counts.pass))} passed, ${yellow(String(counts.warn))} warnings, ${red(String(counts.fail))} failures`,
	);
}
