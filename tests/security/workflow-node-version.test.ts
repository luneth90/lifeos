import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

interface PackageJson {
	engines?: {
		node?: string;
	};
}

interface CiWorkflow {
	jobs?: {
		test?: {
			strategy?: {
				matrix?: {
					'node-version'?: Array<number | string>;
				};
			};
		};
	};
}

interface ReleaseWorkflow {
	jobs?: {
		release?: {
			steps?: Array<{
				name?: string;
				with?: {
					'node-version'?: number | string;
				};
			}>;
		};
	};
}

function readYaml<T>(path: string): T {
	return parseYaml(readFileSync(path, 'utf-8')) as T;
}

function getMinimumNodeVersion(): string {
	const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as PackageJson;
	const versionRange = packageJson.engines?.node;
	if (!versionRange?.startsWith('>=')) {
		throw new Error(`Unsupported engines.node range: ${versionRange ?? 'missing'}`);
	}
	return versionRange.slice(2);
}

function parseNodeVersion(version: string): [major: number, minor: number, patch: number] {
	const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version);
	if (!match) {
		throw new Error(`Invalid Node.js version: ${version}`);
	}
	return [
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2] ?? '0', 10),
		Number.parseInt(match[3] ?? '0', 10),
	];
}

function isVersionAtLeast(actualVersion: string, minimumVersion: string): boolean {
	const actual = parseNodeVersion(actualVersion);
	const minimum = parseNodeVersion(minimumVersion);

	for (let index = 0; index < minimum.length; index += 1) {
		if (actual[index] > minimum[index]) return true;
		if (actual[index] < minimum[index]) return false;
	}

	return true;
}

describe('GitHub workflow Node.js versions', () => {
	it('CI matrix only uses versions supported by package.json engines.node', () => {
		const minimumVersion = getMinimumNodeVersion();
		const workflow = readYaml<CiWorkflow>('.github/workflows/ci.yml');
		const versions = workflow.jobs?.test?.strategy?.matrix?.['node-version'] ?? [];

		expect(versions.length).toBeGreaterThan(0);
		for (const version of versions) {
			expect(isVersionAtLeast(String(version), minimumVersion)).toBe(true);
		}
	});

	it('release workflow uses a version supported by package.json engines.node', () => {
		const minimumVersion = getMinimumNodeVersion();
		const workflow = readYaml<ReleaseWorkflow>('.github/workflows/release.yml');
		const setupNodeStep = workflow.jobs?.release?.steps?.find(
			(step) => step.name === 'Set up Node.js',
		);

		expect(setupNodeStep?.with?.['node-version']).toBeDefined();
		expect(
			isVersionAtLeast(String(setupNodeStep?.with?.['node-version']), minimumVersion),
		).toBe(true);
	});
});
