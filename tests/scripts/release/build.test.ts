import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanOutputDirectory } from '../../../scripts/build.mjs';

describe('发布构建清理', () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('构建前删除整个 dist，避免已删除源码的旧产物进入 tarball', () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-build-clean-'));
		roots.push(root);
		const output = join(root, 'dist');
		mkdirSync(join(output, 'active-docs'), { recursive: true });
		writeFileSync(join(output, 'active-docs', 'derived-memory.js'), 'stale', 'utf-8');

		cleanOutputDirectory(root, output);
		expect(existsSync(output)).toBe(false);
	});

	it('拒绝删除仓库 dist 之外的目录', () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-build-guard-'));
		roots.push(root);
		expect(() => cleanOutputDirectory(root, join(root, 'assets'))).toThrow(/非仓库 dist/);
		expect(() => cleanOutputDirectory(root, root)).toThrow(/非仓库 dist/);
	});

	it('普通构建和发布打包都强制经过 clean-build', () => {
		const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts.build).toBe('node scripts/build.mjs');
		expect(packageJson.scripts['release:pack']).toMatch(/^npm run build /);
	});
});
