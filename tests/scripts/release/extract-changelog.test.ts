import { describe, expect, it } from 'vitest';

const loadModule = () => import('../../../scripts/release/extract-changelog.mjs');

describe('release extract-changelog helper', () => {
	it('extracts the matching release section without the version heading', async () => {
		const { extractReleaseNotes } = await loadModule();
		const changelog = `# Changelog

## 1.1.0 (2026-03-31)

### Features

- Added Windows support

### Internal

- Upgraded better-sqlite3

## 1.0.3 (2026-03-30)

### Features

- Previous release
`;

		expect(extractReleaseNotes(changelog, '1.1.0')).toBe(`### Features

- Added Windows support

### Internal

- Upgraded better-sqlite3`);
	});

	it('rejects when the requested version is missing from the changelog', async () => {
		const { extractReleaseNotes } = await loadModule();

		expect(() => extractReleaseNotes('# Changelog\n', '1.1.0')).toThrow(
			'Could not find changelog section for version 1.1.0',
		);
	});
});
