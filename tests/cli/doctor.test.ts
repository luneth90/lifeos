import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initCommand from '../../src/cli/commands/init.js';
import doctorCommand from '../../src/cli/commands/doctor.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-doctor-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIRST_DIR = { zh: '00_草稿', en: '00_Drafts' } as const;

describe.each(['zh', 'en'] as const)('lifeos doctor --lang %s', (lang) => {
	test('healthy vault: all checks pass', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('missing directory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			const dirName = FIRST_DIR[lang];
			rmSync(join(dir, dirName), { recursive: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true); // warnings don't fail
			const warn = result.checks.find(
				(c) => c.detail === 'missing' && c.name.includes(dirName),
			);
			expect(warn).toBeDefined();
		} finally {
			cleanup();
		}
	});
});

describe('lifeos doctor', () => {
	test('no lifeos.yaml: fails', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks[0].name).toBe('lifeos.yaml');
			expect(result.checks[0].status).toBe('fail');
		} finally {
			cleanup();
		}
	});
});
