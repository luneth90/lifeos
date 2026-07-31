import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
	advanceVaultPathGuard,
	createVaultDirectoryGuard,
	createVaultPathGuard,
	ensureVaultDirectory,
	resolveVaultPath,
	revalidateVaultPathGuard,
	validateExistingFilenameComponent,
} from '../../_shared/scripts/path_safety.mjs';

const ENTITY_TYPES = new Set(['project', 'draft', 'plan', 'diary']);
const MANIFEST_STATUSES = new Set(['in_progress', 'failed', 'complete']);
const REQUIRED_ADAPTERS = [
	'persist_manifest',
	'verify_manifest_receipt',
	'move_with_link_update',
	'memory_notify',
	'confirm_index',
	'memory_forget',
];
const MANIFEST_KEYS = [
	'contract_version',
	'operation',
	'run_id',
	'vault_identity',
	'status',
	'candidates',
	'inventories',
	'candidate_states',
	'moves',
	'collisions',
	'intents',
	'move_receipts',
	'notified',
	'confirmed',
	'forgotten',
	'errors',
];
const MANIFEST_ARRAY_KEYS = [
	'candidates',
	'inventories',
	'candidate_states',
	'moves',
	'collisions',
	'intents',
	'move_receipts',
	'notified',
	'confirmed',
	'forgotten',
	'errors',
];

function codedError(code, cause) {
	const error = new Error(code, cause ? { cause } : undefined);
	error.code = code;
	return error;
}

function codeOf(error, fallback) {
	return typeof error?.code === 'string' ? error.code : fallback;
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
	if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length) return false;
	const ownNames = Object.getOwnPropertyNames(value).sort();
	const keys = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return (
		JSON.stringify(ownNames) === JSON.stringify(wanted) &&
		JSON.stringify(keys) === JSON.stringify(wanted)
	);
}

function assertPlainJson(value) {
	if (value === null || ['string', 'boolean'].includes(typeof value)) return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw codedError('invalid_manifest');
		return;
	}
	if (Array.isArray(value)) {
		if (
			Object.getPrototypeOf(value) !== Array.prototype ||
			Object.getOwnPropertySymbols(value).length ||
			Object.keys(value).length !== value.length
		) {
			throw codedError('invalid_manifest');
		}
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw codedError('invalid_manifest');
			assertPlainJson(descriptor.value);
		}
		return;
	}
	if (!isPlainObject(value)) throw codedError('invalid_manifest');
	if (
		Object.getOwnPropertySymbols(value).length ||
		Object.getOwnPropertyNames(value).length !== Object.keys(value).length
	) {
		throw codedError('invalid_manifest');
	}
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw codedError('invalid_manifest');
		assertPlainJson(descriptor.value);
	}
}

function serializableClone(value) {
	assertPlainJson(value);
	return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueBy(values, keyOf) {
	const seen = new Set();
	for (const value of values) {
		const key = keyOf(value);
		if (seen.has(key)) return false;
		seen.add(key);
	}
	return true;
}

function vaultRelative(root, absolute) {
	const value = relative(root, absolute);
	if (!value || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
		throw codedError('vault_escape');
	}
	return value.split(sep).join('/');
}

function assertCanonicalVaultPath(root, path) {
	if (typeof path !== 'string' || !path) throw codedError('invalid_manifest');
	const absolute = resolveVaultPath(root, path);
	if (vaultRelative(root, absolute) !== path) throw codedError('invalid_manifest');
	return absolute;
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function captureVaultIdentity(vaultRoot) {
	const realpath = realpathSync(vaultRoot);
	const info = statSync(realpath, { bigint: true });
	if (!info.isDirectory()) throw codedError('invalid_vault_root');
	return {
		realpath,
		root_dev: info.dev.toString(10),
		root_ino: info.ino.toString(10),
	};
}

function validateVaultIdentitySchema(identity) {
	if (
		!hasExactKeys(identity, ['realpath', 'root_dev', 'root_ino']) ||
		typeof identity.realpath !== 'string' ||
		!isAbsolute(identity.realpath) ||
		typeof identity.root_dev !== 'string' ||
		!/^\d+$/u.test(identity.root_dev) ||
		typeof identity.root_ino !== 'string' ||
		!/^\d+$/u.test(identity.root_ino)
	) {
		throw codedError('invalid_manifest');
	}
}

function assertVaultIdentity(current, expected) {
	validateVaultIdentitySchema(expected);
	if (!sameValue(current, expected)) throw codedError('vault_identity_mismatch');
}

function assertFrozenVaultIdentity(vaultRoot, expected) {
	try {
		assertVaultIdentity(captureVaultIdentity(vaultRoot), expected);
	} catch (error) {
		throw codedError('vault_identity_mismatch', error);
	}
}

function stableKey(vaultIdentity, runId, step, ...parts) {
	return `${runId}:${step}:${hash(
		JSON.stringify({ vault_identity: vaultIdentity, run_id: runId, step, parts }),
	).slice(0, 20)}`;
}

function pathExists(path) {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

function safeEntryType(path) {
	const info = lstatSync(path);
	if (info.isSymbolicLink()) throw codedError('unsafe_archive_symlink');
	if (info.isFile()) return 'file';
	if (info.isDirectory()) return 'directory';
	throw codedError('unsupported_archive_entry');
}

function normalizeCandidate(vaultRoot, vaultIdentity, runId, candidate) {
	if (!isPlainObject(candidate)) throw codedError('invalid_candidate');
	if (!ENTITY_TYPES.has(candidate.entity_type)) throw codedError('invalid_entity_type');
	const expectedKeys =
		candidate.entity_type === 'project'
			? ['source_path', 'target_path', 'entity_type', 'project_id']
			: ['source_path', 'target_path', 'entity_type'];
	if (!hasExactKeys(candidate, expectedKeys)) throw codedError('invalid_candidate');
	if (
		candidate.entity_type === 'project' &&
		(typeof candidate.project_id !== 'string' || !candidate.project_id)
	) {
		throw codedError('missing_project_id');
	}
	const sourceAbsolute = resolveVaultPath(vaultRoot, candidate.source_path);
	const targetAbsolute = resolveVaultPath(vaultRoot, candidate.target_path);
	const root = realpathSync(vaultRoot);
	const normalized = {
		source_path: vaultRelative(root, sourceAbsolute),
		target_path: vaultRelative(root, targetAbsolute),
		entity_type: candidate.entity_type,
		...(candidate.entity_type === 'project' ? { project_id: candidate.project_id } : {}),
	};
	if (normalized.source_path === normalized.target_path) throw codedError('source_equals_target');
	return {
		...normalized,
		vault_identity: vaultIdentity,
		candidate_key: stableKey(vaultIdentity, runId, 'candidate', normalized),
		source_absolute: sourceAbsolute,
		target_absolute: targetAbsolute,
	};
}

function pathContains(parent, child) {
	return child.startsWith(`${parent}/`);
}

function pathsOverlap(left, right) {
	return left === right || pathContains(left, right) || pathContains(right, left);
}

function validateCandidateSet(candidates) {
	for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
		const left = candidates[leftIndex];
		if (pathsOverlap(left.source_path, left.target_path)) {
			throw codedError('candidate_path_overlap');
		}
		for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
			const right = candidates[rightIndex];
			for (const leftPath of [left.source_path, left.target_path]) {
				for (const rightPath of [right.source_path, right.target_path]) {
					if (pathsOverlap(leftPath, rightPath)) throw codedError('candidate_path_overlap');
				}
			}
		}
	}
}

function validateArchiveComponent(value) {
	try {
		validateExistingFilenameComponent(value);
	} catch (error) {
		throw codedError('unsafe_archive_component', error);
	}
}

function captureInventory(candidate, location) {
	const absoluteBase =
		location === 'source' ? candidate.source_absolute : candidate.target_absolute;
	const entryType = safeEntryType(absoluteBase);
	const files = [];
	const directories = [];
	const visit = (absolute, suffix) => {
		const type = safeEntryType(absolute);
		if (type === 'directory') {
			directories.push(suffix);
			const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
				left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
			);
			for (const entry of entries) {
				validateArchiveComponent(entry.name);
				visit(join(absolute, entry.name), suffix ? `${suffix}/${entry.name}` : entry.name);
			}
			return;
		}
		const bytes = readFileSync(absolute);
		files.push({
			source_path: suffix ? `${candidate.source_path}/${suffix}` : candidate.source_path,
			target_path: suffix ? `${candidate.target_path}/${suffix}` : candidate.target_path,
			size: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		});
	};
	visit(absoluteBase, '');
	return {
		candidate_key: candidate.candidate_key,
		source_path: candidate.source_path,
		target_path: candidate.target_path,
		entry_type: entryType,
		files,
		directories,
	};
}

