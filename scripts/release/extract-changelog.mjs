import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseReleaseTag } from './check-version.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readChangelog(changelogPath = resolve(repoRoot, 'CHANGELOG.md')) {
	return readFileSync(changelogPath, 'utf8');
}

export function extractReleaseNotes(changelog, version) {
	const headingPattern = new RegExp(`^## ${escapeRegex(version)}(?:\\s.*)?$`, 'm');
	const headingMatch = headingPattern.exec(changelog);

	if (!headingMatch) {
		throw new Error(`Could not find changelog section for version ${version}`);
	}

	const sectionStart = headingMatch.index + headingMatch[0].length;
	const remaining = changelog.slice(sectionStart);
	const nextSectionMatch = /\n## .+/m.exec(remaining);
	const sectionEnd = nextSectionMatch ? nextSectionMatch.index : remaining.length;
	const section = remaining.slice(0, sectionEnd).trim();

	if (!section) {
		throw new Error(`Changelog section for version ${version} is empty`);
	}

	return section;
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function main() {
	const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
	const version = parseReleaseTag(tag);
	const changelog = readChangelog();
	const notes = extractReleaseNotes(changelog, version);

	console.log(notes);
}

if (isMainModule()) {
	main();
}
