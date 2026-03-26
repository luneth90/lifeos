/**
 * context-policy.ts — ContextPolicy.md 读取与策略解析。
 *
 * Reads the ContextPolicy markdown file from the vault memory directory
 * and provides runtime policy resolution for scenes and skill profiles.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VaultConfig, getVaultConfig, resolveConfig } from '../config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillProfilePolicy {
	skill_profile: string;
	load_taskboard: boolean;
	allow_domain_tag_fallback: boolean;
	ranking_bias: Record<string, number>;
	recent_event_bias: Record<string, number>;
}

export interface ScenePolicy {
	scene: string;
	citation_required: boolean;
	load_taskboard: boolean;
	ranking_bias: Record<string, number>;
	recent_event_bias: Record<string, number>;
}

export interface ContextPolicy {
	layer0_total: number;
	userprofile_summary: number;
	taskboard_focus: number;
	userprofile_doc_limit: number;
	taskboard_doc_limit: number;
	scenes: Record<string, string>;
	citation_required: string[];
	skill_profiles: Record<string, Partial<SkillProfilePolicy>>;
}

// ─── Default skill profile policies ──────────────────────────────────────────

export const DEFAULT_SKILL_PROFILE_POLICIES: Record<
	string,
	Omit<SkillProfilePolicy, 'skill_profile'>
> = {
	review_strict: {
		load_taskboard: false,
		allow_domain_tag_fallback: false,
		ranking_bias: { review: 50, knowledge: 30, correction: 90 },
		recent_event_bias: { correction: 40, skill_completion: 20, milestone: 15 },
	},
	ask_global: {
		load_taskboard: false,
		allow_domain_tag_fallback: true,
		ranking_bias: {},
		recent_event_bias: { decision: 20, correction: 20, preference: 10 },
	},
	daily_global: {
		load_taskboard: false,
		allow_domain_tag_fallback: false,
		ranking_bias: { project: 60, review: 45, daily: 30 },
		recent_event_bias: { decision: 35, skill_completion: 15, milestone: 10 },
	},
	research_seed: {
		load_taskboard: false,
		allow_domain_tag_fallback: true,
		ranking_bias: { draft: 60, research: 50, resource: 40 },
		recent_event_bias: { decision: 20, preference: 15, skill_completion: 15, milestone: 10 },
	},
	project_seed: {
		load_taskboard: false,
		allow_domain_tag_fallback: true,
		ranking_bias: { project: 60, research: 45, resource: 35, draft: 20 },
		recent_event_bias: { decision: 30, milestone: 20, skill_completion: 15, correction: 10 },
	},
	knowledge_strict: {
		load_taskboard: false,
		allow_domain_tag_fallback: false,
		ranking_bias: { knowledge: 70, project: 35, resource: 25 },
		recent_event_bias: { correction: 35, decision: 15, skill_completion: 10 },
	},
};

// ─── Default policy markdown template ────────────────────────────────────────

function defaultContextPolicyMarkdown(created: string): string {
	return `---
type: context-policy
created: "${created}"
---

# ContextPolicy

本文件由 LifeOS 记忆系统自动生成，用于控制 Layer 0 上下文的预算和场景策略。
可手动编辑以调整行为。

## Layer 0 预算

layer0_total: 1200
userprofile_summary: 400
taskboard_focus: 800
userprofile_doc_limit: 2000
taskboard_doc_limit: 3000

## 场景策略

/today: citation_required taskboard
/research: domain_fallback research draft resource
/project: domain_fallback project research resource draft
/knowledge: knowledge project resource
/review: citation_required review knowledge correction
/ask: domain_fallback
/brainstorm: domain_fallback draft research
/publish: knowledge project research
/ppt: knowledge project research

## 技能画像策略

review_strict: load_taskboard=false domain_fallback=false
ask_global: load_taskboard=false domain_fallback=true
daily_global: load_taskboard=false domain_fallback=false
research_seed: load_taskboard=false domain_fallback=true
project_seed: load_taskboard=false domain_fallback=true
knowledge_strict: load_taskboard=false domain_fallback=false

## 强制引用场景

/today
/review

## 活文档体积约束

TaskBoard: 3000
UserProfile: 2000
`;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to ContextPolicy.md for the given vault root.
 * Uses the global VaultConfig singleton when available; otherwise falls back
 * to the zh preset.
 */
