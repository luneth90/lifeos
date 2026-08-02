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
	vault_binding: {
		identity_fields: ['realpath', 'root_dev', 'root_ino'],
		frozen_for_run: true,
		required_for_resumable_operations: true,
		resume_exact_match_before_receipt_verification: true,
		revalidate_at: [
			'before_external_await',
			'after_external_await',
			'before_guard_create_or_refresh',
			'before_complete_return',
		],
		changed_root: 'fail_closed_manual_recovery',
	},
	untrusted_resume: {
		trust_checks: ['schema', 'vault_identity', 'receipt'],
		persist_manifest: 'forbidden',
		side_effect_callbacks: 'forbidden',
		result: 'local_failed_unverified_null_receipt',
	},
	terminal_revalidation: {
		after_external_await: 'advanced_target_guards_and_inventory',
		before_complete_return: 'synchronous',
		await_after_final_revalidation: 'forbidden',
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

const extendedOperations = [
	{
		skill: 'project',
		runId: 'stable(project, normalized-input, plan_revision, confirmed_hash)',
		targets: {
			zh: {
				plan: '{计划目录}/Plan_YYYY-MM-DD_Project_<ProjectName>.md',
				'main-project': '{项目目录}/<ProjectName>.md',
				'development-main-project': '{项目目录}/<ProjectName>/<ProjectName>.md',
				'project-doc': '{项目目录}/<ProjectName>/文档/<DocumentName>.md',
			},
			en: {
				plan: '{plans directory}/Plan_YYYY-MM-DD_Project_<ProjectName>.md',
				'main-project': '{projects directory}/<ProjectName>.md',
				'development-main-project': '{projects directory}/<ProjectName>/<ProjectName>.md',
				'project-doc': '{projects directory}/<ProjectName>/Docs/<DocumentName>.md',
			},
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
		targets: {
			zh: {
				'book-knowledge-note':
					'{知识目录}/{笔记子目录}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
				'paper-knowledge-note': '{知识目录}/{笔记子目录}/<Domain>/<PaperName>.md',
				wiki: '{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md',
			},
			en: {
				'book-knowledge-note':
					'{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
				'paper-knowledge-note':
					'{knowledge directory}/{notes subdirectory}/<Domain>/<PaperName>.md',
				wiki: '{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md',
			},
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
		targets: {
			zh: {
				'checkpoint-draft': '{草稿目录}/Brainstorm_YYYY-MM-DD_<Topic>.md',
				wiki: '{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md',
			},
			en: {
				'checkpoint-draft': '{drafts directory}/Brainstorm_YYYY-MM-DD_<Topic>.md',
				wiki: '{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md',
			},
		},
		statusMutations: ['checkpoint-draft:create-pending'],
	},
] as const;

describe('幂等与操作安全契约', () => {
	it('中英文共享协议逐字段同构并声明 guard 的边界', () => {
		expect(contract('assets/skills/_shared/operation-safety.zh.md')).toEqual(sharedContract);
		expect(contract('assets/skills/_shared/operation-safety.en.md')).toEqual(sharedContract);
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

	it('Digest 流水线与机器契约使用同一个 run_id', () => {
		const runId = contract('assets/skills/digest/SKILL.zh.md').run_id;
		for (const path of [
			'assets/skills/digest/references/run-pipeline.zh.md',
			'assets/skills/digest/references/run-pipeline.en.md',
		]) {
			expect(read(path), path).toContain(`run_id = ${runId}`);
		}
	});

	it('Today 用规范化选择确定 run_id，并以 task_id 合并同日日记', () => {
		expect(contract('assets/skills/today/SKILL.zh.md')).toMatchObject({
			run_id: 'stable(today, YYYY-MM-DD, selected-items)',
			stable_item_key: 'task_id',
			on_existing: 'merge',
		});
	});

	it.each(extendedOperations)('$skill 保留唯一目标集合与状态流转', (operation) => {
		for (const locale of ['zh', 'en'] as const) {
			const value = contract(`assets/skills/${operation.skill}/SKILL.${locale}.md`);
			expect(value.run_id).toBe(operation.runId);
			expect(value.target_paths).toEqual(operation.targets[locale]);
			expect(value.status_mutations).toEqual(operation.statusMutations);
		}
	});
});