function captureGuardedInventory(vaultRoot, candidate, location) {
	const path = location === 'source' ? candidate.source_path : candidate.target_path;
	const guard = createVaultPathGuard(vaultRoot, path);
	if (guard.leaf.state !== 'existing') throw codedError(`${location}_missing`);
	revalidateVaultPathGuard(guard);
	const inventory = captureInventory(candidate, location);
	revalidateVaultPathGuard(guard);
	return { inventory, guard };
}

function comparableInventory(inventory) {
	return {
		candidate_key: inventory.candidate_key,
		source_path: inventory.source_path,
		target_path: inventory.target_path,
		entry_type: inventory.entry_type,
		files: inventory.files,
		directories: inventory.directories,
	};
}

function assertInventoryMatch(observed, frozen) {
	if (!sameValue(comparableInventory(observed), comparableInventory(frozen))) {
		throw codedError('inventory_mismatch');
	}
}

function validateBusinessShape(candidate, inventory) {
	if (candidate.entity_type !== 'project' && inventory.entry_type !== 'file') {
		throw codedError('invalid_candidate_shape');
	}
	if (candidate.entity_type === 'project' && inventory.files.length === 0) {
		throw codedError('empty_project');
	}
}

function publicCandidate(candidate) {
	return {
		candidate_key: candidate.candidate_key,
		vault_identity: candidate.vault_identity,
		source_path: candidate.source_path,
		target_path: candidate.target_path,
		entity_type: candidate.entity_type,
		...(candidate.entity_type === 'project' ? { project_id: candidate.project_id } : {}),
	};
}

function createManifest(runId, candidates, vaultIdentity) {
	return {
		contract_version: 2,
		operation: 'archive',
		run_id: runId,
		vault_identity: vaultIdentity,
		status: 'in_progress',
		candidates: candidates.map(publicCandidate),
		inventories: [],
		candidate_states: candidates.map((candidate) => ({
			candidate_key: candidate.candidate_key,
			move_started: false,
			moved: false,
		})),
		moves: [],
		collisions: [],
		intents: [],
		move_receipts: [],
		notified: [],
		confirmed: [],
		forgotten: [],
		errors: [],
	};
}

function manifestState(manifest, candidateKey) {
	const state = manifest.candidate_states.find((item) => item.candidate_key === candidateKey);
	if (!state) throw codedError('invalid_manifest');
	return state;
}

function manifestInventory(manifest, candidateKey) {
	return manifest.inventories.find((item) => item.candidate_key === candidateKey) ?? null;
}

function moveRecords(vaultIdentity, runId, inventory) {
	return inventory.files.map((file) => ({
		candidate_key: inventory.candidate_key,
		vault_identity: vaultIdentity,
		source_path: file.source_path,
		target_path: file.target_path,
		move_id: stableKey(vaultIdentity, runId, 'file', file.source_path, file.target_path),
	}));
}

function moveIdempotencyKey(vaultIdentity, runId, candidateKey) {
	return stableKey(vaultIdentity, runId, 'move', candidateKey);
}

function notifyIdempotencyKey(vaultIdentity, runId, moveId) {
	return stableKey(vaultIdentity, runId, 'memory_notify', moveId);
}

function confirmIdempotencyKey(vaultIdentity, runId, moveId) {
	return stableKey(vaultIdentity, runId, 'confirm_index', moveId);
}

function forgetIdempotencyKey(vaultIdentity, runId, projectId) {
	return stableKey(vaultIdentity, runId, 'memory_forget', projectId);
}

function assertString(value) {
	if (typeof value !== 'string' || !value) throw codedError('invalid_manifest');
}

