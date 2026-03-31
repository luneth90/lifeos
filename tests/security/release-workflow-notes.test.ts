import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

interface ReleaseWorkflow {
	jobs?: {
		release?: {
			steps?: Array<{
				name?: string;
				run?: string;
			}>;
		};
	};
}

function readWorkflow(): ReleaseWorkflow {
	return parseYaml(readFileSync('.github/workflows/release.yml', 'utf-8')) as ReleaseWorkflow;
}

describe('release workflow notes', () => {
	it('extracts changelog notes before creating the GitHub release', () => {
		const workflow = readWorkflow();
		const steps = workflow.jobs?.release?.steps ?? [];

		expect(steps.some(step => step.name === 'Extract changelog notes')).toBe(true);
	});

	it('prepends changelog notes to generated release notes', () => {
		const workflow = readWorkflow();
		const createReleaseStep = workflow.jobs?.release?.steps?.find(
			step => step.name === 'Create GitHub Release',
		);

		expect(createReleaseStep?.run).toContain('--generate-notes');
		expect(createReleaseStep?.run).toContain('--notes "$NOTES"');
	});
});
