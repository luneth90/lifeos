import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScopedRulesIndexSection } from '../../src/active-docs/userprofile.js';
import { initDb } from '../../src/db/schema.js';
import {
	MemoryItemConflictError,
	MemoryItemValidationError,
	archiveMemoryItem,
	expireMemoryItems,
	forgetScopeMemoryItems,
	getMemoryItemById,
	listMemoryItems,
	reclassifyMemoryItem,
	restoreMemoryItem,
	upsertMemoryItem,
} from '../../src/services/memory-items.js';

describe('V4 记忆条目治理', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('以 scope 与 slotKey 的复合身份分别创建和更新条目', () => {
		const global = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '全局保持简洁',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
		});
		const project = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '本项目需要完整推导',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
			source: 'correction',
		});

		expect(global.itemId).not.toBe(project.itemId);
		expect(listMemoryItems(db, { slotKey: 'format:answer' })).toHaveLength(2);

		const updated = upsertMemoryItem(db, {
			slotKey: 'format:answer',
			content: '全局只保留结论',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'correction',
		});
		expect(updated.action).toBe('updated');
		expect(updated.itemId).toBe(global.itemId);
		expect(getMemoryItemById(db, project.itemId)?.content).toBe('本项目需要完整推导');
	});

	it('更新时不允许 correction 降级，也不允许隐式改变 itemKind', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '必须使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'correction',
		});
		const updated = upsertMemoryItem(db, {
			slotKey: 'content:language',
			content: '继续使用中文',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			source: 'preference',
		});
		expect(updated.source).toBe('correction');
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'content:language',
				content: '语言事实',
				itemKind: 'fact',
				scope: { type: 'global', key: '' },
			}),
		).toThrow(MemoryItemConflictError);
		expect(getMemoryItemById(db, created.itemId)?.itemKind).toBe('rule');
	});

	it('拒绝非法 slot、scope、优先级、关联文件和 event 写入', () => {
		const base = {
			content: '内容',
			itemKind: 'rule' as const,
			scope: { type: 'global' as const, key: '' },
		};
		expect(() => upsertMemoryItem(db, { ...base, slotKey: 'Bad Key' })).toThrow(
			MemoryItemValidationError,
		);
		expect(() =>
			upsertMemoryItem(db, {
				...base,
				slotKey: 'scope:bad',
				scope: { type: 'global', key: 'not-empty' },
			}),
		).toThrow(MemoryItemValidationError);
		expect(() => upsertMemoryItem(db, { ...base, slotKey: 'priority:bad', priority: 101 })).toThrow(
			MemoryItemValidationError,
		);
		expect(() =>
			upsertMemoryItem(db, { ...base, slotKey: 'files:bad', relatedFiles: [''] }),
		).toThrow(MemoryItemValidationError);
		expect(() =>
			upsertMemoryItem(db, {
				...base,
				slotKey: 'event:bad',
				itemKind: 'event',
			}),
		).toThrow(MemoryItemValidationError);
	});

	it('按 hard、priority、correction 的治理顺序列出条目', () => {
		upsertMemoryItem(db, {
			slotKey: 'order:soft',
			content: '软规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 100,
		});
		upsertMemoryItem(db, {
			slotKey: 'order:hard-low',
			content: '低优先级硬规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 10,
			enforcement: 'hard',
		});
		upsertMemoryItem(db, {
			slotKey: 'order:hard-high',
			content: '高优先级硬规则',
			itemKind: 'rule',
			scope: { type: 'global', key: '' },
			priority: 90,
			enforcement: 'hard',
			source: 'correction',
		});

		expect(listMemoryItems(db).map((item) => item.slotKey)).toEqual([
			'order:hard-high',
			'order:hard-low',
			'order:soft',
		]);
	});

	it('归档后拒绝普通 upsert，并可通过治理接口恢复', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'workflow:review',
			content: '每周复盘',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'today' },
		});
		const archived = archiveMemoryItem(db, {
			itemId: created.itemId,
			reason: '暂时停用',
			archivedAt: '2026-07-20T00:00:00.000Z',
		});
		expect(archived).toMatchObject({ status: 'archived', archiveReason: '暂时停用' });
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'workflow:review',
				content: '恢复复盘',
				itemKind: 'rule',
				scope: { type: 'skill', key: 'today' },
			}),
		).toThrow(MemoryItemConflictError);

		const restored = restoreMemoryItem(db, {
			itemId: created.itemId,
			restoredAt: '2026-07-21T00:00:00.000Z',
		});
		expect(restored).toMatchObject({ status: 'active', archivedAt: null, archiveReason: null });
	});

	it('仅允许已归档条目重分类为 event，且 event 不可恢复', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'decision:old',
			content: '采用方案甲',
			itemKind: 'decision',
			scope: { type: 'project', key: 'project-1' },
		});
		expect(() => reclassifyMemoryItem(db, { itemId: created.itemId, itemKind: 'event' })).toThrow(
			MemoryItemConflictError,
		);
		archiveMemoryItem(db, { itemId: created.itemId, reason: '已完成决策' });
		const event = reclassifyMemoryItem(db, {
			itemId: created.itemId,
			itemKind: 'event',
			slotKey: 'event:decision-old',
		});
		expect(event.itemKind).toBe('event');
		expect(() => restoreMemoryItem(db, { itemId: created.itemId })).toThrow(
			MemoryItemConflictError,
		);
	});

	it('重分类遇到复合键冲突时保持原条目不变', () => {
		const first = upsertMemoryItem(db, {
			slotKey: 'fact:topic',
			content: '项目甲事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-a' },
		});
		upsertMemoryItem(db, {
			slotKey: 'fact:topic',
			content: '项目乙事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-b' },
		});
		expect(() =>
			reclassifyMemoryItem(db, {
				itemId: first.itemId,
				scope: { type: 'project', key: 'project-b' },
			}),
		).toThrow(MemoryItemConflictError);
		expect(getMemoryItemById(db, first.itemId)?.scope).toEqual({
			type: 'project',
			key: 'project-a',
		});
	});

	it.each(['create', 'update', 'archive', 'restore', 'reclassify', 'expire'] as const)(
		'%s 事件插入失败时不部分改变投影',
		(eventType) => {
			let itemId: number | undefined;
			if (eventType !== 'create') {
				const created = upsertMemoryItem(db, {
					slotKey: 'fact:atomicity',
					content: '原始内容',
					itemKind: 'fact',
					scope: { type: 'project', key: 'project-before' },
					actor: 'test:setup',
					correlationId: 'setup:create',
					occurredAt: '2026-08-09T00:00:00.000Z',
					expiresAt: eventType === 'expire' ? '2026-08-09T00:30:00.000Z' : undefined,
				});
				itemId = created.itemId;
				if (eventType === 'restore') {
					archiveMemoryItem(db, {
						itemId,
						reason: '准备恢复测试',
						actor: 'test:setup',
						correlationId: 'setup:archive',
						archivedAt: '2026-08-09T00:01:00.000Z',
					});
				}
			}
			const projectionBefore = db.prepare('SELECT * FROM memory_items ORDER BY item_id').all();
			const eventCountBefore = (
				db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get() as { count: number }
			).count;
			db.exec(`
				CREATE TRIGGER reject_${eventType}_event
				BEFORE INSERT ON memory_item_events
				WHEN new.event_type = '${eventType}'
				BEGIN
					SELECT RAISE(ABORT, '测试注入：${eventType} 事件失败');
				END;
			`);

			const mutate = (): unknown => {
				switch (eventType) {
					case 'create':
						return upsertMemoryItem(db, {
							slotKey: 'fact:atomicity',
							content: '新内容',
							itemKind: 'fact',
							scope: { type: 'project', key: 'project-before' },
							actor: 'test:atomicity',
							correlationId: 'atomicity:create',
							occurredAt: '2026-08-09T01:00:00.000Z',
						});
					case 'update':
						return upsertMemoryItem(db, {
							slotKey: 'fact:atomicity',
							content: '更新内容',
							itemKind: 'fact',
							scope: { type: 'project', key: 'project-before' },
							actor: 'test:atomicity',
							correlationId: 'atomicity:update',
							occurredAt: '2026-08-09T01:00:00.000Z',
						});
					case 'archive':
						return archiveMemoryItem(db, {
							itemId: itemId as number,
							reason: '原子性测试',
							actor: 'test:atomicity',
							correlationId: 'atomicity:archive',
							archivedAt: '2026-08-09T01:00:00.000Z',
						});
					case 'restore':
						return restoreMemoryItem(db, {
							itemId: itemId as number,
							reason: '原子性测试',
							actor: 'test:atomicity',
							correlationId: 'atomicity:restore',
							restoredAt: '2026-08-09T01:00:00.000Z',
						});
					case 'reclassify':
						return reclassifyMemoryItem(db, {
							itemId: itemId as number,
							scope: { type: 'project', key: 'project-after' },
							reason: '原子性测试',
							actor: 'test:atomicity',
							correlationId: 'atomicity:reclassify',
							updatedAt: '2026-08-09T01:00:00.000Z',
						});
					case 'expire':
						return expireMemoryItems(db, {
							now: '2026-08-09T01:00:00.000Z',
							actor: 'test:atomicity',
							correlationId: 'atomicity:expire',
						});
				}
			};

			expect(mutate).toThrow(new RegExp(`${eventType} 事件失败`));
			expect(db.prepare('SELECT * FROM memory_items ORDER BY item_id').all()).toEqual(
				projectionBefore,
			);
			expect(
				(db.prepare('SELECT COUNT(*) AS count FROM memory_item_events').get() as { count: number })
					.count,
			).toBe(eventCountBefore);
		},
	);

	it('批量 scope archive 任一事件失败时整批投影与历史回滚', () => {
		for (const slotKey of ['fact:batch-a', 'fact:batch-b']) {
			upsertMemoryItem(db, {
				slotKey,
				content: slotKey,
				itemKind: 'fact',
				scope: { type: 'project', key: 'project-batch' },
			});
		}
		const projections = db.prepare('SELECT * FROM memory_items ORDER BY item_id').all();
		const events = db.prepare('SELECT * FROM memory_item_events ORDER BY event_id').all();
		db.exec(`
			CREATE TRIGGER reject_second_batch_archive
			BEFORE INSERT ON memory_item_events
			WHEN new.event_type = 'archive' AND new.item_id = 2
			BEGIN
				SELECT RAISE(ABORT, '测试注入：第二条批量归档事件失败');
			END;
		`);

		expect(() =>
			forgetScopeMemoryItems(db, { type: 'project', key: 'project-batch' }, '批量归档'),
		).toThrow(/第二条批量归档事件失败/);
		expect(db.prepare('SELECT * FROM memory_items ORDER BY item_id').all()).toEqual(projections);
		expect(db.prepare('SELECT * FROM memory_item_events ORDER BY event_id').all()).toEqual(events);
	});

	it('过期操作支持 dryRun，并只更新到期的 active 条目', () => {
		const expired = upsertMemoryItem(db, {
			slotKey: 'temporary:past',
			content: '已到期',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			expiresAt: '2026-07-20T00:00:00.000Z',
		});
		const future = upsertMemoryItem(db, {
			slotKey: 'temporary:future',
			content: '尚未到期',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			expiresAt: '2026-07-22T00:00:00.000Z',
		});
		expect(expireMemoryItems(db, { now: '2026-07-21T00:00:00.000Z', dryRun: true })).toEqual({
			expired: 1,
			dryRun: true,
		});
		expect(getMemoryItemById(db, expired.itemId)?.status).toBe('active');
		expect(
			expireMemoryItems(db, {
				now: '2026-07-21T00:00:00.000Z',
				actor: 'test:expiry',
				correlationId: 'expiry:normal',
			}),
		).toEqual({
			expired: 1,
			dryRun: false,
		});
		expect(getMemoryItemById(db, expired.itemId)?.status).toBe('expired');
		expect(getMemoryItemById(db, future.itemId)?.status).toBe('active');
		const event = db
			.prepare("SELECT * FROM memory_item_events WHERE event_type = 'expire'")
			.get() as Record<string, unknown>;
		expect(event).toMatchObject({
			item_id: expired.itemId,
			actor: 'test:expiry',
			correlation_id: 'expiry:normal',
		});
		expect(JSON.parse(event.before_json as string)).toMatchObject({ status: 'active' });
		expect(JSON.parse(event.after_json as string)).toMatchObject({ status: 'expired' });
	});

	it('双连接在写事务建立前延长 expires_at 后，不消费事务外旧候选', () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-expire-race-'));
		const path = join(root, 'memory.db');
		const primary = new Database(path);
		const concurrent = new Database(path);
		try {
			primary.pragma('journal_mode = WAL');
			initDb(primary);
			const created = upsertMemoryItem(primary, {
				slotKey: 'temporary:race',
				content: '扫描时的旧内容',
				itemKind: 'fact',
				scope: { type: 'global', key: '' },
				expiresAt: '2026-08-09T00:00:00.000Z',
				occurredAt: '2026-08-08T00:00:00.000Z',
			});
			let injected = false;
			const racedDb = new Proxy(primary, {
				get(target, property) {
					if (property === 'transaction') {
						return (callback: () => unknown) => {
							if (!injected) {
								concurrent
									.prepare(
										'UPDATE memory_items SET content = ?, expires_at = ?, updated_at = ? WHERE item_id = ?',
									)
									.run(
										'并发更新后的内容',
										'2026-08-11T00:00:00.000Z',
										'2026-08-09T00:30:00.000Z',
										created.itemId,
									);
								injected = true;
							}
							return target.transaction(callback);
						};
					}
					const value = Reflect.get(target, property, target);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			}) as Database.Database;

			expect(expireMemoryItems(racedDb, { now: '2026-08-10T00:00:00.000Z' })).toEqual({
				expired: 0,
				dryRun: false,
			});
			expect(getMemoryItemById(primary, created.itemId)).toMatchObject({
				status: 'active',
				content: '并发更新后的内容',
				expiresAt: '2026-08-11T00:00:00.000Z',
			});
			expect(
				primary
					.prepare("SELECT COUNT(*) AS count FROM memory_item_events WHERE event_type = 'expire'")
					.get(),
			).toEqual({ count: 0 });
		} finally {
			concurrent.close();
			primary.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('事务内 fresh 候选在 UPDATE 前变为未到期时，谓词跳过投影与事件', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'temporary:predicate-race',
			content: '事务读取时的内容',
			itemKind: 'fact',
			scope: { type: 'global', key: '' },
			expiresAt: '2026-08-09T00:00:00.000Z',
			occurredAt: '2026-08-08T00:00:00.000Z',
		});
		let injected = false;
		const guardedDb = new Proxy(db, {
			get(target, property) {
				if (property === 'prepare') {
					return (sql: string) => {
						const statement = target.prepare(sql);
						if (!sql.includes("UPDATE memory_items SET status = 'expired'")) return statement;
						return new Proxy(statement, {
							get(statementTarget, statementProperty) {
								if (statementProperty === 'run') {
									return (updatedAt: string, itemId: number, cutoff: string) => {
										if (!injected) {
											target
												.prepare(
													'UPDATE memory_items SET content = ?, expires_at = ?, updated_at = ? WHERE item_id = ?',
												)
												.run(
													'谓词执行前的新内容',
													'2026-08-11T00:00:00.000Z',
													'2026-08-09T00:30:00.000Z',
													created.itemId,
												);
											injected = true;
										}
										return statementTarget.run(updatedAt, itemId, cutoff);
									};
								}
								const value = Reflect.get(statementTarget, statementProperty, statementTarget);
								return typeof value === 'function' ? value.bind(statementTarget) : value;
							},
						});
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as Database.Database;

		expect(expireMemoryItems(guardedDb, { now: '2026-08-10T00:00:00.000Z' })).toEqual({
			expired: 0,
			dryRun: false,
		});
		expect(getMemoryItemById(db, created.itemId)).toMatchObject({
			status: 'active',
			content: '谓词执行前的新内容',
			expiresAt: '2026-08-11T00:00:00.000Z',
		});
		expect(
			db
				.prepare("SELECT COUNT(*) AS count FROM memory_item_events WHERE event_type = 'expire'")
				.get(),
		).toEqual({ count: 0 });
	});
});

describe('临时文件作用域防写校验', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
		db.prepare(
			`INSERT INTO vault_index (file_path, title, type, status, entity_id)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('60_计划/Plan_test.md', '测试计划', 'plan', 'active', 'plan-test');
		db.prepare(
			`INSERT INTO vault_index (file_path, title, type, status, entity_id)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('00_草稿/ask_test.md', '测试草稿', 'draft', 'pending', 'ask-test');
		db.prepare(
			`INSERT INTO vault_index (file_path, title, type, status, entity_id)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('60_计划/Plan_no_id.md', '无 id 计划', 'plan', 'active', null);
		db.prepare(
			`INSERT INTO vault_index (file_path, title, type, status, entity_id)
			 VALUES (?, ?, ?, ?, ?)`,
		).run('40_知识/note.md', '知识笔记', 'knowledge', 'active', 'note-1');
	});

	afterEach(() => db.close());

	it('禁止为 plan 类型文件的 file 作用域（entity_id 形式 key）写入 memory_log', () => {
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'decision:route',
				content: '阶段性路线决策',
				itemKind: 'decision',
				scope: { type: 'file', key: 'plan-test' },
			}),
		).toThrow(MemoryItemValidationError);
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'decision:route',
				content: '阶段性路线决策',
				itemKind: 'decision',
				scope: { type: 'file', key: 'plan-test' },
			}),
		).toThrow(/临时计划或草稿文件/);
	});

	it('禁止为 draft 类型文件的 file 作用域（entity_id 形式 key）写入 memory_log', () => {
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'fact:temp',
				content: '草稿阶段事实',
				itemKind: 'fact',
				scope: { type: 'file', key: 'ask-test' },
			}),
		).toThrow(MemoryItemValidationError);
	});

	it('禁止为无 frontmatter id、key 为路径形式的 plan/draft 文件写入 memory_log', () => {
		expect(() =>
			upsertMemoryItem(db, {
				slotKey: 'decision:route',
				content: '阶段性路线决策',
				itemKind: 'decision',
				scope: { type: 'file', key: '60_计划/Plan_no_id.md' },
			}),
		).toThrow(MemoryItemValidationError);
	});

	it('正常 file 作用域（vault_index 中 type 非 plan/draft）不受拦截', () => {
		const byId = upsertMemoryItem(db, {
			slotKey: 'fact:note',
			content: '知识笔记事实',
			itemKind: 'fact',
			scope: { type: 'file', key: 'note-1' },
		});
		expect(byId.action).toBe('created');
		const byPath = upsertMemoryItem(db, {
			slotKey: 'fact:note-path',
			content: '路径形式 key 的知识笔记事实',
			itemKind: 'fact',
			scope: { type: 'file', key: '40_知识/note.md' },
		});
		expect(byPath.action).toBe('created');
	});

	it('reclassifyMemoryItem 改挂到 plan/draft 文件作用域被阻断', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'fact:movable',
			content: '可移动事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-1' },
		});
		expect(() =>
			reclassifyMemoryItem(db, {
				itemId: created.itemId,
				scope: { type: 'file', key: 'plan-test' },
			}),
		).toThrow(MemoryItemValidationError);
		expect(() =>
			reclassifyMemoryItem(db, {
				itemId: created.itemId,
				scope: { type: 'file', key: '60_计划/Plan_no_id.md' },
			}),
		).toThrow(MemoryItemValidationError);
		expect(getMemoryItemById(db, created.itemId)?.scope).toEqual({
			type: 'project',
			key: 'project-1',
		});
	});
});

describe('forgetScopeMemoryItems 批量归档', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		initDb(db);
	});

	afterEach(() => db.close());

	it('成功批量归档指定 Scope 的所有 active 记忆，返回正确 changes 数', () => {
		upsertMemoryItem(db, {
			slotKey: 'rule:a',
			content: '规则甲',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});
		upsertMemoryItem(db, {
			slotKey: 'rule:b',
			content: '规则乙',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});
		upsertMemoryItem(db, {
			slotKey: 'rule:c',
			content: '其他项目规则',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-2' },
		});

		const archived = forgetScopeMemoryItems(
			db,
			{ type: 'project', key: 'project-1' },
			'项目归档清理',
		);
		expect(archived).toBe(2);
		expect(
			listMemoryItems(db, { scope: { type: 'project', key: 'project-1' }, status: 'active' }),
		).toHaveLength(0);
		expect(
			listMemoryItems(db, { scope: { type: 'project', key: 'project-2' }, status: 'active' }),
		).toHaveLength(1);
	});

	it('归档后 archived_at 和 archive_reason 字段正确写入', () => {
		const created = upsertMemoryItem(db, {
			slotKey: 'rule:a',
			content: '规则甲',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});
		forgetScopeMemoryItems(db, { type: 'project', key: 'project-1' }, '项目归档清理');
		const item = getMemoryItemById(db, created.itemId);
		expect(item?.status).toBe('archived');
		expect(item?.archivedAt).toEqual(expect.any(String));
		expect(item?.archiveReason).toBe('项目归档清理');
	});

	it('对不存在的 scope 返回 changes: 0', () => {
		expect(forgetScopeMemoryItems(db, { type: 'project', key: 'missing' }, '清理')).toBe(0);
	});

	it('禁止批量归档 global scope', () => {
		expect(() => forgetScopeMemoryItems(db, { type: 'global', key: '' }, '清理')).toThrow(
			MemoryItemValidationError,
		);
		expect(() => forgetScopeMemoryItems(db, { type: 'global', key: '' }, '清理')).toThrow(
			/禁止批量归档 global scope/,
		);
	});

	it('归档原因不能为空', () => {
		expect(() => forgetScopeMemoryItems(db, { type: 'project', key: 'project-1' }, '  ')).toThrow(
			MemoryItemValidationError,
		);
	});

	it('只清 active，expired 条目保持不动', () => {
		const expired = upsertMemoryItem(db, {
			slotKey: 'fact:old',
			content: '已过期事实',
			itemKind: 'fact',
			scope: { type: 'project', key: 'project-1' },
			expiresAt: '2026-07-20T00:00:00.000Z',
		});
		expireMemoryItems(db, { now: '2026-07-21T00:00:00.000Z' });
		upsertMemoryItem(db, {
			slotKey: 'rule:active',
			content: '活跃规则',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});

		const archived = forgetScopeMemoryItems(
			db,
			{ type: 'project', key: 'project-1' },
			'项目归档清理',
		);
		expect(archived).toBe(1);
		const expiredItem = getMemoryItemById(db, expired.itemId);
		expect(expiredItem?.status).toBe('expired');
		expect(expiredItem?.archivedAt).toBeNull();
		expect(expiredItem?.archiveReason).toBeNull();
	});

	it('归档后 UserProfile scoped-rules-index 不再展示已清理作用域', () => {
		upsertMemoryItem(db, {
			slotKey: 'rule:a',
			content: '规则甲',
			itemKind: 'rule',
			scope: { type: 'project', key: 'project-1' },
		});
		upsertMemoryItem(db, {
			slotKey: 'rule:b',
			content: '规则乙',
			itemKind: 'rule',
			scope: { type: 'skill', key: 'revise' },
		});
		const before = buildScopedRulesIndexSection(db);
		expect(before).toContain('project:project-1');
		expect(before).toContain('skill:revise');

		forgetScopeMemoryItems(db, { type: 'project', key: 'project-1' }, '项目归档清理');
		const after = buildScopedRulesIndexSection(db);
		expect(after).not.toContain('project:project-1');
		expect(after).toContain('skill:revise');
	});
});
