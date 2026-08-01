import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import {
	createVaultPathGuard,
	resolveVaultPath,
	revalidateVaultPathGuard,
} from '../../_shared/scripts/path_safety.mjs';

const ELIGIBLE_ENTITY_TYPES = new Set(['project', 'draft', 'plan']);
const MANIFEST_STATUSES = new Set(['in_progress', 'failed', 'complete']);
const REQUIRED_ADAPTERS = [
	'persist_manifest',
	'verify_manifest_receipt',
	'write_archived_frontmatter',
	'memory_notify',
	'confirm_index',
];
const MANIFEST_KEYS = [
	'contract_version',
	'operation',
	'run_id',
	'parent_run_id',
	'parent_receipt',
	'vault_identity',
	'archive_date',
	'status',
	'targets',
	'intents',
	'write_receipts',
	'notified',
	'confirmed',
	'errors',
];
const MANIFEST_ARRAY_KEYS = [
	'targets',
	'intents',
	'write_receipts',
	'notified',
	'confirmed',
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

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
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
	return `${runId}:${step}:${sha256(
		JSON.stringify({ vault_identity: vaultIdentity, run_id: runId, step, parts }),
	).slice(0, 20)}`;
}

function validateArchiveDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		throw codedError('invalid_archive_date');
	}
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		year < 1 ||
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw codedError('invalid_archive_date');
	}
}

function parseScalar(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		if (trimmed[0] === '"') {
			try {
				return JSON.parse(trimmed);
			} catch {
				throw codedError('invalid_frontmatter');
			}
		}
		return trimmed.slice(1, -1).replace(/''/gu, "'");
	}
	return trimmed;
}

function parseFrontmatter(content) {
	const opening = content.match(/^---(\r?\n)/u);
	if (!opening) throw codedError('invalid_frontmatter');
	const newline = opening[1];
	const blockStart = opening[0].length;
	const blockEnd = content.indexOf(`${newline}---`, blockStart);
	if (blockEnd < 0) throw codedError('invalid_frontmatter');
	const values = new Map();
	for (const line of content.slice(blockStart, blockEnd).split(/\r?\n/u)) {
		if (!line || /^\s/u.test(line) || line.startsWith('#')) continue;
		const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/u);
		if (!match) continue;
		if (values.has(match[1])) throw codedError('duplicate_frontmatter_key');
		values.set(match[1], parseScalar(match[2] ?? ''));
	}
	return { newline, blockEnd, values };
}

function renderArchivedContent(content, archiveDate, entityType) {
	const parsed = parseFrontmatter(content);
	if (parsed.values.get('type') !== entityType || parsed.values.get('status') !== 'done') {
		throw codedError('invalid_archive_metadata_target');
	}
	const existing = parsed.values.get('archived');
	if (existing !== undefined) {
		if (existing !== archiveDate) throw codedError('archived_date_conflict');
		return content;
	}
	return `${content.slice(0, parsed.blockEnd)}${parsed.newline}archived: "${archiveDate}"${content.slice(parsed.blockEnd)}`;
}

function readTarget(vaultRoot, filePath) {
	const guard = createVaultPathGuard(vaultRoot, filePath);
	if (guard.leaf.state !== 'existing' || guard.leaf.type !== 'file') {
		throw codedError('metadata_target_missing');
	}
	revalidateVaultPathGuard(guard);
	const absolute = assertCanonicalVaultPath(vaultRoot, filePath);
	if (lstatSync(absolute).isSymbolicLink()) throw codedError('unsafe_metadata_target');
	const content = readFileSync(absolute, 'utf8');
	revalidateVaultPathGuard(guard);
	return { guard, content, sha256: sha256(content), parsed: parseFrontmatter(content) };
}

function tryReadMatchingTarget(vaultRoot, filePath, entityType) {
	let observed;
	try {
		observed = readTarget(vaultRoot, filePath);
	} catch (error) {
		if (error?.code === 'invalid_frontmatter') return null;
		throw error;
	}
	return observed.parsed.values.get('type') === entityType ? observed : null;
}

