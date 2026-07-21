import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const loadModule = () => import('../../../scripts/release/check-version.mjs');

const temporaryRoots: string[] = [];

function writeFixtureFile(root: string, relativePath: string, content: string): void {
	const filePath = join(root, relativePath);
	mkdirSync(join(filePath, '..'), { recursive: true });
	writeFileSync(filePath, content, 'utf8');
}

function createReleaseFixture(version = '1.2.3'): string {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-release-version-'));
	temporaryRoots.push(root);

	writeFixtureFile(
		root,
		'package-lock.json',
		JSON.stringify({ name: 'lifeos', version, packages: { '': { name: 'lifeos', version } } }),
	);
	writeFixtureFile(root, 'CHANGELOG.md', `# 更新日志\n\n## ${version} (2026-07-21)\n`);
	writeFixtureFile(
		root,
		'assets/skills/ask/SKILL.zh.md',
		`---\nname: ask\nversion: ${version}\n---\n`,
	);
	writeFixtureFile(
		root,
		'assets/skills/ask/SKILL.en.md',
		`---\nname: ask\nversion: ${version}\n---\n`,
	);
	writeFixtureFile(
		root,
		'assets/lifeos-rules.zh.md',
		`# Agent 行为规范 — LifeOS\n\`v${version}\`\n`,
	);
	writeFixtureFile(
		root,
		'assets/lifeos-rules.en.md',
		`# Agent 行为规范 — LifeOS\n\`v${version}\`\n`,
	);

	return root;
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('release check-version helper', () => {
	it('accepts a tag that matches the package version', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(validateReleaseTag('v1.2.3', '1.2.3')).toBe('1.2.3');
	});

	it('rejects a missing tag', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('', '1.2.3')).toThrow('Release tag is required');
	});

	it('rejects an invalid tag format', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('1.2.3', '1.2.3')).toThrow('Release tag must match vX.Y.Z');
	});

	it('rejects a tag that does not match package.json', async () => {
		const { validateReleaseTag } = await loadModule();

		expect(() => validateReleaseTag('v1.2.4', '1.2.3')).toThrow(
			'Release tag v1.2.4 does not match package.json version 1.2.3',
		);
	});

	it('校验锁文件、更新日志、技能 frontmatter 与规则资产版本', async () => {
		const { validateRepositoryVersions } = await loadModule();
		const root = createReleaseFixture();

		expect(validateRepositoryVersions('1.2.3', root)).toBe('1.2.3');
	});

	it('一次报告所有版本不一致项', async () => {
		const { validateRepositoryVersions } = await loadModule();
		const root = createReleaseFixture();

		writeFixtureFile(
			root,
			'package-lock.json',
			JSON.stringify({
				name: 'lifeos',
				version: '1.2.4',
				packages: { '': { name: 'lifeos', version: '1.2.5' } },
			}),
		);
		writeFixtureFile(root, 'CHANGELOG.md', '# 更新日志\n\n## 1.2.4 (2026-07-21)\n');
		writeFixtureFile(
			root,
			'assets/skills/ask/SKILL.zh.md',
			'---\nname: ask\nversion: 1.2.4\n---\n',
		);
		writeFixtureFile(root, 'assets/lifeos-rules.en.md', '# Agent 行为规范 — LifeOS\n`v1.2.4`\n');

		expect(() => validateRepositoryVersions('1.2.3', root)).toThrow(
			'package-lock.json 根 version 为 1.2.4，应为 1.2.3',
		);

		try {
			validateRepositoryVersions('1.2.3', root);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain("package-lock.json packages[''].version 为 1.2.5，应为 1.2.3");
			expect(message).toContain('CHANGELOG.md 缺少版本 1.2.3 的二级标题');
			expect(message).toContain(
				'assets/skills/ask/SKILL.zh.md 的 frontmatter version 为 1.2.4，应为 1.2.3',
			);
			expect(message).toContain('assets/lifeos-rules.en.md 的规则版本为 v1.2.4，应为 v1.2.3');
		}
	});

	it('缺少任一语言的技能文件时失败', async () => {
		const { validateRepositoryVersions } = await loadModule();
		const root = createReleaseFixture();
		rmSync(join(root, 'assets/skills/ask/SKILL.en.md'));

		expect(() => validateRepositoryVersions('1.2.3', root)).toThrow(
			'assets/skills/ask/SKILL.en.md',
		);
	});

	it('规则资产缺少独立版本行时失败', async () => {
		const { validateRepositoryVersions } = await loadModule();
		const root = createReleaseFixture();
		writeFixtureFile(root, 'assets/lifeos-rules.zh.md', '# Agent 行为规范 — LifeOS\n');

		expect(() => validateRepositoryVersions('1.2.3', root)).toThrow(
			'assets/lifeos-rules.zh.md 缺少独立的 `vX.Y.Z` 版本行',
		);
	});
});
