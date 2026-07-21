import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
	MemoryEnforcement,
	MemoryItemKind,
	MemoryItemStatus,
	MemoryScope,
	MemorySource,
} from '../types.js';
import {
	MEMORY_ITEMS_V4_INDEX_SQL,
	SCHEMA_VERSION,
	assertSchemaV4,
	createMemoryItemsTableSql,
	tableExists,
} from './schema.js';

export interface LegacyScopeMapEntry {
	legacyIdentity: string;
	contentHash: string;
	scope: MemoryScope;
	itemKind: MemoryItemKind;
	priority?: number;
	enforcement?: MemoryEnforcement;
	status?: MemoryItemStatus;
	archivedAt?: string;
	archiveReason?: string;
}

export interface MigrateToV4Options {
	scopeMap: LegacyScopeMapEntry[];
	preparedAt: string;
}

export interface MigrationResult {
	fromVersion: number;
	toVersion: 4;
	migrated: boolean;
	itemCount: number;
	beforeHash: string;
	afterHash: string;
}

export interface LegacyMemoryInventoryItem {
	legacyIdentity: string;
	slotKey: string;
	content: string;
	contentHash: string;
	source: MemorySource;
	relatedFiles: string[];
	manualFlag: number;
	status: string;
	updatedAt: string | null;
	expiresAt: string | null;
}

export interface LegacyMemoryInventory {
	version: 1 | 2 | 3;
	items: LegacyMemoryInventoryItem[];
}

export class MigrationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MigrationValidationError';
	}
}

interface LegacyMemoryItem {
	legacyIdentity: string;
	slotKey: string;
	content: string;
	source: MemorySource;
	relatedFiles: string[];
	manualFlag: number;
	status: string;
	updatedAt: string | null;
	expiresAt: string | null;
}

interface FinalMemoryItem {
	legacyIdentity: string;
	slotKey: string;
	content: string;
	itemKind: MemoryItemKind;
	scope: MemoryScope;
	priority: number;
	enforcement: MemoryEnforcement;
	source: MemorySource;
	relatedFiles: string[];
	manualFlag: number;
	status: MemoryItemStatus;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	archivedAt: string | null;
	archiveReason: string | null;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableHash(value: unknown): string {
	return sha256(JSON.stringify(value));
}

function columnNames(db: Database.Database, table: string): Set<string> {
	return new Set(
		(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
			(row) => row.name,
		),
	);
}

function parseRelatedFiles(value: unknown, identity: string): string[] {
	if (value === null || value === undefined || value === '') return [];
	if (typeof value !== 'string') {
		throw new MigrationValidationError(`${identity} 的 related_files 不是 JSON 字符串`);
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
			throw new Error('不是字符串数组');
		}
		return parsed;
	} catch {
		throw new MigrationValidationError(`${identity} 的 related_files 不是合法字符串数组`);
	}
}

function readLegacyItems(db: Database.Database, version: number): LegacyMemoryItem[] {
	if (!tableExists(db, 'memory_items')) {
		throw new MigrationValidationError(`Schema V${version} 缺少 memory_items`);
	}
	const columns = columnNames(db, 'memory_items');
	if (version === 1) {
		if (!columns.has('section')) {
			throw new MigrationValidationError('Schema V1 memory_items 缺少 section');
		}
		const identityExpression = columns.has('id')
			? 'CAST(id AS TEXT)'
			: columns.has('item_id')
				? 'CAST(item_id AS TEXT)'
				: 'CAST(rowid AS TEXT)';
		const rows = db
			.prepare(`
				SELECT ${identityExpression} AS legacy_id, slot_key, content, section,
				       related_files, manual_flag, status, updated_at, expires_at
				FROM memory_items ORDER BY rowid
			`)
			.all() as Array<Record<string, unknown>>;
		return rows.map((row) => {
			const identity = `id:${String(row.legacy_id)}`;
			const source: MemorySource = row.section === 'corrections' ? 'correction' : 'preference';
			return {
				legacyIdentity: identity,
				slotKey: String(row.slot_key),
				content: String(row.content),
				source,
				relatedFiles: parseRelatedFiles(row.related_files, identity),
				manualFlag: Number(row.manual_flag ?? 0),
				status: String(row.status ?? 'active'),
				updatedAt: row.updated_at == null ? null : String(row.updated_at),
				expiresAt: row.expires_at == null ? null : String(row.expires_at),
			};
		});
	}

	const rows = db
		.prepare(`
			SELECT slot_key, content, source, related_files, manual_flag,
			       status, updated_at, expires_at
			FROM memory_items ORDER BY slot_key
		`)
		.all() as Array<Record<string, unknown>>;
	return rows.map((row) => {
		const identity = `slot:${String(row.slot_key)}`;
		if (row.source !== 'preference' && row.source !== 'correction') {
			throw new MigrationValidationError(`${identity} 的 source 非法`);
		}
		return {
			legacyIdentity: identity,
			slotKey: String(row.slot_key),
			content: String(row.content),
			source: row.source,
			relatedFiles: parseRelatedFiles(row.related_files, identity),
			manualFlag: Number(row.manual_flag ?? 0),
			status: String(row.status ?? 'active'),
			updatedAt: row.updated_at == null ? null : String(row.updated_at),
			expiresAt: row.expires_at == null ? null : String(row.expires_at),
		};
	});
}

