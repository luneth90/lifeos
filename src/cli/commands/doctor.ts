import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { ConfigValidationError, resolveConfig } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';
import { validateRuntimeContract } from '../../runtime-contract.js';
import {
	describeGlobalHardSafety,
	inspectGlobalHardSafety,
} from '../../services/global-hard-safety.js';
import { estimateTokens } from '../../utils/shared.js';
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
	} catch {
		check('lifeos.yaml', 'fail', 'invalid YAML');
		printSummary(result);
		return result;
	}

	let resolvedConfig: LifeOSConfig;
	try {
		resolvedConfig = resolveConfig(targetPath).rawConfig;
		check('lifeos.yaml', 'pass', 'valid');
	} catch (e) {
		check(
			'lifeos.yaml',
			'fail',
			e instanceof ConfigValidationError ? e.errors.join('\n') : 'invalid config',
		);
		printSummary(result);
		return result;
	}
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

	const runtime = validateRuntimeContract({
		vaultRoot: targetPath,
		runtimeVersion: VERSION,
		verifyManagedAssets: true,
	});
	check(
		'runtime contract',
		runtime.ok ? 'pass' : 'fail',
		runtime.ok ? 'contract=2 schema=4 receipt=opened' : runtime.issues.join('; '),
	);
	checkProjectIds(targetPath, resolvedConfig, check);
	checkProtocolAssets(targetPath, resolvedConfig, check);

	// 10. Database health
	checkDbHealth(targetPath, resolvedConfig, check);
	checkGitDatabaseArtifacts(targetPath, resolvedConfig, check);

	printSummary(result);
	return result;
}

function* walkMarkdown(root: string): Generator<string> {
	if (!existsSync(root)) return;
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		const stat = statSafe(path);
		if (!stat) continue;
		if (stat.isDirectory()) yield* walkMarkdown(path);
		else if (stat.isFile() && extname(entry) === '.md') yield path;
	}
}

