#!/usr/bin/env node

const cmd = process.argv[2];
const CLI_COMMANDS = ['init', 'upgrade', 'doctor', 'rename', 'help', '--help', '-h', '--version', '-V'];
const SERVER_FLAGS = ['--vault-root'];

if (!cmd || SERVER_FLAGS.includes(cmd)) {
	// No subcommand or server flags → start MCP server
	import('../dist/server.js');
} else if (CLI_COMMANDS.includes(cmd)) {
	import('../dist/cli/index.js')
		.then(m => m.run(process.argv.slice(2)))
		.catch(handleError);
} else {
	import('../dist/cli/index.js')
		.then(m => m.run(process.argv.slice(2)))
		.catch(handleError);
}

function handleError(err) {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`\x1b[31m✗\x1b[0m ${msg}`);
	process.exit(1);
}
