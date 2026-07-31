import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'assets', 'skills', '_shared', 'scripts', 'project_identity.mjs');

async function loadModule(): Promise<typeof import('../../assets/skills/_shared/scripts/project_identity.mjs')> {
	return import(scriptPath);
}

describe('项目稳定 ID 脚本', () => {
	it('按标题、文件名和已有 ID 生成稳定的递增标识', async () => {
		const { generateProjectIdentity: generate } = await loadModule();
		expect(generate({ title: 'Graph RAG', filename: '', existing_ids: [] })).toEqual({
			project_id: 'graph-rag',
			base: 'graph-rag',
			suffix: 1,
		});
		expect(generate({ title: 'Graph RAG', filename: '', existing_ids: ['graph-rag'] })).toEqual({
			project_id: 'graph-rag-2',
			base: 'graph-rag',
			suffix: 2,
		});
		expect(generate({ title: '图检索', filename: 'graph-search.md', existing_ids: [] })).toEqual({
			project_id: 'graph-search',
			base: 'graph-search',
			suffix: 1,
		});
	});

	it('拒绝空值和保留占位标识', async () => {
		const { generateProjectIdentity: generate, validateProjectIdentity: validate } = await loadModule();
		expect(() => generate({ title: '图检索', filename: '', existing_ids: [] })).toThrow();
		expect(validate('graph-rag')).toEqual({ valid: true });
		expect(validate('placeholder')).toMatchObject({ valid: false });
		expect(validate('project-template')).toMatchObject({ valid: false });
	});

	it('CLI 从标准输入读取 JSON，并用非零退出码报告无效输入', () => {
		const ok = spawnSync('node', [scriptPath], {
			encoding: 'utf-8',
			input: JSON.stringify({ title: 'Graph RAG', filename: '', existing_ids: [] }),
		});
		expect(ok.status).toBe(0);
		expect(JSON.parse(ok.stdout)).toMatchObject({ project_id: 'graph-rag' });

		const invalid = spawnSync('node', [scriptPath], {
			encoding: 'utf-8',
			input: JSON.stringify({ title: '', filename: '', existing_ids: [] }),
		});
		expect(invalid.status).not.toBe(0);
		expect(invalid.stderr).not.toBe('');
	});
});
