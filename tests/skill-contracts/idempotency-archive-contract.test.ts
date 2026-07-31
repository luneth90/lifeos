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
		zh: '{知识目录}/<chapter>/翻译_<chapter>.md',
		en: '{knowledge directory}/<chapter>/Translation_<chapter>.md',
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
			transaction_steps: ['move', 'memory_notify', 'confirm_index', 'memory_forget'],
			move_guards: {
				source: { before: 'existing', after: 'missing' },
				target: { before: 'missing', after: 'existing' },
				advance: 'advanceVaultPathGuard',
			},
			notify: {
				contract_version: 2,
				file_path: '<new-vault-relative-path>',
				previous_file_path: '<old-vault-relative-path>',
			},
			forget: {
				scope_type: 'project',
				allowed_after: 'confirm_index',
				forbidden_when: ['move_failed', 'notify_failed', 'index_unconfirmed'],
			},
			manifest_updates: {
				move: 'moves',
				collision: 'collisions',
				memory_notify: 'notified',
				failure: 'errors',
			},
			bare_mv: 'forbidden',
		};
		for (const [lang, target] of [
			['zh', '{系统目录}/{归档子目录}/...'],
			['en', '{system directory}/{archive subdirectory}/...'],
		] as const) {
			expect(contract(`assets/skills/archive/SKILL.${lang}.md`)).toEqual({
				contract_version: 1,
				operation: 'archive',
				run_id: 'stable(archive, candidate-paths, archive-date)',
				target_path: target,
				decision: decisions,
				...extra,
			});
		}
	});

	it('Archive 文档不再含裸移动或提前清理的冲突步骤', () => {
		for (const path of ['assets/skills/archive/SKILL.zh.md', 'assets/skills/archive/SKILL.en.md']) {
			const content = read(path);
			expect(content).not.toMatch(/回退到系统\s*`mv`|fall back to system\s*`mv`/i);
			expect(content).not.toMatch(/memory_notify\(previous_file_path=/);
		}
	});
});
