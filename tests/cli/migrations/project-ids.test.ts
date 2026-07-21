import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProjectIdPlan, planProjectIds } from '../../../src/cli/migrations/project-ids.js';
import type { LifeOSConfig } from '../../../src/config.js';

const roots: string[] = [];

function fixture(): { root: string; projects: string; config: LifeOSConfig } {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-project-ids-'));
	const projects = join(root, '20_项目');
	mkdirSync(projects);
	roots.push(root);
	return {
		root,
		projects,
		config: { directories: { projects: '20_项目' } } as LifeOSConfig,
	};
}

function writeProject(projects: string, name: string, content: string): string {
	const path = join(projects, name);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, content, 'utf8');
	return path;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('项目 ID 自动配置', () => {
	it('dry-run 不写文件，apply 保留原内容与 CRLF 并返回完整 catalog', () => {
		const { root, projects, config } = fixture();
		const missing = writeProject(
			projects,
			'Visual Group Theory学习.md',
			'---\r\n# 保留注释\r\ntitle: Visual Group Theory 学习\r\ntype: project\r\nstatus: active\r\n---\r\n正文  \r\n',
		);
		const existing = writeProject(
			projects,
			'已有项目.md',
			'---\ntitle: 已有项目\ntype: project\nid: existing-project\n---\n正文\n',
		);
		const projectDoc = writeProject(
			projects,
			'辅助文档.md',
			'---\ntype: project-doc\nid: INVALID_FOR_PROJECT_DOC\n---\n无需处理\n',
		);
		const beforeMissing = readFileSync(missing, 'utf8');
		const beforeExisting = readFileSync(existing, 'utf8');
		const beforeDoc = readFileSync(projectDoc, 'utf8');

		const plan = planProjectIds(root, config);

		expect(plan.scannedMarkdownFiles).toBe(3);
		expect(plan.changes).toEqual([
			expect.objectContaining({
				relativePath: '20_项目/Visual Group Theory学习.md',
				id: 'visual-group-theory',
				reason: 'ascii-slug',
			}),
		]);
		expect(readFileSync(missing, 'utf8')).toBe(beforeMissing);
		expect(readFileSync(existing, 'utf8')).toBe(beforeExisting);
		expect(readFileSync(projectDoc, 'utf8')).toBe(beforeDoc);

		const result = applyProjectIdPlan(plan);

		expect(result.updated).toEqual([plan.changes[0]?.filePath]);
		expect(readFileSync(missing, 'utf8')).toBe(
			'---\r\n# 保留注释\r\ntitle: Visual Group Theory 学习\r\ntype: project\r\nstatus: active\r\nid: "visual-group-theory"\r\n---\r\n正文  \r\n',
		);
		expect(readFileSync(existing, 'utf8')).toBe(beforeExisting);
		expect(readFileSync(projectDoc, 'utf8')).toBe(beforeDoc);
		expect(result.catalog).toEqual([
			expect.objectContaining({ id: 'existing-project' }),
			expect.objectContaining({
				id: 'visual-group-theory',
				aliases: ['Visual Group Theory 学习', 'Visual Group Theory学习'],
			}),
		]);

		const secondPlan = planProjectIds(root, config);
		expect(secondPlan.changes).toEqual([]);
		expect(applyProjectIdPlan(secondPlan)).toEqual({ updated: [], catalog: result.catalog });
	});

	it('中文标题和文件名使用稳定路径哈希', () => {
		const { root, projects, config } = fixture();
		writeProject(projects, '读书计划.md', '---\ntitle: 读书计划\ntype: project\n---\n正文\n');

		const first = planProjectIds(root, config);
		const second = planProjectIds(root, config);

		expect(first.changes).toHaveLength(1);
		expect(first.changes[0]).toMatchObject({ reason: 'path-hash' });
		expect(first.changes[0]?.id).toMatch(/^project-[a-f0-9]{10}$/);
		expect(second.changes[0]?.id).toBe(first.changes[0]?.id);
	});

	it('原位补全空或 null 的 id 字段且不产生重复键', () => {
		const { root, projects, config } = fixture();
		const blank = writeProject(
			projects,
			'Alpha.md',
			'---\ntitle: Alpha\ntype: project\nid:\nstatus: active\n---\n',
		);
		const nullable = writeProject(
			projects,
			'Beta.md',
			'---\ntitle: Beta\ntype: project\nid : null # 保留说明\n---\n',
		);
		const quoted = writeProject(
			projects,
			'Gamma.md',
			'---\ntitle: Gamma\ntype: project\nid: ""\n---\n',
		);
		const comment = writeProject(
			projects,
			'Delta.md',
			'---\ntitle: Delta\ntype: project\nid: # 行尾注释\n---\n',
		);

		const result = applyProjectIdPlan(planProjectIds(root, config));

		expect(result.updated).toHaveLength(4);
		expect(readFileSync(blank, 'utf8')).toContain('\nid: "alpha"\n');
		expect(readFileSync(nullable, 'utf8')).toContain('\nid : "beta" # 保留说明\n');
		expect(readFileSync(quoted, 'utf8')).toContain('\nid: "gamma"\n');
		expect(readFileSync(comment, 'utf8')).toContain('\nid: "delta" # 行尾注释\n');
		for (const path of [blank, nullable, quoted, comment]) {
			expect(readFileSync(path, 'utf8').match(/^id\s*:/gm)).toHaveLength(1);
		}
		expect(planProjectIds(root, config).changes).toEqual([]);
	});

	it('数字与 YAML 核心标量关键字始终写成字符串 ID', () => {
		const { root, projects, config } = fixture();
		const numeric = writeProject(projects, '123.md', '---\ntype: project\n---\n');
		const truthy = writeProject(projects, 'Truth.md', '---\ntitle: "true"\ntype: project\n---\n');
		const nullable = writeProject(projects, 'Null.md', '---\ntitle: "null"\ntype: project\n---\n');

		const plan = planProjectIds(root, config);
		expect(plan.changes.map(({ id }) => id).sort()).toEqual(['123', 'null', 'true']);

		applyProjectIdPlan(plan);

		for (const [path, id] of [
			[numeric, '123'],
			[truthy, 'true'],
			[nullable, 'null'],
		] as const) {
			const content = readFileSync(path, 'utf8');
			expect(content).toContain(`\nid: "${id}"\n`);
		}
		expect(planProjectIds(root, config).changes).toEqual([]);
	});

	it('同名或与已有 ID 冲突时对所有缺失项做确定性消歧', () => {
		const { root, projects, config } = fixture();
		writeProject(projects, '已有.md', '---\ntitle: 既有 GTS\ntype: project\nid: gts\n---\n');
		writeProject(projects, '甲/GTS.md', '---\ntitle: GTS\ntype: project\n---\n');
		writeProject(projects, '乙/GTS.md', '---\ntitle: GTS\ntype: project\n---\n');

		const plan = planProjectIds(root, config);

		expect(plan.changes.map(({ id, reason }) => ({ id, reason }))).toEqual([
			{ id: expect.stringMatching(/^gts-[a-f0-9]{10}$/), reason: 'conflict' },
			{ id: expect.stringMatching(/^gts-[a-f0-9]{10}$/), reason: 'conflict' },
		]);
		expect(plan.changes[0]?.id).not.toBe(plan.changes[1]?.id);
		expect(plan.catalog.map((project) => project.id)).toContain('gts');
	});

	it('应用前检测计划生成后的并发修改，且不产生部分写入', () => {
		const { root, projects, config } = fixture();
		const first = writeProject(projects, 'First.md', '---\ntitle: First\ntype: project\n---\n');
		const second = writeProject(projects, 'Second.md', '---\ntitle: Second\ntype: project\n---\n');
		const originalFirst = readFileSync(first, 'utf8');
		const plan = planProjectIds(root, config);
		writeFileSync(second, '---\ntitle: Changed\ntype: project\n---\n', 'utf8');

		expect(() => applyProjectIdPlan(plan)).toThrow(/发生变化/);
		expect(readFileSync(first, 'utf8')).toBe(originalFirst);
	});

	it('拒绝重复、占位或非法的已有项目 ID', () => {
		const duplicate = fixture();
		writeProject(duplicate.projects, 'A.md', '---\ntype: project\nid: same\n---\n');
		writeProject(duplicate.projects, 'B.md', '---\ntype: project\nid: same\n---\n');
		expect(() => planProjectIds(duplicate.root, duplicate.config)).toThrow(/项目 id 重复/);

		const placeholder = fixture();
		writeProject(
			placeholder.projects,
			'A.md',
			'---\ntype: project\nid: project-placeholder\n---\n',
		);
		expect(() => planProjectIds(placeholder.root, placeholder.config)).toThrow(/占位 id/);

		const invalid = fixture();
		writeProject(invalid.projects, 'A.md', '---\ntype: project\nid: Upper_Case\n---\n');
		expect(() => planProjectIds(invalid.root, invalid.config)).toThrow(/小写 ASCII/);
	});

	it('拒绝未闭合、不可解析和非对象 frontmatter', () => {
		const unclosed = fixture();
		writeProject(unclosed.projects, 'A.md', '---\ntype: project\n');
		expect(() => planProjectIds(unclosed.root, unclosed.config)).toThrow(/未正确闭合/);

		const invalidYaml = fixture();
		writeProject(invalidYaml.projects, 'A.md', '---\ntype: [project\n---\n');
		expect(() => planProjectIds(invalidYaml.root, invalidYaml.config)).toThrow(/YAML 非法/);

		const scalar = fixture();
		writeProject(scalar.projects, 'A.md', '---\nproject\n---\n');
		expect(() => planProjectIds(scalar.root, scalar.config)).toThrow(/必须是 YAML 对象/);
	});

	it.skipIf(process.platform === 'win32')('拒绝项目树内的符号链接', () => {
		const { root, projects, config } = fixture();
		const outside = join(root, 'outside.md');
		writeFileSync(outside, '---\ntype: project\n---\n', 'utf8');
		symlinkSync(outside, join(projects, 'linked.md'));

		expect(() => planProjectIds(root, config)).toThrow(/符号链接/);
	});

	it('路径哈希基于 Vault 相对路径', () => {
		const first = fixture();
		const second = fixture();
		const relativePath = '20_项目/纯中文.md';
		writeProject(first.projects, '纯中文.md', '---\ntitle: 纯中文\ntype: project\n---\n');
		writeProject(second.projects, '纯中文.md', '---\ntitle: 纯中文\ntype: project\n---\n');

		const expected = createHash('sha256').update(relativePath).digest('hex').slice(0, 10);
		expect(planProjectIds(first.root, first.config).changes[0]?.id).toBe(`project-${expected}`);
		expect(planProjectIds(second.root, second.config).changes[0]?.id).toBe(`project-${expected}`);
	});
});
