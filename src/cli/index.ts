import { VERSION } from './utils/version.js';

export async function run(args: string[]): Promise<void> {
	const cmd = args[0];
	switch (cmd) {
		case 'init':
			return (await import('./commands/init.js')).default(args.slice(1));
		case 'upgrade': {
			await (await import('./commands/upgrade.js')).default(args.slice(1));
			return;
		}
		case 'doctor': {
			await (await import('./commands/doctor.js')).default(args.slice(1));
			return;
		}
		case 'rename': {
			await (await import('./commands/rename.js')).default(args.slice(1));
			return;
		}
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
  lifeos upgrade [path] [opts] Upgrade assets to latest version
  lifeos doctor [path]         Check vault health
  lifeos rename [path]         Rename a vault directory

Options (init / upgrade):
  --lang, -l <zh|en>   Language preset (default: auto-detect / from config)

Options (global):
  --help, -h           Show this help
  --version, -V        Show version`);
}

function printVersion(): void {
	console.log(`lifeos v${VERSION}`);
}
