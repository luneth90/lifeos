import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { EN_PRESET, EN_REFLECTION_SUBS, ZH_PRESET, ZH_REFLECTION_SUBS } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, ensureDir } from '../utils/assets.js';
import { installSchema, installSkills, installTemplates } from '../utils/install-assets.js';
import { parseArgs } from '../utils/ui.js';
import { bold, green, log } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

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

	// 7. Copy skills
	installSkills(targetPath, lang, 'overwrite');

	// 8. Copy CLAUDE.md
	const claudeLangSrc = join(assetsDir(), `claude.${lang}.md`);
	const claudeFallback = join(assetsDir(), 'claude.zh.md');
	const claudeSrc = existsSync(claudeLangSrc) ? claudeLangSrc : claudeFallback;
	copyFileSync(claudeSrc, join(targetPath, 'CLAUDE.md'));

	// 8b. Copy AGENTS.md (for Codex / OpenCode)
	const agentsLangSrc = join(assetsDir(), `agents.${lang}.md`);
	const agentsFallback = join(assetsDir(), 'agents.zh.md');
	const agentsSrc = existsSync(agentsLangSrc) ? agentsLangSrc : agentsFallback;
	copyFileSync(agentsSrc, join(targetPath, 'AGENTS.md'));

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
