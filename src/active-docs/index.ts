/**
 * active-docs/index.ts — Active document routing and refresh entry point.
 *
 * Orchestrates reading existing markdown files, rebuilding AUTO sections
 * from DB data, and writing back. Preserves manual content outside AUTO markers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { getVaultConfig, resolveConfig } from '../config.js';
import type { ActiveDocTarget, RefreshResult } from '../types.js';
import { buildTaskboardSections } from './taskboard.js';
import { buildUserprofileSections } from './userprofile.js';

// ─── Config map ──────────────────────────────────────────────────────────────

interface ActiveDocConfig {
	file: string;
	skeleton: () => string;
	build: (db: Database.Database, vaultRoot: string) => Record<string, string>;
}

const ACTIVE_DOC_CONFIGS: Record<ActiveDocTarget, ActiveDocConfig> = {
	TaskBoard: {
		file: 'TaskBoard.md',
		skeleton: () => buildTaskboardSkeleton(),
		build: buildTaskboardSections,
	},
	UserProfile: {
		file: 'UserProfile.md',
		skeleton: () => buildUserprofileSkeleton(),
		build: buildUserprofileSections,
	},
};

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the vault-relative path for TaskBoard.md
 */
export function taskboardRelativePath(): string {
	return 'TaskBoard.md'; // relative to memory dir
}

/**
 * Returns the vault-relative path for UserProfile.md
 */
export function userprofileRelativePath(): string {
	return 'UserProfile.md'; // relative to memory dir
}

/**
 * Get the absolute path to the memory directory for a vault root.
 */
function getMemoryDir(vaultRoot: string): string {
	const vc = getVaultConfig();
	if (vc !== null) return vc.memoryDir();
	return resolveConfig(vaultRoot).memoryDir();
}

/**
 * Ensure TaskBoard.md and UserProfile.md exist in the memory directory.
 * Creates skeleton files with AUTO section markers if missing.
 */
export function ensureActiveDocsExist(vaultRoot: string): void {
	const memDir = getMemoryDir(vaultRoot);
	mkdirSync(memDir, { recursive: true });

	const tbPath = join(memDir, 'TaskBoard.md');
	if (!existsSync(tbPath)) {
		writeFileSync(tbPath, buildTaskboardSkeleton(), 'utf-8');
	}

	const upPath = join(memDir, 'UserProfile.md');
	if (!existsSync(upPath)) {
		writeFileSync(upPath, buildUserprofileSkeleton(), 'utf-8');
	}
}

// ─── Skeleton generators ──────────────────────────────────────────────────────

function buildSkeleton(
	type: string,
	title: string,
	sections: Array<{ heading: string; marker: string }>,
): string {
	const date = new Date().toISOString().slice(0, 10);
	const sectionBlocks = sections
		.map(
			({ heading, marker }) =>
				`## ${heading}\n<!-- BEGIN AUTO:${marker} -->\n暂无数据\n<!-- END AUTO:${marker} -->`,
		)
		.join('\n\n');
	return `---\ntype: ${type}\ncreated: "${date}"\n---\n\n# ${title}\n\n${sectionBlocks}\n`;
}

function buildTaskboardSkeleton(): string {
	return buildSkeleton('taskboard', 'TaskBoard', [
		{ heading: '当前焦点', marker: 'focus' },
		{ heading: '活跃项目', marker: 'active-projects' },
		{ heading: '待复习', marker: 'revises' },
	]);
}

function buildUserprofileSkeleton(): string {
	return buildSkeleton('userprofile', 'UserProfile', [
		{ heading: '用户摘要', marker: 'profile-summary' },
		{ heading: '行为约束', marker: 'rules' },
	]);
}

// ─── AUTO section replacement ─────────────────────────────────────────────────

/**
 * Replace the content of a single AUTO section in markdown text.
 * Preserves all content outside the BEGIN/END markers.
 */
function replaceAutoSection(content: string, marker: string, newContent: string): string {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`(<!-- BEGIN AUTO:${escaped} -->\\n).*?(\\n<!-- END AUTO:${escaped} -->)`,
		's',
	);

	if (!pattern.test(content)) {
		// Marker not found — append section at end
		return `${content.trimEnd()}\n\n<!-- BEGIN AUTO:${marker} -->\n${newContent}\n<!-- END AUTO:${marker} -->\n`;
	}

	return content.replace(pattern, `$1${newContent}$2`);
}

/**
 * Remove an entire AUTO section block (including its preceding H2 heading)
 * from the document. Used to clean up obsolete sections.
 */
function removeAutoSection(content: string, marker: string): string {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Match optional preceding H2 heading + AUTO block
	const pattern = new RegExp(
		`(?:^## [^\\n]*\\n)?<!-- BEGIN AUTO:${escaped} -->\\n.*?\\n<!-- END AUTO:${escaped} -->\\n?`,
		'ms',
	);
	return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Rebuild all AUTO sections in a markdown document.
 * If opts.section is provided, only rebuild that section.
 * On full rebuild (no targetSection), removes obsolete AUTO blocks
 * that are no longer in the sections record.
 */
function rebuildAutoSections(
	existingContent: string,
	sections: Record<string, string>,
	opts?: { section?: string; preserveManual?: boolean },
): string {
	const { section: targetSection } = opts ?? {};

	let result = existingContent;

	for (const [marker, newContent] of Object.entries(sections)) {
		if (targetSection && marker !== targetSection) continue;
		result = replaceAutoSection(result, marker, newContent);
	}

	// On full rebuild, remove obsolete AUTO blocks not in sections
	if (!targetSection) {
		const obsolete = result.matchAll(/<!-- BEGIN AUTO:(\S+) -->/g);
		for (const match of obsolete) {
			const marker = match[1];
			if (!(marker in sections)) {
				result = removeAutoSection(result, marker);
			}
		}
	}

	return result;
}

// ─── Unified refresh ─────────────────────────────────────────────────────────

/**
 * Rebuild AUTO sections for any active doc target from DB data and write the file.
 */
export function refreshActiveDoc(
	db: Database.Database,
	vaultRoot: string,
	target: ActiveDocTarget,
	opts?: { section?: string; preserveManual?: boolean },
): RefreshResult {
	const cfg = ACTIVE_DOC_CONFIGS[target];
	const memDir = getMemoryDir(vaultRoot);
	mkdirSync(memDir, { recursive: true });
	const docPath = join(memDir, cfg.file);
	const existing = existsSync(docPath) ? readFileSync(docPath, 'utf-8') : cfg.skeleton();
	const sections = cfg.build(db, vaultRoot);
	const updated = rebuildAutoSections(existing, sections, opts);
	writeFileSync(docPath, updated, 'utf-8');
	return {
		status: 'ok',
		path: docPath,
		sections: Object.keys(sections),
		updatedSection: opts?.section ?? 'all',
	};
}

/** Backward-compatible wrapper for TaskBoard refresh. */
export function refreshTaskboard(
	db: Database.Database,
	vaultRoot: string,
	opts?: { section?: string; preserveManual?: boolean },
): RefreshResult {
	return refreshActiveDoc(db, vaultRoot, 'TaskBoard', opts);
}

/** Backward-compatible wrapper for UserProfile refresh. */
export function refreshUserprofile(
	db: Database.Database,
	vaultRoot: string,
	opts?: { section?: string; preserveManual?: boolean },
): RefreshResult {
	return refreshActiveDoc(db, vaultRoot, 'UserProfile', opts);
}
