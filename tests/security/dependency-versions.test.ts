import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseVersion(version: string): [major: number, minor: number, patch: number] {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) {
		throw new Error(`Invalid semver: ${version}`);
	}
	return [
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10),
		Number.parseInt(match[3], 10),
	];
}

function isAtLeast(version: string, minimum: string): boolean {
	const actual = parseVersion(version);
	const floor = parseVersion(minimum);
	for (let index = 0; index < floor.length; index += 1) {
		if (actual[index] > floor[index]) return true;
		if (actual[index] < floor[index]) return false;
	}
	return true;
}

describe('dependency lockfile security floors', () => {
	test('path-to-regexp is locked to a non-vulnerable version', () => {
		const lockPath = resolve(process.cwd(), 'package-lock.json');
		const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
			packages?: Record<string, { version?: string }>;
		};

		const version = lock.packages?.['node_modules/path-to-regexp']?.version;
		expect(version).toBeDefined();
		expect(isAtLeast(version ?? '0.0.0', '8.4.0')).toBe(true);
	});
});
