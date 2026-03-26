import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
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

	// Claude Desktop
	const claudeDesktopPath = getClaudeDesktopConfigPath();
	if (claudeDesktopPath) {
		mergeJsonConfig(claudeDesktopPath, 'lifeos', entry);
		registered.push(`Claude Desktop → ${dim(claudeDesktopPath)}`);
	}

	// Cursor (project-level .cursor/mcp.json)
	const cursorPath = join(vaultRoot, '.cursor', 'mcp.json');
	mergeJsonConfig(cursorPath, 'lifeos', entry);
	registered.push(`Cursor → ${dim(cursorPath)}`);

	if (registered.length === 0) {
		log('⚠', yellow('No AI platform config detected. Register MCP server manually.'));
	} else {
		for (const r of registered) {
			log(green('✔'), r);
		}
	}
}

function getClaudeDesktopConfigPath(): string | null {
	const p = platform();
	let configDir: string;
	if (p === 'darwin') {
		configDir = join(homedir(), 'Library', 'Application Support', 'Claude');
	} else if (p === 'win32') {
		configDir = join(process.env.APPDATA ?? homedir(), 'Claude');
	} else {
		configDir = join(homedir(), '.config', 'Claude');
	}
	// Only register if the Claude directory exists (meaning Claude Desktop is installed)
	return existsSync(configDir) ? join(configDir, 'claude_desktop_config.json') : null;
}

function mergeJsonConfig(filePath: string, serverName: string, entry: McpServerEntry): void {
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
	if (!config.mcpServers) config.mcpServers = {};
	(config.mcpServers as Record<string, unknown>)[serverName] = entry;
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}