/**
 * 只读盘点旧版记忆，供升级器生成可审计的 scope map。
 * 这里不做任何猜测，也不会修改数据库。
 */
export function inspectLegacyMemoryItems(db: Database.Database): LegacyMemoryInventory {
	const version = readVersion(db);
	if (![1, 2, 3].includes(version)) {
		throw new MigrationValidationError(`Schema V${version} 不需要生成 V4 scope map`);
	}
	const items = readLegacyItems(db, version).map(
		(item): LegacyMemoryInventoryItem => ({
			...item,
			contentHash: sha256(item.content),
		}),
	);
	return { version: version as 1 | 2 | 3, items };
}

function isValidTimestamp(value: string | null): value is string {
	return value !== null && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function normalizedTimestamp(value: string, label: string): string {
	const timestamp = Date.parse(value);
	if (!value.trim() || !Number.isFinite(timestamp)) {
		throw new MigrationValidationError(`${label} 必须是有效时间戳`);
	}
	return new Date(timestamp).toISOString();
}

function validateScope(scope: MemoryScope, identity: string): void {
	if (!['global', 'skill', 'project', 'repository', 'tool', 'file'].includes(scope.type)) {
		throw new MigrationValidationError(`${identity} 的 scope type 非法：${scope.type}`);
	}
	if (scope.key !== scope.key.trim()) {
		throw new MigrationValidationError(`${identity} 的 scope key 含首尾空白`);
	}
	if ((scope.type === 'global') !== (scope.key === '')) {
		throw new MigrationValidationError(`${identity} 的 scope type/key 不一致`);
	}
}

function compareFinalItems(a: FinalMemoryItem, b: FinalMemoryItem): number {
	return JSON.stringify([a.scope.type, a.scope.key, a.slotKey]).localeCompare(
		JSON.stringify([b.scope.type, b.scope.key, b.slotKey]),
	);
}

function transformItems(
	legacyItems: LegacyMemoryItem[],
	scopeMap: LegacyScopeMapEntry[],
	preparedAt: string,
): FinalMemoryItem[] {
	const normalizedPreparedAt = normalizedTimestamp(preparedAt, 'preparedAt');
	const mappings = new Map<string, LegacyScopeMapEntry>();
	for (const entry of scopeMap) {
		if (mappings.has(entry.legacyIdentity)) {
			throw new MigrationValidationError(`迁移映射身份重复：${entry.legacyIdentity}`);
		}
		mappings.set(entry.legacyIdentity, entry);
	}
	const identities = new Set(legacyItems.map((item) => item.legacyIdentity));
	for (const identity of mappings.keys()) {
		if (!identities.has(identity)) {
			throw new MigrationValidationError(`迁移映射包含多余条目：${identity}`);
		}
	}

	const finalItems = legacyItems.map((item): FinalMemoryItem => {
		const mapping = mappings.get(item.legacyIdentity);
		if (!mapping) throw new MigrationValidationError(`迁移映射缺少：${item.legacyIdentity}`);
		if (mapping.contentHash !== sha256(item.content)) {
			throw new MigrationValidationError(`内容哈希不匹配：${item.legacyIdentity}`);
		}
		validateScope(mapping.scope, item.legacyIdentity);
		if (!['rule', 'decision', 'fact', 'profile', 'event'].includes(mapping.itemKind)) {
			throw new MigrationValidationError(`${item.legacyIdentity} 的 itemKind 非法`);
		}
		const priority = mapping.priority ?? 50;
		if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
			throw new MigrationValidationError(`${item.legacyIdentity} 的 priority 非法`);
		}
		const enforcement = mapping.enforcement ?? 'soft';
		if (enforcement !== 'hard' && enforcement !== 'soft') {
			throw new MigrationValidationError(`${item.legacyIdentity} 的 enforcement 非法`);
		}
		if (item.manualFlag !== 0 && item.manualFlag !== 1) {
			throw new MigrationValidationError(`${item.legacyIdentity} 的 manual_flag 非法`);
		}
		const status = mapping.status ?? (item.status as MemoryItemStatus);
		if (!['active', 'expired', 'archived'].includes(status)) {
			throw new MigrationValidationError(
				`${item.legacyIdentity} 必须显式映射旧状态 ${item.status}`,
			);
		}
		if (mapping.itemKind === 'event' && status !== 'archived') {
			throw new MigrationValidationError(`${item.legacyIdentity} 的 event 必须归档`);
		}
		const archivedAt =
			status === 'archived' && mapping.archivedAt
				? normalizedTimestamp(mapping.archivedAt, `${item.legacyIdentity} archivedAt`)
				: null;
		const archiveReason = status === 'archived' ? (mapping.archiveReason ?? null) : null;
		if (status === 'archived' && (!archivedAt || !archiveReason?.trim())) {
			throw new MigrationValidationError(`${item.legacyIdentity} 的归档元数据不完整`);
		}
		const updatedAt = isValidTimestamp(item.updatedAt)
			? normalizedTimestamp(item.updatedAt, `${item.legacyIdentity} updatedAt`)
			: normalizedPreparedAt;
		const expiresAt =
			item.expiresAt === null
				? null
				: normalizedTimestamp(item.expiresAt, `${item.legacyIdentity} expiresAt`);
		return {
			legacyIdentity: item.legacyIdentity,
			slotKey: item.slotKey,
			content: item.content,
			itemKind: mapping.itemKind,
			scope: mapping.scope,
			priority,
			enforcement,
			source: item.source,
			relatedFiles: item.relatedFiles,
			manualFlag: item.manualFlag,
			status,
			createdAt: updatedAt,
			updatedAt,
			expiresAt,
			archivedAt,
			archiveReason,
		};
	});

	const compositeKeys = new Set<string>();
	for (const item of finalItems) {
		const key = JSON.stringify([item.scope.type, item.scope.key, item.slotKey]);
		if (compositeKeys.has(key)) {
			throw new MigrationValidationError(`迁移目标复合键重复：${key}`);
		}
		compositeKeys.add(key);
	}
	return finalItems.sort(compareFinalItems);
}

