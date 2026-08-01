import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface PackageJson {
	engines?: {
		node?: string;
	};
}

interface WorkflowStep {
	name?: string;
	uses?: string;
	run?: string;
	with?: {
		'node-version'?: number | string;
		'python-version'?: number | string;
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
			steps?: WorkflowStep[];
		};
	};
}

interface ReleaseWorkflow {
	jobs?: {
		release?: {
			steps?: WorkflowStep[];
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

function expectPythonTestEnvironment(steps: WorkflowStep[], verificationCommand: string): void {
	const setupIndex = steps.findIndex((step) => step.uses === 'actions/setup-python@v7');
	const installIndex = steps.findIndex(
		(step) =>
			step.run?.trim() === 'python -m pip install --disable-pip-version-check PyMuPDF==1.26.5',
	);
	const verificationIndex = steps.findIndex((step) => step.run?.trim() === verificationCommand);

	expect(setupIndex).toBeGreaterThanOrEqual(0);
	expect(steps[setupIndex]?.with?.['python-version']).toBe('3.12');
	expect(installIndex).toBeGreaterThan(setupIndex);
	expect(verificationIndex).toBeGreaterThan(installIndex);
}

function expectNode24OfficialActions(steps: WorkflowStep[]): void {
	const actions = steps.flatMap((step) => (step.uses ? [step.uses] : []));

	for (const expected of [
		'actions/checkout@v7',
		'actions/setup-python@v7',
		'actions/setup-node@v7',
	]) {
		expect(actions).toContain(expected);
	}
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
		expect(isVersionAtLeast(String(setupNodeStep?.with?.['node-version']), minimumVersion)).toBe(
			true,
		);
	});
});

describe('GitHub 工作流 Python 测试环境', () => {
	it('CI 在测试前安装固定版本的 Python 与 PyMuPDF', () => {
		const workflow = readYaml<CiWorkflow>('.github/workflows/ci.yml');
		const steps = workflow.jobs?.test?.steps ?? [];

		expectPythonTestEnvironment(steps, 'npm test');
	});

	it('Release 在发布验证前安装固定版本的 Python 与 PyMuPDF', () => {
		const workflow = readYaml<ReleaseWorkflow>('.github/workflows/release.yml');
		const steps = workflow.jobs?.release?.steps ?? [];

		expectPythonTestEnvironment(steps, 'npm run release:verify');
	});
});

describe('GitHub 工作流官方 Action runner', () => {
	it('CI 只采用当前 node24 主版本的基础 Action', () => {
		const workflow = readYaml<CiWorkflow>('.github/workflows/ci.yml');

		expectNode24OfficialActions(workflow.jobs?.test?.steps ?? []);
	});

	it('Release 只采用当前 node24 主版本的基础 Action', () => {
		const workflow = readYaml<ReleaseWorkflow>('.github/workflows/release.yml');

		expectNode24OfficialActions(workflow.jobs?.release?.steps ?? []);
	});
});