function publicParentCandidate(value) {
	if (
		!isPlainObject(value) ||
		typeof value.candidate_key !== 'string' ||
		typeof value.entity_type !== 'string'
	) {
		throw codedError('invalid_parent_manifest');
	}
	return value;
}

function validateParentEnvelope(envelope, vaultIdentity, vaultRoot) {
	assertPlainJson(envelope);
	if (
		!hasExactKeys(envelope, ['manifest', 'persistence_receipt', 'persistence_state']) ||
		envelope.persistence_state !== 'verified' ||
		typeof envelope.persistence_receipt !== 'string' ||
		!envelope.persistence_receipt ||
		!isPlainObject(envelope.manifest)
	) {
		throw codedError('invalid_parent_envelope');
	}
	const manifest = envelope.manifest;
	if (
		manifest.operation !== 'archive' ||
		manifest.status !== 'complete' ||
		typeof manifest.run_id !== 'string' ||
		!manifest.run_id ||
		!Array.isArray(manifest.candidates) ||
		!Array.isArray(manifest.moves)
	) {
		throw codedError('invalid_parent_manifest');
	}
	assertVaultIdentity(vaultIdentity, manifest.vault_identity);
	const candidates = new Map();
	for (const candidateValue of manifest.candidates) {
		const candidate = publicParentCandidate(candidateValue);
		if (candidates.has(candidate.candidate_key)) throw codedError('invalid_parent_manifest');
		candidates.set(candidate.candidate_key, candidate);
	}
	for (const move of manifest.moves) {
		if (
			!isPlainObject(move) ||
			typeof move.candidate_key !== 'string' ||
			typeof move.target_path !== 'string' ||
			!candidates.has(move.candidate_key)
		) {
			throw codedError('invalid_parent_manifest');
		}
		assertCanonicalVaultPath(vaultRoot, move.target_path);
	}
	return { manifest, candidates };
}

function deriveTargets(vaultRoot, vaultIdentity, runId, archiveDate, parent) {
	const targets = [];
	for (const candidate of parent.candidates.values()) {
		if (!ELIGIBLE_ENTITY_TYPES.has(candidate.entity_type)) continue;
		const matching = [];
		for (const move of parent.manifest.moves.filter(
			(value) => value.candidate_key === candidate.candidate_key,
		)) {
			const observed = tryReadMatchingTarget(vaultRoot, move.target_path, candidate.entity_type);
			if (observed) matching.push({ move, observed });
		}
		if (matching.length !== 1) throw codedError('ambiguous_metadata_target');
		const { move, observed } = matching[0];
		const afterContent = renderArchivedContent(
			observed.content,
			archiveDate,
			candidate.entity_type,
		);
		targets.push({
			target_key: stableKey(vaultIdentity, runId, 'metadata-target', move.target_path),
			candidate_key: candidate.candidate_key,
			file_path: move.target_path,
			entity_type: candidate.entity_type,
			before_sha256: observed.sha256,
			after_sha256: sha256(afterContent),
		});
	}
	return targets.sort((left, right) => left.file_path.localeCompare(right.file_path));
}

function createManifest({ runId, parentEnvelope, vaultIdentity, archiveDate, targets }) {
	return {
		contract_version: 1,
		operation: 'archive-metadata',
		run_id: runId,
		parent_run_id: parentEnvelope.manifest.run_id,
		parent_receipt: parentEnvelope.persistence_receipt,
		vault_identity: vaultIdentity,
		archive_date: archiveDate,
		status: 'in_progress',
		targets,
		intents: [],
		write_receipts: [],
		notified: [],
		confirmed: [],
		errors: [],
	};
}

function targetFor(manifest, targetKey) {
	const target = manifest.targets.find((value) => value.target_key === targetKey);
	if (!target) throw codedError('invalid_manifest');
	return target;
}

function writeIdempotencyKey(vaultIdentity, runId, targetKey) {
	return stableKey(vaultIdentity, runId, 'write_archived_frontmatter', targetKey);
}

function notifyIdempotencyKey(vaultIdentity, runId, targetKey) {
	return stableKey(vaultIdentity, runId, 'memory_notify', targetKey);
}

