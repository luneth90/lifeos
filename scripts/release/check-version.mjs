import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

export function parseReleaseTag(tag) {
	if (!tag) {
		throw new Error('Release tag is required');
	}

	const trimmedTag = tag.trim();
	const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(trimmedTag);

	if (!match) {
		throw new Error('Release tag must match vX.Y.Z');
	}

	return match[1];
}

export function readPackageVersion(packageJsonPath = resolve(repoRoot, 'package.json')) {
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

	if (typeof packageJson.version !== 'string' || !packageJson.version) {
		throw new Error(`Missing package version in ${packageJsonPath}`);
	}

	return packageJson.version;
}

export function validateReleaseTag(tag, packageVersion) {
	const tagVersion = parseReleaseTag(tag);

	if (tagVersion !== packageVersion) {
		throw new Error(`Release tag ${tag} does not match package.json version ${packageVersion}`);
	}

	return tagVersion;
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function main() {
	const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
	const packageVersion = readPackageVersion();
	const resolvedVersion = validateReleaseTag(tag, packageVersion);

	console.log(`Validated release tag v${resolvedVersion} for package version ${packageVersion}`);
}

if (isMainModule()) {
	main();
}
