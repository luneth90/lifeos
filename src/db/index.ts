import Database from 'better-sqlite3';

/**
 * Reclaim physical space and compact the FTS index for a database.
 *
 * Runs, in order: PRAGMA incremental_vacuum (reclaims the entire freelist),
 * the FTS5 'optimize' command (merges fragmented segments), and
 * PRAGMA wal_checkpoint(TRUNCATE) (flushes the WAL and truncates it to zero
 * bytes). Returns the freelist page count before/after and whether the WAL
 * file was truncated.
 */
export function runDbMaintenance(db: Database.Database): {
	freelistBefore: number;
	freelistAfter: number;
	walTruncated: boolean;
} {
	const freelistBefore = db.pragma('freelist_count', { simple: true }) as number;
	db.pragma('incremental_vacuum');
	db.prepare("INSERT INTO vault_fts(vault_fts) VALUES('optimize')").run();
	const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
		busy: number;
		log: number;
		checkpointed: number;
	}>;
	const freelistAfter = db.pragma('freelist_count', { simple: true }) as number;
	// With TRUNCATE mode, a non-busy checkpoint guarantees the WAL file was
	// truncated to zero bytes.
	return {
		freelistBefore,
		freelistAfter,
		walTruncated: checkpoint[0] !== undefined && checkpoint[0].busy === 0,
	};
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