export function contextPolicyPath(vaultRoot: string): string {
	const vc = getVaultConfig();
	if (vc !== null) {
		return join(vc.memoryDir(), 'ContextPolicy.md');
	}
	// Fall back: build a temporary config without registering as singleton
	const tempVc = resolveConfig(vaultRoot);
	return join(tempVc.memoryDir(), 'ContextPolicy.md');
}

// ─── Ensure file exists ───────────────────────────────────────────────────────

/**
 * Ensure ContextPolicy.md exists at the correct location.
 * Creates the file with default content when missing.
 * Returns the absolute path.
 */
export function ensureContextPolicyExists(vaultRoot: string): string {
	const path = contextPolicyPath(vaultRoot);
	const dir = path.substring(0, path.lastIndexOf('/'));
	mkdirSync(dir, { recursive: true });
	if (!existsSync(path)) {
		const created = new Date().toISOString().slice(0, 10);
		writeFileSync(path, defaultContextPolicyMarkdown(created), 'utf-8');
	}
	return path;
}

// ─── Section extraction ───────────────────────────────────────────────────────

/**
 * Extract non-empty content lines from a named markdown H2 section.
 * Stops at the next H2 heading (## ...) or end of file.
 */
function extractSectionLines(content: string, sectionTitle: string): string[] {
	const lines = content.split('\n');
	let inSection = false;
	const result: string[] = [];

	for (const line of lines) {
		if (line.startsWith('## ')) {
			if (inSection) break; // reached next section
			if (line === `## ${sectionTitle}`) {
				inSection = true;
			}
			continue;
		}
		if (inSection) {
			const trimmed = line.trim();
			// Skip frontmatter-style separators and empty lines
			if (trimmed && !trimmed.startsWith('---')) {
				result.push(trimmed);
			}
		}
	}
	return result;
}

// ─── Budget parsing ───────────────────────────────────────────────────────────

/**
 * Parse context budget values from the "Layer 0 预算" section.
 * Falls back to VaultConfig.contextBudgets() when the vault root is provided.
 */
function loadContextBudgets(content: string, vaultRoot: string): Record<string, number> {
	// Try to parse from the markdown section first
	const lines = extractSectionLines(content, 'Layer 0 预算');
	const parsed: Record<string, number> = {};
	for (const line of lines) {
		if (!line.includes(':')) continue;
		const colonIdx = line.indexOf(':');
		const key = line.slice(0, colonIdx).trim();
		const val = Number.parseInt(line.slice(colonIdx + 1).trim(), 10);
		if (key && !Number.isNaN(val)) {
			parsed[key] = val;
		}
	}

	// Fall back to VaultConfig for any missing keys
	const vc = getVaultConfig() ?? resolveConfig(vaultRoot);
	const defaults = vc.contextBudgets();

	return { ...defaults, ...parsed };
}

// ─── Skill profile parsing ────────────────────────────────────────────────────

/**
 * Parse a skill profile rule string into a partial SkillProfilePolicy.
 * Recognises tokens: load_taskboard=true/false, domain_fallback=true/false
 */
function parseSkillProfileRule(rule: string): Partial<SkillProfilePolicy> {
	const result: Partial<SkillProfilePolicy> = {};
	const tokens = rule.split(/\s+/);
	for (const token of tokens) {
		if (token.startsWith('load_taskboard=')) {
			result.load_taskboard = token.endsWith('true');
		} else if (token.startsWith('domain_fallback=')) {
			result.allow_domain_tag_fallback = token.endsWith('true');
		}
	}
	return result;
}

// ─── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load and parse the ContextPolicy.md file from the vault.
 * Creates the file with defaults if it does not exist.
 */
