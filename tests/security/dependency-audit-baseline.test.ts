import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LockedPackage {
	version?: string;
}

interface PackageLock {
	packages?: Record<string, LockedPackage>;
}

const minimumSafeVersions: Record<string, string> = {
	'@hono/node-server': '2.0.5',
	'@modelcontextprotocol/sdk': '1.30.0',
	'body-parser': '2.3.0',
	esbuild: '0.28.1',
	'fast-uri': '3.1.4',
	hono: '4.12.27',
	postcss: '8.5.18',
	'path-to-regexp': '8.4.0',
	qs: '6.15.2',
	vite: '7.3.5',
	vitest: '3.2.6',
};

function compareVersions(left: string, right: string): number {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	for (let index = 0; index < 3; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

describe('依赖安全基线', () => {
	it('锁文件中的所有已知漏洞依赖均达到修复版本', () => {
		const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as PackageLock;

		for (const [name, minimumVersion] of Object.entries(minimumSafeVersions)) {
			const installedVersions = Object.entries(packageLock.packages ?? {})
				.filter(
					([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
				)
				.map(([, dependency]) => dependency.version)
				.filter((version): version is string => version !== undefined);

			expect(installedVersions, `${name} 必须存在于锁文件中`).not.toHaveLength(0);
			for (const installedVersion of installedVersions) {
				expect(
					compareVersions(installedVersion, minimumVersion),
					`${name}@${installedVersion} 必须不低于 ${minimumVersion}`,
				).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
