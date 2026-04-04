import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import doctorCommand, {
	MIN_NODE_VERSION,
	isNodeVersionSupported,
} from '../../src/cli/commands/doctor.js';
import initCommand from '../../src/cli/commands/init.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-doctor-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FIRST_DIR = { zh: '00_草稿', en: '00_Drafts' } as const;
const DIGEST_DIR = { zh: join('90_系统', '信息'), en: join('90_System', 'Digest') } as const;

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
			const warn = result.checks.find((c) => c.detail === 'missing' && c.name.includes(dirName));
			expect(warn).toBeDefined();
		} finally {
			cleanup();
		}
	});

	test('missing digest subdirectory: reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', lang, '--no-mcp']);
			rmSync(join(dir, DIGEST_DIR[lang]), { recursive: true, force: true });
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(true);
			expect(
				result.checks.some(
					(c) => c.name === `subdirectory: ${DIGEST_DIR[lang]}` && c.status === 'warn',
				),
			).toBe(true);
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

	test('invalid YAML reports failure', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			writeFileSync(join(dir, 'lifeos.yaml'), '{{invalid yaml');
			const result = await doctorCommand([dir]);
			expect(result.passed).toBe(false);
			expect(result.checks.some((c) => c.name === 'lifeos.yaml' && c.status === 'fail')).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('version mismatch reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const yamlPath = join(dir, 'lifeos.yaml');
			const content = readFileSync(yamlPath, 'utf-8');
			writeFileSync(yamlPath, content.replace(/assets: \S+/, 'assets: 0.0.1'));
			const result = await doctorCommand([dir]);
			expect(result.checks.some((c) => c.name === 'assets version' && c.status === 'warn')).toBe(
				true,
			);
		} finally {
			cleanup();
		}
	});

	test('missing template reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			unlinkSync(join(dir, '90_系统', '模板', 'Daily_Template.md'));
			const result = await doctorCommand([dir]);
			expect(
				result.checks.some((c) => c.name.includes('Daily_Template') && c.status === 'warn'),
			).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('missing skills directory reports warning', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			rmSync(join(dir, '.agents'), { recursive: true });
			const result = await doctorCommand([dir]);
			expect(result.checks.some((c) => c.name === '.agents/skills/' && c.status === 'warn')).toBe(
				true,
			);
		} finally {
			cleanup();
		}
	});

	test('Node.js version check always present', async () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			await initCommand([dir, '--lang', 'zh', '--no-mcp']);
			const result = await doctorCommand([dir]);
			expect(result.checks.some((c) => c.name === `Node.js >= ${MIN_NODE_VERSION}`)).toBe(true);
		} finally {
			cleanup();
		}
	});

	test('Node.js version helper enforces the full minimum version', () => {
		expect(isNodeVersionSupported('v24.14.1')).toBe(true);
		expect(isNodeVersionSupported('v24.14.0')).toBe(false);
		expect(isNodeVersionSupported('v24.15.0')).toBe(true);
		expect(isNodeVersionSupported('v25.0.0')).toBe(true);
		expect(isNodeVersionSupported('v23.99.99')).toBe(false);
	});
});