function statSafe(path: string): ReturnType<typeof import('node:fs').statSync> | null {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

function readFrontmatter(path: string): Record<string, unknown> | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf-8'));
	if (!match?.[1]) return null;
	try {
		const value: unknown = parseYaml(match[1]);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function checkProjectIds(
	targetPath: string,
	config: LifeOSConfig,
	check: (name: string, status: 'pass' | 'warn' | 'fail', detail?: string) => void,
): void {
	const seen = new Map<string, string>();
	const issues: string[] = [];
	for (const file of walkMarkdown(join(targetPath, config.directories.projects))) {
		const frontmatter = readFrontmatter(file);
		if (frontmatter?.type !== 'project') continue;
		const id = typeof frontmatter.id === 'string' ? frontmatter.id.trim() : '';
		if (!id) {
			issues.push(`缺少 id: ${file}`);
			continue;
		}
		if (
			id === 'Project_Template' ||
			id.includes('{{') ||
			id.toLowerCase().includes('placeholder')
		) {
			issues.push(`占位 id: ${file}`);
		}
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
			issues.push(`id 不是可移植的小写 ASCII 标识符 ${id}: ${file}`);
		}
		const previous = seen.get(id);
		if (previous) issues.push(`重复 id ${id}: ${previous}, ${file}`);
		else seen.set(id, file);
	}
	check(
		'project ids',
		issues.length ? 'fail' : 'pass',
		issues.length ? issues.join('; ') : `${seen.size} unique`,
	);
}

function checkProtocolAssets(
	targetPath: string,
	config: LifeOSConfig,
	check: (name: string, status: 'pass' | 'warn' | 'fail', detail?: string) => void,
): void {
	const paths = [
		join(targetPath, 'AGENTS.md'),
		join(targetPath, 'CLAUDE.md'),
		join(targetPath, '.agents', 'skills', '_shared', 'memory-protocol.md'),
	];
	const legacy =
		/memory_(recent|auto_capture|skill_complete|refresh|skill_context)|memory_log\s*\(\s*slot_key|profile:summary.*(?:兼容|legacy)/i;
	const bad = paths.filter((path) => existsSync(path) && legacy.test(readFileSync(path, 'utf-8')));
	check(
		'memory protocol assets',
		bad.length ? 'fail' : 'pass',
		bad.length ? `旧协议残留: ${bad.join(', ')}` : undefined,
	);
	void config;
}

function checkDbHealth(
	targetPath: string,
	config: LifeOSConfig,
	check: (name: string, status: 'pass' | 'warn' | 'fail', detail?: string) => void,
): void {
	const dbName = config.memory?.db_name ?? 'memory.db';
	const memorySub = config.subdirectories?.system?.memory ?? '记忆';
	const systemDir = config.directories?.system ?? '90_系统';
	const dbPath = join(targetPath, systemDir, memorySub, dbName);

	if (!existsSync(dbPath)) {
		check('database', 'pass', 'not yet initialized (expected for new vaults)');
		return;
	}

	let db: Database.Database | null = null;
	try {
		db = new Database(dbPath, { readonly: true });
		const versions = db.prepare('SELECT version FROM schema_version').all() as Array<{
			version: number;
		}>;
		if (versions.length !== 1 || versions[0]?.version !== 4) {
			check('database schema', 'fail', `expected 4, found ${versions[0]?.version ?? 'unknown'}`);
			return;
		}
		check('database schema', 'pass', 'v4');

		// Integrity check
		try {
			const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
			const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
			check('database integrity', ok ? 'pass' : 'fail', ok ? 'ok' : JSON.stringify(integrity));
		} catch {
			check('database integrity', 'fail', 'pragma failed');
		}

		// Row counts
		try {
			const viCount = (db.prepare('SELECT COUNT(*) as n FROM vault_index').get() as { n: number })
				.n;
			const ftsCount = (db.prepare('SELECT COUNT(*) as n FROM vault_fts').get() as { n: number }).n;
			const miCount = (db.prepare('SELECT COUNT(*) as n FROM memory_items').get() as { n: number })
				.n;

			const ftsOk = viCount === ftsCount;
			check(
				`database rows: vault=${viCount} fts=${ftsCount} memory=${miCount}`,
				ftsOk ? 'pass' : 'warn',
				ftsOk
					? undefined
					: 'vault_index and vault_fts row counts differ — FTS index may be out of sync',
			);
		} catch {
			check('database rows', 'fail', 'query failed');
		}

		const projectOrphans = (
			db
				.prepare(`
					SELECT COUNT(*) AS count FROM memory_items m
					WHERE m.scope_type = 'project'
					  AND NOT EXISTS (
						SELECT 1 FROM vault_index v
						WHERE v.type = 'project' AND v.entity_id = m.scope_key
					  )
				`)
				.get() as { count: number }
		).count;
		const fileOrphans = (
			db
				.prepare(`
					SELECT COUNT(*) AS count FROM memory_items m
					WHERE m.scope_type = 'file'
					  AND NOT EXISTS (
						SELECT 1 FROM vault_index v
						WHERE v.entity_id = m.scope_key OR v.file_path = m.scope_key
					  )
				`)
				.get() as { count: number }
		).count;
		const repositoryIds = new Set(Object.keys(config.memory.repository_bindings));
		const repositoryOrphans = (
			db
				.prepare("SELECT DISTINCT scope_key FROM memory_items WHERE scope_type = 'repository'")
				.all() as Array<{ scope_key: string }>
		).filter((row) => !repositoryIds.has(row.scope_key)).length;
		const orphanCount = projectOrphans + fileOrphans + repositoryOrphans;
		check('memory scopes', orphanCount === 0 ? 'pass' : 'fail', `${orphanCount} orphan`);
		const hardSafety = inspectGlobalHardSafety(db);
		const recoveryItemId = hardSafety.offenders[0]?.itemId;
		const recovery =
			recoveryItemId === undefined
				? ''
				: `；恢复方式：lifeos rules archive；Vault=${JSON.stringify(targetPath)}；item_id=${recoveryItemId}；reason=缩减全局 hard 规则`;
		check(
			'global hard runtime safety',
			hardSafety.ok ? 'pass' : 'fail',
			`${describeGlobalHardSafety(hardSafety)}${recovery}`,
		);
		if (!hardSafety.ok) return;
		const hardRules = db
			.prepare(`
				SELECT slot_key, content FROM memory_items
				WHERE status = 'active' AND scope_type = 'global'
				  AND item_kind = 'rule' AND enforcement = 'hard'
				  AND (expires_at IS NULL OR expires_at >= ?)
			`)
			.all(new Date().toISOString()) as Array<{ slot_key: string; content: string }>;
		const hardTokens = estimateTokens(
			hardRules.map((row) => `- **${row.slot_key}**: ${row.content}`).join('\n'),
		);
		const budgets = config.memory.context_budgets;
		check(
			'global hard rules budget',
			hardTokens <= budgets.global_rules ? 'pass' : 'fail',
			`${hardTokens}/${budgets.global_rules}`,
		);
		const oversizedHard = hardRules.filter(
			(row) =>
				budgets.single_item_max === 0 ||
				estimateTokens(`- **${row.slot_key}**: ${row.content}`) > budgets.single_item_max,
		);
		check(
			'global hard single-item budget',
			oversizedHard.length === 0 ? 'pass' : 'fail',
			oversizedHard.length
				? `${oversizedHard.map((row) => row.slot_key).join(', ')} > ${budgets.single_item_max}`
				: `<= ${budgets.single_item_max}`,
		);
		const hardLayerTokens = hardRules.length
			? estimateTokens(
					`## 行为约束\n${hardRules.map((row) => `- **${row.slot_key}**: ${row.content}`).join('\n')}`,
				)
			: 0;
		check(
			'global hard Layer 0 budget',
			hardLayerTokens <= budgets.layer0_total ? 'pass' : 'fail',
			`${hardLayerTokens}/${budgets.layer0_total}`,
		);
	} catch {
		check('database', 'fail', 'could not open memory.db');
	} finally {
		db?.close();
	}
}

function checkGitDatabaseArtifacts(
	targetPath: string,
	config: LifeOSConfig,
	check: (name: string, status: 'pass' | 'warn' | 'fail', detail?: string) => void,
): void {
	const rootResult = spawnSync('git', ['-C', targetPath, 'rev-parse', '--show-toplevel'], {
		encoding: 'utf8',
	});
	if (rootResult.error) {
		check('database Git hygiene', 'warn', `无法执行 Git 检查：${rootResult.error.message}`);
		return;
	}
	if (rootResult.status !== 0) {
		const detail = rootResult.stderr.trim();
		if (/not a git repository/i.test(detail)) {
			check('database Git hygiene', 'pass', '未检测到 Git worktree；未修改任何 Git 配置');
		} else {
			check(
				'database Git hygiene',
				'warn',
				`Git worktree 检测失败：${detail || `退出码 ${rootResult.status}`}`,
			);
		}
		return;
	}
	let gitRoot: string;
	let canonicalTargetPath: string;
	try {
		gitRoot = realpathSync.native(resolve(rootResult.stdout.trim()));
		canonicalTargetPath = realpathSync.native(targetPath);
	} catch (error) {
		check(
			'database Git hygiene',
			'warn',
			`无法规范化 Git 路径：${error instanceof Error ? error.message : String(error)}`,
		);
		return;
	}
	const dbPath = join(
		canonicalTargetPath,
		config.directories.system,
		config.subdirectories.system.memory,
		config.memory.db_name,
	);
	const artifacts = [`${dbPath}-wal`, `${dbPath}-shm`].map((path) => ({
		path,
		relativePath: relative(gitRoot, path).replace(/\\/g, '/'),
	}));
	if (artifacts.some((artifact) => artifact.relativePath.startsWith('../'))) {
		check('database Git hygiene', 'warn', '数据库临时文件不在当前 Git worktree 内，无法检查');
		return;
	}

	const tracked: string[] = [];
	const unignored: string[] = [];
	for (const artifact of artifacts) {
		const trackedResult = spawnSync(
			'git',
			[
				'--literal-pathspecs',
				'-C',
				gitRoot,
				'ls-files',
				'--error-unmatch',
				'--',
				artifact.relativePath,
			],
			{ encoding: 'utf8' },
		);
		if (trackedResult.status === 0) tracked.push(artifact.relativePath);
		else if (trackedResult.status !== 1) {
			check('database Git hygiene', 'warn', `无法检查跟踪状态：${artifact.relativePath}`);
			return;
		}

		const ignoredResult = spawnSync(
			'git',
			['-C', gitRoot, 'check-ignore', '--no-index', '--stdin', '-z'],
			{ encoding: 'utf8', input: `${artifact.relativePath}\0` },
		);
		if (ignoredResult.status === 1) unignored.push(artifact.relativePath);
		else if (ignoredResult.status !== 0) {
			check('database Git hygiene', 'warn', `无法检查忽略状态：${artifact.relativePath}`);
			return;
		}
	}

	if (tracked.length > 0) {
		check(
			'database Git hygiene',
			'warn',
			`SQLite 临时文件已被 Git 跟踪：${tracked.join('、')}。请逐个确认后运行 git rm --cached -- <路径>，再添加忽略规则；doctor 未修改仓库。`,
		);
		return;
	}
	if (unignored.length > 0) {
		check(
			'database Git hygiene',
			'warn',
			`SQLite 临时文件未被忽略：${unignored.join('、')}。建议在合适的 .gitignore 中添加精确路径或 *.db-wal、*.db-shm；doctor 未修改仓库。`,
		);
		return;
	}
	check('database Git hygiene', 'pass', 'SQLite WAL/SHM 临时文件未被跟踪且已忽略');
}

function printSummary(result: DoctorResult) {
	const counts = { pass: 0, warn: 0, fail: 0 };
	for (const c of result.checks) counts[c.status]++;
	console.log(
		`\n${bold('Summary:')} ${green(String(counts.pass))} passed, ${yellow(String(counts.warn))} warnings, ${red(String(counts.fail))} failures`,
	);
}
