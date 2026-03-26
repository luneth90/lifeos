import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../../package.json');

export async function run(args: string[]): Promise<void> {
	const cmd = args[0];
	switch (cmd) {
		case 'init':
			return (await import('./commands/init.js')).default(args.slice(1));
		case 'upgrade':
			return (await import('./commands/upgrade.js')).default(args.slice(1));
		case 'doctor':
			return (await import('./commands/doctor.js')).default(args.slice(1));
		case 'help':
		case '--help':
		case '-h':
			return printHelp();
		case '--version':
		case '-V':
			return printVersion();
		default:
			console.error(`Unknown command: ${cmd}\nRun "lifeos help" for usage.`);
			process.exit(1);
	}
}

function printHelp(): void {
	console.log(`lifeos v${VERSION} — AI-native knowledge OS

Usage:
  lifeos                       Start MCP server (default)
  lifeos init [path] [options] Create a new LifeOS vault
  lifeos upgrade               Upgrade assets to latest version
  lifeos doctor [path]         Check vault health

Options (init):
  --lang, -l <zh|en>   Language preset (default: auto-detect)

Options (global):
  --help, -h           Show this help
  --version, -V        Show version`);
}

function printVersion(): void {
	console.log(`lifeos v${VERSION}`);
}
