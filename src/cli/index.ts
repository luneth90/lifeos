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
		case 'rules': {
			await (await import('./commands/rules.js')).default(args.slice(1));
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
  lifeos upgrade [path] [opts] 原子升级资产、配置、项目身份与数据库
  lifeos doctor [path]         Check vault health
  lifeos rename [path]         Rename a vault directory
  lifeos rules <cmd> [path]    List, audit, classify, archive or restore memory

Options (init / upgrade):
  --lang, -l <zh|en>   Language preset (default: auto-detect / from config)

Options (upgrade):
  --scope-map, -m <file>  指定 V4 scope map；缺省时由旧数据库自动生成
  --accept-scope-map      审阅后接受所有已有有效建议（占位 scope 仍会被拒绝）
  --restore <journal>     从外部 cutover journal 显式恢复

V1–V3 升级会自动补齐缺失项目 ID，并从旧记忆中的明确源码路径发现高置信仓库绑定。

Options (global):
  --help, -h           Show this help
  --version, -V        Show version`);
}

function printVersion(): void {
	console.log(`lifeos v${VERSION}`);
}
