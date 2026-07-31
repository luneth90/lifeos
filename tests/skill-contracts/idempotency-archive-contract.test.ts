import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const decisions = ['create', 'merge', 'resume', 'skip', 'replace'];

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function contract(path: string): Record<string, unknown> {
	const match = read(path).match(/<!--\s*operation-safety-v1\s*-->\s*\n```yaml\n([\s\S]*?)\n```/m);
	if (!match) throw new Error(`缺少 operation-safety-v1：${path}`);
	return parseYaml(match[1]) as Record<string, unknown>;
}

function frontmatter(path: string): Record<string, unknown> {
	const match = read(path).match(/^---\n([\s\S]*?)\n---/);
	if (!match) throw new Error(`缺少 Frontmatter：${path}`);
	return parseYaml(match[1]) as Record<string, unknown>;
}

const sharedContract = {
	contract_version: 1,
	preflight: 'required',
	validation: 'required',
	notification: 'memory_notify',
	collision: 'preflight_required',
	recovery: 'resume_same_run_id',
	run_id: 'stable(<skill>, <canonical-input>, <time-window-or-mode>)',
	target_path: 'resolved-vault-relative-path',
	decision: decisions,
	path_guard: {
		resolve_scope: 'preflight_only',
		create: 'createVaultPathGuard',
		revalidate: 'revalidateVaultPathGuard',
		advance: 'advanceVaultPathGuard',
		captures: ['ancestors', 'leaf_state', 'leaf_type', 'leaf_dev', 'leaf_ino', 'leaf_realpath'],
		default_leaf_expectation: 'unchanged',
		transitions: {
			create_or_update_target: { before: 'missing', after: 'existing' },
			move_source: { before: 'existing', after: 'missing' },
			move_target: { before: 'missing', after: 'existing' },
		},
		required_at: ['before_operation', 'after_operation'],
		on_change: 'abort_and_record',
		atomic_race_guarantee: false,
		untrusted_concurrency: 'require_atomic_client_capability',
	},
	directory_creation: {
		create_guard: 'createVaultDirectoryGuard',
		ensure: 'ensureVaultDirectory',
		strategy: 'guard_revalidate_single_level_mkdir_advance_revalidate',
		recursive_mkdir: false,
	},
	manifest: { run_id: 'string', moves: [], collisions: [], notified: [], errors: [] },
};

const operations = [
	{
		name: 'ask',
		runId: 'stable(ask, normalized-topic, YYYY-MM-DD)',
		zh: '{草稿目录}/<draft-id>.md',
		en: '{drafts directory}/<draft-id>.md',
		extra: { on_existing: 'merge', preserve: ['sources'] },
	},
	{
		name: 'today',
		runId: 'stable(today, YYYY-MM-DD, selected-items)',
		zh: '{日记目录}/YYYY-MM-DD.md',
		en: '{diary directory}/YYYY-MM-DD.md',
		extra: {
			on_existing: 'merge',
			stable_item_key: 'task_id',
			managed_regions: ['tasks', 'related-projects'],
		},
	},
	{
		name: 'digest',
		runId: 'stable(digest, config-hash, time-window)',
		zh: '{草稿目录}/<topic>-<window>.md',
		en: '{drafts directory}/<topic>-<window>.md',
		extra: {
			on_existing: 'merge',
			input_transport: ['stdin', 'input_file'],
			source_ledger_fields: ['published_at', 'fetched_at', 'health', 'errors'],
			fail_closed: ['unknown_module', 'missing_required_config', 'all_sources_failed'],
			partial_failure_status: 'partial',
		},
	},
	{
		name: 'research',
		runId: 'stable(research, normalized-input, plan_revision, confirmed_hash)',
		zh: '{研究目录}/<research-id>.md',
		en: '{research directory}/<research-id>.md',
		extra: { on_draft: 'resume', replace_requires: 'explicit_user_request' },
	},
	{
		name: 'translate',
		runId: 'stable(translate, source-pdf, chapter-range, extraction-hash)',
		zh: '{资源目录}/{翻译子目录}/<书名>/<章节名>.md',
		en: '{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md',
		extra: { on_draft: 'resume', replace_requires: 'explicit_user_request' },
	},
	{
		name: 'revise',
		runId: 'stable(revise, knowledge-note-id, mode, note-hash)',
		zh: '{知识目录}/<chapter>/复习_<run-id>.md',
		en: '{knowledge directory}/<chapter>/Review_<run-id>.md',
		extra: {
			on_pending: 'resume',
			question_fields: ['knowledge_point_id', 'source_refs', 'rubric'],
			note_hash_mismatch: 'regenerate',
			pass_threshold: 0.8,
			blindspot_state_advance: false,
		},
	},
] as const;

