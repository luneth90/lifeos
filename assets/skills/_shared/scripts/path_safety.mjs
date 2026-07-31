import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

const RESERVED_NAMES = new Set([
	'CON',
	'PRN',
	'AUX',
	'NUL',
	'COM1',
	'COM2',
	'COM3',
	'COM4',
	'COM5',
	'COM6',
	'COM7',
	'COM8',
	'COM9',
	'LPT1',
	'LPT2',
	'LPT3',
	'LPT4',
	'LPT5',
	'LPT6',
	'LPT7',
	'LPT8',
	'LPT9',
]);

function codedError(code) {
	const error = new Error(code);
	error.code = code;
	return error;
}

function unsafeComponent() {
	return codedError('unsafe_path_component');
}

function vaultEscape() {
	return codedError('vault_escape');
}

function guardChanged() {
	return codedError('path_guard_changed');
}

function pathNotDirectory() {
	return codedError('path_not_directory');
}

function hasControlCharacters(value) {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code <= 0x1f || code === 0x7f;
	});
}

export function normalizeFilenameComponent(value) {
	if (typeof value !== 'string') throw unsafeComponent();
	if (hasControlCharacters(value)) throw unsafeComponent();
	const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
	if (!normalized || normalized === '.' || normalized === '..') throw unsafeComponent();
	if (/[\\/:<>"|?*]/u.test(normalized) || normalized.endsWith('.')) {
		throw unsafeComponent();
	}
	const basename = normalized
		.split('.')[0]
		.replace(/[ .]+$/u, '')
		.toUpperCase();
	if (RESERVED_NAMES.has(basename)) throw unsafeComponent();
	return normalized;
}

export function validateExistingFilenameComponent(value) {
	if (
		typeof value !== 'string' ||
		hasControlCharacters(value) ||
		value.normalize('NFC') !== value
	) {
		throw unsafeComponent();
	}
	if (normalizeFilenameComponent(value) !== value) throw unsafeComponent();
	return value;
}

function assertInside(root, candidate) {
	const relation = relative(root, candidate);
	if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation))
		throw vaultEscape();
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

function hasAbsoluteOrDeviceSyntax(value) {
	return (
		isAbsolute(value) ||
		win32.isAbsolute(value) ||
		/^[a-z]:/iu.test(value) ||
		/^\\\\[?.]\\/u.test(value) ||
		/^\\\\/u.test(value)
	);
}

function normalizedPath(vaultRoot, relativePath) {
	if (typeof vaultRoot !== 'string' || !vaultRoot) throw vaultEscape();
	if (
		typeof relativePath !== 'string' ||
		!relativePath ||
		hasAbsoluteOrDeviceSyntax(relativePath)
	) {
		throw vaultEscape();
	}
	const components = relativePath.split(/[\\/]/u);
	if (
		components.some(
			(component) =>
				component === '' ||
				component === '.' ||
				component === '..' ||
				hasControlCharacters(component),
		)
	) {
		throw vaultEscape();
	}
	const root = realpathSync(vaultRoot);
	const normalizedComponents = components.map(normalizeFilenameComponent);
	const candidate = resolve(root, ...normalizedComponents);
	assertInside(root, candidate);
	return { root, components: normalizedComponents, candidate };
}

export function resolveVaultPath(vaultRoot, relativePath) {
	const { root, candidate } = normalizedPath(vaultRoot, relativePath);
	const actualAncestor = realpathSync(existingAncestor(candidate));
	assertInside(root, actualAncestor);
	return candidate;
}

function identity(path) {
	const info = statSync(path);
	return { dev: String(info.dev), ino: String(info.ino), realpath: realpathSync(path) };
}

function leafType(info) {
	if (info.isFile()) return 'file';
	if (info.isDirectory()) return 'directory';
	if (info.isBlockDevice()) return 'block_device';
	if (info.isCharacterDevice()) return 'character_device';
	if (info.isFIFO()) return 'fifo';
	if (info.isSocket()) return 'socket';
	return 'other';
}

function captureLeaf(root, candidate, errorFactory) {
	let info;
	try {
		info = lstatSync(candidate);
	} catch (error) {
		if (error?.code === 'ENOENT') return { state: 'missing' };
		throw errorFactory();
	}
	if (info.isSymbolicLink()) throw errorFactory();
	let actualPath;
	try {
		actualPath = realpathSync(candidate);
		assertInside(root, actualPath);
	} catch {
		throw errorFactory();
	}
	return {
		state: 'existing',
		type: leafType(info),
		dev: String(info.dev),
		ino: String(info.ino),
		realpath: actualPath,
	};
}

function captureParentAncestors(root, components, errorFactory) {
	const snapshots = [{ relative_path: '.', ...identity(root) }];
	let current = root;
	for (const component of components.slice(0, -1)) {
		current = join(current, component);
		if (!existsSync(current)) throw errorFactory();
		if (lstatSync(current).isSymbolicLink()) throw errorFactory();
		const snapshot = identity(current);
		assertInside(root, snapshot.realpath);
		if (!statSync(current).isDirectory()) throw errorFactory();
		snapshots.push({ relative_path: relative(root, current).split(sep).join('/'), ...snapshot });
	}
	return snapshots;
}

