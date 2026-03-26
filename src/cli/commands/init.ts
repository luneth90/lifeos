import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { ZH_PRESET, EN_PRESET, SUBDIR_PARENTS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { parseArgs } from '../utils/ui.js';
import { bold, green, log } from '../utils/ui.js';
import { assetsDir, copyDir, ensureDir } from '../utils/assets.js';
import { resolveSkillFiles } from '../utils/lang.js';

const require = createRequire(import.meta.url);
const VERSION: string = require('../../../package.json').version;

// ─── Reflection subdirectories ───────────────────────────────────────────────

const ZH_REFLECTION_SUBS = ['周复盘', '月复盘', '季度复盘', '年度复盘', '项目复盘', '路径校准'];
const EN_REFLECTION_SUBS = ['Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Projects', 'Alignment'];

// ─── Language auto-detection ─────────────────────────────────────────────────

function detectLang(): 'zh' | 'en' {
	const locale =
		Intl.DateTimeFormat().resolvedOptions().locale ?? process.env.LANG ?? process.env.LC_ALL ?? '';
	return locale.startsWith('zh') ? 'zh' : 'en';
}

// ─── Gitignore content ──────────────────────────────────────────────────────

const GITIGNORE = `# LifeOS
*.db
*.db-wal
*.db-shm

# Obsidian
.obsidian/workspace*.json
.obsidian/cache
`;

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
	for (const [logicalName, subDirName] of Object.entries(subdirs)) {
		const parentLogical = SUBDIR_PARENTS[logicalName];
		const parentDir = dirs[parentLogical];
		ensureDir(join(targetPath, parentDir, subDirName));
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
	const templatesSrc = join(assetsDir(), 'templates', lang);
	const templatesDest = join(targetPath, dirs.system, subdirs.templates);
	if (existsSync(templatesSrc)) {
		ensureDir(templatesDest);
		copyDir(templatesSrc, templatesDest);
	}

	// 6. Copy schema
	const schemaSrc = join(assetsDir(), 'schema');
	const schemaDest = join(targetPath, dirs.system, subdirs.schema);
	if (existsSync(schemaSrc)) {
		ensureDir(schemaDest);
		copyDir(schemaSrc, schemaDest);
	}

	// 7. Copy skills
	const skillsSrc = join(assetsDir(), 'skills');
	const skillsDest = join(targetPath, '.agents', 'skills');
	if (existsSync(skillsSrc)) {
		for (const skillName of readdirSync(skillsSrc)) {
			// Skip deprecated lifeos-init skill
			if (skillName === 'lifeos-init') continue;

			const skillSrcDir = join(skillsSrc, skillName);
			const fileMap = resolveSkillFiles(skillSrcDir, lang);
			for (const [destRelPath, srcPath] of fileMap) {
				const destPath = join(skillsDest, skillName, destRelPath);
				ensureDir(join(destPath, '..'));
				copyFileSync(srcPath, destPath);
			}
		}
	}

	// 8. Copy CLAUDE.md
	const claudeLangSrc = join(assetsDir(), `claude.${lang}.md`);
	const claudeFallback = join(assetsDir(), 'claude.zh.md');
	const claudeSrc = existsSync(claudeLangSrc) ? claudeLangSrc : claudeFallback;
	copyFileSync(claudeSrc, join(targetPath, 'CLAUDE.md'));

	// 9. Git init
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

	// 10. MCP registration
	if (!noMcp) {
		const { registerMcp } = await import('../utils/mcp-register.js');
		await registerMcp(targetPath);
	}

	// 11. Print summary
	log(green('✔'), bold('LifeOS vault initialized'));
	log('  ', `Path:     ${targetPath}`);
	log('  ', `Language: ${lang}`);
	log('  ', `Version:  ${VERSION}`);
}