function validateInventorySchema(vaultRoot, inventory, candidate) {
	if (
		!hasExactKeys(inventory, [
			'candidate_key',
			'source_path',
			'target_path',
			'entry_type',
			'files',
			'directories',
		]) ||
		inventory.candidate_key !== candidate.candidate_key ||
		inventory.source_path !== candidate.source_path ||
		inventory.target_path !== candidate.target_path ||
		!['file', 'directory'].includes(inventory.entry_type) ||
		!Array.isArray(inventory.files) ||
		!Array.isArray(inventory.directories)
	) {
		throw codedError('invalid_manifest');
	}
	assertCanonicalVaultPath(vaultRoot, inventory.source_path);
	assertCanonicalVaultPath(vaultRoot, inventory.target_path);
	if (!uniqueBy(inventory.files, (file) => file.source_path)) throw codedError('invalid_manifest');
	for (const file of inventory.files) {
		if (
			!hasExactKeys(file, ['source_path', 'target_path', 'size', 'sha256']) ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			typeof file.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(file.sha256)
		) {
			throw codedError('invalid_manifest');
		}
		assertCanonicalVaultPath(vaultRoot, file.source_path);
		assertCanonicalVaultPath(vaultRoot, file.target_path);
		const sourceSuffix =
			file.source_path === candidate.source_path
				? ''
				: file.source_path.startsWith(`${candidate.source_path}/`)
					? file.source_path.slice(candidate.source_path.length + 1)
					: null;
		const targetSuffix =
			file.target_path === candidate.target_path
				? ''
				: file.target_path.startsWith(`${candidate.target_path}/`)
					? file.target_path.slice(candidate.target_path.length + 1)
					: null;
		if (sourceSuffix === null || sourceSuffix !== targetSuffix)
			throw codedError('invalid_manifest');
		for (const component of sourceSuffix ? sourceSuffix.split('/') : []) {
			validateArchiveComponent(component);
		}
	}
	if (!uniqueBy(inventory.directories, (path) => path)) throw codedError('invalid_manifest');
	for (const directory of inventory.directories) {
		if (typeof directory !== 'string') throw codedError('invalid_manifest');
		for (const component of directory ? directory.split('/') : []) {
			validateArchiveComponent(component);
		}
	}
	if (
		(inventory.entry_type === 'file' &&
			(inventory.files.length !== 1 || inventory.directories.length !== 0)) ||
		(inventory.entry_type === 'directory' && !inventory.directories.includes(''))
	) {
		throw codedError('invalid_manifest');
	}
	validateBusinessShape(candidate, inventory);
}

function expectedIntent(vaultIdentity, runId, effectType, reference) {
	if (effectType === 'move') {
		return {
			effect_type: 'move',
			effect_key: reference.candidate_key,
			vault_identity: vaultIdentity,
			idempotency_key: moveIdempotencyKey(vaultIdentity, runId, reference.candidate_key),
		};
	}
	if (effectType === 'memory_notify') {
		return {
			effect_type: 'memory_notify',
			effect_key: reference.move_id,
			vault_identity: vaultIdentity,
			idempotency_key: notifyIdempotencyKey(vaultIdentity, runId, reference.move_id),
		};
	}
	if (effectType === 'confirm_index') {
		return {
			effect_type: 'confirm_index',
			effect_key: reference.move_id,
			vault_identity: vaultIdentity,
			idempotency_key: confirmIdempotencyKey(vaultIdentity, runId, reference.move_id),
		};
	}
	return {
		effect_type: 'memory_forget',
		effect_key: reference.project_id,
		vault_identity: vaultIdentity,
		idempotency_key: forgetIdempotencyKey(vaultIdentity, runId, reference.project_id),
	};
}

