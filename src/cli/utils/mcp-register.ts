import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dim, green, log, yellow } from './ui.js';

interface McpServerEntry {
	command: string;
	args: string[];
}

export type MergeMode = 'replace' | 'merge-missing';

export async function registerMcp(vaultRoot: string, mode: MergeMode = 'replace'): Promise<void> {
	const entry: McpServerEntry = {
		command: 'lifeos',
		args: ['--vault-root', vaultRoot],
	};

	const registered: string[] = [];

	// Claude Code — project-level .mcp.json
	const claudeCodePath = join(vaultRoot, '.mcp.json');
	mergeJsonConfig(claudeCodePath, 'mcpServers', 'lifeos', { ...entry }, mode);
	registered.push(`Claude Code → ${dim(claudeCodePath)}`);

	// Codex — project-level .codex/config.toml
	const codexPath = join(vaultRoot, '.codex', 'config.toml');
	mergeCodexToml(codexPath, 'lifeos', entry, mode);
	registered.push(`Codex → ${dim(codexPath)}`);

	// OpenCode — project-level opencode.json
	const opencodePath = join(vaultRoot, 'opencode.json');
	mergeJsonConfig(
		opencodePath,
		'mcp',
		'lifeos',
		{
			type: 'local',
			command: [entry.command, ...entry.args],
		},
		mode,
	);
	registered.push(`OpenCode → ${dim(opencodePath)}`);

	for (const r of registered) {
		log(green('✔'), r);
	}
}

function mergeJsonConfig(
	filePath: string,
	sectionKey: string,
	serverName: string,
	entry: Record<string, unknown>,
	mode: MergeMode,
): void {
	let config: Record<string, unknown> = {};
	if (existsSync(filePath)) {
		try {
			config = JSON.parse(readFileSync(filePath, 'utf-8'));
		} catch {
			log(yellow('⚠'), `Malformed JSON in ${filePath}, creating fresh config`);
			config = {};
		}
	} else {
		mkdirSync(dirname(filePath), { recursive: true });
	}
	if (!config[sectionKey]) config[sectionKey] = {};
	const section = config[sectionKey] as Record<string, unknown>;
	const existingEntry = section[serverName];
	section[serverName] =
		mode === 'merge-missing' && isRecord(existingEntry)
			? mergeMissing(existingEntry, entry)
			: entry;
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function mergeCodexToml(
	filePath: string,
	serverName: string,
	entry: McpServerEntry,
	mode: MergeMode,
): void {
	let existing = '';
	if (existsSync(filePath)) {
		existing = readFileSync(filePath, 'utf-8');
	} else {
		mkdirSync(dirname(filePath), { recursive: true });
	}

	const sectionHeader = `[mcp_servers.${serverName}]`;
	const range = findTomlSection(existing, sectionHeader);

	if (range === null) {
		const content = existing.trim()
			? `${existing.trim()}\n\n${buildTomlSection(serverName, entry)}`
			: buildTomlSection(serverName, entry);
		writeFileSync(filePath, content);
		return;
	}

	if (mode === 'replace') {
		const content = replaceTomlSection(
			existing,
			range,
			buildTomlSection(serverName, entry).trimEnd(),
		);
		writeFileSync(filePath, ensureTrailingNewline(content));
		return;
	}

	const lines = existing.slice(range.start, range.end).trimEnd().split('\n');
	const header = lines[0];
	const body = lines.slice(1);

	if (!body.some((line) => /^\s*command\s*=/.test(line))) {
		body.unshift(`command = "${entry.command}"`);
	}
	if (!body.some((line) => /^\s*args\s*=/.test(line))) {
		const commandIndex = body.findIndex((line) => /^\s*command\s*=/.test(line));
		const argsLine = `args = [${entry.args.map((arg) => `"${arg}"`).join(', ')}]`;
		if (commandIndex === -1) {
			body.push(argsLine);
		} else {
			body.splice(commandIndex + 1, 0, argsLine);
		}
	}

	const mergedSection = [header, ...body].join('\n');
	const content = replaceTomlSection(existing, range, mergedSection);
	writeFileSync(filePath, ensureTrailingNewline(content));
}

function buildTomlSection(serverName: string, entry: McpServerEntry): string {
	const argsStr = entry.args.map((arg) => `"${arg}"`).join(', ');
	return `[mcp_servers.${serverName}]\ncommand = "${entry.command}"\nargs = [${argsStr}]\n`;
}

function findTomlSection(
	content: string,
	sectionHeader: string,
): { start: number; end: number } | null {
	const start = content.indexOf(sectionHeader);
	if (start === -1) return null;

	const afterHeader = start + sectionHeader.length;
	const rest = content.slice(afterHeader);
	const nextSectionMatch = rest.match(/\n\[[^\n]+\]/);
	const nextSectionIndex = nextSectionMatch?.index;
	const end = nextSectionIndex === undefined ? content.length : afterHeader + nextSectionIndex + 1;
	return { start, end };
}

function replaceTomlSection(
	content: string,
	range: { start: number; end: number },
	section: string,
): string {
	return `${content.slice(0, range.start)}${section}${content.slice(range.end)}`;
}

function ensureTrailingNewline(content: string): string {
	return content.endsWith('\n') ? content : `${content}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeMissing(
	existing: Record<string, unknown>,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };
	for (const [key, value] of Object.entries(incoming)) {
		if (merged[key] === undefined) {
			merged[key] = value;
			continue;
		}
		if (isRecord(merged[key]) && isRecord(value)) {
			merged[key] = mergeMissing(merged[key] as Record<string, unknown>, value);
		}
	}
	return merged;
}
