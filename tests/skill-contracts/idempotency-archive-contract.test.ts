import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function contract(path: string): Record<string, unknown> {
	const match = read(path).match(/<!--\s*operation-safety-v1\s*-->\s*\n```yaml\n([\s\S]*?)\n```/m);
	if (!match) throw new Error(`缺少 operation-safety-v1：${path}`);
	return parseYaml(match[1]) as Record<string, unknown>;
}

function expectOperationContract(path: string, operation: string): void {
	const value = contract(path);
	expect(value).toMatchObject({ contract_version: 1, operation });
	expect(value.run_id).toEqual(expect.any(String));
	expect(value.target_path).toEqual(expect.any(String));
	expect(value.decision).toEqual(['create', 'merge', 'resume', 'skip', 'replace']);
}

describe('阶段五幂等与归档契约', () => {
	it('中英文共享协议定义稳定运行、预检、通知和可恢复清单', () => {
		for (const path of [
			'assets/skills/_shared/operation-safety.zh.md',
			'assets/skills/_shared/operation-safety.en.md',
		]) {
			const content = read(path);
			expect(content).toMatch(/run_id/);
			expect(content).toMatch(/preflight/i);
			expect(content).toMatch(/memory_notify/);
			expect(content).toMatch(/rollback|恢复/i);
			expect(content).toMatch(/create\|merge\|resume\|skip\|replace/);
		}
	});

	it('可重跑技能公开稳定运行标识、目标路径和决策', () => {
		for (const [path, operation] of [
			['assets/skills/ask/SKILL.zh.md', 'ask'], ['assets/skills/ask/SKILL.en.md', 'ask'],
			['assets/skills/today/SKILL.zh.md', 'today'], ['assets/skills/today/SKILL.en.md', 'today'],
			['assets/skills/digest/SKILL.zh.md', 'digest'], ['assets/skills/digest/SKILL.en.md', 'digest'],
			['assets/skills/research/SKILL.zh.md', 'research'], ['assets/skills/research/SKILL.en.md', 'research'],
			['assets/skills/translate/SKILL.zh.md', 'translate'], ['assets/skills/translate/SKILL.en.md', 'translate'],
			['assets/skills/revise/SKILL.zh.md', 'revise'], ['assets/skills/revise/SKILL.en.md', 'revise'],
		] as const) expectOperationContract(path, operation);
	});

	it('Today 只在托管区块按稳定任务 ID 合并', () => {
		for (const path of ['assets/skills/today/SKILL.zh.md', 'assets/skills/today/SKILL.en.md']) {
			const content = read(path);
			expect(content).toMatch(/managed region|托管区块/i);
			expect(content).toMatch(/task_id/);
			expect(content).toMatch(/merge/);
		}
	});

	it('Digest 失败关闭并记录可合并来源台账', () => {
		for (const path of [
			'assets/skills/digest/SKILL.zh.md', 'assets/skills/digest/SKILL.en.md',
			'assets/skills/digest/references/config-parser.zh.md', 'assets/skills/digest/references/config-parser.en.md',
			'assets/skills/digest/references/run-pipeline.zh.md', 'assets/skills/digest/references/run-pipeline.en.md',
		]) {
			const content = read(path);
			expect(content).toMatch(/run_id/);
			expect(content).toMatch(/published_at/);
			expect(content).toMatch(/fetched_at/);
			expect(content).toMatch(/health/);
			expect(content).toMatch(/errors/);
		}
		for (const path of ['assets/skills/digest/SKILL.zh.md', 'assets/skills/digest/SKILL.en.md']) {
			const content = read(path);
			expect(content).toMatch(/unknown module|未知模块/i);
			expect(content).toMatch(/all sources failed|全部来源失败/i);
			expect(content).toMatch(/stdin/);
			expect(content).not.toMatch(/echo\s+['"]?<json_input>/);
		}
	});

	it('Research、Translate 和 Revise 保护可恢复工作与评分状态', () => {
		for (const path of ['assets/skills/research/SKILL.zh.md', 'assets/skills/research/SKILL.en.md', 'assets/skills/translate/SKILL.zh.md', 'assets/skills/translate/SKILL.en.md']) {
			const content = read(path);
			expect(content).toMatch(/resume/);
			expect(content).toMatch(/explicit.*replace|明确.*replace/i);
		}
		for (const path of ['assets/skills/revise/SKILL.zh.md', 'assets/skills/revise/SKILL.en.md', 'assets/skills/revise/references/grading-protocol.zh.md', 'assets/skills/revise/references/grading-protocol.en.md']) {
			const content = read(path);
			expect(content).toMatch(/knowledge_point_id/);
			expect(content).toMatch(/source_refs/);
			expect(content).toMatch(/rubric/);
			expect(content).toMatch(/hash/);
			expect(content).toMatch(/80%|0\.8/);
		}
	});

	it('Archive 在移动前预检，在索引确认后遗忘，并保留恢复清单', () => {
		for (const path of ['assets/skills/archive/SKILL.zh.md', 'assets/skills/archive/SKILL.en.md']) {
			const content = read(path);
			expectOperationContract(path, 'archive');
			expect(content).toMatch(/preflight/i);
			expect(content).toMatch(/collision/i);
			expect(content).toMatch(/move manifest/i);
			expect(content).toMatch(/memory_notify/);
			expect(content).toMatch(/memory_forget/);
			expect(content).toMatch(/index.*confirm|索引.*确认/i);
			expect(content).toMatch(/explicit.*degrade|明确.*降级/i);
		}
	});
});
