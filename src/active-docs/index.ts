import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { type VaultConfig, getOrCreateVaultConfig } from '../config.js';
import type { ActiveDocTarget, RefreshResult } from '../types.js';
import { buildTaskboardSections } from './taskboard.js';
import { buildUserprofileSections } from './userprofile.js';

interface ActiveDocConfig {
	file: string;
	type: string;
	title: string;
	sections: Array<{ heading: string; marker: string }>;
	build: (db: Database.Database, vaultRoot: string) => Record<string, string>;
}

const CONFIGS: Record<ActiveDocTarget, ActiveDocConfig> = {
	TaskBoard: {
		file: 'TaskBoard.md',
		type: 'taskboard',
		title: 'TaskBoard',
		sections: [
			{ heading: '当前焦点', marker: 'focus' },
			{ heading: '活跃项目', marker: 'active-projects' },
			{ heading: '待复习', marker: 'revises' },
		],
		build: buildTaskboardSections,
	},
	UserProfile: {
		file: 'UserProfile.md',
		type: 'userprofile',
		title: 'UserProfile',
		sections: [
			{ heading: '用户摘要', marker: 'profile-summary' },
			{ heading: '全局行为约束', marker: 'global-rules' },
			{ heading: '作用域规则索引', marker: 'scoped-rules-index' },
		],
		build: buildUserprofileSections,
	},
};

interface ActiveDocOptions {
	section?: string;
	config?: VaultConfig;
}

function memoryDir(root: string, config?: VaultConfig): string {
	return (config ?? getOrCreateVaultConfig(root)).memoryDir();
}

export function taskboardRelativePath(): string {
	return 'TaskBoard.md';
}

export function userprofileRelativePath(): string {
	return 'UserProfile.md';
}

function skeleton(config: ActiveDocConfig): string {
	const date = new Date().toISOString().slice(0, 10);
	const body = config.sections
		.map(
			(section) =>
				`## ${section.heading}\n<!-- BEGIN AUTO:${section.marker} -->\n暂无数据\n<!-- END AUTO:${section.marker} -->`,
		)
		.join('\n\n');
	return `---\ntype: ${config.type}\ncreated: "${date}"\n---\n\n# ${config.title}\n\n${body}\n`;
}

export function ensureActiveDocsExist(vaultRoot: string, config?: VaultConfig): void {
	const directory = memoryDir(vaultRoot, config);
	mkdirSync(directory, { recursive: true });
	for (const config of Object.values(CONFIGS)) {
		const path = join(directory, config.file);
		if (!existsSync(path)) writeFileSync(path, skeleton(config), 'utf-8');
	}
}

function assertFinalMarkers(content: string, config: ActiveDocConfig): void {
	const begins = [...content.matchAll(/<!-- BEGIN AUTO:(\S+) -->/g)].map((match) => match[1]);
	const ends = [...content.matchAll(/<!-- END AUTO:(\S+) -->/g)].map((match) => match[1]);
	const expected = config.sections.map((section) => section.marker);
	const same = (actual: Array<string | undefined>) =>
		actual.length === expected.length &&
		expected.every((marker) => actual.filter((item) => item === marker).length === 1);
	if (!same(begins) || !same(ends)) {
		throw new Error(`${config.file} 不是最终 AUTO 区块格式，请先运行 lifeos upgrade`);
	}
	for (const marker of expected) {
		const begin = content.indexOf(`<!-- BEGIN AUTO:${marker} -->`);
		const end = content.indexOf(`<!-- END AUTO:${marker} -->`);
		if (begin < 0 || end < begin) {
			throw new Error(`${config.file} 的 AUTO:${marker} 区块无效`);
		}
	}
}

function replaceSection(content: string, marker: string, value: string): string {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`(<!-- BEGIN AUTO:${escaped} -->\\r?\\n).*?(\\r?\\n<!-- END AUTO:${escaped} -->)`,
		's',
	);
	return content.replace(pattern, (_match, begin: string, end: string) => `${begin}${value}${end}`);
}

function atomicWrite(path: string, content: string): void {
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, content, 'utf-8');
	renameSync(temporary, path);
}

export function refreshActiveDoc(
	db: Database.Database,
	vaultRoot: string,
	target: ActiveDocTarget,
	opts?: ActiveDocOptions,
): RefreshResult {
	const config = CONFIGS[target];
	const directory = memoryDir(vaultRoot, opts?.config);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, config.file);
	const exists = existsSync(path);
	const existing = exists ? readFileSync(path, 'utf-8') : skeleton(config);
	if (exists) assertFinalMarkers(existing, config);
	const sections = config.build(db, vaultRoot);
	if (opts?.section && !(opts.section in sections)) {
		throw new Error(`未知 AUTO 区块：${opts.section}`);
	}
	let updated = existing;
	for (const [marker, value] of Object.entries(sections)) {
		if (!opts?.section || opts.section === marker) {
			updated = replaceSection(updated, marker, value);
		}
	}
	const changed = updated !== existing;
	if (changed || !exists) atomicWrite(path, updated);
	return {
		status: 'ok',
		path,
		sections: Object.keys(sections),
		updatedSection: opts?.section ?? 'all',
		changed,
	};
}

export function refreshTaskboard(
	db: Database.Database,
	root: string,
	opts?: ActiveDocOptions,
): RefreshResult {
	return refreshActiveDoc(db, root, 'TaskBoard', opts);
}

export function refreshUserprofile(
	db: Database.Database,
	root: string,
	opts?: ActiveDocOptions,
): RefreshResult {
	return refreshActiveDoc(db, root, 'UserProfile', opts);
}
