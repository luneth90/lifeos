import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { refreshUserprofile } from '../../active-docs/index.js';
import { getOrCreateVaultConfig } from '../../config.js';
import { assertRuntimeContract } from '../../runtime-contract.js';
import {
	archiveMemoryItem,
	listMemoryItems,
	reclassifyMemoryItem,
	restoreMemoryItem,
} from '../../services/memory-items.js';
import { resolveMemoryScopes } from '../../services/scope-resolver.js';
import type {
	ListMemoryItemsInput,
	MemoryItemKind,
	MemoryItemStatus,
	MemoryScope,
	ScopeType,
} from '../../types.js';
import { parseArgs } from '../utils/ui.js';
import { VERSION } from '../utils/version.js';

function print(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function requiredId(flags: Record<string, string | true>): number {
	const id = Number(flags.id);
	if (!Number.isInteger(id) || id <= 0) throw new Error('--id 必须是正整数');
	return id;
}

function parseScope(value: string): MemoryScope {
	const separator = value.indexOf(':');
	if (separator < 0) throw new Error('--scope 必须使用 type:key 格式');
	return {
		type: value.slice(0, separator) as ScopeType,
		key: value.slice(separator + 1),
	};
}

function refreshAuditView(db: Database.Database, vaultRoot: string): void {
	try {
		refreshUserprofile(db, vaultRoot);
	} catch (error) {
		console.warn('[lifeos] UserProfile 审计视图刷新失败：', error);
	}
}

export default async function rules(args: string[]): Promise<unknown> {
	const command = args[0] ?? 'list';
	const commands = new Set(['list', 'audit', 'export', 'classify', 'archive', 'restore']);
	if (!commands.has(command)) throw new Error(`未知 rules 命令：${command}`);
	const { positionals, flags } = parseArgs(args.slice(1), {
		id: {},
		scope: {},
		kind: {},
		status: {},
		reason: {},
		'scope-type': {},
		'scope-key': {},
		'slot-key': {},
		output: {},
	});
	const vaultRoot = resolve(positionals[0] ?? '.');
	const config = getOrCreateVaultConfig(vaultRoot);
	assertRuntimeContract({ vaultRoot, runtimeVersion: VERSION, verifyManagedAssets: true });
	const writable = ['classify', 'archive', 'restore'].includes(command);
	const db = new Database(config.dbPath(), { readonly: !writable, fileMustExist: true });
	try {
		if (command === 'list') {
			const input: ListMemoryItemsInput = { limit: 1000 };
			if (typeof flags.scope === 'string') input.scope = parseScope(flags.scope);
			if (typeof flags.kind === 'string') input.itemKind = flags.kind as MemoryItemKind;
			if (typeof flags.status === 'string') input.status = flags.status as MemoryItemStatus;
			const result = listMemoryItems(db, input);
			print(result);
			return result;
		}
		if (command === 'audit') {
			const projectOrphans = db
				.prepare(`
					SELECT item_id, scope_key FROM memory_items m
					WHERE m.scope_type = 'project'
					  AND NOT EXISTS (
						SELECT 1 FROM vault_index v
						WHERE v.type = 'project' AND v.entity_id = m.scope_key
					  )
				`)
				.all();
			const fileOrphans = db
				.prepare(`
					SELECT item_id, scope_key FROM memory_items m
					WHERE m.scope_type = 'file'
					  AND NOT EXISTS (
						SELECT 1 FROM vault_index v
						WHERE v.entity_id = m.scope_key OR v.file_path = m.scope_key
					  )
				`)
				.all();
			const repositoryIds = new Set(Object.keys(config.repositoryBindings()));
			const repositoryOrphans = (
				db
					.prepare("SELECT item_id, scope_key FROM memory_items WHERE scope_type = 'repository'")
					.all() as Array<{ item_id: number; scope_key: string }>
			).filter((row) => !repositoryIds.has(row.scope_key));
			const result = {
				ok:
					projectOrphans.length === 0 && fileOrphans.length === 0 && repositoryOrphans.length === 0,
				projectOrphans,
				fileOrphans,
				repositoryOrphans,
			};
			print(result);
			return result;
		}
		if (command === 'export') {
			const result = listMemoryItems(db, { limit: 10_000 });
			if (typeof flags.output === 'string') {
				writeFileSync(resolve(flags.output), `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
			} else {
				print(result);
			}
			return result;
		}

		const itemId = requiredId(flags);
		if (command === 'classify') {
			let scope: MemoryScope | undefined =
				typeof flags['scope-type'] === 'string' && typeof flags['scope-key'] === 'string'
					? {
							type: flags['scope-type'] as ScopeType,
							key: flags['scope-key'],
						}
					: undefined;
			const itemKind = typeof flags.kind === 'string' ? (flags.kind as MemoryItemKind) : undefined;
			const slotKey = typeof flags['slot-key'] === 'string' ? flags['slot-key'] : undefined;
			if (!scope && !itemKind && !slotKey) {
				throw new Error('classify 至少需要 scope、kind 或 slot-key 中的一项');
			}
			if (scope) {
				const resolution = resolveMemoryScopes(db, [scope], {
					config,
					allowCreate: true,
					requireRepositoryBinding: true,
				});
				if (resolution.unresolvedScopes.length > 0 || !resolution.resolvedScopes[0]) {
					throw new Error(`无法解析目标 scope：${scope.type}:${scope.key}`);
				}
				scope = resolution.resolvedScopes[0];
			}
			const result = reclassifyMemoryItem(db, { itemId, scope, itemKind, slotKey });
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		if (command === 'archive') {
			if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
				throw new Error('archive 需要 --reason');
			}
			const result = archiveMemoryItem(db, { itemId, reason: flags.reason });
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		if (command === 'restore') {
			const result = restoreMemoryItem(db, { itemId });
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		throw new Error(`未实现 rules 命令：${command}`);
	} finally {
		db.close();
	}
}
