import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

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
const phases = [
	'planned',
	'confirmed',
	'executing',
	'validated',
	'committed',
	'failed',
	'cancelled',
];
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
		new RegExp(`<!--\\s*${escaped}\\s*-->\\s*\\n\`\`\`yaml\\n([\\s\\S]*?)\\n\`\`\``, 'm'),
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

function expectSameMachineShape(zh: unknown, en: unknown, path: string): void {
	if (path.endsWith('.purpose') || path.endsWith('.fallback')) {
		expect(typeof en, `${path} 说明字段类型不一致`).toBe('string');
		expect(typeof zh, `${path} 说明字段类型不一致`).toBe('string');
		return;
	}
	if (Array.isArray(zh) || Array.isArray(en)) {
		expect(Array.isArray(en), `${path} 数组类型不一致`).toBe(Array.isArray(zh));
		expect((en as unknown[]).length, `${path} 数组长度不一致`).toBe((zh as unknown[]).length);
		for (let index = 0; index < (zh as unknown[]).length; index += 1) {
			expectSameMachineShape(
				(zh as unknown[])[index],
				(en as unknown[])[index],
				`${path}[${index}]`,
			);
		}
		return;
	}
	if (zh && en && typeof zh === 'object' && typeof en === 'object') {
		const zhRecord = zh as Record<string, unknown>;
		const enRecord = en as Record<string, unknown>;
		expect(Object.keys(enRecord).sort(), `${path} 字段集合不一致`).toEqual(
			Object.keys(zhRecord).sort(),
		);
		for (const key of Object.keys(zhRecord))
			expectSameMachineShape(zhRecord[key], enRecord[key], `${path}.${key}`);
		return;
	}
	expect(en, `${path} 机器字段值不一致`).toEqual(zh);
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
		const zh = readYamlContract(
			'assets/skills/_shared/client-capabilities.zh.md',
			'client-capabilities-v1',
		);
		const en = readYamlContract(
			'assets/skills/_shared/client-capabilities.en.md',
			'client-capabilities-v1',
		);
		for (const contract of [zh, en]) {
			expect(contract).toMatchObject({ contract_version: 1, capabilities: expect.any(Object) });
			const entries = (contract as { capabilities: Record<string, Record<string, unknown>> })
				.capabilities;
			expect(Object.keys(entries)).toEqual(capabilities);
			for (const [name, definition] of Object.entries(entries)) {
				expect(definition, `${name} 缺少 purpose`).toHaveProperty('purpose');
				expect(definition, `${name} 缺少 examples`).toHaveProperty('examples');
				expect(definition, `${name} 缺少专有样例索引`).toHaveProperty(
					'client_specific_example_indexes',
				);
				expect(definition, `${name} 缺少 fallback`).toHaveProperty('fallback');
				const examples = definition.examples as unknown[];
				const indexes = definition.client_specific_example_indexes as unknown[];
				expect(indexes.length, `${name} 至少声明一个客户端专有样例`).toBeGreaterThan(0);
				for (const index of indexes) {
					expect(Number.isInteger(index), `${name} 专有样例索引必须为整数`).toBe(true);
					expect(index, `${name} 专有样例索引越界`).toBeGreaterThanOrEqual(0);
					expect(index, `${name} 专有样例索引越界`).toBeLessThan(examples.length);
					expect(typeof examples[index as number], `${name} 专有样例必须是字符串`).toBe('string');
				}
			}
		}
		expectSameMachineShape(zh, en, 'client-capabilities');
	});

	it('交互与网络技能只依赖语义能力并公开降级路径', () => {
		for (const [skill, expectedCapabilities] of [
			['today', ['ask_user']],
			['revise', ['ask_user']],
			['digest', ['web_search', 'web_fetch', 'execute_command']],
		] as const) {
			for (const locale of ['zh', 'en'] as const) {
				const path = `assets/skills/${skill}/SKILL.${locale}.md`;
				const content = read(path);
				for (const capability of expectedCapabilities) {
					expect(content, path).toMatch(
						new RegExp(`capabilities: \\[[^\\]]*\\b${capability}\\b[^\\]]*\\]`),
					);
					expect(content, path).toMatch(new RegExp(`\\b${capability}\\b`));
				}
				expect(content, path).toContain('client-capabilities');
				expect(content, path).toMatch(/降级|fallback/i);
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
		for (const path of ['assets/skills/project/SKILL.zh.md', 'assets/skills/project/SKILL.en.md']) {
			const content = read(path);
			expect(content, path).toContain('client-capabilities');
			expect(content, path).toContain('Execution_Manifest_Schema.json');
			expect(content, path).toContain('project_identity.mjs');
			expect(content, path).toMatch(/plan_revision/);
			expect(content, path).toMatch(/confirmed_hash/);
		}
		for (const path of [
			'assets/skills/research/SKILL.zh.md',
			'assets/skills/research/SKILL.en.md',
		]) {
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

	it('脚本型技能通过 execute_command 解析 Python 3', () => {
		for (const path of [
			'assets/skills/read-pdf/SKILL.zh.md',
			'assets/skills/read-pdf/SKILL.en.md',
			'assets/skills/translate/SKILL.zh.md',
			'assets/skills/translate/SKILL.en.md',
			'assets/skills/digest/SKILL.zh.md',
			'assets/skills/digest/SKILL.en.md',
			'assets/skills/digest/references/run-pipeline.zh.md',
			'assets/skills/digest/references/run-pipeline.en.md',
		]) {
			const content = read(path);
			expect(content, path).toContain('execute_command');
			expect(content, path).toContain('python3');
			expect(content, path).toContain('py -3');
			expect(content, path).toMatch(/初始化阶段|initialization/i);
			expect(content, path).toMatch(/Python 2|Python 2/);
			expect(content, path).not.toMatch(/(?:^|\n)python\s+\.agents\/skills\/(?:read-pdf|digest)/m);
		}
	});
});
