import Database from 'better-sqlite3';

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