function confirmIdempotencyKey(vaultIdentity, runId, targetKey) {
	return stableKey(vaultIdentity, runId, 'confirm_index', targetKey);
}

function expectedIntent(vaultIdentity, runId, effectType, target, archiveDate) {
	const keyFunction =
		effectType === 'write_archived_frontmatter'
			? writeIdempotencyKey
			: effectType === 'memory_notify'
				? notifyIdempotencyKey
				: confirmIdempotencyKey;
	return {
		effect_type: effectType,
		effect_key: target.target_key,
		vault_identity: vaultIdentity,
		idempotency_key: keyFunction(vaultIdentity, runId, target.target_key),
		file_path: target.file_path,
		archive_date: archiveDate,
		before_sha256: target.before_sha256,
		after_sha256: target.after_sha256,
	};
}

function validateTargetSchema(vaultRoot, target, vaultIdentity, runId) {
	if (
		!hasExactKeys(target, [
			'target_key',
			'candidate_key',
			'file_path',
			'entity_type',
			'before_sha256',
			'after_sha256',
		]) ||
		target.target_key !== stableKey(vaultIdentity, runId, 'metadata-target', target.file_path) ||
		!ELIGIBLE_ENTITY_TYPES.has(target.entity_type) ||
		typeof target.candidate_key !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(target.before_sha256) ||
		!/^[a-f0-9]{64}$/u.test(target.after_sha256)
	) {
		throw codedError('invalid_manifest');
	}
	assertCanonicalVaultPath(vaultRoot, target.file_path);
}

function validateTargetsAgainstParent(manifest, parent) {
	const expectedCandidates = new Set(
		[...parent.candidates.values()]
			.filter((candidate) => ELIGIBLE_ENTITY_TYPES.has(candidate.entity_type))
			.map((candidate) => candidate.candidate_key),
	);
	if (
		manifest.targets.length !== expectedCandidates.size ||
		!uniqueBy(manifest.targets, (target) => target.target_key) ||
		!uniqueBy(manifest.targets, (target) => target.candidate_key) ||
		!uniqueBy(manifest.targets, (target) => target.file_path)
	) {
		throw codedError('invalid_manifest');
	}
	for (const target of manifest.targets) {
		const candidate = parent.candidates.get(target.candidate_key);
		if (
			!candidate ||
			candidate.entity_type !== target.entity_type ||
			!parent.manifest.moves.some(
				(move) =>
					move.candidate_key === target.candidate_key && move.target_path === target.file_path,
			)
		) {
			throw codedError('invalid_manifest');
		}
		expectedCandidates.delete(target.candidate_key);
	}
	if (expectedCandidates.size) throw codedError('invalid_manifest');
}

