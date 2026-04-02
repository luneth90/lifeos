import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTempVault, type TempVault } from '../setup.js';
import { _resetDefaultInstance } from '../../src/config.js';
import {
  contextPolicyPath,
  ensureContextPolicyExists,
  loadContextPolicy,
} from '../../src/utils/context-policy.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

let vault: TempVault;

beforeEach(() => {
  vault = createTempVault();
  _resetDefaultInstance();
});

afterEach(() => {
  vault.cleanup();
  _resetDefaultInstance();
});

// ─── contextPolicyPath ─────────────────────────────────────────────────────────

describe('contextPolicyPath', () => {
  it('returns absolute path inside memory dir ending with ContextPolicy.md', () => {
    const path = contextPolicyPath(vault.root);
    expect(path).toContain('记忆');
    expect(path.startsWith('/')).toBe(true);
    expect(path.endsWith('ContextPolicy.md')).toBe(true);
  });
});

// ─── ensureContextPolicyExists ────────────────────────────────────────────────

describe('ensureContextPolicyExists', () => {
  it('creates ContextPolicy.md with expected sections and frontmatter', () => {
    const path = ensureContextPolicyExists(vault.root);
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith('ContextPolicy.md')).toBe(true);

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('type: context-policy');
    expect(content).toContain('## Layer 0 预算');
    expect(content).toContain('## 活文档体积约束');
  });

  it('does not overwrite existing file', () => {
    const path = ensureContextPolicyExists(vault.root);
    const customContent = '# custom content\n';
    writeFileSync(path, customContent, 'utf-8');

    ensureContextPolicyExists(vault.root);
    const after = readFileSync(path, 'utf-8');
    expect(after).toBe(customContent);
  });
});

// ─── loadContextPolicy ─────────────────────────────────────────────────────────

describe('loadContextPolicy', () => {
  it('returns a policy object with correct types and positive budget defaults', () => {
    const policy = loadContextPolicy(vault.root);
    // Budget fields are positive numbers
    expect(policy.layer0_total).toBeGreaterThan(0);
    expect(policy.userprofile_summary).toBeGreaterThan(0);
    expect(policy.taskboard_focus).toBeGreaterThan(0);
    expect(typeof policy.userprofile_doc_limit).toBe('number');
    expect(typeof policy.taskboard_doc_limit).toBe('number');
  });

  it('parses budget overrides from file content', () => {
    const policyPath = ensureContextPolicyExists(vault.root);
    const content = readFileSync(policyPath, 'utf-8');
    const updated = content.replace('layer0_total: 2000', 'layer0_total: 9999');
    writeFileSync(policyPath, updated, 'utf-8');

    const policy = loadContextPolicy(vault.root);
    expect(policy.layer0_total).toBe(9999);
  });

  it('handles file with empty sections gracefully', () => {
    const policyPath = ensureContextPolicyExists(vault.root);
    writeFileSync(policyPath, '## Layer 0 预算\n\n## 活文档体积约束\n\n', 'utf-8');
    const policy = loadContextPolicy(vault.root);
    // Should fall back to defaults from VaultConfig
    expect(typeof policy.layer0_total).toBe('number');
    expect(typeof policy.userprofile_doc_limit).toBe('number');
  });
});
