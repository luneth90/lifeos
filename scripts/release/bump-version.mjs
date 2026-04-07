import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const BUMP_TYPES = ['major', 'minor', 'patch'];

function readCurrentVersion() {
	const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
	return pkg.version;
}

function bumpVersion(current, type) {
	const m = SEMVER_RE.exec(current);
	if (!m) throw new Error(`Invalid semver: ${current}`);

	let [, major, minor, patch] = m.map(Number);

	switch (type) {
		case 'major':
			major++;
			minor = 0;
			patch = 0;
			break;
		case 'minor':
			minor++;
			patch = 0;
			break;
		case 'patch':
			patch++;
			break;
	}

	return `${major}.${minor}.${patch}`;
}

function updatePackageJson(newVersion) {
	const filePath = resolve(repoRoot, 'package.json');
	const content = readFileSync(filePath, 'utf8');
	const updated = content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
	writeFileSync(filePath, updated);
	return filePath;
}

function updatePackageLock() {
	execFileSync('npm', ['install', '--package-lock-only'], {
		cwd: repoRoot,
		stdio: 'pipe',
	});
	return resolve(repoRoot, 'package-lock.json');
}

function findSkillFiles() {
	const output = execFileSync('find', ['assets/skills', '-name', 'SKILL.*.md', '-type', 'f'], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	return output
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((f) => resolve(repoRoot, f));
}

function updateSkillFile(filePath, oldVersion, newVersion) {
	const content = readFileSync(filePath, 'utf8');
	const pattern = new RegExp(`^(version:\\s*)${oldVersion.replace(/\./g, '\\.')}$`, 'm');

	if (!pattern.test(content)) return false;

	writeFileSync(filePath, content.replace(pattern, `$1${newVersion}`));
	return true;
}

function updateLifeosRules(oldVersion, newVersion) {
	const updated = [];
	const escapedOld = oldVersion.replace(/\./g, '\\.');
	const pattern = new RegExp(`\`v${escapedOld}\``, 'g');

	for (const lang of ['zh', 'en']) {
		const filePath = resolve(repoRoot, `assets/lifeos-rules.${lang}.md`);
		const content = readFileSync(filePath, 'utf8');
		if (!pattern.test(content)) continue;
		writeFileSync(filePath, content.replace(pattern, `\`v${newVersion}\``));
		updated.push(`assets/lifeos-rules.${lang}.md`);
	}
	return updated;
}

function main() {
	const type = process.argv[2];

	if (!BUMP_TYPES.includes(type)) {
		console.error(`Usage: node bump-version.mjs <${BUMP_TYPES.join('|')}>`);
		process.exit(1);
	}

	const oldVersion = readCurrentVersion();
	const newVersion = bumpVersion(oldVersion, type);

	console.log(`Bumping ${oldVersion} → ${newVersion}\n`);

	const updated = [];

	// 1. package.json
	updatePackageJson(newVersion);
	updated.push('package.json');

	// 2. package-lock.json
	updatePackageLock();
	updated.push('package-lock.json');

	// 3. Skill files
	const skillFiles = findSkillFiles();
	for (const f of skillFiles) {
		if (updateSkillFile(f, oldVersion, newVersion)) {
			updated.push(f.replace(`${repoRoot}/`, ''));
		}
	}

	// 4. lifeos-rules (CLAUDE.md source)
	updated.push(...updateLifeosRules(oldVersion, newVersion));

	console.log(`Updated ${updated.length} files:`);
	for (const f of updated) {
		console.log(`  ${f}`);
	}

	console.log(`\nVersion bumped to ${newVersion}`);
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
	main();
}

export { readCurrentVersion, bumpVersion, updatePackageJson, findSkillFiles, updateSkillFile };
