import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

export function cleanOutputDirectory(repositoryRoot, outputDirectory) {
	const root = resolve(repositoryRoot);
	const output = resolve(outputDirectory);
	if (dirname(output) !== root || basename(output) !== 'dist') {
		throw new Error(`拒绝清理非仓库 dist 目录：${output}`);
	}
	rmSync(output, { recursive: true, force: true });
}

export function build() {
	const output = resolve(repoRoot, 'dist');
	cleanOutputDirectory(repoRoot, output);
	execFileSync(process.execPath, [resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) build();