function validateResumeManifest(manifest, runId, candidates, vaultRoot, vaultIdentity) {
	assertPlainJson(manifest);
	if (!hasExactKeys(manifest, MANIFEST_KEYS)) throw codedError('invalid_manifest');
	if (manifest.run_id !== runId) throw codedError('run_id_mismatch');
	assertVaultIdentity(vaultIdentity, manifest.vault_identity);
	if (
		manifest.contract_version !== 2 ||
		manifest.operation !== 'archive' ||
		!MANIFEST_STATUSES.has(manifest.status)
	) {
		throw codedError('invalid_manifest');
	}
	for (const key of MANIFEST_ARRAY_KEYS) {
		if (!Array.isArray(manifest[key])) throw codedError('invalid_manifest');
	}
	const expectedCandidates = candidates.map(publicCandidate);
	if (!sameValue(manifest.candidates, expectedCandidates))
		throw codedError('candidate_set_mismatch');
	if (
		manifest.candidate_states.length !== candidates.length ||
		!uniqueBy(manifest.candidate_states, (state) => state.candidate_key)
	) {
		throw codedError('invalid_manifest');
	}
	for (let index = 0; index < candidates.length; index += 1) {
		const state = manifest.candidate_states[index];
		if (
			!hasExactKeys(state, ['candidate_key', 'move_started', 'moved']) ||
			state.candidate_key !== candidates[index].candidate_key ||
			typeof state.move_started !== 'boolean' ||
			typeof state.moved !== 'boolean' ||
			(state.moved && !state.move_started)
		) {
			throw codedError('invalid_manifest');
		}
	}
	if (!uniqueBy(manifest.inventories, (inventory) => inventory.candidate_key)) {
		throw codedError('invalid_manifest');
	}
	for (const inventory of manifest.inventories) {
		const candidate = candidates.find((item) => item.candidate_key === inventory.candidate_key);
		if (!candidate) throw codedError('invalid_manifest');
		validateInventorySchema(vaultRoot, inventory, candidate);
	}
	const expectedMoves = [];
	for (const candidate of candidates) {
		const state = manifestState(manifest, candidate.candidate_key);
		const inventory = manifestInventory(manifest, candidate.candidate_key);
		if (state.move_started && !inventory) throw codedError('invalid_manifest');
		if (state.moved) expectedMoves.push(...moveRecords(vaultIdentity, runId, inventory));
	}
	if (!sameValue(manifest.moves, expectedMoves)) throw codedError('invalid_manifest');
	if (!uniqueBy(manifest.moves, (move) => move.move_id)) throw codedError('invalid_manifest');
	for (const move of manifest.moves) {
		if (
			!hasExactKeys(move, [
				'candidate_key',
				'vault_identity',
				'source_path',
				'target_path',
				'move_id',
			]) ||
			!sameValue(move.vault_identity, vaultIdentity)
		) {
			throw codedError('invalid_manifest');
		}
	}
	if (!uniqueBy(manifest.collisions, (item) => `${item.source_path}\n${item.target_path}`)) {
		throw codedError('invalid_manifest');
	}
	for (const collision of manifest.collisions) {
		if (
			!hasExactKeys(collision, ['source_path', 'target_path', 'code']) ||
			collision.code !== 'target_collision'
		) {
			throw codedError('invalid_manifest');
		}
		assertCanonicalVaultPath(vaultRoot, collision.source_path);
		assertCanonicalVaultPath(vaultRoot, collision.target_path);
	}
	if (!uniqueBy(manifest.intents, (intent) => `${intent.effect_type}\n${intent.effect_key}`)) {
		throw codedError('invalid_manifest');
	}
	for (const intent of manifest.intents) {
		if (
			!hasExactKeys(intent, ['effect_type', 'effect_key', 'vault_identity', 'idempotency_key']) ||
			!sameValue(intent.vault_identity, vaultIdentity)
		) {
			throw codedError('invalid_manifest');
		}
		let reference;
		if (intent.effect_type === 'move') {
			reference = candidates.find((candidate) => candidate.candidate_key === intent.effect_key);
		} else if (['memory_notify', 'confirm_index'].includes(intent.effect_type)) {
			reference = manifest.moves.find((move) => move.move_id === intent.effect_key);
		} else if (intent.effect_type === 'memory_forget') {
			reference = { project_id: intent.effect_key };
			if (
				!candidates.some(
					(candidate) =>
						candidate.entity_type === 'project' && candidate.project_id === intent.effect_key,
				)
			) {
				throw codedError('invalid_manifest');
			}
		} else {
			throw codedError('invalid_manifest');
		}
		if (
			!reference ||
			!sameValue(intent, expectedIntent(vaultIdentity, runId, intent.effect_type, reference))
		) {
			throw codedError('invalid_manifest');
		}
	}
	if (!uniqueBy(manifest.move_receipts, (item) => item.candidate_key)) {
		throw codedError('invalid_manifest');
	}
	for (const item of manifest.move_receipts) {
		if (!hasExactKeys(item, ['candidate_key', 'idempotency_key', 'receipt'])) {
			throw codedError('invalid_manifest');
		}
		const candidate = candidates.find((value) => value.candidate_key === item.candidate_key);
		if (
			!candidate ||
			item.idempotency_key !== moveIdempotencyKey(vaultIdentity, runId, candidate.candidate_key) ||
			typeof item.receipt !== 'string' ||
			!item.receipt ||
			!manifest.intents.some((intent) =>
				sameValue(intent, expectedIntent(vaultIdentity, runId, 'move', candidate)),
			)
		) {
			throw codedError('invalid_manifest');
		}
	}
	const movedCandidateKeys = manifest.candidate_states
		.filter((state) => state.moved)
		.map((state) => state.candidate_key);
	if (
		!sameValue(
			manifest.move_receipts.map((item) => item.candidate_key),
			movedCandidateKeys,
		)
	) {
		throw codedError('invalid_manifest');
	}
	for (const state of manifest.candidate_states) {
		const candidate = candidates.find((item) => item.candidate_key === state.candidate_key);
		const hasMoveIntent = manifest.intents.some((intent) =>
			sameValue(intent, expectedIntent(vaultIdentity, runId, 'move', candidate)),
		);
		if (hasMoveIntent !== state.move_started) throw codedError('invalid_manifest');
	}
	for (const [key, effectType, receiptKey] of [
		['notified', 'memory_notify', notifyIdempotencyKey],
		['confirmed', 'confirm_index', confirmIdempotencyKey],
	]) {
		if (!uniqueBy(manifest[key], (item) => item.move_id)) throw codedError('invalid_manifest');
		for (const item of manifest[key]) {
			if (!hasExactKeys(item, ['move_id', 'idempotency_key', 'receipt'])) {
				throw codedError('invalid_manifest');
			}
			const move = manifest.moves.find((value) => value.move_id === item.move_id);
			if (
				!move ||
				item.idempotency_key !== receiptKey(vaultIdentity, runId, item.move_id) ||
				typeof item.receipt !== 'string' ||
				!item.receipt ||
				!manifest.intents.some((intent) =>
					sameValue(intent, expectedIntent(vaultIdentity, runId, effectType, move)),
				)
			) {
				throw codedError('invalid_manifest');
			}
		}
	}
	const notifiedIds = new Set(manifest.notified.map((item) => item.move_id));
	if (manifest.confirmed.some((item) => !notifiedIds.has(item.move_id))) {
		throw codedError('invalid_manifest');
	}
	if (!uniqueBy(manifest.forgotten, (item) => item.project_id))
		throw codedError('invalid_manifest');
	for (const item of manifest.forgotten) {
		if (!hasExactKeys(item, ['project_id', 'idempotency_key', 'receipt'])) {
			throw codedError('invalid_manifest');
		}
		const expected = expectedIntent(vaultIdentity, runId, 'memory_forget', item);
		if (
			item.idempotency_key !== expected.idempotency_key ||
			typeof item.receipt !== 'string' ||
			!item.receipt ||
			!manifest.intents.some((intent) => sameValue(intent, expected))
		) {
			throw codedError('invalid_manifest');
		}
		const candidateKeys = new Set(
			candidates
				.filter(
					(candidate) =>
						candidate.entity_type === 'project' && candidate.project_id === item.project_id,
				)
				.map((candidate) => candidate.candidate_key),
		);
		const relevant = manifest.moves.filter((move) => candidateKeys.has(move.candidate_key));
		const confirmed = new Set(manifest.confirmed.map((record) => record.move_id));
		if (!relevant.length || relevant.some((move) => !confirmed.has(move.move_id))) {
			throw codedError('invalid_manifest');
		}
	}
	if (!uniqueBy(manifest.errors, (error) => JSON.stringify(error)))
		throw codedError('invalid_manifest');
	for (const error of manifest.errors) {
		if (!hasExactKeys(error, ['step', 'path', 'code', 'recovery_action', 'side_effect_state'])) {
			throw codedError('invalid_manifest');
		}
		for (const key of ['step', 'path', 'code', 'recovery_action', 'side_effect_state']) {
			assertString(error[key]);
		}
	}
	if (manifest.status === 'complete') {
		const confirmed = new Set(manifest.confirmed.map((item) => item.move_id));
		const forgotten = new Set(manifest.forgotten.map((item) => item.project_id));
		const projectIds = new Set(
			candidates
				.filter((candidate) => candidate.entity_type === 'project')
				.map((candidate) => candidate.project_id),
		);
		if (
			manifest.candidate_states.some((state) => !state.moved) ||
			manifest.moves.some((move) => !confirmed.has(move.move_id)) ||
			manifest.collisions.length ||
			[...projectIds].some((projectId) => !forgotten.has(projectId))
		) {
			throw codedError('invalid_manifest');
		}
	}
	if (manifest.status === 'failed' && !manifest.errors.length) throw codedError('invalid_manifest');
}

