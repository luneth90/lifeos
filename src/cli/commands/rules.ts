import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { assertVaultPathSafe } from '../../utils/safe-path.js';
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

async function createVerifiedPurgeBackup(
	db: Database.Database,
	vaultRoot: string,
	memoryDir: string,
	itemId: number,
	expectedEvents: number,
): Promise<string> {
	const backupDir = assertVaultPathSafe(vaultRoot, join(memoryDir, 'purge-backups'));
	mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	const backupPath = assertVaultPathSafe(
		vaultRoot,
		join(backupDir, `memory-before-purge-item-${itemId}-${randomUUID()}.db`),
	);
	await db.backup(backupPath);
	const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
	try {
		if (backup.pragma('integrity_check', { simple: true }) !== 'ok') {
			throw new Error('purge 数据库备份完整性校验失败');
		}
		const item = backup.prepare('SELECT status FROM memory_items WHERE item_id = ?').get(itemId) as
			| { status: string }
			| undefined;
		const eventCount = (
			backup
				.prepare('SELECT COUNT(*) AS count FROM memory_item_events WHERE item_id = ?')
				.get(itemId) as { count: number }
		).count;
		if (item?.status !== 'archived' || eventCount !== expectedEvents) {
			throw new Error('purge 数据库备份无法恢复目标投影及其完整历史');
		}
	} finally {
		backup.close();
	}
	return backupPath;
}

export default async function rules(args: string[]): Promise<unknown> {
	const command = args[0] ?? 'list';
	const commands = new Set(['list', 'audit', 'export', 'classify', 'archive', 'restore', 'purge']);
	if (!commands.has(command)) throw new Error(`未知 rules 命令：${command}`);
	const { positionals, flags } = parseArgs(args.slice(1), {
		id: {},
		'item-id': {},
		'confirm-item-id': {},
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
	const writable = ['classify', 'archive', 'restore', 'purge'].includes(command);
	const db = new Database(config.dbPath(), { readonly: !writable, fileMustExist: true });
	try {
		db.pragma('foreign_keys = ON');
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
		if (command === 'purge') {
			if (flags.id !== undefined) throw new Error('purge 需要 --item-id，不接受 --id');
			const itemId = Number(flags['item-id']);
			if (!Number.isInteger(itemId) || itemId <= 0) {
				throw new Error('purge 需要 --item-id <正整数>');
			}
			const confirmedItemId = Number(flags['confirm-item-id']);
			if (!Number.isInteger(confirmedItemId) || confirmedItemId <= 0) {
				throw new Error('purge 需要 --confirm-item-id <正整数>');
			}
			if (itemId !== confirmedItemId) throw new Error('purge 确认 item id 必须完全一致');
			if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
				throw new Error('purge 需要非空 --reason');
			}
			const item = db.prepare('SELECT status FROM memory_items WHERE item_id = ?').get(itemId) as
				| { status: string }
				| undefined;
			if (!item) throw new Error(`未找到 memory item：${itemId}`);
			if (item.status !== 'archived') throw new Error('只允许永久清除已归档条目');
			const deletedEvents = (
				db
					.prepare('SELECT COUNT(*) AS count FROM memory_item_events WHERE item_id = ?')
					.get(itemId) as { count: number }
			).count;
			const backupPath = await createVerifiedPurgeBackup(
				db,
				vaultRoot,
				config.memoryDir(),
				itemId,
				deletedEvents,
			);
			const purge = db.transaction(() => {
				const current = db
					.prepare('SELECT status FROM memory_items WHERE item_id = ?')
					.get(itemId) as { status: string } | undefined;
				const currentEvents = (
					db
						.prepare('SELECT COUNT(*) AS count FROM memory_item_events WHERE item_id = ?')
						.get(itemId) as { count: number }
				).count;
				if (current?.status !== 'archived' || currentEvents !== deletedEvents) {
					throw new Error('purge 备份后目标投影或历史发生变化，已中止删除');
				}
				const deletedProjection = db
					.prepare("DELETE FROM memory_items WHERE item_id = ? AND status = 'archived'")
					.run(itemId).changes;
				if (deletedProjection !== 1) throw new Error('purge 投影删除数量异常');
				const remainingEvents = (
					db
						.prepare('SELECT COUNT(*) AS count FROM memory_item_events WHERE item_id = ?')
						.get(itemId) as { count: number }
				).count;
				if (remainingEvents !== 0) throw new Error('purge 事件删除数量异常');
				return deletedProjection;
			});
			const deletedProjection = purge.immediate();
			const result = { itemId, deletedProjection, deletedEvents, backupPath };
			refreshAuditView(db, vaultRoot);
			print(result);
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
			const result = reclassifyMemoryItem(db, {
				itemId,
				scope,
				itemKind,
				slotKey,
				reason: typeof flags.reason === 'string' ? flags.reason : undefined,
				actor: 'cli:rules:classify',
				correlationId: `cli:rules:classify:item:${itemId}`,
			});
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		if (command === 'archive') {
			if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
				throw new Error('archive 需要 --reason');
			}
			const result = archiveMemoryItem(db, {
				itemId,
				reason: flags.reason,
				actor: 'cli:rules:archive',
				correlationId: `cli:rules:archive:item:${itemId}`,
			});
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		if (command === 'restore') {
			const result = restoreMemoryItem(db, {
				itemId,
				reason: typeof flags.reason === 'string' ? flags.reason : undefined,
				actor: 'cli:rules:restore',
				correlationId: `cli:rules:restore:item:${itemId}`,
			});
			refreshAuditView(db, vaultRoot);
			print(result);
			return result;
		}
		throw new Error(`未实现 rules 命令：${command}`);
	} finally {
		db.close();
	}
}
