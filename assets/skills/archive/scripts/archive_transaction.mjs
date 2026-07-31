import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
	advanceVaultPathGuard,
	createVaultDirectoryGuard,
	createVaultPathGuard,
	ensureVaultDirectory,
	resolveVaultPath,
	revalidateVaultPathGuard,
} from '../../_shared/scripts/path_safety.mjs';

const ENTITY_TYPES = new Set(['project', 'draft', 'plan', 'diary']);

function codedError(code, cause) {
	const error = new Error(code, cause ? { cause } : undefined);
	error.code = code;
	return error;
}

function codeOf(error, fallback) {
	return typeof error?.code === 'string' ? error.code : fallback;
}

function vaultRelative(root, absolute) {
	const value = relative(root, absolute);
	if (!value || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
		throw codedError('vault_escape');
	}
	return value.split(sep).join('/');
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function stableKey(runId, step, ...parts) {
	return `${runId}:${step}:${hash(JSON.stringify(parts)).slice(0, 20)}`;
}

function serializableClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
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

function normalizeCandidate(vaultRoot, candidate) {
	if (!candidate || typeof candidate !== 'object') throw codedError('invalid_candidate');
	if (!ENTITY_TYPES.has(candidate.entity_type)) throw codedError('invalid_entity_type');
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
		candidate_key: stableKey('archive-candidate', 'pair', normalized),
		source_absolute: sourceAbsolute,
		target_absolute: targetAbsolute,
	};
}

function pathContains(parent, child) {
	return child.startsWith(`${parent}/`);
}

