import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const RESERVED_NAMES = new Set([
	'CON', 'PRN', 'AUX', 'NUL',
	'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
	'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function unsafeComponent(message = 'unsafe_path_component') {
	const error = new Error(message);
	error.code = 'unsafe_path_component';
	return error;
}

function vaultEscape() {
	const error = new Error('vault_escape');
	error.code = 'vault_escape';
	return error;
}

export function normalizeFilenameComponent(value) {
	if (typeof value !== 'string') throw unsafeComponent();
	const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
	if (!normalized || normalized === '.' || normalized === '..') throw unsafeComponent();
	if (/[\\/\u0000-\u001f\u007f]/u.test(normalized)) throw unsafeComponent();
	const basename = normalized.split('.')[0].toUpperCase();
	if (RESERVED_NAMES.has(basename)) throw unsafeComponent();
	return normalized;
}

function assertInside(root, candidate) {
	const relation = relative(root, candidate);
	if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw vaultEscape();
}

function existingAncestor(candidate) {
	let current = candidate;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}

export function resolveVaultPath(vaultRoot, relativePath) {
	if (typeof vaultRoot !== 'string' || !vaultRoot) throw vaultEscape();
	if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) throw vaultEscape();
	const components = relativePath.split(/[\\/]/u);
	if (components.some((component) => component === '' || component === '.' || component === '..' || /[\u0000-\u001f\u007f]/u.test(component))) {
		throw vaultEscape();
	}
	const root = realpathSync(vaultRoot);
	const candidate = resolve(root, ...components.map(normalizeFilenameComponent));
	assertInside(root, candidate);
	const actualAncestor = realpathSync(existingAncestor(candidate));
	assertInside(root, actualAncestor);
	return candidate;
}

function readStdin() {
	return new Promise((resolveInput, reject) => {
		let input = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => { input += chunk; });
		process.stdin.on('end', () => resolveInput(input));
		process.stdin.on('error', reject);
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const input = JSON.parse(await readStdin());
		const result = input.mode === 'normalize'
			? { value: normalizeFilenameComponent(input.value) }
			: { path: resolveVaultPath(input.vault_root, input.relative_path) };
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} catch (error) {
		process.stderr.write(`${JSON.stringify({ error: error.code ?? 'invalid_input', message: error.message })}\n`);
		process.exitCode = 1;
	}
}
