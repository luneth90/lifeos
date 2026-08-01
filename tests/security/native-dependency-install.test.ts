import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface RootPackageJson {
	dependencies?: Record<string, string>;
}

interface LockedPackage {
	hasInstallScript?: boolean;
}

interface PackageLock {
	packages?: Record<string, LockedPackage>;
}

interface DependencyManifest {
	version: string;
	dependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('原生数据库生产依赖', () => {
	it('使用无弃用下载器和安装脚本的 better-sqlite3 13', () => {
		const packageJson = readJson<RootPackageJson>('package.json');
		const packageLock = readJson<PackageLock>('package-lock.json');
		const sqliteManifest = readJson<DependencyManifest>(
			require.resolve('better-sqlite3/package.json'),
		);
		const lockedSqlite = packageLock.packages?.['node_modules/better-sqlite3'];

		expect(packageJson.dependencies?.['better-sqlite3']).toBe('^13.0.2');
		expect(sqliteManifest.version).toMatch(/^13\./);
		expect(sqliteManifest.dependencies?.['prebuild-install']).toBeUndefined();
		expect(sqliteManifest.scripts?.install).toBeUndefined();
		expect(lockedSqlite?.hasInstallScript).not.toBe(true);
		expect(packageLock.packages?.['node_modules/prebuild-install']).toBeUndefined();
	});

	it('通过 N-API 预编译模块执行真实 SQLite 查询', () => {
		const db = new Database(':memory:');
		try {
			expect(db.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
		} finally {
			db.close();
		}
	});
});
