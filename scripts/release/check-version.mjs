import { readFileSync, readdirSync } from 'node:fs';
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

function readJson(filePath) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法读取 ${filePath}：${message}`);
	}
}

function readText(filePath) {
	try {
		return readFileSync(filePath, 'utf8');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法读取 ${filePath}：${message}`);
	}
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relativeDisplayPath(filePath, rootPath) {
	return filePath.slice(rootPath.length + 1);
}

function readFrontmatterVersion(filePath) {
	const content = readText(filePath);
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];

	if (!frontmatter) {
		throw new Error(`${filePath} 缺少 YAML frontmatter`);
	}

	const versions = [...frontmatter.matchAll(/^version:\s*['\"]?([^'\"\s#]+)['\"]?\s*(?:#.*)?$/gm)];

	if (versions.length !== 1) {
		throw new Error(`${filePath} 的 frontmatter 必须且只能包含一个 version 字段`);
	}

	return versions[0][1];
}

function collectSkillFiles(rootPath, errors) {
	const skillsRoot = resolve(rootPath, 'assets/skills');
	let skillDirectories;

	try {
		skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
			.sort((left, right) => left.name.localeCompare(right.name));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		errors.push(`无法枚举 assets/skills：${message}`);
		return [];
	}

	const files = [];
	for (const directory of skillDirectories) {
		for (const language of ['zh', 'en']) {
			files.push(resolve(skillsRoot, directory.name, `SKILL.${language}.md`));
		}
	}

	if (files.length === 0) {
		errors.push('assets/skills 下没有可校验的中英文技能文件');
	}

	return files;
}

/**
 * 校验发布版本在所有发布资产中保持一致。
 *
 * 保留 rootPath 参数是为了让发布测试使用隔离目录，不影响真实仓库。
 */
export function validateRepositoryVersions(expectedVersion, rootPath = repoRoot) {
	const resolvedRoot = resolve(rootPath);
	const errors = [];

	const packageLockPath = resolve(resolvedRoot, 'package-lock.json');
	try {
		const packageLock = readJson(packageLockPath);
		if (packageLock.version !== expectedVersion) {
			errors.push(
				`package-lock.json 根 version 为 ${String(packageLock.version)}，应为 ${expectedVersion}`,
			);
		}
		if (packageLock.packages?.['']?.version !== expectedVersion) {
			errors.push(
				`package-lock.json packages[''].version 为 ${String(packageLock.packages?.['']?.version)}，应为 ${expectedVersion}`,
			);
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	const changelogPath = resolve(resolvedRoot, 'CHANGELOG.md');
	try {
		const changelog = readText(changelogPath);
		const escapedVersion = escapeRegExp(expectedVersion);
		const heading = new RegExp(
			`^##\\s+(?:\\[${escapedVersion}\\]|${escapedVersion})(?:\\s+\\([^\\r\\n]*\\))?\\s*$`,
			'm',
		);
		if (!heading.test(changelog)) {
			errors.push(`CHANGELOG.md 缺少版本 ${expectedVersion} 的二级标题`);
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	for (const skillFile of collectSkillFiles(resolvedRoot, errors)) {
		try {
			const version = readFrontmatterVersion(skillFile);
			if (version !== expectedVersion) {
				errors.push(
					`${relativeDisplayPath(skillFile, resolvedRoot)} 的 frontmatter version 为 ${version}，应为 ${expectedVersion}`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(message.replace(skillFile, relativeDisplayPath(skillFile, resolvedRoot)));
		}
	}

	for (const language of ['zh', 'en']) {
		const rulesPath = resolve(resolvedRoot, `assets/lifeos-rules.${language}.md`);
		try {
			const rules = readText(rulesPath);
			const versionLine = /^`v([^`\r\n]+)`\s*$/m.exec(rules);
			if (!versionLine) {
				errors.push(`${relativeDisplayPath(rulesPath, resolvedRoot)} 缺少独立的 \`vX.Y.Z\` 版本行`);
			} else if (versionLine[1] !== expectedVersion) {
				errors.push(
					`${relativeDisplayPath(rulesPath, resolvedRoot)} 的规则版本为 v${versionLine[1]}，应为 v${expectedVersion}`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(message.replace(rulesPath, relativeDisplayPath(rulesPath, resolvedRoot)));
		}
	}

	if (errors.length > 0) {
		throw new Error(
			`发布版本一致性检查失败（目标版本 ${expectedVersion}）：\n${errors.map((error) => `- ${error}`).join('\n')}`,
		);
	}

	return expectedVersion;
}

function isMainModule() {
	return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function main() {
	const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
	const packageVersion = readPackageVersion();
	const resolvedVersion = validateReleaseTag(tag, packageVersion);
	validateRepositoryVersions(resolvedVersion);

	console.log(`已验证发布版本 v${resolvedVersion}，package.json、锁文件、更新日志与发布资产一致`);
}

if (isMainModule()) {
	main();
}