function validateResumeEnvelope(envelope, runId, candidates, vaultRoot, vaultIdentity) {
	assertPlainJson(envelope);
	if (
		!hasExactKeys(envelope, ['manifest', 'persistence_receipt', 'persistence_state']) ||
		envelope.persistence_state !== 'verified' ||
		typeof envelope.persistence_receipt !== 'string' ||
		!envelope.persistence_receipt
	) {
		throw codedError('invalid_manifest_envelope');
	}
	validateResumeManifest(envelope.manifest, runId, candidates, vaultRoot, vaultIdentity);
}

function requireAdapters(adapters) {
	for (const name of REQUIRED_ADAPTERS) {
		if (typeof adapters?.[name] !== 'function') throw codedError(`missing_adapter_${name}`);
	}
}

function bindAdaptersToVaultIdentity(adapters, vaultRoot, vaultIdentity) {
	const bound = { ...adapters };
	for (const name of REQUIRED_ADAPTERS) {
		const callback = adapters[name];
		bound[name] = async (...args) => {
			assertFrozenVaultIdentity(vaultRoot, vaultIdentity);
			try {
				return await callback.apply(adapters, args);
			} finally {
				assertFrozenVaultIdentity(vaultRoot, vaultIdentity);
			}
		};
	}
	return bound;
}

function validReceiptResult(value) {
	return (
		hasExactKeys(value, ['ok', 'receipt']) &&
		value.ok === true &&
		typeof value.receipt === 'string' &&
		Boolean(value.receipt)
	);
}

function validConfirmResult(value) {
	return (
		hasExactKeys(value, ['ok', 'confirmed', 'receipt']) &&
		value.ok === true &&
		typeof value.confirmed === 'boolean' &&
		typeof value.receipt === 'string' &&
		Boolean(value.receipt)
	);
}

function validVerifyResult(value) {
	return (
		hasExactKeys(value, ['ok', 'verified']) &&
		value.ok === true &&
		typeof value.verified === 'boolean'
	);
}

function envelope(manifest, receipt, state) {
	return {
		manifest: serializableClone(manifest),
		persistence_receipt: receipt,
		persistence_state: state,
	};
}

async function tryPersist(manifest, adapters) {
	try {
		const snapshot = serializableClone(manifest);
		const vaultIdentity = serializableClone(manifest.vault_identity);
		const payload = { manifest: snapshot, vault_identity: vaultIdentity };
		const expected = JSON.stringify(payload);
		const result = await adapters.persist_manifest(payload);
		if (JSON.stringify(payload) !== expected) return { ok: false, code: 'adapter_result_invalid' };
		if (!validReceiptResult(result)) return { ok: false, code: 'adapter_result_invalid' };
		return { ok: true, receipt: result.receipt };
	} catch (error) {
		return { ok: false, code: codeOf(error, 'persist_manifest_failed') };
	}
}

function appendError(manifest, error) {
	if (!manifest.errors.some((existing) => sameValue(existing, error))) manifest.errors.push(error);
}

function errorRecord({ step, path, code, recovery_action, side_effect_state = 'none' }) {
	return { step, path, code, recovery_action, side_effect_state };
}

async function fail(manifest, adapters, details) {
	manifest.status = 'failed';
	appendError(manifest, errorRecord(details));
	const persisted = await tryPersist(manifest, adapters);
	if (persisted.ok) return envelope(manifest, persisted.receipt, 'verified');
	appendError(
		manifest,
		errorRecord({
			step: 'persist_manifest',
			path: manifest.run_id,
			code: persisted.code,
			recovery_action: 'manual_recovery_required',
			side_effect_state: details.side_effect_state ?? 'unknown',
		}),
	);
	return envelope(manifest, null, 'unverified');
}

async function persistOrFail(manifest, adapters, sideEffectState = 'none') {
	const persisted = await tryPersist(manifest, adapters);
	if (persisted.ok) return { ok: true, receipt: persisted.receipt };
	manifest.status = 'failed';
	appendError(
		manifest,
		errorRecord({
			step: 'persist_manifest',
			path: manifest.run_id,
			code: persisted.code,
			recovery_action: 'manual_recovery_required',
			side_effect_state: sideEffectState,
		}),
	);
	return { ok: false, result: envelope(manifest, null, 'unverified') };
}

function ensureIntent(manifest, intent) {
	const existing = manifest.intents.find(
		(item) => item.effect_type === intent.effect_type && item.effect_key === intent.effect_key,
	);
	if (existing && !sameValue(existing, intent)) throw codedError('invalid_manifest');
	if (!existing) manifest.intents.push(intent);
}

function targetStable(vaultRoot, item) {
	revalidateVaultPathGuard(item.target_guard);
	const observed = captureInventory(item.candidate, 'target');
	revalidateVaultPathGuard(item.target_guard);
	assertInventoryMatch(observed, item.inventory);
}

function advancedTargetsStable(vaultRoot, prepared) {
	const vaultIdentity = prepared[0]?.candidate?.vault_identity;
	if (!vaultIdentity) throw codedError('vault_identity_mismatch');
	assertFrozenVaultIdentity(vaultRoot, vaultIdentity);
	for (const item of prepared) {
		if (item.target_guard) targetStable(vaultRoot, item);
	}
}

function addMoveRecords(manifest, vaultIdentity, runId, inventory) {
	for (const move of moveRecords(vaultIdentity, runId, inventory)) {
		if (!manifest.moves.some((existing) => existing.move_id === move.move_id)) {
			manifest.moves.push(move);
		}
	}
}

