import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZH_PRESET, EN_PRESET, SUBDIR_PARENTS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { parseArgs, log, green, yellow, red, bold } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';
import { assetsDir } from '../utils/assets.js';

export interface DoctorResult {
	passed: boolean;
	checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>;
}

export default async function doctor(args: string[]): Promise<DoctorResult> {
	const { positionals } = parseArgs(args, {});
	const targetPath = resolve(positionals[0] ?? '.');
	const result: DoctorResult = { passed: true, checks: [] };

	function check(name: string, status: 'pass' | 'warn' | 'fail', detail?: string) {
		result.checks.push({ name, status, detail });
		if (status === 'fail') result.passed = false;
		const icon =
			status === 'pass' ? green('✓') : status === 'warn' ? yellow('⚠') : red('✗');
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

	const lang = config?.language === 'en' ? 'en' : 'zh';
	const preset = lang === 'en' ? EN_PRESET : ZH_PRESET;

	const templatesSrc = join(assetsDir(), 'templates', lang);
	const expectedTemplates = existsSync(templatesSrc)
		? readdirSync(templatesSrc).filter((f) => f.endsWith('.md'))
		: [];

	// 2. Top-level directories
	for (const dirName of Object.values(preset.directories)) {
		if (existsSync(join(targetPath, dirName))) {
			check(`directory: ${dirName}`, 'pass');
		} else {
			check(`directory: ${dirName}`, 'warn', 'missing');
		}
	}

	// 3. Subdirectories
	for (const [logicalName, subDirName] of Object.entries(preset.subdirectories)) {
		const parentLogical = SUBDIR_PARENTS[logicalName];
		const parentDir = preset.directories[parentLogical];
		const fullPath = join(targetPath, parentDir, subDirName);
		if (existsSync(fullPath)) {
			check(`subdirectory: ${parentDir}/${subDirName}`, 'pass');
		} else {
			check(`subdirectory: ${parentDir}/${subDirName}`, 'warn', 'missing');
		}
	}

	// 4. Templates
	const tplDir = join(
		targetPath,
		preset.directories.system,
		preset.subdirectories.templates,
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
		preset.directories.system,
		preset.subdirectories.schema,
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

	// 8. Node.js version
	const nodeVersion = parseInt(process.version.slice(1), 10);
	check('Node.js >= 18', nodeVersion >= 18 ? 'pass' : 'warn', process.version);

	// 9. Version check
	const installedVersion = (config as LifeOSConfig)?.installed_versions?.assets;
	if (installedVersion === VERSION) {
		check('assets version', 'pass', `v${VERSION}`);
	} else if (installedVersion) {
		check(
			'assets version',
			'warn',
			`installed: v${installedVersion}, current: v${VERSION}`,
		);
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
