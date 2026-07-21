import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dim, green, log } from './ui.js';

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
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
		} catch {
			throw new Error(`现有 JSON 配置无法解析，拒绝覆盖：${filePath}`);
		}
		if (!isRecord(parsed)) throw new Error(`现有 JSON 配置根节点必须是对象：${filePath}`);
		config = parsed;
	} else {
		mkdirSync(dirname(filePath), { recursive: true });
	}
	if (config[sectionKey] === undefined) config[sectionKey] = {};
	const section = config[sectionKey];
	if (!isRecord(section)) {
		throw new Error(`现有 JSON 配置的 ${sectionKey} 必须是对象：${filePath}`);
	}
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
	const headers: Array<{ header: string; start: number }> = [];
	let offset = 0;
	let multiline: '"""' | "'''" | null = null;
	for (const line of content.split(/(?<=\n)/)) {
		const withoutNewline = line.replace(/[\r\n]+$/, '');
		const delimiter: '"""' | "'''" | null = multiline ?? multilineDelimiter(withoutNewline);
		if (multiline) {
			if (delimiter && delimiterOccurrences(withoutNewline, delimiter) % 2 === 1) {
				multiline = null;
			}
			offset += line.length;
			continue;
		}
		if (delimiter && delimiterOccurrences(withoutNewline, delimiter) % 2 === 1) {
			multiline = delimiter;
			offset += line.length;
			continue;
		}

		const trimmed = withoutNewline.trim();
		if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('[')) {
			const match = trimmed.match(/^(\[[^\]\r\n]+\]|\[\[[^\]\r\n]+\]\])\s*(?:#.*)?$/);
			if (!match?.[1]) throw new Error('现有 Codex TOML 包含无法安全定位的 table header');
			headers.push({ header: match[1], start: offset });
		}
		offset += line.length;
	}
	if (multiline) throw new Error('现有 Codex TOML 包含未闭合的多行字符串');

	const matches = headers.filter((header) => header.header === sectionHeader);
	if (matches.length > 1) throw new Error(`现有 Codex TOML 重复定义 ${sectionHeader}`);
	const target = matches[0];
	if (!target) return null;
	const next = headers.find((header) => header.start > target.start);
	return { start: target.start, end: next?.start ?? content.length };
}

function multilineDelimiter(line: string): '"""' | "'''" | null {
	const basic = line.indexOf('"""');
	const literal = line.indexOf("'''");
	if (basic === -1 && literal === -1) return null;
	if (basic === -1) return "'''";
	if (literal === -1) return '"""';
	return basic < literal ? '"""' : "'''";
}

function delimiterOccurrences(line: string, delimiter: '"""' | "'''"): number {
	let count = 0;
	let offset = 0;
	while (true) {
		const next = line.indexOf(delimiter, offset);
		if (next === -1) return count;
		count += 1;
		offset = next + delimiter.length;
	}
}

function replaceTomlSection(
	content: string,
	range: { start: number; end: number },
	section: string,
): string {
	const suffix = content.slice(range.end);
	const normalizedSection = suffix.length > 0 && !section.endsWith('\n') ? `${section}\n` : section;
	return `${content.slice(0, range.start)}${normalizedSection}${suffix}`;
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
