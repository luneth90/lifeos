import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempVault } from './setup.js';

describe('createTempVault', () => {
	it('creates the temp vault under the local tmp directory', () => {
		const vault = createTempVault();

		try {
			expect(vault.root.startsWith(join(process.cwd(), 'tmp'))).toBe(true);
			expect(existsSync(vault.root)).toBe(true);
		} finally {
			vault.cleanup();
		}
	});

	it('cleanup removes the temp vault directory', () => {
		const vault = createTempVault();

		expect(existsSync(vault.root)).toBe(true);

		vault.cleanup();

		expect(existsSync(vault.root)).toBe(false);
	});
});
