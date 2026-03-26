import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dim, green, log, yellow } from './ui.js';

interface McpServerEntry {
	command: string;
	args: string[];
}

export async function registerMcp(vaultRoot: string): Promise<void> {
	const entry: McpServerEntry = {
		command: 'npx',
		args: ['-y', 'lifeos', '--vault-root', vaultRoot],
	};

	const registered: string[] = [];

	// Claude Code — project-level .mcp.json
	const claudeCodePath = join(vaultRoot, '.mcp.json');
	mergeJsonConfig(claudeCodePath, 'mcpServers', 'lifeos', { ...entry });
	registered.push(`Claude Code → ${dim(claudeCodePath)}`);

	// Codex — project-level .codex/config.toml
	const codexPath = join(vaultRoot, '.codex', 'config.toml');
	mergeCodexToml(codexPath, 'lifeos', entry);
	registered.push(`Codex → ${dim(codexPath)}`);

	// OpenCode — project-level opencode.json
	const opencodePath = join(vaultRoot, 'opencode.json');
	mergeJsonConfig(opencodePath, 'mcp', 'lifeos', {
		type: 'local',
		command: [entry.command, ...entry.args],
	});
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
	(config[sectionKey] as Record<string, unknown>)[serverName] = entry;
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function mergeCodexToml(filePath: string, serverName: string, entry: McpServerEntry): void {
	let existing = '';
	if (existsSync(filePath)) {
		existing = readFileSync(filePath, 'utf-8');
	} else {
		mkdirSync(dirname(filePath), { recursive: true });
	}

	// Remove existing section for this server if present
	const sectionHeader = `[mcp_servers.${serverName}]`;
	if (existing.includes(sectionHeader)) {
		// Remove from section header to next section or end of file
		existing = existing.replace(
			new RegExp(`\\[mcp_servers\\.${serverName}\\][\\s\\S]*?(?=\\n\\[|$)`),
			'',
		);
	}

	const argsStr = entry.args.map((a) => `"${a}"`).join(', ');
	const section = `${sectionHeader}\ncommand = "${entry.command}"\nargs = [${argsStr}]\n`;

	const content = existing.trim() ? `${existing.trim()}\n\n${section}` : section;
	writeFileSync(filePath, content);
}
