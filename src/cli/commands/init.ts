import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { EN_PRESET, EN_REFLECTION_SUBS, ZH_PRESET, ZH_REFLECTION_SUBS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from '../utils/assets.js';
import {
	installPrompts,
	installSchema,
	installSkills,
	installTemplates,
} from '../utils/install-assets.js';
import { parseArgs } from '../utils/ui.js';
import { bold, green, log, red, yellow } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

// ─── Language auto-detection ─────────────────────────────────────────────────

function detectLang(): 'zh' | 'en' {
	const locale =
		Intl.DateTimeFormat().resolvedOptions().locale ?? process.env.LANG ?? process.env.LC_ALL ?? '';
	return locale.startsWith('zh') ? 'zh' : 'en';
}

// ─── Gitignore content ──────────────────────────────────────────────────────

const GITIGNORE = `# LifeOS
*.db-wal
*.db-shm

# Obsidian
.obsidian/workspace*.json
.obsidian/cache
`;

// ─── Prerequisite checks ────────────────────────────────────────────────────

interface PrereqResult {
	name: string;
	ok: boolean;
	version?: string;
	hint: string;
}

const isWindows = process.platform === 'win32';

function checkCommand(cmd: string, versionFlag = '--version'): string | null {
	try {
		return execSync(`${cmd} ${versionFlag}`, { stdio: 'pipe' }).toString().trim().split('\n')[0];
	} catch {
		return null;
	}
}

/** Resolve the Python 3 executable name for this platform. */
function findPython(): { cmd: string; version: string } | null {
	// macOS/Linux: prefer python3; Windows: usually just python
	const candidates = isWindows ? ['python', 'python3'] : ['python3', 'python'];
	for (const cmd of candidates) {
		const ver = checkCommand(cmd);
		if (ver?.includes('3.')) return { cmd, version: ver };
	}
	return null;
}

function checkPrerequisites(): { results: PrereqResult[]; pythonCmd: string | null } {
	const results: PrereqResult[] = [];
	let pythonCmd: string | null = null;

	// Node.js (already running, but check version)
	const nodeVer = process.version;
	results.push({
		name: 'Node.js',
		ok: true,
		version: nodeVer,
		hint: 'https://nodejs.org/',
	});

	// Git
	const gitVer = checkCommand('git');
	results.push({
		name: 'Git',
		ok: gitVer !== null,
		version: gitVer ?? undefined,
		hint: 'https://git-scm.com/',
	});

	// Python 3
	const py = findPython();
	pythonCmd = py?.cmd ?? null;
	results.push({
		name: 'Python 3',
		ok: py !== null,
		version: py?.version,
		hint: 'https://www.python.org/  (required by /read-pdf skill)',
	});

	return { results, pythonCmd };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default async function init(args: string[]): Promise<void> {
	const { positionals, flags } = parseArgs(args, {
		lang: { alias: 'l' },
		'no-mcp': {},
	});

	const targetPath = resolve(positionals[0] ?? '.');
	const lang: 'zh' | 'en' =
		flags.lang && flags.lang !== true ? (flags.lang as 'zh' | 'en') : detectLang();
	const noMcp = flags['no-mcp'] === true;

	// 0. Prerequisite checks
	const { results: prereqs } = checkPrerequisites();
	const missing = prereqs.filter((p) => !p.ok);

	log('📋', bold('Prerequisites:'));
	for (const p of prereqs) {
		const status = p.ok ? green('✔') : red('✘');
		const ver = p.version ? ` (${p.version})` : '';
		log('  ', `${status} ${p.name}${ver}`);
	}

	if (missing.length > 0) {
		log('  ', '');
		log('⚠️', yellow('Missing prerequisites:'));
		for (const m of missing) {
			log('  ', `${red('→')} ${m.name}: ${m.hint}`);
		}
		log('  ', '');
		throw new Error('Please install missing prerequisites before initializing.');
	}
	log('  ', '');

	const preset: LifeOSConfig = lang === 'en' ? EN_PRESET : ZH_PRESET;

	// 1. Validate target
	const yamlPath = join(targetPath, 'lifeos.yaml');
	if (existsSync(yamlPath)) {
		throw new Error('Vault already initialized. Use "lifeos upgrade" to update assets.');
	}

	// 2. Create target directory
	ensureDir(targetPath);

	// 3. Create directory structure
	const dirs = preset.directories;
	const subdirs = preset.subdirectories;

	// Top-level directories
	for (const dirName of Object.values(dirs)) {
		ensureDir(join(targetPath, dirName));
	}

	// Subdirectories
	for (const [parentLogical, group] of Object.entries(subdirs)) {
		const parentDir = dirs[parentLogical];
		if (!parentDir) continue;
		for (const [, subValue] of Object.entries(group as Record<string, unknown>)) {
			if (typeof subValue === 'string') {
				ensureDir(join(targetPath, parentDir, subValue));
			} else if (typeof subValue === 'object' && subValue !== null) {
				// nested group like archive: { projects, drafts, plans }
				for (const [, nestedValue] of Object.entries(subValue as Record<string, string>)) {
					ensureDir(join(targetPath, parentDir, nestedValue));
				}
			}
		}
	}

	// Reflection subdirectories
	const reflectionDir = dirs.reflection;
	const reflectionSubs = lang === 'zh' ? ZH_REFLECTION_SUBS : EN_REFLECTION_SUBS;
	for (const sub of reflectionSubs) {
		ensureDir(join(targetPath, reflectionDir, sub));
	}

	// 4. Generate lifeos.yaml
	const yamlConfig = {
		...preset,
		installed_versions: {
			cli: VERSION,
			assets: VERSION,
		},
	};
	writeFileSync(yamlPath, stringifyYaml(yamlConfig), 'utf-8');

	// 5. Copy templates
	installTemplates(targetPath, preset);

	// 6. Copy schema
	installSchema(targetPath, preset);

	// 7. Copy prompts
	installPrompts(targetPath, preset);

	// 8. Copy skills
	installSkills(targetPath, lang, 'overwrite');

	// 9. Create .claude/ and symlink skills for Claude Code discovery
	const claudeDir = join(targetPath, '.claude');
	ensureDir(claudeDir);
	const claudeSkillsLink = join(claudeDir, 'skills');
	if (!existsSync(claudeSkillsLink)) {
		if (isWindows) {
			// Windows: junction doesn't require admin privileges (needs absolute target)
			symlinkSync(resolve(targetPath, '.agents', 'skills'), claudeSkillsLink, 'junction');
		} else {
			symlinkSync(join('..', '.agents', 'skills'), claudeSkillsLink);
		}
	}

	// 10. Copy CLAUDE.md & AGENTS.md (single source, same content)
	const rulesLangSrc = join(assetsDir(), `lifeos-rules.${lang}.md`);
	const rulesFallback = join(assetsDir(), 'lifeos-rules.zh.md');
	const rulesSrc = existsSync(rulesLangSrc) ? rulesLangSrc : rulesFallback;
	copyFileSync(rulesSrc, join(targetPath, 'CLAUDE.md'));
	copyFileSync(rulesSrc, join(targetPath, 'AGENTS.md'));

	// 11. Git init
	if (!existsSync(join(targetPath, '.git'))) {
		try {
			execSync('git init', { cwd: targetPath, stdio: 'ignore' });
		} catch {
			// git not available — skip silently
		}
	}
	const gitignorePath = join(targetPath, '.gitignore');
	if (!existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, GITIGNORE, 'utf-8');
	}

	// 12. MCP registration
	if (!noMcp) {
		const { registerMcp } = await import('../utils/mcp-register.js');
		await registerMcp(targetPath);
	}

	// 13. Print summary
	log(green('✔'), bold('LifeOS vault initialized'));
	log('  ', `Path:     ${targetPath}`);
	log('  ', `Language: ${lang}`);
	log('  ', `Version:  ${VERSION}`);
}
