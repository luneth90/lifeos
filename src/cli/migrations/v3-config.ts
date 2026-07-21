import { parse as parseYaml } from 'yaml';
import { DEFAULT_CONTEXT_BUDGETS, EN_PRESET, ZH_PRESET, lifeosConfigSchema } from '../../config.js';
import type { LifeOSConfig } from '../../config.js';

export class LegacyConfigMigrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LegacyConfigMigrationError';
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function merge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = result[key];
		result[key] =
			current &&
			value &&
			typeof current === 'object' &&
			typeof value === 'object' &&
			!Array.isArray(current) &&
			!Array.isArray(value)
				? merge(current as Record<string, unknown>, value as Record<string, unknown>)
				: value;
	}
	return result;
}

function nonnegative(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function parseLegacyConfigYaml(content: string): Record<string, unknown> {
	const parsed: unknown = parseYaml(content);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new LegacyConfigMigrationError('旧 lifeos.yaml 必须是对象');
	}
	return parsed as Record<string, unknown>;
}

export function migrateV3Config(raw: Record<string, unknown>): LifeOSConfig {
	const language = raw.language === 'en' ? 'en' : 'zh';
	const preset = structuredClone(language === 'en' ? EN_PRESET : ZH_PRESET);
	const legacyMemory = record(raw.memory);
	const legacyBudgets = record(legacyMemory.context_budgets);
	const merged = merge(preset as unknown as Record<string, unknown>, raw);
	const memory = record(merged.memory);
	memory.contract_version = 2;
	memory.context_budgets = {
		layer0_total: nonnegative(legacyBudgets.layer0_total, DEFAULT_CONTEXT_BUDGETS.layer0_total),
		global_rules: DEFAULT_CONTEXT_BUDGETS.global_rules,
		userprofile_summary: nonnegative(
			legacyBudgets.userprofile_summary,
			DEFAULT_CONTEXT_BUDGETS.userprofile_summary,
		),
		taskboard_focus: nonnegative(
			legacyBudgets.taskboard_focus,
			DEFAULT_CONTEXT_BUDGETS.taskboard_focus,
		),
		scoped_context: DEFAULT_CONTEXT_BUDGETS.scoped_context,
		single_item_max: DEFAULT_CONTEXT_BUDGETS.single_item_max,
	};
	memory.repository_bindings = record(legacyMemory.repository_bindings);
	merged.memory = memory;
	const parsed = lifeosConfigSchema.safeParse(merged);
	if (!parsed.success) {
		throw new LegacyConfigMigrationError(
			parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
		);
	}
	return parsed.data as LifeOSConfig;
}