export function loadContextPolicy(vaultRoot: string): ContextPolicy {
	const path = ensureContextPolicyExists(vaultRoot);
	const content = readFileSync(path, 'utf-8');

	// Parse scenes
	const scenes: Record<string, string> = {};
	for (const line of extractSectionLines(content, '场景策略')) {
		if (!line.includes(':')) continue;
		const colonIdx = line.indexOf(':');
		const name = line.slice(0, colonIdx).trim();
		const rule = line.slice(colonIdx + 1).trim();
		if (name) scenes[name] = rule;
	}

	// Parse skill profiles
	const skillProfiles: Record<string, Partial<SkillProfilePolicy>> = {};
	for (const line of extractSectionLines(content, '技能画像策略')) {
		if (!line.includes(':')) continue;
		const colonIdx = line.indexOf(':');
		const name = line.slice(0, colonIdx).trim();
		const rule = line.slice(colonIdx + 1).trim();
		if (name) skillProfiles[name] = parseSkillProfileRule(rule);
	}

	// Parse citation_required lines
	const citationRequired = extractSectionLines(content, '强制引用场景');

	// Parse budgets
	const budgets = loadContextBudgets(content, vaultRoot);

	return {
		layer0_total: budgets.layer0_total ?? 1200,
		userprofile_summary: budgets.userprofile_summary ?? 400,
		taskboard_focus: budgets.taskboard_focus ?? 800,
		userprofile_doc_limit: budgets.userprofile_doc_limit ?? 2000,
		taskboard_doc_limit: budgets.taskboard_doc_limit ?? 3000,
		scenes,
		citation_required: citationRequired,
		skill_profiles: skillProfiles,
	};
}

// ─── Scene policy resolution ──────────────────────────────────────────────────

/**
 * Keyword → bias bucket mappings for scene rule text.
 * Each keyword maps to a { bucket: weight } pair to inject into ranking_bias
 * or recent_event_bias.
 */
const SCENE_RANKING_KEYWORDS: Record<string, Record<string, number>> = {
	taskboard: { project: 40, daily: 20 },
	project: { project: 50 },
	research: { research: 50 },
	draft: { draft: 40 },
	resource: { resource: 35 },
	knowledge: { knowledge: 50 },
	review: { review: 45 },
	daily: { daily: 30 },
};

const SCENE_EVENT_KEYWORDS: Record<string, Record<string, number>> = {
	citation_required: { correction: 30, decision: 25 },
	taskboard: { skill_completion: 15, milestone: 10 },
	project: { decision: 30, milestone: 20 },
	research: { decision: 20, preference: 15 },
	review: { correction: 40, skill_completion: 20 },
};

/**
 * Derive a runtime ScenePolicy from the stored rule text for a given scene name.
 */
export function resolveScenePolicy(policy: ContextPolicy, scene: string): ScenePolicy {
	const sceneName = String(scene);
	const rule = String(policy.scenes?.[sceneName] ?? '').trim();

	if (!rule) {
		return {
			scene: sceneName,
			citation_required: false,
			load_taskboard: false,
			ranking_bias: {},
			recent_event_bias: {},
		};
	}

	const tokens = rule.split(/\s+/).filter(Boolean);
	const citationRequired = tokens.includes('citation_required');
	const loadTaskboard = tokens.includes('taskboard');
	const rankingBias: Record<string, number> = {};
	const recentEventBias: Record<string, number> = {};

	for (const token of tokens) {
		const rb = SCENE_RANKING_KEYWORDS[token];
		if (rb) {
			for (const [k, v] of Object.entries(rb)) {
				rankingBias[k] = Math.max(rankingBias[k] ?? 0, v);
			}
		}
		const eb = SCENE_EVENT_KEYWORDS[token];
		if (eb) {
			for (const [k, v] of Object.entries(eb)) {
				recentEventBias[k] = Math.max(recentEventBias[k] ?? 0, v);
			}
		}
	}

	return {
		scene: sceneName,
		citation_required: citationRequired,
		load_taskboard: loadTaskboard,
		ranking_bias: rankingBias,
		recent_event_bias: recentEventBias,
	};
}

// ─── Skill profile policy resolution ─────────────────────────────────────────

/**
 * Merge loaded skill profile settings with built-in defaults.
 * Loaded values take precedence over defaults.
 */
export function resolveSkillProfilePolicy(
	policy: ContextPolicy,
	skillProfile: string,
): SkillProfilePolicy {
	const loaded = policy.skill_profiles?.[skillProfile] ?? {};
	const base = DEFAULT_SKILL_PROFILE_POLICIES[skillProfile] ?? {
		load_taskboard: false,
		allow_domain_tag_fallback: false,
		ranking_bias: {},
		recent_event_bias: {},
	};

	return {
		skill_profile: skillProfile,
		load_taskboard: loaded.load_taskboard ?? base.load_taskboard,
		allow_domain_tag_fallback: loaded.allow_domain_tag_fallback ?? base.allow_domain_tag_fallback,
		ranking_bias: { ...base.ranking_bias, ...(loaded.ranking_bias ?? {}) },
		recent_event_bias: { ...base.recent_event_bias, ...(loaded.recent_event_bias ?? {}) },
	};
}