function finalProjection(item: FinalMemoryItem): unknown[] {
	return [
		item.scope.type,
		item.scope.key,
		item.slotKey,
		sha256(item.content),
		item.itemKind,
		item.priority,
		item.enforcement,
		item.source,
		JSON.stringify(item.relatedFiles),
		item.manualFlag,
		item.status,
		item.createdAt,
		item.updatedAt,
		item.expiresAt,
		item.archivedAt,
		item.archiveReason,
	];
}

function compareProjections(a: unknown[], b: unknown[]): number {
	return JSON.stringify(a.slice(0, 3)).localeCompare(JSON.stringify(b.slice(0, 3)));
}

function hashFinalTable(db: Database.Database): { count: number; hash: string } {
	const rows = db
		.prepare(`
			SELECT scope_type, scope_key, slot_key, content, item_kind, priority,
			       enforcement, source, related_files, manual_flag, status,
			       created_at, updated_at, expires_at, archived_at, archive_reason
			FROM memory_items
		`)
		.all() as Array<Record<string, unknown>>;
	const projection = rows
		.map((row) => [
			row.scope_type,
			row.scope_key,
			row.slot_key,
			sha256(String(row.content)),
			row.item_kind,
			row.priority,
			row.enforcement,
			row.source,
			row.related_files,
			row.manual_flag,
			row.status,
			row.created_at,
			row.updated_at,
			row.expires_at,
			row.archived_at,
			row.archive_reason,
		])
		.sort(compareProjections);
	return { count: rows.length, hash: stableHash(projection) };
}

