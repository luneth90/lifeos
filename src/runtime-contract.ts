import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isGeneratedPythonCacheEntry, resolveSkillFiles } from './cli/utils/lang.js';
import type { VaultConfig } from './config.js';
import { resolveConfig } from './config.js';
import { cutoverRoot, isValidCutoverId, readCutoverLock } from './cutover-lock.js';
import { assertVaultPathSafe, canonicalVaultRoot } from './utils/safe-path.js';

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
	config?: VaultConfig;
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
		.filter((entry) => !isGeneratedPythonCacheEntry(entry))
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

function receiptPath(vaultRoot: string, config?: VaultConfig): string {
	return join((config ?? resolveConfig(vaultRoot)).memoryDir(), RUNTIME_RECEIPT_FILENAME);
}

function safeAssetPath(vaultRoot: string, assetPath: string): string | null {
	if (isAbsolute(assetPath)) return null;
	const root = resolve(vaultRoot);
	const candidate = resolve(root, assetPath);
	const rel = relative(root, candidate);
	return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : candidate;
}

function readReceipt(
	vaultRoot: string,
	config: VaultConfig,
	issues: string[],
): RuntimeReceipt | undefined {
	const path = receiptPath(vaultRoot, config);
	if (!existsSync(path)) {
		issues.push(`缺少 ${RUNTIME_RECEIPT_FILENAME}`);
		return undefined;
	}
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			issues.push('runtime receipt 必须是 Vault 内普通文件');
			return undefined;
		}
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
	if (!receipt.cutover_id || !isValidCutoverId(receipt.cutover_id)) {
		issues.push('upgrade receipt 的 cutover_id 非法');
		return;
	}
	try {
		const root = canonicalVaultRoot(vaultRoot);
		const expectedPath = join(cutoverRoot(root), receipt.cutover_id, 'journal.json');
		const requestedPath = resolve(receipt.journal_path);
		if (requestedPath !== expectedPath) {
			issues.push('cutover journal 不在受控目录');
			return;
		}
		const stat = lstatSync(requestedPath);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			issues.push('cutover journal 必须是普通文件');
			return;
		}
		if (realpathSync.native(requestedPath) !== expectedPath) {
			issues.push('cutover journal 路径经过符号链接');
			return;
		}
		const journal = JSON.parse(readFileSync(receipt.journal_path, 'utf-8')) as {
			state?: string;
			contract_version?: number;
			schema_version?: number;
			package_sha256?: string;
			cutover_id?: string;
			vault_root?: string;
			to_version?: string;
			backup_sha256?: string;
			backup_path?: string;
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
		if (!journal.vault_root || canonicalVaultRoot(journal.vault_root) !== root) {
			issues.push('cutover journal vault_root 不匹配');
		}
		if (journal.to_version !== receipt.runtime_version) {
			issues.push('cutover journal to_version 不匹配');
		}
		if (!/^[a-f0-9]{64}$/.test(journal.backup_sha256 ?? '')) {
			issues.push('cutover journal backup_sha256 非法');
		}
		const expectedBackup = join(dirname(expectedPath), 'vault');
		if (resolve(journal.backup_path ?? '') !== expectedBackup) {
			issues.push('cutover journal backup_path 不匹配');
		} else {
			const backupStat = lstatSync(expectedBackup);
			if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) {
				issues.push('cutover backup 不是普通目录');
			} else if (realpathSync.native(expectedBackup) !== expectedBackup) {
				issues.push('cutover backup 路径经过符号链接');
			}
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
		let fullPath = safeAssetPath(vaultRoot, assetPath);
		if (!fullPath) {
			issues.push(`managed asset 路径非法：${assetPath}`);
			continue;
		}
		try {
			fullPath = assertVaultPathSafe(vaultRoot, fullPath);
		} catch {
			issues.push(`managed asset 路径经过符号链接：${assetPath}`);
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
	let vaultRoot: string;
	try {
		vaultRoot = canonicalVaultRoot(options.vaultRoot);
		assertVaultPathSafe(vaultRoot, join(vaultRoot, 'lifeos.yaml'));
	} catch (error) {
		issues.push(error instanceof Error ? error.message : 'Vault 路径不安全');
		return { ok: false, issues };
	}
	try {
		const lock = readCutoverLock(vaultRoot);
		if (lock && !options.allowActiveCutover) {
			issues.push(`cutover 写闸已关闭（pid=${lock.pid}）`);
		}
	} catch (error) {
		issues.push(error instanceof Error ? error.message : 'cutover lock 无法读取');
	}
	let config: VaultConfig;
	try {
		config = options.config ?? resolveConfig(vaultRoot);
		if (canonicalVaultRoot(config.vaultRoot) !== vaultRoot) {
			issues.push('显式配置快照不属于当前 Vault');
			return { ok: false, issues };
		}
	} catch (error) {
		issues.push(error instanceof Error ? error.message : 'lifeos.yaml 无效');
		return { ok: false, issues };
	}
	const raw = config.rawConfig;
	if (raw.memory.contract_version !== CONTRACT_VERSION) {
		issues.push('memory.contract_version 必须为 2');
	}
	const receipt = readReceipt(vaultRoot, config, issues);
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
		checkJournal(receipt, vaultRoot, options.expectedJournalState ?? 'opened', issues);
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
		checkManagedAssets(vaultRoot, raw, issues);
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
	assertVaultPathSafe(vaultRoot, path);
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	const descriptor = openSync(temporary, 'wx', 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, path);
	if (process.platform !== 'win32') {
		const directoryDescriptor = openSync(dirname(path), 'r');
		try {
			fsyncSync(directoryDescriptor);
		} finally {
			closeSync(directoryDescriptor);
		}
	}
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
