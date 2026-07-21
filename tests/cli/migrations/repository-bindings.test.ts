import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	discoverRepositoryBindings,
	resolveGitRoot,
} from '../../../src/cli/migrations/repository-bindings.js';
import type { LegacyMemoryInventoryItem } from '../../../src/cli/migrations/v4-scope-map.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-repository-bindings-'));
	temporaryRoots.push(root);
	return root;
}

function gitRepository(parent: string, name: string): string {
	const root = join(parent, name);
	mkdirSync(root, { recursive: true });
	execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
	return realpathSync.native(root);
}

function inventoryItem(
	slotKey: string,
	content: string,
	relatedFiles: string[] = [],
): LegacyMemoryInventoryItem {
	return {
		legacyIdentity: `slot:${slotKey}`,
		slotKey,
		content,
		contentHash: '0'.repeat(64),
		source: 'preference',
		relatedFiles,
		status: 'active',
		updatedAt: '2026-07-21T00:00:00.000Z',
	};
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('repository_bindings 自动发现', () => {
	it('纯文件系统解析普通 .git 目录和合法 .git 文件', () => {
		const parent = temporaryRoot();
		const ordinary = gitRepository(parent, 'ordinary-repository');
		const nestedFile = join(ordinary, 'src', 'index.ts');
		mkdirSync(join(ordinary, 'src'));
		writeFileSync(nestedFile, 'export {};');
		expect(resolveGitRoot(nestedFile)).toEqual({ status: 'resolved', root: ordinary });

		const worktree = join(parent, 'worktree');
		const metadata = join(parent, 'worktree-metadata');
		mkdirSync(worktree);
		mkdirSync(metadata);
		writeFileSync(join(metadata, 'HEAD'), 'ref: refs/heads/main\n');
		writeFileSync(join(worktree, '.git'), 'gitdir: ../worktree-metadata\n');
		expect(resolveGitRoot(worktree)).toEqual({
			status: 'resolved',
			root: realpathSync.native(worktree),
		});
	});

	it.skipIf(process.platform === 'win32')('拒绝 .git 符号链接和无效普通文件', () => {
		const parent = temporaryRoot();
		const metadata = join(parent, 'metadata');
		mkdirSync(metadata);
		writeFileSync(join(metadata, 'HEAD'), 'ref: refs/heads/main\n');

		const symlinkRepository = join(parent, 'symlink-repository');
		mkdirSync(symlinkRepository);
		symlinkSync(metadata, join(symlinkRepository, '.git'), 'dir');
		expect(resolveGitRoot(symlinkRepository)).toEqual({ status: 'not_git_repository' });
		const brokenSymlinkRepository = join(parent, 'broken-symlink-repository');
		mkdirSync(brokenSymlinkRepository);
		symlinkSync(join(parent, 'missing-metadata'), join(brokenSymlinkRepository, '.git'), 'dir');
		expect(resolveGitRoot(brokenSymlinkRepository)).toEqual({ status: 'not_git_repository' });

		const invalidRepository = join(parent, 'invalid-repository');
		mkdirSync(invalidRepository);
		writeFileSync(join(invalidRepository, '.git'), 'gitdir: ../missing-metadata\n');
		expect(resolveGitRoot(invalidRepository)).toEqual({ status: 'not_git_repository' });
	});

	it('覆盖生产旧记忆的 tool/workflow source path 槽位模式', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const lifeos = gitRepository(parent, 'lifeos');
		const learningapp = gitRepository(parent, 'LearningApp');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem('tool:lifeos-source-path', `源码路径固定为 ${lifeos}`),
				inventoryItem('workflow:lifeos-source-dir', `后续修改必须在 ${lifeos} 中完成`),
				inventoryItem('tool:learningapp-source-path', `source path is ${learningapp}`),
			],
		});

		expect(result.ambiguities).toEqual([]);
		expect(result.bindings).toEqual({ learningapp: [learningapp], lifeos: [lifeos] });
		expect(result.discovered.map(({ key }) => key)).toEqual(['learningapp', 'lifeos']);
	});

	it('内容明确声明源码路径时可由唯一 Git 根目录生成 key', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const repositoryRoot = gitRepository(parent, 'research-engine');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem('preference:workspace-location', `代码仓库目录：${repositoryRoot}`),
			],
		});

		expect(result.ambiguities).toEqual([]);
		expect(result.bindings).toEqual({ 'research-engine': [repositoryRoot] });
	});

	it('从 repository 槽位和内容绝对路径解析真实 Git 根目录并生成稳定 key', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const repositoryRoot = gitRepository(parent, 'LearningApp');
		const sourcePath = join(repositoryRoot, 'Sources', 'App.swift');
		mkdirSync(join(repositoryRoot, 'Sources'));
		writeFileSync(sourcePath, 'struct App {}');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem(
					'repository:learningapp-build',
					`源码文件位于 "${sourcePath}"，必须先检查构建`,
				),
			],
		});

		expect(result.ambiguities).toEqual([]);
		expect(result.bindings).toEqual({ learningapp: [repositoryRoot] });
		expect(result.discovered).toMatchObject([
			{
				key: 'learningapp',
				roots: [repositoryRoot],
				evidence: [{ source: 'content', path: sourcePath }],
			},
		]);
	});

	it('将同一仓库的 related_files 与内容证据去重，并稳定排序绑定路径', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const repositoryRoot = gitRepository(parent, 'lifeos');
		const first = join(repositoryRoot, 'README.md');
		const second = join(repositoryRoot, 'src', 'index.ts');
		mkdirSync(join(repositoryRoot, 'src'));
		writeFileSync(first, 'LifeOS');
		writeFileSync(second, 'export {};');

		const result = discoverRepositoryBindings({
			vaultRoot,
			existingBindings: { zeta: ['/z', '/a', '/z'] },
			inventory: [inventoryItem('repository:lifeos-release', `检查 ${second}`, [first, first])],
		});

		expect(result.ambiguities).toEqual([]);
		expect(result.bindings).toEqual({ lifeos: [repositoryRoot], zeta: ['/a', '/z'] });
		expect(result.discovered[0]?.evidence.map(({ path }) => path)).toEqual([first, second]);
	});

	it('显式绑定优先，已绑定仓库不会被自动发现结果改写', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const repositoryRoot = gitRepository(parent, 'lifeos');

		const result = discoverRepositoryBindings({
			vaultRoot,
			existingBindings: { custom: [repositoryRoot] },
			inventory: [inventoryItem('repository:lifeos-release', repositoryRoot)],
		});

		expect(result).toMatchObject({
			bindings: { custom: [repositoryRoot] },
			discovered: [],
			ambiguities: [],
		});
	});

	it('无绝对路径的 repository 规则可由唯一显式 key 直接满足', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const configuredRoot = join(parent, 'configured-lifeos');

		const result = discoverRepositoryBindings({
			vaultRoot,
			existingBindings: { lifeos: [configuredRoot] },
			inventory: [
				inventoryItem('repository:lifeos-release', '发布必须保持单一提交'),
				inventoryItem('workflow:lifeos-source-dir', '后续源码修改遵守同一发布规则'),
			],
		});

		expect(result).toEqual({
			bindings: { lifeos: [configuredRoot] },
			discovered: [],
			ambiguities: [],
		});
	});

	it('显式 key 已绑定其他仓库时报告冲突且绝不覆盖', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const explicitRoot = gitRepository(join(parent, 'explicit'), 'lifeos');
		const discoveredRoot = gitRepository(join(parent, 'discovered'), 'lifeos');

		const result = discoverRepositoryBindings({
			vaultRoot,
			existingBindings: { lifeos: [explicitRoot] },
			inventory: [inventoryItem('repository:lifeos-release', discoveredRoot)],
		});

		expect(result.bindings).toEqual({ lifeos: [explicitRoot] });
		expect(result.discovered).toEqual([]);
		expect(result.ambiguities).toMatchObject([
			{ reason: 'explicit_binding_conflict', proposedKey: 'lifeos' },
		]);
	});

	it('单条旧记忆命中多个 Git 仓库时保留结构化歧义，不做选择', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const first = gitRepository(parent, 'lifeos');
		const second = gitRepository(parent, 'lifeos-tools');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [inventoryItem('repository:lifeos-release', `同时参考 ${first} 和 ${second}`)],
		});

		expect(result.bindings).toEqual({});
		expect(result.discovered).toEqual([]);
		expect(result.ambiguities).toMatchObject([
			{
				reason: 'multiple_repositories',
				repositoryRoots: [first, second],
			},
		]);
	});

	it('不存在路径、非 Git 路径和缺少绝对路径分别报告歧义', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		const ordinaryDirectory = join(parent, 'ordinary');
		mkdirSync(vaultRoot);
		mkdirSync(ordinaryDirectory);

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem('repository:missing-path', join(parent, 'missing')),
				inventoryItem('repository:ordinary-path', ordinaryDirectory),
				inventoryItem('repository:relative-only', '只关联 Vault 项目文件', ['20_项目/Demo.md']),
			],
		});

		expect(result.bindings).toEqual({});
		expect(result.ambiguities.map(({ reason }) => reason).sort()).toEqual([
			'missing_path_evidence',
			'not_git_repository',
			'path_not_found',
		]);
	});

	it('Vault 自身或其项目目录即使是 Git 仓库也绝不生成源码绑定', () => {
		const parent = temporaryRoot();
		const vaultRoot = gitRepository(parent, 'vault');
		const projectPath = join(vaultRoot, '20_项目', 'Demo.md');
		mkdirSync(join(vaultRoot, '20_项目'));
		writeFileSync(projectPath, '# Demo');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [inventoryItem('repository:vault-project', projectPath)],
		});

		expect(result.bindings).toEqual({});
		expect(result.discovered).toEqual([]);
		expect(result.ambiguities).toMatchObject([{ reason: 'missing_path_evidence' }]);
	});

	it('同一自动 key 对应多个仓库根目录时整体拒绝，不返回部分绑定', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const first = gitRepository(join(parent, 'one'), 'lifeos');
		const second = gitRepository(join(parent, 'two'), 'lifeos');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem('repository:lifeos-release', first),
				inventoryItem('repository:lifeos-build', second),
			],
		});

		expect(result.bindings).toEqual({});
		expect(result.discovered).toEqual([]);
		expect(result.ambiguities).toMatchObject([
			{
				reason: 'repository_key_conflict',
				proposedKey: 'lifeos',
				repositoryRoots: [first, second],
			},
		]);
	});

	it('仓库目录无法生成 ASCII key 或与槽位提示不一致时不猜测', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const chinese = gitRepository(parent, '源码仓库');
		const lifeos = gitRepository(parent, 'lifeos');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem('repository:源码规则', chinese),
				inventoryItem('repository:another-product', lifeos),
			],
		});

		expect(result.bindings).toEqual({});
		expect(result.ambiguities.map(({ reason }) => reason).sort()).toEqual([
			'repository_key_mismatch',
			'repository_key_unavailable',
		]);
	});

	it('非 repository 槽位中的绝对路径不会触发自动绑定', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		mkdirSync(vaultRoot);
		const repositoryRoot = gitRepository(parent, 'tooling');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [inventoryItem('tool:codex-path', repositoryRoot)],
		});

		expect(result).toEqual({ bindings: {}, discovered: [], ambiguities: [] });
	});

	it('关联正式项目笔记的 source-path 事实属于项目，不产生仓库歧义', () => {
		const parent = temporaryRoot();
		const vaultRoot = join(parent, 'vault');
		const projectDirectory = join(vaultRoot, '20_项目', 'GTS学习');
		const projectFile = join(projectDirectory, 'GTS学习.md');
		mkdirSync(projectDirectory, { recursive: true });
		writeFileSync(projectFile, '---\ntype: project\nid: gts-learning\n---\n# GTS 学习');

		const result = discoverRepositoryBindings({
			vaultRoot,
			inventory: [
				inventoryItem(
					'tool:gts-source-path',
					`GTS 学习项目源码路径固定为 ${join(parent, 'removed-gts-source')}`,
					['20_项目/GTS学习/GTS学习.md'],
				),
			],
		});

		expect(result).toEqual({ bindings: {}, discovered: [], ambiguities: [] });
	});
});
