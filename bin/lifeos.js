#!/usr/bin/env node

const cmd = process.argv[2];
const CLI_COMMANDS = ['init', 'upgrade', 'doctor', 'help', '--help', '-h', '--version', '-V'];

if (cmd && CLI_COMMANDS.includes(cmd)) {
	import('../dist/cli/index.js').then(m => m.run(process.argv.slice(2)));
} else {
	import('../dist/server.js');
}