export function createVaultPathGuard(vaultRoot, relativePath) {
	const { root, components, candidate } = normalizedPath(vaultRoot, relativePath);
	if (lstatSync(root).isSymbolicLink()) throw vaultEscape();
	return {
		contract_version: 1,
		vault_realpath: root,
		relative_path: components.join('/'),
		components,
		candidate_path: candidate,
		ancestors: captureParentAncestors(root, components, vaultEscape),
		leaf: captureLeaf(root, candidate, vaultEscape),
	};
}

function validLeafSnapshot(leaf) {
	if (leaf?.state === 'missing') return true;
	return (
		leaf?.state === 'existing' &&
		typeof leaf.type === 'string' &&
		typeof leaf.dev === 'string' &&
		typeof leaf.ino === 'string' &&
		typeof leaf.realpath === 'string'
	);
}

function sameLeafSnapshot(before, after) {
	if (before.state !== after.state) return false;
	if (before.state === 'missing') return true;
	return (
		before.type === after.type &&
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.realpath === after.realpath
	);
}

function validateGuardBase(guard) {
	if (
		!guard ||
		guard.contract_version !== 1 ||
		!Array.isArray(guard.components) ||
		!Array.isArray(guard.ancestors) ||
		!validLeafSnapshot(guard.leaf)
	) {
		throw guardChanged();
	}
	try {
		const root = realpathSync(guard.vault_realpath);
		if (root !== guard.vault_realpath || lstatSync(root).isSymbolicLink()) throw guardChanged();
		if (guard.components.some((component) => normalizeFilenameComponent(component) !== component))
			throw guardChanged();
		const candidate = resolve(root, ...guard.components);
		if (guard.relative_path !== guard.components.join('/') || guard.candidate_path !== candidate)
			throw guardChanged();
		assertInside(root, candidate);
		const current = captureParentAncestors(root, guard.components, guardChanged);
		if (current.length !== guard.ancestors.length) throw guardChanged();
		for (let index = 0; index < current.length; index += 1) {
			const before = guard.ancestors[index];
			const after = current[index];
			if (
				before.relative_path !== after.relative_path ||
				before.dev !== after.dev ||
				before.ino !== after.ino ||
				before.realpath !== after.realpath
			) {
				throw guardChanged();
			}
		}
		return { root, candidate };
	} catch (error) {
		if (error?.code === 'path_guard_changed') throw error;
		throw guardChanged();
	}
}

export function revalidateVaultPathGuard(guard) {
	const { root, candidate } = validateGuardBase(guard);
	try {
		const currentLeaf = captureLeaf(root, candidate, guardChanged);
		if (!sameLeafSnapshot(guard.leaf, currentLeaf)) throw guardChanged();
		return candidate;
	} catch (error) {
		if (error?.code === 'path_guard_changed') throw error;
		throw guardChanged();
	}
}

export function advanceVaultPathGuard(guard, transition) {
	const { root, candidate } = validateGuardBase(guard);
	try {
		const allowed =
			(transition?.before === 'missing' && transition?.after === 'existing') ||
			(transition?.before === 'existing' && transition?.after === 'missing');
		if (!allowed || guard.leaf.state !== transition.before) throw guardChanged();
		const leaf = captureLeaf(root, candidate, guardChanged);
		if (leaf.state !== transition.after) throw guardChanged();
		return {
			...guard,
			components: [...guard.components],
			ancestors: guard.ancestors.map((ancestor) => ({ ...ancestor })),
			leaf,
		};
	} catch (error) {
		if (error?.code === 'path_guard_changed') throw error;
		throw guardChanged();
	}
}

function assertDirectoryLeaf(leaf, errorFactory = pathNotDirectory) {
	if (leaf?.state !== 'existing' || leaf.type !== 'directory') throw errorFactory();
}

function assertVaultDirectoryRoot(vaultRoot, errorFactory = vaultEscape) {
	try {
		const requestedRoot = resolve(vaultRoot);
		const rootInfo = lstatSync(requestedRoot);
		if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw errorFactory();
		const root = realpathSync(requestedRoot);
		const snapshot = identity(root);
		if (snapshot.realpath !== root) throw errorFactory();
		return { root, snapshot };
	} catch (error) {
		if (error?.code === 'vault_escape' || error?.code === 'path_guard_changed') throw error;
		throw errorFactory();
	}
}