function validateResumeManifest(
	manifest,
	{ runId, parentEnvelope, vaultIdentity, vaultRoot, archiveDate, parent },
) {
	assertPlainJson(manifest);
	if (!hasExactKeys(manifest, MANIFEST_KEYS)) throw codedError('invalid_manifest');
	if (
		manifest.contract_version !== 1 ||
		manifest.operation !== 'archive-metadata' ||
		manifest.run_id !== runId ||
		manifest.parent_run_id !== parentEnvelope.manifest.run_id ||
		manifest.parent_receipt !== parentEnvelope.persistence_receipt ||
		manifest.archive_date !== archiveDate ||
		!MANIFEST_STATUSES.has(manifest.status)
	) {
		throw codedError('invalid_manifest');
	}
	assertVaultIdentity(vaultIdentity, manifest.vault_identity);
	for (const key of MANIFEST_ARRAY_KEYS) {
		if (!Array.isArray(manifest[key])) throw codedError('invalid_manifest');
	}
	for (const target of manifest.targets) {
		validateTargetSchema(vaultRoot, target, vaultIdentity, runId);
	}
	validateTargetsAgainstParent(manifest, parent);
	if (!uniqueBy(manifest.intents, (intent) => `${intent.effect_type}\n${intent.effect_key}`)) {
		throw codedError('invalid_manifest');
	}
	for (const intent of manifest.intents) {
		if (
			!hasExactKeys(intent, [
				'effect_type',
				'effect_key',
				'vault_identity',
				'idempotency_key',
				'file_path',
				'archive_date',
				'before_sha256',
				'after_sha256',
			]) ||
			!['write_archived_frontmatter', 'memory_notify', 'confirm_index'].includes(intent.effect_type)
		) {
			throw codedError('invalid_manifest');
		}
		const target = targetFor(manifest, intent.effect_key);
		if (
			!sameValue(
				intent,
				expectedIntent(vaultIdentity, runId, intent.effect_type, target, archiveDate),
			)
		) {
			throw codedError('invalid_manifest');
		}
	}
	for (const [key, effectType, idempotencyKey, receiptKeys] of [
		[
			'write_receipts',
			'write_archived_frontmatter',
			writeIdempotencyKey,
			['target_key', 'idempotency_key', 'receipt', 'applied_sha256'],
		],
		[
			'notified',
			'memory_notify',
			notifyIdempotencyKey,
			['target_key', 'idempotency_key', 'receipt'],
		],
		[
			'confirmed',
			'confirm_index',
			confirmIdempotencyKey,
			['target_key', 'idempotency_key', 'receipt'],
		],
	]) {
		if (!uniqueBy(manifest[key], (item) => item.target_key)) throw codedError('invalid_manifest');
		for (const item of manifest[key]) {
			if (!hasExactKeys(item, receiptKeys)) throw codedError('invalid_manifest');
			const target = targetFor(manifest, item.target_key);
			if (
				item.idempotency_key !== idempotencyKey(vaultIdentity, runId, target.target_key) ||
				typeof item.receipt !== 'string' ||
				!item.receipt ||
				(effectType === 'write_archived_frontmatter' &&
					item.applied_sha256 !== target.after_sha256) ||
				!manifest.intents.some((intent) =>
					sameValue(intent, expectedIntent(vaultIdentity, runId, effectType, target, archiveDate)),
				)
			) {
				throw codedError('invalid_manifest');
			}
		}
	}
	const written = new Set(manifest.write_receipts.map((item) => item.target_key));
	const notified = new Set(manifest.notified.map((item) => item.target_key));
	if (manifest.notified.some((item) => !written.has(item.target_key))) {
		throw codedError('invalid_manifest');
	}
	if (manifest.confirmed.some((item) => !notified.has(item.target_key))) {
		throw codedError('invalid_manifest');
	}
	if (!uniqueBy(manifest.errors, (error) => JSON.stringify(error))) {
		throw codedError('invalid_manifest');
	}
	for (const error of manifest.errors) {
		if (!hasExactKeys(error, ['step', 'path', 'code', 'recovery_action', 'side_effect_state'])) {
			throw codedError('invalid_manifest');
		}
		for (const key of ['step', 'path', 'code', 'recovery_action', 'side_effect_state']) {
			if (typeof error[key] !== 'string' || !error[key]) throw codedError('invalid_manifest');
		}
	}
	if (
		manifest.status === 'complete' &&
		(manifest.targets.some((target) => !written.has(target.target_key)) ||
			manifest.targets.some((target) => !notified.has(target.target_key)) ||
			manifest.targets.some(
				(target) => !manifest.confirmed.some((item) => item.target_key === target.target_key),
			))
	) {
		throw codedError('invalid_manifest');
	}
	if (manifest.status === 'failed' && !manifest.errors.length) throw codedError('invalid_manifest');
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

function validWriteResult(value) {
	return (
		hasExactKeys(value, ['ok', 'receipt', 'applied_sha256']) &&
		value.ok === true &&
		typeof value.receipt === 'string' &&
		Boolean(value.receipt) &&
		typeof value.applied_sha256 === 'string' &&
		/^[a-f0-9]{64}$/u.test(value.applied_sha256)
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

function errorRecord({ step, path, code, recovery_action, side_effect_state = 'none' }) {
	return { step, path, code, recovery_action, side_effect_state };
}

function appendError(manifest, error) {
	if (!manifest.errors.some((existing) => sameValue(existing, error))) manifest.errors.push(error);
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

function verifyTargetState(vaultRoot, target, archiveDate, requireAfter) {
	const observed = readTarget(vaultRoot, target.file_path);
	const rendered = renderArchivedContent(observed.content, archiveDate, target.entity_type);
	if (sha256(rendered) !== target.after_sha256) throw codedError('metadata_target_changed');
	if (requireAfter && observed.sha256 !== target.after_sha256) {
		throw codedError('metadata_write_missing');
	}
	if (
		!requireAfter &&
		observed.sha256 !== target.before_sha256 &&
		observed.sha256 !== target.after_sha256
	) {
		throw codedError('metadata_target_changed');
	}
	return { ...observed, rendered };
}

function verifyAppliedTargets(vaultRoot, manifest) {
	const written = new Set(manifest.write_receipts.map((item) => item.target_key));
	for (const target of manifest.targets) {
		if (written.has(target.target_key)) {
			verifyTargetState(vaultRoot, target, manifest.archive_date, true);
		}
	}
}

function untrustedFailure({ runId, parentEnvelope, vaultIdentity, archiveDate, code, step }) {
	const parentManifest = isPlainObject(parentEnvelope?.manifest) ? parentEnvelope.manifest : {};
	const manifest = {
		contract_version: 1,
		operation: 'archive-metadata',
		run_id: runId,
		parent_run_id: typeof parentManifest.run_id === 'string' ? parentManifest.run_id : 'unverified',
		parent_receipt:
			typeof parentEnvelope?.persistence_receipt === 'string'
				? parentEnvelope.persistence_receipt
				: 'unverified',
		vault_identity: vaultIdentity,
		archive_date: archiveDate,
		status: 'failed',
		targets: [],
		intents: [],
		write_receipts: [],
		notified: [],
		confirmed: [],
		errors: [
			errorRecord({
				step,
				path: runId,
				code,
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'operation_not_started',
			}),
		],
	};
	return envelope(manifest, null, 'unverified');
}

async function verifyEnvelopeReceipt({ envelope: value, adapters, vaultIdentity, code }) {
	let verification;
	try {
		const payload = {
			manifest: serializableClone(value.manifest),
			persistence_receipt: value.persistence_receipt,
			vault_identity: serializableClone(vaultIdentity),
		};
		const expected = JSON.stringify(payload);
		verification = await adapters.verify_manifest_receipt(payload);
		if (JSON.stringify(payload) !== expected) throw codedError('adapter_result_invalid');
	} catch (error) {
		throw codedError(codeOf(error, code), error);
	}
	if (!validVerifyResult(verification)) throw codedError('adapter_result_invalid');
	if (!verification.verified) throw codedError(code);
}

/**
 * 在已经完成且回执可信的 Archive 移动事务之后，写入 archived 日期并重新通知、确认索引。
 * 本操作拥有独立 run_id 与认证 manifest，不与父移动事务宣称跨系统原子性。
 */
export async function runArchiveMetadataTransaction({
	vault_root,
	run_id,
	archive_date,
	move_envelope,
	manifest: resumeEnvelope,
	adapters,
}) {
	if (typeof run_id !== 'string' || !run_id) throw codedError('invalid_run_id');
	validateArchiveDate(archive_date);
	requireAdapters(adapters);
	const vaultIdentity = captureVaultIdentity(vault_root);
	const vaultRoot = vaultIdentity.realpath;
	adapters = bindAdaptersToVaultIdentity(adapters, vaultRoot, vaultIdentity);
	let parent;
	try {
		parent = validateParentEnvelope(move_envelope, vaultIdentity, vaultRoot);
		await verifyEnvelopeReceipt({
			envelope: move_envelope,
			adapters,
			vaultIdentity,
			code: 'parent_manifest_receipt_invalid',
		});
	} catch (error) {
		return untrustedFailure({
			runId: run_id,
			parentEnvelope: move_envelope,
			vaultIdentity,
			archiveDate: archive_date,
			code: codeOf(error, 'invalid_parent_envelope'),
			step: 'verify_parent_manifest',
		});
	}

	let currentManifest;
	if (resumeEnvelope !== undefined) {
		try {
			assertPlainJson(resumeEnvelope);
			if (
				!hasExactKeys(resumeEnvelope, ['manifest', 'persistence_receipt', 'persistence_state']) ||
				resumeEnvelope.persistence_state !== 'verified' ||
				typeof resumeEnvelope.persistence_receipt !== 'string' ||
				!resumeEnvelope.persistence_receipt
			) {
				throw codedError('invalid_manifest_envelope');
			}
			validateResumeManifest(resumeEnvelope.manifest, {
				runId: run_id,
				parentEnvelope: move_envelope,
				vaultIdentity,
				vaultRoot,
				archiveDate: archive_date,
				parent,
			});
			await verifyEnvelopeReceipt({
				envelope: resumeEnvelope,
				adapters,
				vaultIdentity,
				code: 'manifest_receipt_invalid',
			});
			currentManifest = serializableClone(resumeEnvelope.manifest);
			verifyAppliedTargets(vaultRoot, currentManifest);
		} catch (error) {
			return untrustedFailure({
				runId: run_id,
				parentEnvelope: move_envelope,
				vaultIdentity,
				archiveDate: archive_date,
				code: codeOf(error, 'invalid_manifest'),
				step: 'resume_validation',
			});
		}
	} else {
		let targets;
		try {
			targets = deriveTargets(vaultRoot, vaultIdentity, run_id, archive_date, parent);
		} catch (error) {
			const failure = createManifest({
				runId: run_id,
				parentEnvelope: move_envelope,
				vaultIdentity,
				archiveDate: archive_date,
				targets: [],
			});
			return fail(failure, adapters, {
				step: 'derive_metadata_targets',
				path: run_id,
				code: codeOf(error, 'metadata_target_derivation_failed'),
				recovery_action: 'fix_archive_target_then_resume_parent_and_start_new_metadata_run',
				side_effect_state: 'metadata_not_started',
			});
		}
		currentManifest = createManifest({
			runId: run_id,
			parentEnvelope: move_envelope,
			vaultIdentity,
			archiveDate: archive_date,
			targets,
		});
	}

	currentManifest.status = 'in_progress';
	let persisted = await persistOrFail(currentManifest, adapters);
	if (!persisted.ok) return persisted.result;
	verifyAppliedTargets(vaultRoot, currentManifest);

	for (const target of currentManifest.targets) {
		if (currentManifest.write_receipts.some((item) => item.target_key === target.target_key)) {
			verifyTargetState(vaultRoot, target, archive_date, true);
			continue;
		}
		const intent = expectedIntent(
			vaultIdentity,
			run_id,
			'write_archived_frontmatter',
			target,
			archive_date,
		);
		ensureIntent(currentManifest, intent);
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_write_pending');
		if (!persisted.ok) return persisted.result;
		let observed;
		try {
			verifyAppliedTargets(vaultRoot, currentManifest);
			observed = verifyTargetState(vaultRoot, target, archive_date, false);
		} catch (error) {
			return fail(currentManifest, adapters, {
				step: 'write_archived_frontmatter',
				path: target.file_path,
				code: codeOf(error, 'metadata_target_changed'),
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'write_not_started',
			});
		}
		let result;
		try {
			result = await adapters.write_archived_frontmatter({
				vault_root: vaultRoot,
				vault_identity: serializableClone(vaultIdentity),
				file_path: target.file_path,
				archive_date,
				expected_before_sha256: target.before_sha256,
				expected_after_sha256: target.after_sha256,
				content: observed.rendered,
				idempotency_key: intent.idempotency_key,
			});
		} catch (error) {
			return fail(currentManifest, adapters, {
				step: 'write_archived_frontmatter',
				path: target.file_path,
				code: codeOf(error, 'metadata_write_failed'),
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'write_may_have_started',
			});
		}
		if (!validWriteResult(result) || result.applied_sha256 !== target.after_sha256) {
			return fail(currentManifest, adapters, {
				step: 'write_archived_frontmatter',
				path: target.file_path,
				code: 'adapter_result_invalid',
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'write_may_have_started',
			});
		}
		try {
			verifyTargetState(vaultRoot, target, archive_date, true);
		} catch (error) {
			return fail(currentManifest, adapters, {
				step: 'write_archived_frontmatter',
				path: target.file_path,
				code: codeOf(error, 'metadata_write_postcondition_failed'),
				recovery_action: 'manual_recovery_required',
				side_effect_state: 'write_applied_target_changed',
			});
		}
		currentManifest.write_receipts.push({
			target_key: target.target_key,
			idempotency_key: intent.idempotency_key,
			receipt: result.receipt,
			applied_sha256: result.applied_sha256,
		});
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_write_applied');
		if (!persisted.ok) return persisted.result;
		verifyAppliedTargets(vaultRoot, currentManifest);
	}

	for (const target of currentManifest.targets) {
		if (currentManifest.notified.some((item) => item.target_key === target.target_key)) continue;
		const intent = expectedIntent(vaultIdentity, run_id, 'memory_notify', target, archive_date);
		ensureIntent(currentManifest, intent);
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_notify_pending');
		if (!persisted.ok) return persisted.result;
		verifyAppliedTargets(vaultRoot, currentManifest);
		let result;
		try {
			result = await adapters.memory_notify({
				contract_version: 2,
				vault_identity: serializableClone(vaultIdentity),
				file_path: target.file_path,
				expected_sha256: target.after_sha256,
				idempotency_key: intent.idempotency_key,
			});
		} catch (error) {
			return fail(currentManifest, adapters, {
				step: 'memory_notify',
				path: target.file_path,
				code: codeOf(error, 'memory_notify_failed'),
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'notify_may_have_started',
			});
		}
		verifyAppliedTargets(vaultRoot, currentManifest);
		if (!validReceiptResult(result)) {
			return fail(currentManifest, adapters, {
				step: 'memory_notify',
				path: target.file_path,
				code: 'adapter_result_invalid',
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'notify_may_have_started',
			});
		}
		currentManifest.notified.push({
			target_key: target.target_key,
			idempotency_key: intent.idempotency_key,
			receipt: result.receipt,
		});
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_notify_applied');
		if (!persisted.ok) return persisted.result;
		verifyAppliedTargets(vaultRoot, currentManifest);
	}

	for (const target of currentManifest.targets) {
		if (currentManifest.confirmed.some((item) => item.target_key === target.target_key)) continue;
		const intent = expectedIntent(vaultIdentity, run_id, 'confirm_index', target, archive_date);
		ensureIntent(currentManifest, intent);
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_confirm_pending');
		if (!persisted.ok) return persisted.result;
		verifyAppliedTargets(vaultRoot, currentManifest);
		let result;
		try {
			result = await adapters.confirm_index({
				vault_identity: serializableClone(vaultIdentity),
				file_path: target.file_path,
				expected_sha256: target.after_sha256,
				idempotency_key: intent.idempotency_key,
			});
		} catch (error) {
			return fail(currentManifest, adapters, {
				step: 'confirm_index',
				path: target.file_path,
				code: codeOf(error, 'confirm_index_failed'),
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'confirm_may_have_started',
			});
		}
		verifyAppliedTargets(vaultRoot, currentManifest);
		if (!validConfirmResult(result) || !result.confirmed) {
			return fail(currentManifest, adapters, {
				step: 'confirm_index',
				path: target.file_path,
				code: validConfirmResult(result) ? 'index_unconfirmed' : 'adapter_result_invalid',
				recovery_action: 'resume_same_run_id_with_idempotency_key',
				side_effect_state: 'confirm_may_have_started',
			});
		}
		currentManifest.confirmed.push({
			target_key: target.target_key,
			idempotency_key: intent.idempotency_key,
			receipt: result.receipt,
		});
		persisted = await persistOrFail(currentManifest, adapters, 'metadata_confirm_applied');
		if (!persisted.ok) return persisted.result;
		verifyAppliedTargets(vaultRoot, currentManifest);
	}

	currentManifest.status = 'complete';
	persisted = await persistOrFail(currentManifest, adapters, 'all_metadata_effects_applied');
	if (!persisted.ok) return persisted.result;
	verifyAppliedTargets(vaultRoot, currentManifest);
	return envelope(currentManifest, persisted.receipt, 'verified');
}