describe('阶段五幂等与归档契约', () => {
	it('中英文共享协议逐字段同构并声明 guard 的边界', () => {
		const zh = contract('assets/skills/_shared/operation-safety.zh.md');
		const en = contract('assets/skills/_shared/operation-safety.en.md');
		expect(zh).toEqual(sharedContract);
		expect(en).toEqual(sharedContract);
	});

	it.each(operations)('$name 中英文契约具有精确字段和值', ({ name, runId, zh, en, extra }) => {
		const base = {
			contract_version: 1,
			safety_protocol: 'operation-safety-v1',
			operation: name,
			run_id: runId,
			decision: decisions,
			...extra,
		};
		expect(contract(`assets/skills/${name}/SKILL.zh.md`)).toEqual({ ...base, target_path: zh });
		expect(contract(`assets/skills/${name}/SKILL.en.md`)).toEqual({ ...base, target_path: en });
	});

	it('Archive 机器契约固定通知、索引确认和遗忘顺序', () => {
		const extra = {
			adapter: 'scripts/archive_transaction.mjs',
			external_callbacks: [
				'persist_manifest',
				'verify_manifest_receipt',
				'move_with_link_update',
				'memory_notify',
				'confirm_index',
				'memory_forget',
			],
			transaction_steps: [
				'preflight_all',
				'create_target_parents',
				'freeze_inventory',
				'persist_manifest',
				'persist_move_intent',
				'revalidate_inventory',
				'create_fresh_move_guards',
				'move_once',
				'advance_move_guards',
				'record_file_moves',
				'persist_move_receipt',
				'memory_notify_each',
				'confirm_index_each',
				'memory_forget_project',
			],
			directory_creation: {
				create_guard: 'createVaultDirectoryGuard',
				ensure: 'ensureVaultDirectory',
				recursive_mkdir: 'forbidden',
			},
			inventory: {
				freeze_before_move: 'all_candidate_files',
				revalidate_after_each_persist: true,
				subitem_names: 'nfc_exact_no_control_windows_safe',
				entity_shapes: 'project_file_or_nonempty_directory_others_file_only',
				directory_move: 'once',
				manifest_moves: 'per_file_source_target',
			},
			move_guards: {
				intent_persisted_before_revalidation: true,
				fresh_after_intent_persist: true,
				last_revalidate_adjacent_to_call: true,
				source: { before: 'existing', after: 'missing' },
				target: { before: 'missing', after: 'existing' },
				advance: 'advanceVaultPathGuard',
			},
			persistence: {
				manifest_contract_version: 2,
				persist_callback: 'persist_manifest',
				verify_callback: 'verify_manifest_receipt',
				envelope_keys: ['manifest', 'persistence_receipt', 'persistence_state'],
				receipt_required_for_resume: true,
				unauthenticated_resume: 'fail_closed_manual_recovery',
				schema: 'recursive_exact_keys_and_derived_ids',
			},
			effects: {
				intent_before_side_effect: 'persisted',
				receipt_after_side_effect: 'persisted',
				resume: 'trusted_receipt_or_same_idempotency_key_replay',
				malformed_result: 'stop_and_record',
			},
			notify: {
				contract_version: 2,
				file_path: '<new-vault-relative-path>',
				previous_file_path: '<old-vault-relative-path>',
			},
			forget: {
				scope_type: 'project',
				allowed_after: 'all_project_files_confirmed',
				forbidden_entity_types: ['draft', 'plan', 'diary'],
				forbidden_when: ['move_failed', 'notify_failed', 'index_unconfirmed'],
			},
			manifest_updates: {
				candidate: 'candidates',
				inventory: 'inventories',
				move_state: 'candidate_states',
				move: 'moves',
				collision: 'collisions',
				intent: 'intents',
				move_receipt: 'move_receipts',
				memory_notify: 'notified',
				confirm_index: 'confirmed',
				memory_forget: 'forgotten',
				failure: 'errors',
			},
			resume: {
				required_match: ['run_id', 'candidates', 'inventories', 'derived_ids', 'receipt'],
				moved_state: 'source_missing_target_existing',
				source_restored: 'reject',
				skip_confirmed_files: 'trusted_receipt_only',
				external_idempotency_key: 'required',
			},
			stop_semantics: {
				any_failure: 'stop_entire_run',
				resume: 'same_run_id_same_authenticated_envelope',
				continue_other_candidates: false,
			},
			guarantees: {
				exactly_once: false,
				atomic_cross_system: false,
				last_revalidate_to_syscall_atomic: false,
			},
			post_transaction_writes: {
				current_run: 'forbidden',
				archived_frontmatter: 'separate_guarded_operation',
				diary_log: 'separate_guarded_operation',
			},
			bare_mv: 'forbidden',
		};
		for (const [lang, targets] of [
			[
				'zh',
				{
					'project-file': '{系统目录}/{归档项目子目录}/YYYY/<project-name>.md',
					'project-directory': '{系统目录}/{归档项目子目录}/YYYY/<project-name>/',
					draft: '{系统目录}/{归档草稿子目录}/YYYY/MM/<filename>.md',
					plan: '{系统目录}/{归档计划子目录}/<filename>.md',
					diary: '{系统目录}/{归档日记子目录}/YYYY/MM/YYYY-MM-DD.md',
				},
			],
			[
				'en',
				{
					'project-file':
						'{system directory}/{archived projects subdirectory}/YYYY/<project-name>.md',
					'project-directory':
						'{system directory}/{archived projects subdirectory}/YYYY/<project-name>/',
					draft: '{system directory}/{archived drafts subdirectory}/YYYY/MM/<filename>.md',
					plan: '{system directory}/{archived plans subdirectory}/<filename>.md',
					diary: '{system directory}/{archived diary subdirectory}/YYYY/MM/YYYY-MM-DD.md',
				},
			],
		] as const) {
			const path = `assets/skills/archive/SKILL.${lang}.md`;
			expect(frontmatter(path).dependencies).toMatchObject({
				scripts: [{ path: 'scripts/archive_transaction.mjs' }],
			});
			expect(contract(path)).toEqual({
				contract_version: 1,
				safety_protocol: 'operation-safety-v1',
				operation: 'archive',
				run_id: 'stable(archive, candidate-paths, archive-date)',
				target_paths: targets,
				decision: decisions,
				...extra,
			});
		}
	});

	it('Archive 双语说明禁止在已完成事务后执行未受清单保护的写入', () => {
		expect(read('assets/skills/archive/SKILL.zh.md')).toContain(
			'本次 Archive run 禁止在事务完成后直接改写归档目标 frontmatter 或今日日记',
		);
		expect(read('assets/skills/archive/SKILL.en.md')).toContain(
			'This Archive run must not directly rewrite archived-target frontmatter or today’s diary after the transaction completes',
		);
	});

	it('Project、Knowledge 与 Brainstorm 声明真实写集及非原子恢复边界', () => {
		const common = {
			guard: {
				artifacts: 'create_or_update_target',
				status_targets: 'unchanged_until_validated',
			},
			manifest: {
				records: ['artifacts', 'status_mutations', 'validation', 'notified', 'errors'],
				commit_order: ['guard', 'write', 'validate', 'memory_notify', 'mutate_status'],
			},
			recovery: {
				strategy: 'resume_same_run_id',
				preserve_sources_on_failure: true,
				atomic_cross_system_guarantee: false,
			},
		};
		const cases = [
			{
				skill: 'project',
				runId: 'stable(project, normalized-input, plan_revision, confirmed_hash)',
				zhTargets: {
					plan: '{计划目录}/Plan_YYYY-MM-DD_Project_<ProjectName>.md',
					'main-project': '{项目目录}/<ProjectName>.md',
					'development-main-project': '{项目目录}/<ProjectName>/<ProjectName>.md',
					'project-doc': '{项目目录}/<ProjectName>/文档/<DocumentName>.md',
				},
				enTargets: {
					plan: '{plans directory}/Plan_YYYY-MM-DD_Project_<ProjectName>.md',
					'main-project': '{projects directory}/<ProjectName>.md',
					'development-main-project': '{projects directory}/<ProjectName>/<ProjectName>.md',
					'project-doc': '{projects directory}/<ProjectName>/Docs/<DocumentName>.md',
				},
				statusMutations: [
					'plan:pending->active->done|failed|cancelled',
					'source-draft:pending->done(after-validation)',
					'project:create-active',
				],
			},
			{
				skill: 'knowledge',
				runId: 'stable(knowledge, source-hash, project-or-standalone, topic)',
				zhTargets: {
					'book-knowledge-note':
						'{知识目录}/{笔记子目录}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
					'paper-knowledge-note': '{知识目录}/{笔记子目录}/<Domain>/<PaperName>.md',
					wiki: '{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md',
				},
				enTargets: {
					'book-knowledge-note':
						'{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
					'paper-knowledge-note':
						'{knowledge directory}/{notes subdirectory}/<Domain>/<PaperName>.md',
					wiki: '{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md',
				},
				statusMutations: [
					'knowledge:draft->review(after-validation)',
					'source-draft:pending->done(after-consumption)',
					'project:update-mastery(after-validation)',
				],
			},
			{
				skill: 'brainstorm',
				runId: 'stable(brainstorm, normalized-topic, YYYY-MM-DD)',
				zhTargets: {
					'checkpoint-draft': '{草稿目录}/Brainstorm_YYYY-MM-DD_<Topic>.md',
					wiki: '{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md',
				},
				enTargets: {
					'checkpoint-draft': '{drafts directory}/Brainstorm_YYYY-MM-DD_<Topic>.md',
					wiki: '{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md',
				},
				statusMutations: ['checkpoint-draft:create-pending'],
			},
		] as const;

		for (const testCase of cases) {
			for (const [locale, targetPaths] of [
				['zh', testCase.zhTargets],
				['en', testCase.enTargets],
			] as const) {
				const path = `assets/skills/${testCase.skill}/SKILL.${locale}.md`;
				expect(frontmatter(path).dependencies).toMatchObject({
					protocols: [{ path: '../_shared/operation-safety.md' }],
				});
				expect(contract(path)).toEqual({
					contract_version: 1,
					safety_protocol: 'operation-safety-v1',
					operation: testCase.skill,
					run_id: testCase.runId,
					target_paths: targetPaths,
					decision: decisions,
					status_mutations: testCase.statusMutations,
					...common,
				});
			}
		}
	});

	it('Archive 文档不再含裸移动或提前清理的冲突步骤', () => {
		for (const path of ['assets/skills/archive/SKILL.zh.md', 'assets/skills/archive/SKILL.en.md']) {
			const content = read(path);
			expect(content).not.toMatch(/回退到系统\s*`mv`|fall back to system\s*`mv`/i);
			expect(content).not.toMatch(/memory_notify\(previous_file_path=/);
			expect(content).not.toContain('mkdir -p');
			expect(content).toContain('createVaultDirectoryGuard');
			expect(content).toContain('ensureVaultDirectory');
			expect(content).toContain('scripts/archive_transaction.mjs');
			expect(content).toContain('verify_manifest_receipt');
			expect(content).not.toMatch(/继续处理其余条目|continue processing remaining items/i);
			expect(content).not.toMatch(/rollback|反向执行/iu);
		}
	});
});
