#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cmd = process.argv[2];
const CLI_COMMANDS = [
	'init',
	'upgrade',
	'doctor',
	'rename',
	'help',
	'--help',
	'-h',
	'--version',
	'-V',
];
const SERVER_FLAGS = ['--vault-root'];
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!cmd || SERVER_FLAGS.includes(cmd)) {
	// No subcommand or server flags → start MCP server
	loadServerEntry();
} else if (CLI_COMMANDS.includes(cmd)) {
	loadCliEntry();
} else {
	loadCliEntry();
}

function handleError(err) {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`\x1b[31m✗\x1b[0m ${msg}`);
	process.exit(1);
}

function loadServerEntry() {
	const builtEntry = join(rootDir, 'dist', 'server.js');
	const sourceEntry = join(rootDir, 'src', 'server.ts');

	if (existsSync(builtEntry)) {
		import(pathToFileURL(builtEntry).href).then((m) => m.main()).catch(handleError);
		return;
	}

	runSourceEntry(sourceEntry, 'server');
}

function loadCliEntry() {
	const builtEntry = join(rootDir, 'dist', 'cli', 'index.js');
	const sourceEntry = join(rootDir, 'src', 'cli', 'index.ts');

	if (existsSync(builtEntry)) {
		import(pathToFileURL(builtEntry).href)
			.then((m) => m.run(process.argv.slice(2)))
			.catch(handleError);
		return;
	}

	runSourceEntry(sourceEntry, 'cli');
}

function runSourceEntry(sourceEntry, mode) {
	if (!existsSync(sourceEntry)) {
		handleError(new Error(`Cannot find module '${sourceEntry}'`));
		return;
	}

	const sourceUrl = pathToFileURL(sourceEntry).href;
	const script =
		mode === 'server'
			? `import(${JSON.stringify(sourceUrl)}).then((m) => m.main()).catch((err) => { console.error(err); process.exit(1); });`
			: `import(${JSON.stringify(sourceUrl)}).then((m) => m.run(process.argv.slice(2))).catch((err) => { console.error(err); process.exit(1); });`;

	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--eval', script, '__lifeos_source_entry__', ...process.argv.slice(2)],
		{
			stdio: 'inherit',
			env: process.env,
		},
	);

	child.on('error', handleError);
	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 1);
	});
}
