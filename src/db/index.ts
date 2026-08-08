import { existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { DbMaintenanceMetrics, DbMaintenanceMode, DbMaintenanceReport } from '../types.js';

function databasePath(db: Database.Database): string | null {
	const databases = db.pragma('database_list') as Array<{ name: string; file: string }>;
	const main = databases.find((entry) => entry.name === 'main');
	return main?.file || null;
}

export function collectDbMaintenanceMetrics(db: Database.Database): DbMaintenanceMetrics {
	const pageCount = db.pragma('page_count', { simple: true }) as number;
	const pageSize = db.pragma('page_size', { simple: true }) as number;
	const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
	const path = databasePath(db);
	const walPath = path ? `${path}-wal` : null;
	const walBytes = walPath ? (existsSync(walPath) ? statSync(walPath).size : 0) : null;
	const walPages =
		walBytes === null ? null : walBytes <= 32 ? 0 : Math.floor((walBytes - 32) / (pageSize + 24));
	return {
		pageCount,
		freelistCount,
		freelistBytes: freelistCount * pageSize,
		walPages,
		walBytes,
	};
}

function runMaintenance(
	db: Database.Database,
	mode: DbMaintenanceMode,
	operation: (before: DbMaintenanceMetrics) => void,
): DbMaintenanceReport {
	const started = Date.now();
	const startedAt = new Date(started).toISOString();
	let before: DbMaintenanceMetrics | null = null;
	try {
		before = collectDbMaintenanceMetrics(db);
		operation(before);
		const after = collectDbMaintenanceMetrics(db);
		const finished = Date.now();
		return {
			mode,
			state: 'succeeded',
			startedAt,
			finishedAt: new Date(finished).toISOString(),
			durationMs: finished - started,
			before,
			after,
			error: null,
		};
	} catch (error) {
		const finished = Date.now();
		let after: DbMaintenanceMetrics | null = null;
		try {
			after = collectDbMaintenanceMetrics(db);
		} catch {
			// 指标读取失败时保留 null，避免用零值伪装未知状态。
		}
		return {
			mode,
			state: 'failed',
			startedAt,
			finishedAt: new Date(finished).toISOString(),
			durationMs: finished - started,
			before,
			after,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** 例行维护：回收 freelist、有限合并 FTS 段，并执行非截断 checkpoint。 */
export function runDbMaintenance(db: Database.Database): DbMaintenanceReport {
	return runMaintenance(db, 'routine', (before) => {
		db.pragma(`incremental_vacuum(${before.freelistCount})`);
		db.prepare("INSERT INTO vault_fts(vault_fts, rank) VALUES('merge', 4)").run();
		db.pragma('wal_checkpoint(PASSIVE)');
	});
}

/** 显式压缩：完整重建数据库、优化 FTS，并截断 WAL。仅供明确的 compact 路径调用。 */
export function runDbCompaction(db: Database.Database): DbMaintenanceReport {
	return runMaintenance(db, 'explicit', () => {
		db.pragma('auto_vacuum = INCREMENTAL');
		db.prepare("INSERT INTO vault_fts(vault_fts) VALUES('optimize')").run();
		db.exec('VACUUM');
		const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
			busy: number;
			log: number;
			checkpointed: number;
		}>;
		const terminal = checkpoint[0];
		const afterCheckpoint = collectDbMaintenanceMetrics(db);
		const checkpointComplete =
			terminal?.busy === 0 &&
			((terminal.log === 0 && terminal.checkpointed === 0) ||
				(terminal.log === -1 && terminal.checkpointed === -1 && afterCheckpoint.walBytes === 0));
		if (!checkpointComplete) {
			throw new Error(
				`wal_checkpoint(TRUNCATE) 未达终态: busy=${terminal?.busy ?? 'unknown'} log=${terminal?.log ?? 'unknown'} checkpointed=${terminal?.checkpointed ?? 'unknown'}`,
			);
		}
		if (afterCheckpoint.walBytes !== 0) {
			throw new Error(
				`wal_checkpoint(TRUNCATE) 返回成功但 WAL 仍为 ${afterCheckpoint.walBytes ?? 'unknown'} bytes`,
			);
		}
	});
}

/**
 * Execute a function with a temporary database connection that auto-closes.
 */
export function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

/**
 * Type-safe wrapper for db.prepare(sql).all(...params).
 * Eliminates the need for `as Record<string, unknown>[]` casts.
 */
export function queryAll<T>(db: Database.Database, sql: string, ...params: unknown[]): T[] {
	return db.prepare(sql).all(...params) as T[];
}

/**
 * Type-safe wrapper for db.prepare(sql).get(...params).
 */
export function queryOne<T>(
	db: Database.Database,
	sql: string,
	...params: unknown[]
): T | undefined {
	return db.prepare(sql).get(...params) as T | undefined;
}

/**
 * Build a SQL IN clause with placeholders for the given values.
 * Returns { clause: 'col IN (?, ?, ?)', params: values }
 */
export function inClause(column: string, values: string[]): { clause: string; params: string[] } {
	if (values.length === 0) throw new Error('inClause: values must be non-empty');
	const placeholders = values.map(() => '?').join(', ');
	return { clause: `${column} IN (${placeholders})`, params: values };
}
