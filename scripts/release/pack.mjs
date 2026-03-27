import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

export function extractTarballName(output) {
	const trimmedOutput = output.trim();

	if (!trimmedOutput) {
		throw new Error('npm pack did not return a tarball name');
	}

	try {
		const parsed = JSON.parse(trimmedOutput);
		const tarball = Array.isArray(parsed) ? parsed[0]?.filename : undefined;

		if (typeof tarball === 'string' && tarball.endsWith('.tgz')) {
			return tarball;
		}
	} catch {
		// Fall through to plain-text parsing for local npm output variations.
	}

	const tarball = trimmedOutput
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)
		.at(-1);

	if (!tarball || !tarball.endsWith('.tgz')) {
		throw new Error('npm pack output did not contain a tarball filename');
	}

	return tarball;
}

export function runNpmPack(execFileSyncImpl = execFileSync) {
	const output = execFileSyncImpl('npm', ['pack', '--json'], {
		cwd: repoRoot,
		encoding: 'utf8',
	});

	return extractTarballName(output);
}

export function writeGitHubOutput(name, value, outputPath = process.env.GITHUB_OUTPUT) {
	if (!outputPath) {
		return;
	}

	appendFileSync(outputPath, `${name}=${value}\n`);
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function main() {
	const tarball = runNpmPack();

	writeGitHubOutput('tarball', tarball);
	console.log(tarball);
}

if (isMainModule()) {
	main();
}