function readVersion(db: Database.Database): number {
	if (!tableExists(db, 'schema_version')) {
		throw new MigrationValidationError('旧数据库缺少 schema_version');
	}
	const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{
		version: unknown;
	}>;
	if (rows.length !== 1 || !Number.isInteger(rows[0]?.version)) {
		throw new MigrationValidationError('schema_version 必须且只能包含一个整数版本');
	}
	return rows[0]?.version as number;
}

function rebuildVaultSchema(db: Database.Database): void {
	if (!tableExists(db, 'vault_index')) {
		throw new MigrationValidationError('旧数据库缺少 vault_index');
	}
	const vaultColumns = columnNames(db, 'vault_index');
	const finalVaultColumns = [
		'file_path',
		'title',
		'type',
		'status',
		'domain',
		'category',
		'tags',
		'aliases',
		'summary',
		'search_hints',
		'wikilinks',
		'backlinks',
		'section_heads',
		'content_hash',
		'file_size',
		'created_at',
		'modified_at',
		'indexed_at',
		'project',
		'entity_id',
	] as const;
	if (!vaultColumns.has('file_path')) {
		throw new MigrationValidationError('旧 vault_index 缺少 file_path');
	}
	const scanStateColumns = tableExists(db, 'scan_state')
		? columnNames(db, 'scan_state')
		: new Set<string>();
	const finalScanStateColumns = [
		'file_path',
		'last_seen_hash',
		'last_seen_mtime',
		'last_seen_size',
		'last_indexed_at',
	] as const;
	db.exec(`
		DROP TABLE IF EXISTS scan_state_v4;
		CREATE TABLE scan_state_v4 (
			file_path TEXT PRIMARY KEY,
			last_seen_hash TEXT,
			last_seen_mtime REAL,
			last_seen_size INTEGER,
			last_indexed_at TEXT
		);
	`);
	if (scanStateColumns.has('file_path')) {
		const scanProjection = finalScanStateColumns
			.map((column) => (scanStateColumns.has(column) ? column : `NULL AS ${column}`))
			.join(', ');
		db.exec(`
			INSERT INTO scan_state_v4 (${finalScanStateColumns.join(', ')})
			SELECT ${scanProjection} FROM scan_state;
		`);
	}
	if (tableExists(db, 'scan_state')) db.exec('DROP TABLE scan_state');
	db.exec('ALTER TABLE scan_state_v4 RENAME TO scan_state');

	db.exec(`
		DROP TRIGGER IF EXISTS session_fts_ai;
		DROP TRIGGER IF EXISTS session_fts_ad;
		DROP TRIGGER IF EXISTS session_fts_au;
		DROP TABLE IF EXISTS session_fts;
		DROP TABLE IF EXISTS session_log;
		DROP TABLE IF EXISTS session_state;
		DROP TABLE IF EXISTS enhance_queue;

		DROP TRIGGER IF EXISTS vault_fts_ai;
		DROP TRIGGER IF EXISTS vault_fts_ad;
		DROP TRIGGER IF EXISTS vault_fts_au;
		DROP TABLE IF EXISTS vault_fts;

		DROP TABLE IF EXISTS vault_index_v4;
		CREATE TABLE vault_index_v4 (
			file_path TEXT PRIMARY KEY,
			title TEXT,
			type TEXT,
			status TEXT,
			domain TEXT,
			category TEXT,
			tags TEXT,
			aliases TEXT,
			summary TEXT,
			search_hints TEXT,
			wikilinks TEXT,
			backlinks TEXT,
			section_heads TEXT,
			content_hash TEXT,
			file_size INTEGER,
			created_at TEXT,
			modified_at TEXT,
			indexed_at TEXT,
			project TEXT,
			entity_id TEXT
		);
	`);
	const selectProjection = finalVaultColumns
		.map((column) => (vaultColumns.has(column) ? column : `NULL AS ${column}`))
		.join(', ');
	db.exec(`
		INSERT INTO vault_index_v4 (${finalVaultColumns.join(', ')})
		SELECT ${selectProjection} FROM vault_index;
		DROP TABLE vault_index;
		ALTER TABLE vault_index_v4 RENAME TO vault_index;

		CREATE VIRTUAL TABLE vault_fts USING fts5(
			file_path, title, summary, search_hints, tags,
			content='vault_index', content_rowid='rowid'
		);
		CREATE TRIGGER vault_fts_ai AFTER INSERT ON vault_index BEGIN
			INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
			VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
		END;
		CREATE TRIGGER vault_fts_ad AFTER DELETE ON vault_index BEGIN
			INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
			VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
		END;
		CREATE TRIGGER vault_fts_au AFTER UPDATE ON vault_index BEGIN
			INSERT INTO vault_fts(vault_fts, rowid, file_path, title, summary, search_hints, tags)
			VALUES ('delete', old.rowid, old.file_path, old.title, old.summary, old.search_hints, old.tags);
			INSERT INTO vault_fts(rowid, file_path, title, summary, search_hints, tags)
			VALUES (new.rowid, new.file_path, new.title, new.summary, new.search_hints, new.tags);
		END;
		INSERT INTO vault_fts(vault_fts) VALUES('rebuild');

		DROP INDEX IF EXISTS idx_vault_index_entity_id;
		CREATE INDEX idx_vault_index_entity_id
		ON vault_index(entity_id) WHERE entity_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_vault_index_type_status ON vault_index(type, status);
		CREATE INDEX IF NOT EXISTS idx_scan_state_last_indexed_at ON scan_state(last_indexed_at DESC);
	`);
}

