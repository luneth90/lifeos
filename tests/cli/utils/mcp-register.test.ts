import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMcp } from '../../../src/cli/utils/mcp-register.js';

describe('registerMcp 配置保全', () => {
	const temporaryRoots: string[] = [];

	function makeRoot(): string {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-mcp-register-'));
		temporaryRoots.push(root);
		return root;
	}

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('现有 .mcp.json 无法解析时拒绝覆盖并保留原文', async () => {
		const root = makeRoot();
		const path = join(root, '.mcp.json');
		const malformed = '{"mcpServers":\n';
		writeFileSync(path, malformed, 'utf-8');

		await expect(registerMcp(root, 'replace')).rejects.toThrow(/无法解析，拒绝覆盖/);

		expect(readFileSync(path, 'utf-8')).toBe(malformed);
		expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(false);
	});

	it('现有 JSON 根节点或目标 section 不是对象时拒绝覆盖', async () => {
		const rootWithArray = makeRoot();
		const arrayPath = join(rootWithArray, '.mcp.json');
		writeFileSync(arrayPath, '[1, 2, 3]\n', 'utf-8');
		await expect(registerMcp(rootWithArray, 'replace')).rejects.toThrow(/根节点必须是对象/);
		expect(readFileSync(arrayPath, 'utf-8')).toBe('[1, 2, 3]\n');

		const rootWithInvalidSection = makeRoot();
		const sectionPath = join(rootWithInvalidSection, '.mcp.json');
		const original = '{"sentinel":true,"mcpServers":[]}\n';
		writeFileSync(sectionPath, original, 'utf-8');
		await expect(registerMcp(rootWithInvalidSection, 'replace')).rejects.toThrow(
			/mcpServers 必须是对象/,
		);
		expect(readFileSync(sectionPath, 'utf-8')).toBe(original);
	});

	it('TOML 中注释和多行字符串里的同名文本不会被当成目标 section', async () => {
		const root = makeRoot();
		const path = join(root, '.codex', 'config.toml');
		mkdirSync(join(root, '.codex'));
		const original = `# [mcp_servers.lifeos]
description = """
[mcp_servers.lifeos]
"""

[mcp_servers.other]
command = "other"
`;
		writeFileSync(path, original, 'utf-8');

		await registerMcp(root, 'replace');

		const updated = readFileSync(path, 'utf-8');
		expect(updated).toContain(original.trim());
		expect(updated.match(/^\[mcp_servers\.lifeos\]$/gm)).toHaveLength(2);
		expect(updated).toContain('command = "lifeos"');
	});

	it('重复目标 section 或畸形 table header 时拒绝改写 TOML', async () => {
		const duplicateRoot = makeRoot();
		const duplicatePath = join(duplicateRoot, '.codex', 'config.toml');
		mkdirSync(join(duplicateRoot, '.codex'));
		const duplicate = `[mcp_servers.lifeos]
command = "one"

[mcp_servers.lifeos]
command = "two"
`;
		writeFileSync(duplicatePath, duplicate, 'utf-8');
		await expect(registerMcp(duplicateRoot, 'replace')).rejects.toThrow(/重复定义/);
		expect(readFileSync(duplicatePath, 'utf-8')).toBe(duplicate);

		const malformedRoot = makeRoot();
		const malformedPath = join(malformedRoot, '.codex', 'config.toml');
		mkdirSync(join(malformedRoot, '.codex'));
		const malformed = '[mcp_servers.other\ncommand = "other"\n';
		writeFileSync(malformedPath, malformed, 'utf-8');
		await expect(registerMcp(malformedRoot, 'replace')).rejects.toThrow(/无法安全定位/);
		expect(readFileSync(malformedPath, 'utf-8')).toBe(malformed);
	});
});
