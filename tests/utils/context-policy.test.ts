import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTempVault, type TempVault } from '../setup.js';
import { _resetDefaultInstance } from '../../src/config.js';
import {
  contextPolicyPath,
  ensureContextPolicyExists,
  loadContextPolicy,
  resolveScenePolicy,
  resolveSkillProfilePolicy,
  DEFAULT_SKILL_PROFILE_POLICIES,
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
    expect(content).toContain('## 场景策略');
    expect(content).toContain('## 技能画像策略');
    expect(content).toContain('## 强制引用场景');
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
    // Structural types
    expect(typeof policy.scenes).toBe('object');
    expect(Array.isArray(policy.citation_required)).toBe(true);
    expect(typeof policy.skill_profiles).toBe('object');
  });

  it('parses budget overrides from file content', () => {
    const policyPath = ensureContextPolicyExists(vault.root);
    const content = readFileSync(policyPath, 'utf-8');
    const updated = content.replace('layer0_total: 1200', 'layer0_total: 9999');
    writeFileSync(policyPath, updated, 'utf-8');

    const policy = loadContextPolicy(vault.root);
    expect(policy.layer0_total).toBe(9999);
  });

  it('parses scenes from default file', () => {
    const policy = loadContextPolicy(vault.root);
    // Default template includes /today and /revise
    expect(policy.scenes['/today']).toBeTruthy();
    expect(policy.scenes['/revise']).toBeTruthy();
  });

  it('parses citation_required from default file', () => {
    const policy = loadContextPolicy(vault.root);
    expect(policy.citation_required).toContain('/today');
    expect(policy.citation_required).toContain('/revise');
  });

  it('handles file with empty sections gracefully', () => {
    const policyPath = ensureContextPolicyExists(vault.root);
    writeFileSync(policyPath, '## 场景策略\n\n## 技能画像策略\n\n## 强制引用场景\n\n## Layer 0 预算\n\n', 'utf-8');
    const policy = loadContextPolicy(vault.root);
    expect(policy.scenes).toEqual({});
    expect(policy.citation_required).toEqual([]);
    expect(policy.skill_profiles).toEqual({});
  });
});

// ─── resolveScenePolicy ────────────────────────────────────────────────────────

describe('resolveScenePolicy', () => {
  it('returns default policy for unknown scene', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/unknown_scene');
    expect(result.scene).toBe('/unknown_scene');
    expect(result.citation_required).toBe(false);
    expect(result.load_taskboard).toBe(false);
    expect(result.ranking_bias).toEqual({});
    expect(result.recent_event_bias).toEqual({});
  });

  it('detects citation_required from rule text', () => {
    const policy = loadContextPolicy(vault.root);
    // /today has citation_required in default template
    const result = resolveScenePolicy(policy, '/today');
    expect(result.citation_required).toBe(true);
  });

  it('detects taskboard token → load_taskboard: true', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/today');
    expect(result.load_taskboard).toBe(true);
  });

  it('builds ranking_bias from tokens', () => {
    const policy = loadContextPolicy(vault.root);
    // /research has research, draft, resource tokens
    const result = resolveScenePolicy(policy, '/research');
    expect(result.ranking_bias['research']).toBeGreaterThan(0);
    expect(result.ranking_bias['draft']).toBeGreaterThan(0);
    expect(result.ranking_bias['resource']).toBeGreaterThan(0);
  });

  it('builds ranking_bias with knowledge token', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/knowledge');
    expect(result.ranking_bias['knowledge']).toBeGreaterThan(0);
  });

  it('scene value is preserved in result', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/revise');
    expect(result.scene).toBe('/revise');
  });

  it('revise scene has correction in recent_event_bias', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/revise');
    // review token triggers correction event bias
    expect(result.recent_event_bias['correction']).toBeGreaterThan(0);
  });
});

// ─── resolveSkillProfilePolicy ────────────────────────────────────────────────

describe('resolveSkillProfilePolicy', () => {
  it.each([
    ['revise_strict', { load_taskboard: false, allow_domain_tag_fallback: false, ranking_key: 'correction', ranking_val: 90 }],
    ['ask_global', { load_taskboard: false, allow_domain_tag_fallback: true, ranking_key: null, ranking_val: null }],
    ['daily_global', { load_taskboard: false, allow_domain_tag_fallback: false, ranking_key: 'project', ranking_val: 60 }],
    ['research_seed', { load_taskboard: false, allow_domain_tag_fallback: true, ranking_key: 'draft', ranking_val: 60 }],
    ['project_seed', { load_taskboard: false, allow_domain_tag_fallback: true, ranking_key: 'project', ranking_val: 60 }],
    ['knowledge_strict', { load_taskboard: false, allow_domain_tag_fallback: false, ranking_key: 'knowledge', ranking_val: 70 }],
  ] as const)('returns correct defaults for %s', (profile, expected) => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, profile);
    expect(result.skill_profile).toBe(profile);
    expect(result.load_taskboard).toBe(expected.load_taskboard);
    expect(result.allow_domain_tag_fallback).toBe(expected.allow_domain_tag_fallback);
    if (expected.ranking_key) {
      expect(result.ranking_bias[expected.ranking_key]).toBe(expected.ranking_val);
    }
  });

  it('returns safe defaults for unknown profile', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'unknown_profile');
    expect(result.skill_profile).toBe('unknown_profile');
    expect(result.load_taskboard).toBe(false);
    expect(result.allow_domain_tag_fallback).toBe(false);
    expect(result.ranking_bias).toEqual({});
    expect(result.recent_event_bias).toEqual({});
  });

  it('merges loaded overrides over defaults', () => {
    const policyPath = ensureContextPolicyExists(vault.root);
    const content = readFileSync(policyPath, 'utf-8');
    // Override revise_strict to have domain_fallback=true
    const updated = content.replace(
      'revise_strict: load_taskboard=false domain_fallback=false',
      'revise_strict: load_taskboard=false domain_fallback=true',
    );
    writeFileSync(policyPath, updated, 'utf-8');

    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'revise_strict');
    expect(result.allow_domain_tag_fallback).toBe(true);
    // Defaults for ranking_bias should still apply
    expect(result.ranking_bias['correction']).toBe(90);
  });
});

// ─── DEFAULT_SKILL_PROFILE_POLICIES ───────────────────────────────────────────

describe('DEFAULT_SKILL_PROFILE_POLICIES', () => {
  it('contains all 6 profiles with required fields', () => {
    const profiles = [
      'revise_strict', 'ask_global', 'daily_global',
      'research_seed', 'project_seed', 'knowledge_strict',
    ];
    for (const p of profiles) {
      expect(DEFAULT_SKILL_PROFILE_POLICIES[p]).toBeDefined();
      const profile = DEFAULT_SKILL_PROFILE_POLICIES[p];
      expect(typeof profile.load_taskboard).toBe('boolean');
      expect(typeof profile.allow_domain_tag_fallback).toBe('boolean');
      expect(typeof profile.ranking_bias).toBe('object');
      expect(typeof profile.recent_event_bias).toBe('object');
    }
  });
});