export function migrateToV4(db: Database.Database, options: MigrateToV4Options): MigrationResult {
	const fromVersion = readVersion(db);
	if (fromVersion === SCHEMA_VERSION) {
		assertSchemaV4(db);
		const current = hashFinalTable(db);
		return {
			fromVersion,
			toVersion: 4,
			migrated: false,
			itemCount: current.count,
			beforeHash: current.hash,
			afterHash: current.hash,
		};
	}
	if (![1, 2, 3].includes(fromVersion)) {
		throw new MigrationValidationError(`不支持从 Schema V${fromVersion} 迁移`);
	}

	const migrate = db.transaction((): MigrationResult => {
		if (readVersion(db) !== fromVersion) {
			throw new MigrationValidationError('迁移期间 schema_version 发生变化');
		}
		const legacyItems = readLegacyItems(db, fromVersion);
		const finalItems = transformItems(legacyItems, options.scopeMap, options.preparedAt);
		const beforeProjection = finalItems.map(finalProjection).sort(compareProjections);
		const beforeHash = stableHash(beforeProjection);

		db.exec('DROP TABLE IF EXISTS memory_items_v4');
		db.exec(createMemoryItemsTableSql('memory_items_v4'));
		const insert = db.prepare(`
			INSERT INTO memory_items_v4(
				slot_key, content, item_kind, scope_type, scope_key, priority,
				enforcement, source, related_files, manual_flag, status,
				created_at, updated_at, expires_at, archived_at, archive_reason
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		for (const item of finalItems) {
			insert.run(
				item.slotKey,
				item.content,
				item.itemKind,
				item.scope.type,
				item.scope.key,
				item.priority,
				item.enforcement,
				item.source,
				JSON.stringify(item.relatedFiles),
				item.manualFlag,
				item.status,
				item.createdAt,
				item.updatedAt,
				item.expiresAt,
				item.archivedAt,
				item.archiveReason,
			);
		}
		const insertedCount = (
			db.prepare('SELECT COUNT(*) AS count FROM memory_items_v4').get() as { count: number }
		).count;
		if (insertedCount !== legacyItems.length) {
			throw new MigrationValidationError('迁移前后 memory item 行数不一致');
		}

		db.exec(`
			ALTER TABLE memory_items RENAME TO memory_items_legacy;
			ALTER TABLE memory_items_v4 RENAME TO memory_items;
			DROP TABLE memory_items_legacy;
		`);
		db.exec(MEMORY_ITEMS_V4_INDEX_SQL);
		rebuildVaultSchema(db);

		const after = hashFinalTable(db);
		if (after.count !== legacyItems.length || after.hash !== beforeHash) {
			throw new MigrationValidationError('迁移后字段哈希校验失败');
		}
		db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
		assertSchemaV4(db);
		return {
			fromVersion,
			toVersion: 4,
			migrated: true,
			itemCount: after.count,
			beforeHash,
			afterHash: after.hash,
		};
	});
	return migrate.exclusive();
}
