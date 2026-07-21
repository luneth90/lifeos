import { createHash } from 'node:crypto';
import {
	existsSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveSkillFiles } from './cli/utils/lang.js';
import type { VaultConfig } from './config.js';
import { resolveConfig } from './config.js';
import { readCutoverLock } from './cutover-lock.js';

export const CONTRACT_VERSION = 2 as const;
export const RUNTIME_SCHEMA_VERSION = 4 as const;
export const RUNTIME_RECEIPT_FILENAME = 'runtime-receipt.json';

export type RuntimeReceipt = {
	contract_version: 2;
	schema_version: 4;
	kind: 'fresh-install' | 'upgrade';
	state: 'opened';
	runtime_version: string;
	installed_at: string;
	journal_path?: string;
	cutover_id?: string;
	package_sha256: string;
};

export interface RuntimeContractOptions {
	vaultRoot: string;
	db?: Database.Database;
	runtimeVersion?: string;
	verifyManagedAssets?: boolean;
	allowActiveCutover?: boolean;
	expectedJournalState?: 'verified' | 'opened';
}

export interface RuntimeContractResult {
	ok: boolean;
	issues: string[];
	receipt?: RuntimeReceipt;
}

export class RuntimeContractError extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super(`LifeOS runtime contract 校验失败：\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
		this.name = 'RuntimeContractError';
		this.issues = issues;
	}
}

function sha256(content: Buffer | string): string {
	return createHash('sha256').update(content).digest('hex');
}

function packageFiles(root: string, path: string): string[] {
	if (!existsSync(path)) return [];
	const stat = statSync(path);
	if (stat.isFile()) return [relative(root, path).replace(/\\/g, '/')];
	if (!stat.isDirectory()) return [];
	return readdirSync(path)
		.sort()
		.flatMap((entry) => packageFiles(root, join(path, entry)));
}

function runtimePackageRoot(): string {
	return resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export function runtimePackageSha256(): string {
	const root = runtimePackageRoot();
	const files = ['package.json', 'bin', 'dist', 'assets']
		.flatMap((entry) => packageFiles(root, join(root, entry)))
		.sort();
	if (!files.includes('package.json')) throw new Error('无法定位 LifeOS package.json');
	const hash = createHash('sha256');
	for (const file of files) {
		const content = readFileSync(join(root, file));
		hash.update(file);
		hash.update('\0');
		hash.update(String(content.length));
		hash.update('\0');
		hash.update(content);
		hash.update('\0');
	}
	return hash.digest('hex');
}

function receiptPath(vaultRoot: string): string {
	return join(resolveConfig(vaultRoot).memoryDir(), RUNTIME_RECEIPT_FILENAME);
}

function safeAssetPath(vaultRoot: string, assetPath: string): string | null {
	if (isAbsolute(assetPath)) return null;
	const root = resolve(vaultRoot);
	const candidate = resolve(root, assetPath);
	const rel = relative(root, candidate);
	return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : candidate;
}

function readReceipt(vaultRoot: string, issues: string[]): RuntimeReceipt | undefined {
	const path = receiptPath(vaultRoot);
	if (!existsSync(path)) {
		issues.push(`缺少 ${RUNTIME_RECEIPT_FILENAME}`);
		return undefined;
	}
	try {
		const value = JSON.parse(readFileSync(path, 'utf-8')) as RuntimeReceipt;
		if (value.contract_version !== CONTRACT_VERSION) {
			issues.push('receipt contract_version 不是 2');
		}
		if (value.schema_version !== RUNTIME_SCHEMA_VERSION) {
			issues.push('receipt schema_version 不是 4');
		}
		if (value.kind !== 'fresh-install' && value.kind !== 'upgrade') {
			issues.push('receipt kind 非法');
		}
		if (value.state !== 'opened') issues.push('receipt 尚未 opened');
		if (!/^[a-f0-9]{64}$/.test(value.package_sha256)) {
			issues.push('receipt package_sha256 非法');
		}
		return value;
	} catch {
		issues.push('runtime receipt 不是有效 JSON');
		return undefined;
	}
}

function checkJournal(
	receipt: RuntimeReceipt,
	vaultRoot: string,
	expectedState: 'verified' | 'opened',
	issues: string[],
): void {
	if (receipt.kind !== 'upgrade') return;
	if (!receipt.journal_path || !isAbsolute(receipt.journal_path)) {
		issues.push('upgrade receipt 缺少绝对 journal_path');
		return;
	}
	const journalRelative = relative(resolve(vaultRoot), resolve(receipt.journal_path));
	if (journalRelative === '' || (!journalRelative.startsWith('..') && !isAbsolute(journalRelative))) {
		issues.push('cutover journal 必须位于 Vault 外');
	}
	if (!receipt.cutover_id?.trim()) issues.push('upgrade receipt 缺少 cutover_id');
	try {
		const journal = JSON.parse(readFileSync(receipt.journal_path, 'utf-8')) as {
			state?: string;
			contract_version?: number;
			schema_version?: number;
			package_sha256?: string;
			cutover_id?: string;
			vault_root?: string;
			to_version?: string;
			backup_sha256?: string;
		};
		if (journal.state !== expectedState) {
			issues.push(`cutover journal 状态不是 ${expectedState}`);
		}
		if (journal.contract_version !== CONTRACT_VERSION) {
			issues.push('cutover journal contract_version 不匹配');
		}
		if (journal.schema_version !== RUNTIME_SCHEMA_VERSION) {
			issues.push('cutover journal schema_version 不匹配');
		}
		if (journal.package_sha256 !== receipt.package_sha256) {
			issues.push('cutover journal package_sha256 不匹配');
		}
		if (journal.cutover_id !== receipt.cutover_id) {
			issues.push('cutover journal cutover_id 不匹配');
		}
		if (!journal.vault_root || resolve(journal.vault_root) !== resolve(vaultRoot)) {
			issues.push('cutover journal vault_root 不匹配');
		}
		if (journal.to_version !== receipt.runtime_version) {
			issues.push('cutover journal to_version 不匹配');
		}
		if (!/^[a-f0-9]{64}$/.test(journal.backup_sha256 ?? '')) {
			issues.push('cutover journal backup_sha256 非法');
		}
	} catch {
		issues.push('cutover journal 缺失或不可读');
	}
}

function checkDb(db: Database.Database | undefined, dbPath: string, issues: string[]): void {
	let owned: Database.Database | undefined;
	try {
		let target = db;
		if (!target && existsSync(dbPath)) {
			owned = new Database(dbPath, { readonly: true, fileMustExist: true });
			target = owned;
		}
		if (!target) {
			issues.push('数据库文件缺失；请运行 lifeos init 或 lifeos upgrade');
			return;
		}
		const rows = target.prepare('SELECT version FROM schema_version').all() as Array<{
			version?: number;
		}>;
		if (rows.length !== 1 || rows[0]?.version !== RUNTIME_SCHEMA_VERSION) {
			issues.push(`数据库 Schema 必须为 4，当前为 ${rows[0]?.version ?? 'unknown'}`);
		}
	} catch {
		issues.push('无法读取数据库 Schema 版本');
	} finally {
		owned?.close();
	}
}

function checkManagedAssets(
	vaultRoot: string,
	config: ReturnType<typeof resolveConfig>['rawConfig'],
	issues: string[],
): void {
	const records = config.managed_assets ?? {};
	for (const expected of expectedManagedAssetPaths(config)) {
		if (!Object.prototype.hasOwnProperty.call(records, expected)) {
			issues.push(`managed asset 清单缺少：${expected}`);
		}
	}
	for (const [assetPath, record] of Object.entries(records)) {
		const fullPath = safeAssetPath(vaultRoot, assetPath);
		if (!fullPath) {
			issues.push(`managed asset 路径非法：${assetPath}`);
			continue;
		}
		if (!existsSync(fullPath)) {
			issues.push(`managed asset 缺失：${assetPath}`);
			continue;
		}
		if (sha256(readFileSync(fullPath)) !== record.sha256) {
			issues.push(`managed asset 哈希不匹配：${assetPath}`);
		}
		if (config.installed_versions?.assets && record.version !== config.installed_versions.assets) {
			issues.push(`managed asset 版本不匹配：${assetPath}`);
		}
	}
}

function expectedManagedAssetPaths(config: VaultConfig['rawConfig']): string[] {
	const root = join(runtimePackageRoot(), 'assets');
	const lang = config.language === 'en' ? 'en' : 'zh';
	const expected = new Set<string>(['AGENTS.md', 'CLAUDE.md']);
	const addFlat = (source: string, destination: string, predicate = (_name: string) => true) => {
		if (!existsSync(source)) return;
		for (const name of readdirSync(source).filter(predicate)) {
			if (statSync(join(source, name)).isFile()) {
				expected.add(join(destination, name).replace(/\\/g, '/'));
			}
		}
	};
	addFlat(
		join(root, 'templates', lang),
		join(config.directories.system, config.subdirectories.system.templates),
		(name) => !name.startsWith('.'),
	);
	addFlat(
		join(root, 'schema'),
		join(config.directories.system, config.subdirectories.system.schema),
		(name) => !name.startsWith('.'),
	);
	const promptRoot = join(root, 'prompts');
	if (existsSync(promptRoot)) {
		for (const name of readdirSync(promptRoot).filter((entry) => entry.endsWith(`.${lang}.md`))) {
			expected.add(
				join(
					config.directories.system,
					config.subdirectories.system.prompts,
					name.replace(`.${lang}.md`, '.md'),
				).replace(/\\/g, '/'),
			);
		}
	}
	const skillsRoot = join(root, 'skills');
	if (existsSync(skillsRoot)) {
		for (const skillName of readdirSync(skillsRoot).filter((entry) => {
			const path = join(skillsRoot, entry);
			return !entry.startsWith('.') && statSync(path).isDirectory();
		})) {
			for (const destination of resolveSkillFiles(join(skillsRoot, skillName), lang).keys()) {
				expected.add(join('.agents', 'skills', skillName, destination).replace(/\\/g, '/'));
			}
		}
	}
	return [...expected].sort();
}

export function validateRuntimeContract(options: RuntimeContractOptions): RuntimeContractResult {
	const issues: string[] = [];
	try {
		const lock = readCutoverLock(options.vaultRoot);
		if (lock && !options.allowActiveCutover) {
			issues.push(`cutover 写闸已关闭（pid=${lock.pid}）`);
		}
	} catch (error) {
		issues.push(error instanceof Error ? error.message : 'cutover lock 无法读取');
	}
	let config: ReturnType<typeof resolveConfig>;
	try {
		config = resolveConfig(options.vaultRoot);
	} catch (error) {
		issues.push(error instanceof Error ? error.message : 'lifeos.yaml 无效');
		return { ok: false, issues };
	}
	const raw = config.rawConfig;
	if (raw.memory.contract_version !== CONTRACT_VERSION) {
		issues.push('memory.contract_version 必须为 2');
	}
	const receipt = readReceipt(options.vaultRoot, issues);
	if (receipt) {
		try {
			if (receipt.package_sha256 !== runtimePackageSha256()) {
				issues.push('receipt package_sha256 与当前运行制品不一致');
			}
		} catch (error) {
			issues.push(error instanceof Error ? error.message : '无法计算运行制品哈希');
		}
		if (options.runtimeVersion && receipt.runtime_version !== options.runtimeVersion) {
			issues.push(
				`receipt runtime_version ${receipt.runtime_version} 与运行版本 ${options.runtimeVersion} 不一致`,
			);
		}
		checkJournal(
			receipt,
			options.vaultRoot,
			options.expectedJournalState ?? 'opened',
			issues,
		);
	}
	if (options.runtimeVersion) {
		if (raw.installed_versions?.cli !== options.runtimeVersion) {
			issues.push('installed_versions.cli 与运行版本不一致');
		}
		if (raw.installed_versions?.assets !== options.runtimeVersion) {
			issues.push('installed_versions.assets 与运行版本不一致');
		}
	}
	checkDb(options.db, config.dbPath(), issues);
	if (options.verifyManagedAssets !== false) {
		checkManagedAssets(options.vaultRoot, raw, issues);
	}
	return { ok: issues.length === 0, issues, receipt };
}

export function assertRuntimeContract(options: RuntimeContractOptions): RuntimeContractResult {
	const result = validateRuntimeContract(options);
	if (!result.ok) throw new RuntimeContractError(result.issues);
	return result;
}

export function writeRuntimeReceipt(vaultRoot: string, receipt: RuntimeReceipt): RuntimeReceipt {
	const path = receiptPath(vaultRoot);
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(temporary, path);
	return receipt;
}

export function writeFreshInstallReceipt(
	vaultRoot: string,
	_config: VaultConfig | unknown,
	runtimeVersion: string,
): RuntimeReceipt {
	return writeRuntimeReceipt(vaultRoot, {
		contract_version: CONTRACT_VERSION,
		schema_version: RUNTIME_SCHEMA_VERSION,
		kind: 'fresh-install',
		state: 'opened',
		runtime_version: runtimeVersion,
		installed_at: new Date().toISOString(),
		package_sha256: runtimePackageSha256(),
	});
}
