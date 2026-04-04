/**
 * context-policy.ts — ContextPolicy.md 读取与策略解析。
 *
 * Reads the ContextPolicy markdown file from the vault memory directory
 * and provides runtime policy for Layer 0 budgets and active doc constraints.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VaultConfig, getVaultConfig, resolveConfig } from '../config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextPolicy {
	layer0_total: number;
	userprofile_summary: number;
	userprofile_rules: number;
	taskboard_focus: number;
	userprofile_doc_limit: number;
	taskboard_doc_limit: number;
}

// ─── Default policy markdown template ────────────────────────────────────────

function defaultContextPolicyMarkdown(created: string): string {
	return `---
type: context-policy
created: "${created}"
---

# ContextPolicy

本文件由 LifeOS 记忆系统自动生成，用于控制 Layer 0 上下文的预算和活文档体积约束。
可手动编辑以调整行为。

## Layer 0 预算

layer0_total: 1800
userprofile_summary: 200
userprofile_rules: 1000
taskboard_focus: 500
revises_summary: 100
userprofile_doc_limit: 2000
taskboard_doc_limit: 3000

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

// ─── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load and parse the ContextPolicy.md file from the vault.
 * Creates the file with defaults if it does not exist.
 */
export function loadContextPolicy(vaultRoot: string): ContextPolicy {
	const path = ensureContextPolicyExists(vaultRoot);
	const content = readFileSync(path, 'utf-8');

	// Parse budgets
	const budgets = loadContextBudgets(content, vaultRoot);

	return {
		layer0_total: budgets.layer0_total ?? 1800,
		userprofile_summary: budgets.userprofile_summary ?? 200,
		userprofile_rules: budgets.userprofile_rules ?? 1000,
		taskboard_focus: budgets.taskboard_focus ?? 500,
		userprofile_doc_limit: budgets.userprofile_doc_limit ?? 2000,
		taskboard_doc_limit: budgets.taskboard_doc_limit ?? 3000,
	};
}