function validateCandidateSet(candidates) {
	for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
		const left = candidates[leftIndex];
		for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
			const right = candidates[rightIndex];
			if (
				left.source_path === right.source_path ||
				left.target_path === right.target_path ||
				pathContains(left.source_path, right.source_path) ||
				pathContains(right.source_path, left.source_path) ||
				pathContains(left.target_path, right.target_path) ||
				pathContains(right.target_path, left.target_path)
			) {
				throw codedError('candidate_path_overlap');
			}
		}
		if (
			pathContains(left.source_path, left.target_path) ||
			pathContains(left.target_path, left.source_path)
		) {
			throw codedError('candidate_path_overlap');
		}
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
			for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
				left.name.localeCompare(right.name),
			)) {
				visit(join(absolute, entry.name), suffix ? `${suffix}/${entry.name}` : entry.name);
			}
			return;
		}
		const bytes = readFileSync(absolute);
		const sourcePath =
			location === 'source'
				? suffix
					? `${candidate.source_path}/${suffix}`
					: candidate.source_path
				: suffix
					? `${candidate.source_path}/${suffix}`
					: candidate.source_path;
		const targetPath =
			location === 'target'
				? suffix
					? `${candidate.target_path}/${suffix}`
					: candidate.target_path
				: suffix
					? `${candidate.target_path}/${suffix}`
					: candidate.target_path;
		files.push({
			source_path: sourcePath,
			target_path: targetPath,
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

function publicCandidate(candidate) {
	return {
		candidate_key: candidate.candidate_key,
		source_path: candidate.source_path,
		target_path: candidate.target_path,
		entity_type: candidate.entity_type,
		...(candidate.entity_type === 'project' ? { project_id: candidate.project_id } : {}),
	};
}

function createManifest(runId, candidates) {
	return {
		contract_version: 1,
		operation: 'archive',
		run_id: runId,
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
		notified: [],
		confirmed: [],
		forgotten: [],
		errors: [],
	};
}

function validateResumeManifest(manifest, runId, candidates) {
	if (!manifest || typeof manifest !== 'object') throw codedError('invalid_manifest');
	if (manifest.run_id !== runId) throw codedError('run_id_mismatch');
	if (
		manifest.contract_version !== 1 ||
		manifest.operation !== 'archive' ||
		!Array.isArray(manifest.candidates) ||
		!Array.isArray(manifest.inventories) ||
		!Array.isArray(manifest.candidate_states) ||
		!Array.isArray(manifest.moves) ||
		!Array.isArray(manifest.collisions) ||
		!Array.isArray(manifest.notified) ||
		!Array.isArray(manifest.confirmed) ||
		!Array.isArray(manifest.forgotten) ||
		!Array.isArray(manifest.errors)
	) {
		throw codedError('invalid_manifest');
	}
	if (!sameValue(manifest.candidates, candidates.map(publicCandidate))) {
		throw codedError('candidate_set_mismatch');
	}
}

function manifestState(manifest, candidateKey) {
	const state = manifest.candidate_states.find((item) => item.candidate_key === candidateKey);
	if (!state) throw codedError('invalid_manifest');
	return state;
}

function manifestInventory(manifest, candidateKey) {
	return manifest.inventories.find((item) => item.candidate_key === candidateKey) ?? null;
}

function moveRecords(runId, inventory) {
	return inventory.files.map((file) => ({
		candidate_key: inventory.candidate_key,
		source_path: file.source_path,
		target_path: file.target_path,
		move_id: stableKey(runId, 'file', file.source_path, file.target_path),
	}));
}

async function persist(manifest, adapters) {
	const snapshot = serializableClone(manifest);
	if (typeof adapters.persist_manifest === 'function') await adapters.persist_manifest(snapshot);
	return snapshot;
}

async function fail(manifest, adapters, { step, path, code, recovery_action }) {
	manifest.status = 'failed';
	manifest.errors.push({ step, path, code, recovery_action });
	await persist(manifest, adapters);
	return serializableClone(manifest);
}

function requireAdapters(adapters) {
	for (const name of ['move_with_link_update', 'memory_notify', 'confirm_index', 'memory_forget']) {
		if (typeof adapters?.[name] !== 'function') throw codedError(`missing_adapter_${name}`);
	}
}

function confirmResult(value) {
	return value === true || value?.confirmed === true;
}

function reconcileMovedCandidate(candidate, inventory) {
	if (pathExists(candidate.source_absolute) || !pathExists(candidate.target_absolute)) return false;
	const observed = captureInventory(candidate, 'target');
	if (!sameValue(comparableInventory(observed), comparableInventory(inventory))) {
		throw codedError('inventory_mismatch');
	}
	return true;
}

/**
 * 执行可恢复的 Archive 文件系统事务。外部能力必须按传入的 idempotency_key 幂等。
 * 本适配器不承诺跨文件系统与外部索引/记忆系统的 exactly-once 或原子语义。
 */
export async function runArchiveTransaction({
	vault_root,
	run_id,
	candidates: requestedCandidates,
	manifest: resumeManifest,
	adapters,
}) {
	if (typeof run_id !== 'string' || !run_id) throw codedError('invalid_run_id');
	if (!Array.isArray(requestedCandidates) || !requestedCandidates.length) {
		throw codedError('invalid_candidates');
	}
	requireAdapters(adapters);
	const vaultRoot = realpathSync(vault_root);
	const candidates = requestedCandidates.map((candidate) =>
		normalizeCandidate(vaultRoot, candidate),
	);
	validateCandidateSet(candidates);
	const manifest = resumeManifest
		? serializableClone(resumeManifest)
		: createManifest(run_id, candidates);
	if (resumeManifest) validateResumeManifest(manifest, run_id, candidates);
	manifest.status = 'in_progress';
	manifest.collisions = [];

	const prepared = [];
	for (const candidate of candidates) {
		const sourceExists = pathExists(candidate.source_absolute);
		const targetExists = pathExists(candidate.target_absolute);
		const frozen = manifestInventory(manifest, candidate.candidate_key);
		let mode;
		if (sourceExists && targetExists) {
			manifest.collisions.push({
				source_path: candidate.source_path,
				target_path: candidate.target_path,
				code: 'target_collision',
			});
			continue;
		}
		if (sourceExists) {
			mode = 'move';
		} else if (targetExists && frozen) {
			mode = 'resume';
		} else {
			return fail(manifest, adapters, {
				step: 'preflight',
				path: candidate.source_path,
				code: targetExists ? 'untracked_target' : 'source_missing',
				recovery_action: 'restore_source_or_supply_matching_manifest',
			});
		}
		const sourceGuard =
			mode === 'move' ? createVaultPathGuard(vaultRoot, candidate.source_path) : null;
		if (sourceGuard && sourceGuard.leaf.state !== 'existing') throw codedError('source_missing');
		const targetParent = dirname(candidate.target_path).split(sep).join('/');
		prepared.push({ candidate, frozen, mode, sourceGuard, targetParent });
	}

	if (manifest.collisions.length) {
		return fail(manifest, adapters, {
			step: 'preflight',
			path: manifest.collisions[0].target_path,
			code: 'collision_preflight',
			recovery_action: 'resolve_collision_then_resume_same_run_id',
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
			const directoryGuard = createVaultDirectoryGuard(vaultRoot, targetParent);
			ensureVaultDirectory(directoryGuard);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'create_target_parent',
				path: targetParent,
				code: codeOf(error, 'directory_create_failed'),
				recovery_action: 'inspect_target_parent_then_resume_same_run_id',
			});
		}
	}
	for (const item of prepared) {
		const observed = captureInventory(item.candidate, item.mode === 'move' ? 'source' : 'target');
		if (
			item.frozen &&
			!sameValue(comparableInventory(observed), comparableInventory(item.frozen))
		) {
			throw codedError('inventory_mismatch');
		}
		if (!item.frozen) manifest.inventories.push(serializableClone(observed));
		item.inventory = item.frozen ?? observed;
	}
	await persist(manifest, adapters);

	for (const item of prepared) {
		const { candidate, inventory } = item;
		const state = manifestState(manifest, candidate.candidate_key);
		if (item.mode === 'move') {
			try {
				const targetGuard = createVaultPathGuard(vaultRoot, candidate.target_path);
				if (targetGuard.leaf.state !== 'missing') throw codedError('target_collision');
				revalidateVaultPathGuard(item.sourceGuard);
				revalidateVaultPathGuard(targetGuard);
				state.move_started = true;
				await persist(manifest, adapters);
				await adapters.move_with_link_update({
					vault_root: vaultRoot,
					source_path: candidate.source_path,
					target_path: candidate.target_path,
					entry_type: inventory.entry_type,
					idempotency_key: stableKey(run_id, 'move', candidate.candidate_key),
				});
				advanceVaultPathGuard(item.sourceGuard, { before: 'existing', after: 'missing' });
				advanceVaultPathGuard(targetGuard, { before: 'missing', after: 'existing' });
				if (!reconcileMovedCandidate(candidate, inventory))
					throw codedError('move_postcondition_failed');
			} catch (error) {
				try {
					if (reconcileMovedCandidate(candidate, inventory)) {
						state.moved = true;
						for (const move of moveRecords(run_id, inventory)) {
							if (!manifest.moves.some((existing) => existing.move_id === move.move_id)) {
								manifest.moves.push(move);
							}
						}
					}
				} catch (reconcileError) {
					if (reconcileError?.code === 'inventory_mismatch') throw reconcileError;
				}
				return fail(manifest, adapters, {
					step: 'move',
					path: candidate.target_path,
					code: codeOf(error, 'move_failed'),
					recovery_action: 'inspect_filesystem_then_resume_same_run_id',
				});
			}
			state.moved = true;
			for (const move of moveRecords(run_id, inventory)) {
				if (!manifest.moves.some((existing) => existing.move_id === move.move_id)) {
					manifest.moves.push(move);
				}
			}
			await persist(manifest, adapters);
		} else {
			if (!reconcileMovedCandidate(candidate, inventory)) throw codedError('resume_state_mismatch');
			state.move_started = true;
			state.moved = true;
			for (const move of moveRecords(run_id, inventory)) {
				if (!manifest.moves.some((existing) => existing.move_id === move.move_id)) {
					manifest.moves.push(move);
				}
			}
			await persist(manifest, adapters);
		}

		for (const move of manifest.moves.filter(
			(record) => record.candidate_key === candidate.candidate_key,
		)) {
			if (!manifest.notified.includes(move.move_id)) {
				try {
					await adapters.memory_notify({
						contract_version: 2,
						file_path: move.target_path,
						previous_file_path: move.source_path,
						idempotency_key: stableKey(run_id, 'memory_notify', move.move_id),
					});
					manifest.notified.push(move.move_id);
					await persist(manifest, adapters);
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'memory_notify',
						path: move.target_path,
						code: codeOf(error, 'memory_notify_failed'),
						recovery_action: 'resume_same_run_id',
					});
				}
			}
			if (!manifest.confirmed.includes(move.move_id)) {
				let confirmed;
				try {
					confirmed = await adapters.confirm_index({
						file_path: move.target_path,
						previous_file_path: move.source_path,
						idempotency_key: stableKey(run_id, 'confirm_index', move.move_id),
					});
				} catch (error) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: codeOf(error, 'confirm_index_failed'),
						recovery_action: 'resume_same_run_id',
					});
				}
				if (!confirmResult(confirmed)) {
					return fail(manifest, adapters, {
						step: 'confirm_index',
						path: move.target_path,
						code: 'index_unconfirmed',
						recovery_action: 'wait_for_index_then_resume_same_run_id',
					});
				}
				manifest.confirmed.push(move.move_id);
				await persist(manifest, adapters);
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
		const projectCandidateKeys = new Set(
			candidates
				.filter(
					(candidate) => candidate.entity_type === 'project' && candidate.project_id === projectId,
				)
				.map((candidate) => candidate.candidate_key),
		);
		const relevantMoves = manifest.moves.filter((move) =>
			projectCandidateKeys.has(move.candidate_key),
		);
		if (!relevantMoves.every((move) => manifest.confirmed.includes(move.move_id))) continue;
		const forgetKey = stableKey(run_id, 'memory_forget', projectId);
		if (manifest.forgotten.includes(forgetKey)) continue;
		try {
			await adapters.memory_forget({
				contract_version: 2,
				scope: { type: 'project', key: projectId },
				reason: '项目归档清理',
				idempotency_key: forgetKey,
			});
			manifest.forgotten.push(forgetKey);
			await persist(manifest, adapters);
		} catch (error) {
			return fail(manifest, adapters, {
				step: 'memory_forget',
				path: projectId,
				code: codeOf(error, 'memory_forget_failed'),
				recovery_action: 'resume_same_run_id',
			});
		}
	}

	manifest.status = 'complete';
	await persist(manifest, adapters);
	return serializableClone(manifest);
}
