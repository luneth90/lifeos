import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

interface Step {
	name?: string;
	uses?: string;
	run?: string;
	with?: Record<string, string | number>;
}

interface Workflow {
	jobs?: Record<
		string,
		{
			strategy?: {
				matrix?: {
					'node-version'?: Array<string | number>;
					include?: Array<{ os?: string; 'node-version'?: string | number }>;
				};
			};
			steps?: Step[];
		}
	>;
}

function readWorkflow(path: string): Workflow {
	return parseYaml(readFileSync(path, 'utf-8')) as Workflow;
}

function versionAtLeast(actual: string, minimum: string): boolean {
	const parts = (value: string) => value.replace(/^v/, '').split('.').map(Number);
	const left = parts(actual);
	const right = parts(minimum);
	for (let index = 0; index < 3; index += 1) {
		if ((left[index] ?? 0) !== (right[index] ?? 0)) {
			return (left[index] ?? 0) > (right[index] ?? 0);
		}
	}
	return true;
}

function expectPythonBefore(steps: Step[], command: string): void {
	for (const [action, expected] of [
		['actions/checkout', 'actions/checkout@v7'],
		['actions/setup-python', 'actions/setup-python@v7'],
		['actions/setup-node', 'actions/setup-node@v7'],
	]) {
		expect(
			steps.flatMap((step) => (step.uses?.startsWith(`${action}@`) ? [step.uses] : [])),
		).toEqual([expected]);
	}
	const setup = steps.findIndex((step) => step.uses === 'actions/setup-python@v7');
	const install = steps.findIndex((step) => step.run?.includes('PyMuPDF==1.26.5'));
	const verify = steps.findIndex((step) => step.run?.includes(command));
	expect(setup).toBeGreaterThanOrEqual(0);
	expect(steps[setup]?.with?.['python-version']).toBe('3.12');
	expect(install).toBeGreaterThan(setup);
	expect(verify).toBeGreaterThan(install);
}

describe('GitHub 工作流发布门禁', () => {
	it('CI 与 Release 使用受支持的 Node.js，并在验证前安装 PDF 依赖', () => {
		const minimum = String(
			(JSON.parse(readFileSync('package.json', 'utf-8')) as { engines: { node: string } }).engines
				.node,
		).replace(/^>=/, '');
		const ci = readWorkflow('.github/workflows/ci.yml').jobs?.test;
		const release = readWorkflow('.github/workflows/release.yml').jobs?.release;
		const matrix = ci?.strategy?.matrix;
		const ciVersions = [
			...(matrix?.['node-version'] ?? []),
			...(matrix?.include
				?.map((entry) => entry['node-version'])
				.filter((version): version is string | number => version !== undefined) ?? []),
		];
		const releaseNode = release?.steps?.find((step) => step.name === 'Set up Node.js')?.with?.[
			'node-version'
		];

		expect(ciVersions.length).toBeGreaterThan(0);
		expect(ciVersions.every((version) => versionAtLeast(String(version), minimum))).toBe(true);
		expect(versionAtLeast(String(releaseNode), minimum)).toBe(true);
		expectPythonBefore(ci?.steps ?? [], 'npm test');
		expectPythonBefore(release?.steps ?? [], 'npm run release:verify');
	});

	it('Release 在发布前完成漏洞、构建和变更说明门禁', () => {
		const steps = readWorkflow('.github/workflows/release.yml').jobs?.release?.steps ?? [];
		const index = (predicate: (step: Step) => boolean) => steps.findIndex(predicate);
		const audit = index((step) => step.run === 'npm audit --audit-level=low');
		const verify = index((step) => step.run === 'npm run release:verify');
		const notes = index((step) => step.name === 'Extract changelog notes');
		const publish = index((step) => step.name === 'Publish to npm');
		const release = steps.find((step) => step.name === 'Create GitHub Release');

		expect(audit).toBeGreaterThanOrEqual(0);
		expect(verify).toBeGreaterThan(audit);
		expect(notes).toBeGreaterThan(verify);
		expect(publish).toBeGreaterThan(notes);
		expect(release?.run).toContain('--generate-notes');
		expect(release?.run).toContain('--notes "$NOTES"');
	});
});