export function createVaultDirectoryGuard(vaultRoot, relativePath) {
	const normalized = normalizedPath(vaultRoot, relativePath);
	const { root, snapshot } = assertVaultDirectoryRoot(vaultRoot);
	if (normalized.root !== root) throw vaultEscape();
	const steps = [];
	let missing = false;
	for (let index = 0; index < normalized.components.length; index += 1) {
		const components = normalized.components.slice(0, index + 1);
		const relativePathStep = components.join('/');
		const candidate = join(root, ...components);
		if (!missing && existsSync(candidate)) {
			const guard = createVaultPathGuard(root, relativePathStep);
			assertDirectoryLeaf(guard.leaf);
			steps.push({ relative_path: relativePathStep, state: 'existing', guard });
			continue;
		}
		missing = true;
		steps.push({ relative_path: relativePathStep, state: 'missing' });
	}
	return {
		contract_version: 1,
		guard_type: 'vault_directory_creation',
		vault_realpath: root,
		root_identity: snapshot,
		relative_path: normalized.components.join('/'),
		components: normalized.components,
		steps,
	};
}

function validateDirectoryGuardBase(directoryGuard) {
	if (
		!directoryGuard ||
		directoryGuard.contract_version !== 1 ||
		directoryGuard.guard_type !== 'vault_directory_creation' ||
		!Array.isArray(directoryGuard.components) ||
		!Array.isArray(directoryGuard.steps) ||
		directoryGuard.steps.length !== directoryGuard.components.length ||
		directoryGuard.relative_path !== directoryGuard.components.join('/')
	) {
		throw guardChanged();
	}
	const { root, snapshot } = assertVaultDirectoryRoot(directoryGuard.vault_realpath, guardChanged);
	if (
		root !== directoryGuard.vault_realpath ||
		snapshot.dev !== directoryGuard.root_identity?.dev ||
		snapshot.ino !== directoryGuard.root_identity?.ino ||
		snapshot.realpath !== directoryGuard.root_identity?.realpath
	) {
		throw guardChanged();
	}
	let sawMissing = false;
	for (let index = 0; index < directoryGuard.steps.length; index += 1) {
		const step = directoryGuard.steps[index];
		const expectedPath = directoryGuard.components.slice(0, index + 1).join('/');
		if (step?.relative_path !== expectedPath || !['existing', 'missing'].includes(step?.state)) {
			throw guardChanged();
		}
		if (step.state === 'missing') sawMissing = true;
		else if (sawMissing || !step.guard) throw guardChanged();
	}
	return root;
}

export function ensureVaultDirectory(directoryGuard, options = {}) {
	const root = validateDirectoryGuardBase(directoryGuard);
	const guards = [];
	const created = [];
	for (const step of directoryGuard.steps) {
		if (step.state === 'existing') {
			revalidateVaultPathGuard(step.guard);
			assertDirectoryLeaf(step.guard.leaf, guardChanged);
			guards.push(step.guard);
			continue;
		}
		let guard;
		try {
			guard = createVaultPathGuard(root, step.relative_path);
			if (guard.leaf.state !== 'missing') throw guardChanged();
			if (typeof options.before_create === 'function') {
				options.before_create({
					relative_path: step.relative_path,
					absolute_path: guard.candidate_path,
				});
			}
			revalidateVaultPathGuard(guard);
			mkdirSync(guard.candidate_path);
			guard = advanceVaultPathGuard(guard, { before: 'missing', after: 'existing' });
			assertDirectoryLeaf(guard.leaf, guardChanged);
			revalidateVaultPathGuard(guard);
		} catch (error) {
			if (error?.code === 'path_guard_changed' || error?.code === 'vault_escape') throw error;
			throw guardChanged();
		}
		created.push(step.relative_path);
		guards.push(guard);
	}
	for (const guard of guards) {
		revalidateVaultPathGuard(guard);
		assertDirectoryLeaf(guard.leaf, guardChanged);
	}
	return {
		path: join(root, ...directoryGuard.components),
		relative_path: directoryGuard.relative_path,
		created,
		guards,
	};
}

function readStdin() {
	return new Promise((resolveInput, reject) => {
		let input = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => {
			input += chunk;
		});
		process.stdin.on('end', () => resolveInput(input));
		process.stdin.on('error', reject);
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const input = JSON.parse(await readStdin());
		let result;
		if (input.mode === 'normalize') result = { value: normalizeFilenameComponent(input.value) };
		else if (input.mode === 'guard')
			result = { guard: createVaultPathGuard(input.vault_root, input.relative_path) };
		else if (input.mode === 'revalidate') result = { path: revalidateVaultPathGuard(input.guard) };
		else if (input.mode === 'advance')
			result = { guard: advanceVaultPathGuard(input.guard, input.transition) };
		else if (input.mode === 'ensure-directory') {
			const directoryGuard = createVaultDirectoryGuard(input.vault_root, input.relative_path);
			const ensured = ensureVaultDirectory(directoryGuard);
			result = { path: ensured.path, created: ensured.created };
		} else if (!Object.hasOwn(input, 'mode')) {
			result = { path: resolveVaultPath(input.vault_root, input.relative_path) };
		} else {
			throw codedError('invalid_mode');
		}
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} catch (error) {
		process.stderr.write(
			`${JSON.stringify({ error: error.code ?? 'invalid_input', message: error.message })}\n`,
		);
		process.exitCode = 1;
	}
}
