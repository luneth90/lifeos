import { describe, expect, it, vi } from 'vitest';

const loadModule = () => import('../../../scripts/release/pack.mjs');

describe('release pack helper', () => {
	it('normalizes npm 10/11 array and npm 12 keyed object manifests', async () => {
		const { normalizePackEntries } = await loadModule();
		const legacy = [{ filename: 'lifeos-1.2.3.tgz' }];
		const current = { lifeos: { filename: 'lifeos-1.2.3.tgz' } };

		expect(normalizePackEntries(legacy)).toEqual(legacy);
		expect(normalizePackEntries(current)).toEqual([current.lifeos]);
	});

	it('rejects npm pack manifests without files or filename', async () => {
		const { normalizePackEntries } = await loadModule();

		expect(() => normalizePackEntries({ lifeos: { name: 'lifeos' } })).toThrow(
			'npm pack json output did not contain package entries',
		);
	});

	it('extracts the tarball name from npm pack json output', async () => {
		const { extractTarballName } = await loadModule();

		const output = JSON.stringify([{ filename: 'lifeos-1.2.3.tgz' }]);

		expect(extractTarballName(output)).toBe('lifeos-1.2.3.tgz');
	});

	it('extracts the tarball name from npm 12 keyed json output', async () => {
		const { extractTarballName } = await loadModule();
		const output = JSON.stringify({ lifeos: { filename: 'lifeos-1.2.3.tgz' } });

		expect(extractTarballName(output)).toBe('lifeos-1.2.3.tgz');
	});

	it('falls back to the last output line when npm pack is not json', async () => {
		const { extractTarballName } = await loadModule();

		const output = 'npm notice some log line\nlifeos-1.2.3.tgz\n';

		expect(extractTarballName(output)).toBe('lifeos-1.2.3.tgz');
	});

	it('rejects empty npm pack output', async () => {
		const { extractTarballName } = await loadModule();

		expect(() => extractTarballName('')).toThrow('npm pack did not return a tarball name');
	});

	it('runs npm pack and returns the generated tarball name', async () => {
		const { runNpmPack } = await loadModule();
		const execFileSync = vi.fn(() => JSON.stringify([{ filename: 'lifeos-1.2.3.tgz' }]));

		expect(runNpmPack(execFileSync)).toBe('lifeos-1.2.3.tgz');
		expect(execFileSync).toHaveBeenCalledWith('npm', ['pack', '--json'], {
			cwd: expect.any(String),
			encoding: 'utf8',
		});
	});
});
