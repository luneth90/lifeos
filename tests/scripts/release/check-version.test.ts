import { describe, expect, it } from 'vitest';

const loadModule = () => import('../../../scripts/release/check-version.mjs');

describe('release check-version helper', () => {
	it('accepts a tag that matches the package version', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(validateReleaseTag('v1.2.3', '1.2.3')).toBe('1.2.3');
	});

	it('rejects a missing tag', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('', '1.2.3')).toThrow('Release tag is required');
	});

	it('rejects an invalid tag format', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('1.2.3', '1.2.3')).toThrow('Release tag must match vX.Y.Z');
	});

	it('rejects a tag that does not match package.json', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('v1.2.4', '1.2.3')).toThrow(
			'Release tag v1.2.4 does not match package.json version 1.2.3',
		);
	});
});
