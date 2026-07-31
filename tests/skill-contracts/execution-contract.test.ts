import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const requiredManifestFields = [
	'contract_version',
	'run_id',
	'phase',
	'plan_revision',
	'confirmed_hash',
	'inputs',
	'artifacts',
	'status_mutations',
	'validation',
	'errors',
];
const phases = ['planned', 'confirmed', 'executing', 'validated', 'committed', 'failed', 'cancelled'];
const capabilities = [
	'spawn_agent',
	'ask_user',
	'web_search',
	'web_fetch',
	'inspect_image',
	'execute_command',
	'move_with_link_update',
];

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

function readYamlContract(relativePath: string, marker: string): unknown {
	const content = read(relativePath);
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(
		new RegExp('<!--\\s*' + escaped + '\\s*-->\\s*\\n```yaml\\n([\\s\\S]*?)\\n```', 'm'),
	);
	if (!match) throw new Error(`缺少 YAML 契约块 ${marker}：${relativePath}`);
	return parseYaml(match[1]);
}

function expectInOrder(content: string, path: string, patterns: RegExp[]): void {
	let cursor = 0;
	for (const pattern of patterns) {
		const match = content.slice(cursor).match(pattern);
		expect(match, `${path} 缺少有序步骤 ${pattern}`).not.toBeNull();
		cursor += (match?.index ?? 0) + (match?.[0].length ?? 0);
	}
}

describe('阶段二执行契约', () => {
	it('公开机器可读的执行清单字段和阶段枚举', () => {
		const schema = JSON.parse(read('assets/schema/Execution_Manifest_Schema.json')) as {
			required: string[];
			properties: { phase: { enum: string[] } };
		};
		expect(schema.required).toEqual(requiredManifestFields);
		expect(schema.properties.phase.enum).toEqual(phases);
	});

	it('中英文能力协议共享同一语义能力契约', () => {
		const zh = readYamlContract('assets/skills/_shared/client-capabilities.zh.md', 'client-capabilities-v1');
		const en = readYamlContract('assets/skills/_shared/client-capabilities.en.md', 'client-capabilities-v1');
		for (const contract of [zh, en]) {
			expect(contract).toMatchObject({ contract_version: 1, capabilities: expect.any(Object) });
			const entries = (contract as { capabilities: Record<string, Record<string, unknown>> })
				.capabilities;
			expect(Object.keys(entries)).toEqual(capabilities);
			for (const [name, definition] of Object.entries(entries)) {
				expect(definition, `${name} 缺少 purpose`).toHaveProperty('purpose');
				expect(definition, `${name} 缺少 examples`).toHaveProperty('examples');
				expect(definition, `${name} 缺少 fallback`).toHaveProperty('fallback');
			}
		}
	});

	it('确认摘要在计划修订或哈希变化后失效，并按独立验收顺序提交', () => {
		for (const path of [
			'assets/skills/_shared/dual-agent-orchestrator.zh.md',
			'assets/skills/_shared/dual-agent-orchestrator.en.md',
		]) {
			const content = read(path);
			expect(content, path).toMatch(/confirmed_hash/);
			expect(content, path).toMatch(/plan_revision/);
			expect(content, path).toMatch(/重新确认|re-confirm/i);
			expectInOrder(content, path, [
				/status:\s*pending/,
				/snapshot/i,
				/user.confirm|用户确认/i,
				/hash.check|哈希校验/i,
				/status:\s*active/,
				/execute|执行/i,
				/manifest/i,
				/independent.*valid|独立验收/i,
				/memory_notify/,
				/status:\s*done/,
			]);
		}
	});

	it('项目、研究和头脑风暴通过公共语义契约协作', () => {
		for (const path of [
			'assets/skills/project/SKILL.zh.md',
			'assets/skills/project/SKILL.en.md',
		]) {
			const content = read(path);
			expect(content, path).toContain('client-capabilities');
			expect(content, path).toContain('Execution_Manifest_Schema.json');
			expect(content, path).toContain('project_identity.mjs');
			expect(content, path).toMatch(/plan_revision/);
			expect(content, path).toMatch(/confirmed_hash/);
		}
		for (const path of ['assets/skills/research/SKILL.zh.md', 'assets/skills/research/SKILL.en.md']) {
			const content = read(path);
			expect(content, path).toContain('client-capabilities');
			expect(content, path).toContain('Execution_Manifest_Schema.json');
			expect(content, path).toMatch(/plan_revision/);
			expect(content, path).toMatch(/confirmed_hash/);
		}
		for (const path of [
			'assets/skills/brainstorm/references/action-options.zh.md',
			'assets/skills/brainstorm/references/action-options.en.md',
		]) {
			const content = read(path);
			expect(content, path).toContain('/project');
			expect(content, path).toMatch(/结构化输入|structured input/i);
			expect(content, path).not.toMatch(/planning-agent-prompt/);
		}
	});
});