function untrustedResumeFailure(runId, candidates, vaultIdentity, code, step) {
	const manifest = createManifest(runId, candidates, vaultIdentity);
	manifest.status = 'failed';
	appendError(
		manifest,
		errorRecord({
			step,
			path: runId,
			code,
			recovery_action: 'manual_recovery_required',
			side_effect_state: 'resume_not_started',
		}),
	);
	return envelope(manifest, null, 'unverified');
}

/**
 * 执行可恢复的 Archive 文件系统事务。外部适配器是持久化、认证与幂等边界。
 * 本模块不承诺 exactly-once、跨系统原子性，亦不能消除最终复核到系统调用的竞态。
 */
export async function runArchiveTransaction({
	vault_root,
	run_id,
	candidates: requestedCandidates,
	manifest: resumeEnvelope,
	adapters,
}) {
	if (typeof run_id !== 'string' || !run_id) throw codedError('invalid_run_id');
	if (!Array.isArray(requestedCandidates) || !requestedCandidates.length) {
		throw codedError('invalid_candidates');
	}
	requireAdapters(adapters);
	const vaultIdentity = captureVaultIdentity(vault_root);
	const vaultRoot = vaultIdentity.realpath;
	adapters = bindAdaptersToVaultIdentity(adapters, vaultRoot, vaultIdentity);
	const candidates = requestedCandidates.map((candidate) =>
		normalizeCandidate(vaultRoot, vaultIdentity, run_id, candidate),
	);
	validateCandidateSet(candidates);
	let manifest;
	if (resumeEnvelope !== undefined) {
		try {
			validateResumeEnvelope(resumeEnvelope, run_id, candidates, vaultRoot, vaultIdentity);
		} catch (error) {
			return untrustedResumeFailure(
				run_id,
				candidates,
				vaultIdentity,
				codeOf(error, 'invalid_manifest'),
				'resume_validation',
			);
		}
		let verification;
		try {
			const verificationManifest = serializableClone(resumeEnvelope.manifest);
			const verificationPayload = {
				manifest: verificationManifest,
				persistence_receipt: resumeEnvelope.persistence_receipt,
				vault_identity: serializableClone(vaultIdentity),
			};
			const expectedVerificationPayload = JSON.stringify(verificationPayload);
			verification = await adapters.verify_manifest_receipt(verificationPayload);
			assertVaultIdentity(captureVaultIdentity(vault_root), vaultIdentity);
			if (JSON.stringify(verificationPayload) !== expectedVerificationPayload) {
				return untrustedResumeFailure(
					run_id,
					candidates,
					vaultIdentity,
					'adapter_result_invalid',
					'verify_manifest_receipt',
				);
			}
		} catch (error) {
			return untrustedResumeFailure(
				run_id,
				candidates,
				vaultIdentity,
				codeOf(error, 'verify_failed'),
				'verify_manifest_receipt',
			);
		}
		if (!validVerifyResult(verification)) {
			return untrustedResumeFailure(
				run_id,
				candidates,
				vaultIdentity,
				'adapter_result_invalid',
				'verify_manifest_receipt',
			);
		}
		if (!verification.verified) {
			return untrustedResumeFailure(
				run_id,
				candidates,
				vaultIdentity,
				'manifest_receipt_invalid',
				'verify_manifest_receipt',
			);
		}
		manifest = serializableClone(resumeEnvelope.manifest);
	} else {
		manifest = createManifest(run_id, candidates, vaultIdentity);
	}
	manifest.status = 'in_progress';
	manifest.collisions = [];

	const prepared = [];
	for (const candidate of candidates) {
		const state = manifestState(manifest, candidate.candidate_key);
		const frozen = manifestInventory(manifest, candidate.candidate_key);
		const moveReceipt = manifest.move_receipts.find(
			(item) => item.candidate_key === candidate.candidate_key,
		);
		const sourceExists = pathExists(candidate.source_absolute);
		const targetExists = pathExists(candidate.target_absolute);
		let mode;
		if (sourceExists && targetExists) {
			if (resumeEnvelope !== undefined && (state.move_started || state.moved || moveReceipt)) {
				throw codedError('resume_source_restored');
			}
			manifest.collisions.push({
				source_path: candidate.source_path,
				target_path: candidate.target_path,
				code: 'target_collision',
			});
			continue;
		}
		if (sourceExists) {
			if (resumeEnvelope !== undefined && (state.moved || moveReceipt)) {
				throw codedError('resume_source_restored');
			}
			mode = 'move';
		} else if (targetExists) {
			if (!frozen || !state.moved || !moveReceipt) {
				return fail(manifest, adapters, {
					step: 'preflight',
					path: candidate.target_path,
					code: 'untrusted_moved_state',
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'target_exists_source_missing',
				});
			}
			mode = 'resume';
		} else {
			return fail(manifest, adapters, {
				step: 'preflight',
				path: candidate.source_path,
				code: 'source_missing',
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'none',
			});
		}
		const targetParent = dirname(candidate.target_path).split(sep).join('/');
		prepared.push({ candidate, state, frozen, mode, targetParent, target_guard: null });
	}

	if (manifest.collisions.length) {
		return fail(manifest, adapters, {
			step: 'preflight',
			path: manifest.collisions[0].target_path,
			code: 'collision_preflight',
			recovery_action: 'resolve_collision_then_resume_same_run_id',
			side_effect_state: 'none',
		});
	}
	const targetParents = [
		...new Set(
			prepared
				.filter((item) => item.mode === 'move' && item.targetParent !== '.')
				.map((item) => item.targetParent),
		),
	].sort(
		(left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
	);
	for (const targetParent of targetParents) {
		try {
			advancedTargetsStable(vaultRoot, prepared);
			const directoryGuard = createVaultDirectoryGuard(vaultRoot, targetParent);
			ensureVaultDirectory(directoryGuard);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'create_target_parent',
				path: targetParent,
				code: codeOf(error, 'directory_create_failed'),
				recovery_action: 'inspect_target_parent_then_resume_same_run_id',
				side_effect_state: 'target_directories_may_exist',
			});
		}
	}
	for (const item of prepared) {
		try {
			advancedTargetsStable(vaultRoot, prepared);
			const observed = captureGuardedInventory(
				vaultRoot,
				item.candidate,
				item.mode === 'move' ? 'source' : 'target',
			).inventory;
			validateBusinessShape(item.candidate, observed);
			if (item.frozen) assertInventoryMatch(observed, item.frozen);
			else manifest.inventories.push(serializableClone(observed));
			item.inventory = item.frozen ?? observed;
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'freeze_inventory',
				path: item.candidate.source_path,
				code: codeOf(error, 'inventory_failed'),
				recovery_action: 'inspect_candidate_then_resume_same_run_id',
				side_effect_state: 'target_directories_may_exist',
			});
		}
	}
	let persisted = await persistOrFail(manifest, adapters);
	if (!persisted.ok) return persisted.result;
	advancedTargetsStable(vaultRoot, prepared);

	for (const item of prepared) {
		const { candidate, inventory, state } = item;
		if (item.mode === 'move') {
			const moveIntent = expectedIntent(vaultIdentity, run_id, 'move', candidate);
			ensureIntent(manifest, moveIntent);
			state.move_started = true;
			persisted = await persistOrFail(manifest, adapters);
			if (!persisted.ok) return persisted.result;
			try {
				advancedTargetsStable(vaultRoot, prepared);
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'target_changed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'prior_move_target_changed',
				});
			}
			let sourceGuard;
			let targetGuard;
			try {
				advancedTargetsStable(vaultRoot, prepared);
				const observed = captureGuardedInventory(vaultRoot, candidate, 'source').inventory;
				assertInventoryMatch(observed, inventory);
				sourceGuard = createVaultPathGuard(vaultRoot, candidate.source_path);
				targetGuard = createVaultPathGuard(vaultRoot, candidate.target_path);
				if (sourceGuard.leaf.state !== 'existing') throw codedError('source_missing');
				if (targetGuard.leaf.state !== 'missing') throw codedError('target_collision');
				revalidateVaultPathGuard(sourceGuard);
				revalidateVaultPathGuard(targetGuard);
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'move_precondition_failed'),
					recovery_action: 'inspect_filesystem_then_resume_same_run_id',
					side_effect_state: 'none',
				});
			}
			let movePromise;
			try {
				revalidateVaultPathGuard(sourceGuard);
				revalidateVaultPathGuard(targetGuard);
				movePromise = adapters.move_with_link_update({
					vault_root: vaultRoot,
					vault_identity: serializableClone(vaultIdentity),
					source_path: candidate.source_path,
					target_path: candidate.target_path,
					entry_type: inventory.entry_type,
					idempotency_key: moveIntent.idempotency_key,
				});
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'move_failed'),
					recovery_action: 'inspect_filesystem_then_resume_same_run_id',
					side_effect_state: 'move_may_have_started',
				});
			}
			let moveResult;
			try {
				moveResult = await movePromise;
			} catch (error) {
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (revalidationError) {
					return fail(manifest, adapters, {
						step: 'move',
						path: candidate.target_path,
						code: codeOf(revalidationError, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'move_may_have_started_prior_target_changed',
					});
				}
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'move_failed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'move_may_have_started',
				});
			}
			try {
				advancedTargetsStable(vaultRoot, prepared);
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'target_changed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'move_may_have_started_prior_target_changed',
				});
			}
			if (!validReceiptResult(moveResult)) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: 'adapter_result_invalid',
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'move_may_have_started_receipt_missing',
				});
			}
			let advancedSource;
			let advancedTarget;
			try {
				advancedSource = advanceVaultPathGuard(sourceGuard, {
					before: 'existing',
					after: 'missing',
				});
				advancedTarget = advanceVaultPathGuard(targetGuard, {
					before: 'missing',
					after: 'existing',
				});
				const observed = captureInventory(candidate, 'target');
				revalidateVaultPathGuard(advancedSource);
				revalidateVaultPathGuard(advancedTarget);
				assertInventoryMatch(observed, inventory);
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'move_postcondition_failed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state:
						error?.code === 'inventory_mismatch'
							? 'move_applied_target_changed'
							: 'move_state_unknown',
				});
			}
			item.source_guard = advancedSource;
			item.target_guard = advancedTarget;
			state.moved = true;
			addMoveRecords(manifest, vaultIdentity, run_id, inventory);
			manifest.move_receipts.push({
				candidate_key: candidate.candidate_key,
				idempotency_key: moveIntent.idempotency_key,
				receipt: moveResult.receipt,
			});
			persisted = await persistOrFail(manifest, adapters, 'move_applied_manifest_untrusted');
			if (!persisted.ok) return persisted.result;
			try {
				advancedTargetsStable(vaultRoot, prepared);
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'target_changed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'move_applied_target_changed',
				});
			}
		} else {
			try {
				advancedTargetsStable(vaultRoot, prepared);
				const observed = captureGuardedInventory(vaultRoot, candidate, 'target');
				assertInventoryMatch(observed.inventory, inventory);
				item.target_guard = observed.guard;
			} catch (error) {
				return fail(manifest, adapters, {
					step: 'resume',
					path: candidate.target_path,
					code: codeOf(error, 'resume_state_mismatch'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'move_previously_applied',
				});
			}
		}

		for (const move of manifest.moves.filter(
			(record) => record.candidate_key === candidate.candidate_key,
		)) {
			if (!manifest.notified.some((record) => record.move_id === move.move_id)) {
				const intent = expectedIntent(vaultIdentity, run_id, 'memory_notify', move);
				ensureIntent(manifest, intent);
				persisted = await persistOrFail(manifest, adapters, 'move_applied_notify_pending');
				if (!persisted.ok) return persisted.result;
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'move_applied_target_changed',
					});
				}
				let result;
				try {
					result = await adapters.memory_notify({
						contract_version: 2,
						vault_identity: serializableClone(vaultIdentity),
						file_path: move.target_path,
						previous_file_path: move.source_path,
						idempotency_key: intent.idempotency_key,
					});
				} catch (error) {
					try {
						advancedTargetsStable(vaultRoot, prepared);
					} catch (revalidationError) {
						return fail(manifest, adapters, {
							step: 'memory_notify',
							path: move.target_path,
							code: codeOf(revalidationError, 'target_changed'),
							recovery_action: 'manual_recovery_required',
							side_effect_state: 'notify_may_have_started_target_changed',
						});
					}
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: codeOf(error, 'memory_notify_failed'),
						recovery_action: 'resume_same_run_id_with_idempotency_key',
						side_effect_state: 'notify_may_have_started',
					});
				}
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'notify_applied_target_changed',
					});
				}
				if (!validReceiptResult(result)) {
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: 'adapter_result_invalid',
						recovery_action: 'resume_same_run_id_with_idempotency_key',
						side_effect_state: 'notify_may_have_started',
					});
				}
				manifest.notified.push({
					move_id: move.move_id,
					idempotency_key: intent.idempotency_key,
					receipt: result.receipt,
				});
				persisted = await persistOrFail(manifest, adapters, 'notify_applied_manifest_untrusted');
				if (!persisted.ok) return persisted.result;
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'notify_applied_target_changed',
					});
				}
			}
			if (!manifest.confirmed.some((record) => record.move_id === move.move_id)) {
				const intent = expectedIntent(vaultIdentity, run_id, 'confirm_index', move);
				ensureIntent(manifest, intent);
				persisted = await persistOrFail(manifest, adapters, 'notify_applied_confirm_pending');
				if (!persisted.ok) return persisted.result;
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'move_applied_target_changed',
					});
				}
				let result;
				try {
					result = await adapters.confirm_index({
						vault_identity: serializableClone(vaultIdentity),
						file_path: move.target_path,
						previous_file_path: move.source_path,
						idempotency_key: intent.idempotency_key,
					});
				} catch (error) {
					try {
						advancedTargetsStable(vaultRoot, prepared);
					} catch (revalidationError) {
						return fail(manifest, adapters, {
							step: 'confirm_index',
							path: move.target_path,
							code: codeOf(revalidationError, 'target_changed'),
							recovery_action: 'manual_recovery_required',
							side_effect_state: 'confirm_may_have_started_target_changed',
						});
					}
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: codeOf(error, 'confirm_index_failed'),
						recovery_action: 'resume_same_run_id_with_idempotency_key',
						side_effect_state: 'confirm_may_have_started',
					});
				}
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'confirm_applied_target_changed',
					});
				}
				if (!validConfirmResult(result)) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: 'adapter_result_invalid',
						recovery_action: 'resume_same_run_id_with_idempotency_key',
						side_effect_state: 'confirm_may_have_started',
					});
				}
				if (!result.confirmed) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: 'index_unconfirmed',
						recovery_action: 'resume_same_run_id_with_idempotency_key',
						side_effect_state: 'index_not_confirmed',
					});
				}
				manifest.confirmed.push({
					move_id: move.move_id,
					idempotency_key: intent.idempotency_key,
					receipt: result.receipt,
				});
				persisted = await persistOrFail(manifest, adapters, 'confirm_applied_manifest_untrusted');
				if (!persisted.ok) return persisted.result;
				try {
					advancedTargetsStable(vaultRoot, prepared);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: codeOf(error, 'target_changed'),
						recovery_action: 'manual_recovery_required',
						side_effect_state: 'confirm_applied_target_changed',
					});
				}
			}
		}
	}

	const projectIds = [
		...new Set(
			candidates
				.filter((candidate) => candidate.entity_type === 'project')
				.map((candidate) => candidate.project_id),
		),
	];
	for (const projectId of projectIds) {
		const projectItems = prepared.filter(
			(item) => item.candidate.entity_type === 'project' && item.candidate.project_id === projectId,
		);
		const projectCandidateKeys = new Set(projectItems.map((item) => item.candidate.candidate_key));
		const relevantMoves = manifest.moves.filter((move) =>
			projectCandidateKeys.has(move.candidate_key),
		);
		const confirmed = new Set(manifest.confirmed.map((item) => item.move_id));
		if (!relevantMoves.length || relevantMoves.some((move) => !confirmed.has(move.move_id))) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: 'project_moves_unconfirmed',
				recovery_action: 'resume_same_run_id',
				side_effect_state: 'forget_not_started',
			});
		}
		if (manifest.forgotten.some((record) => record.project_id === projectId)) continue;
		const intent = expectedIntent(vaultIdentity, run_id, 'memory_forget', {
			project_id: projectId,
		});
		ensureIntent(manifest, intent);
		persisted = await persistOrFail(manifest, adapters, 'project_confirmed_forget_pending');
		if (!persisted.ok) return persisted.result;
		try {
			advancedTargetsStable(vaultRoot, prepared);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: codeOf(error, 'target_changed'),
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'move_applied_target_changed',
			});
		}
		let result;
		try {
			result = await adapters.memory_forget({
				contract_version: 2,
				vault_identity: serializableClone(vaultIdentity),
				scope: { type: 'project', key: projectId },
				reason: '项目归档清理',
				idempotency_key: intent.idempotency_key,
			});
		} catch (error) {
			try {
				advancedTargetsStable(vaultRoot, prepared);
			} catch (revalidationError) {
				return fail(manifest, adapters, {
					step: 'memory_forget',
					path: projectId,
					code: codeOf(revalidationError, 'target_changed'),
					recovery_action: 'manual_recovery_required',
					side_effect_state: 'forget_may_have_started_target_changed',
				});
			}
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: codeOf(error, 'memory_forget_failed'),
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'forget_may_have_started',
			});
		}
		try {
			advancedTargetsStable(vaultRoot, prepared);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: codeOf(error, 'target_changed'),
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'forget_applied_target_changed',
			});
		}
		if (!validReceiptResult(result)) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: 'adapter_result_invalid',
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'forget_may_have_started',
			});
		}
		manifest.forgotten.push({
			project_id: projectId,
			idempotency_key: intent.idempotency_key,
			receipt: result.receipt,
		});
		persisted = await persistOrFail(manifest, adapters, 'forget_applied_manifest_untrusted');
		if (!persisted.ok) return persisted.result;
		try {
			advancedTargetsStable(vaultRoot, prepared);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: codeOf(error, 'target_changed'),
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'forget_applied_target_changed',
			});
		}
	}

	manifest.status = 'complete';
	persisted = await persistOrFail(manifest, adapters, 'all_effects_applied');
	if (!persisted.ok) return persisted.result;
	try {
		advancedTargetsStable(vaultRoot, prepared);
	} catch (error) {
		return fail(manifest, adapters, {
			step: 'finalize',
			path: manifest.run_id,
			code: codeOf(error, 'target_changed'),
			recovery_action: 'manual_recovery_required',
			side_effect_state: 'all_effects_applied_target_changed',
		});
	}
	advancedTargetsStable(vaultRoot, prepared);
	return envelope(manifest, persisted.receipt, 'verified');
}
