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
  it('returns path inside memory dir', () => {
    const path = contextPolicyPath(vault.root);
    expect(path).toContain('ContextPolicy.md');
    expect(path).toContain('Memory');
  });

  it('path is absolute', () => {
    const path = contextPolicyPath(vault.root);
    expect(path.startsWith('/')).toBe(true);
  });

  it('path ends with ContextPolicy.md', () => {
    const path = contextPolicyPath(vault.root);
    expect(path.endsWith('ContextPolicy.md')).toBe(true);
  });
});

// ─── ensureContextPolicyExists ────────────────────────────────────────────────

describe('ensureContextPolicyExists', () => {
  it('creates ContextPolicy.md when missing', () => {
    const path = ensureContextPolicyExists(vault.root);
    expect(existsSync(path)).toBe(true);
  });

  it('returns the path to the file', () => {
    const path = ensureContextPolicyExists(vault.root);
    expect(path.endsWith('ContextPolicy.md')).toBe(true);
  });

  it('does not overwrite existing file', () => {
    const path = ensureContextPolicyExists(vault.root);
    const content = readFileSync(path, 'utf-8');
    const customContent = '# custom content\n';
    writeFileSync(path, customContent, 'utf-8');

    ensureContextPolicyExists(vault.root);
    const after = readFileSync(path, 'utf-8');
    expect(after).toBe(customContent);
  });

  it('created file contains expected sections', () => {
    const path = ensureContextPolicyExists(vault.root);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('## Layer 0 预算');
    expect(content).toContain('## 场景策略');
    expect(content).toContain('## 技能画像策略');
    expect(content).toContain('## 强制引用场景');
    expect(content).toContain('## 活文档体积约束');
  });

  it('created file has frontmatter with type: context-policy', () => {
    const path = ensureContextPolicyExists(vault.root);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('type: context-policy');
  });

  it('idempotent — calling twice is safe', () => {
    ensureContextPolicyExists(vault.root);
    expect(() => ensureContextPolicyExists(vault.root)).not.toThrow();
  });
});

// ─── loadContextPolicy ─────────────────────────────────────────────────────────

describe('loadContextPolicy', () => {
  it('returns a policy object with budget fields', () => {
    const policy = loadContextPolicy(vault.root);
    expect(typeof policy.layer0_total).toBe('number');
    expect(typeof policy.userprofile_summary).toBe('number');
    expect(typeof policy.taskboard_focus).toBe('number');
    expect(typeof policy.userprofile_doc_limit).toBe('number');
    expect(typeof policy.taskboard_doc_limit).toBe('number');
  });

  it('returns scenes as Record<string, string>', () => {
    const policy = loadContextPolicy(vault.root);
    expect(typeof policy.scenes).toBe('object');
    for (const [k, v] of Object.entries(policy.scenes)) {
      expect(typeof k).toBe('string');
      expect(typeof v).toBe('string');
    }
  });

  it('returns citation_required as string[]', () => {
    const policy = loadContextPolicy(vault.root);
    expect(Array.isArray(policy.citation_required)).toBe(true);
  });

  it('returns skill_profiles as object', () => {
    const policy = loadContextPolicy(vault.root);
    expect(typeof policy.skill_profiles).toBe('object');
  });

  it('default budget values are positive', () => {
    const policy = loadContextPolicy(vault.root);
    expect(policy.layer0_total).toBeGreaterThan(0);
    expect(policy.userprofile_summary).toBeGreaterThan(0);
    expect(policy.taskboard_focus).toBeGreaterThan(0);
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
    // Default template includes /today and /review
    expect(policy.scenes['/today']).toBeTruthy();
    expect(policy.scenes['/review']).toBeTruthy();
  });

  it('parses citation_required from default file', () => {
    const policy = loadContextPolicy(vault.root);
    expect(policy.citation_required).toContain('/today');
    expect(policy.citation_required).toContain('/review');
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
    const result = resolveScenePolicy(policy, '/review');
    expect(result.scene).toBe('/review');
  });

  it('review scene has correction in recent_event_bias', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveScenePolicy(policy, '/review');
    // review token triggers correction event bias
    expect(result.recent_event_bias['correction']).toBeGreaterThan(0);
  });
});

// ─── resolveSkillProfilePolicy ────────────────────────────────────────────────

describe('resolveSkillProfilePolicy', () => {
  it('returns defaults for review_strict', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'review_strict');
    expect(result.skill_profile).toBe('review_strict');
    expect(result.load_taskboard).toBe(false);
    expect(result.allow_domain_tag_fallback).toBe(false);
    expect(result.ranking_bias['correction']).toBe(90);
    expect(result.recent_event_bias['correction']).toBe(40);
  });

  it('returns defaults for ask_global', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'ask_global');
    expect(result.skill_profile).toBe('ask_global');
    expect(result.allow_domain_tag_fallback).toBe(true);
    expect(result.ranking_bias).toEqual({});
  });

  it('returns defaults for daily_global', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'daily_global');
    expect(result.ranking_bias['project']).toBe(60);
    expect(result.ranking_bias['review']).toBe(45);
    expect(result.recent_event_bias['decision']).toBe(35);
  });

  it('returns defaults for research_seed', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'research_seed');
    expect(result.allow_domain_tag_fallback).toBe(true);
    expect(result.ranking_bias['draft']).toBe(60);
    expect(result.ranking_bias['research']).toBe(50);
  });

  it('returns defaults for project_seed', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'project_seed');
    expect(result.allow_domain_tag_fallback).toBe(true);
    expect(result.ranking_bias['project']).toBe(60);
    expect(result.recent_event_bias['decision']).toBe(30);
  });

  it('returns defaults for knowledge_strict', () => {
    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'knowledge_strict');
    expect(result.allow_domain_tag_fallback).toBe(false);
    expect(result.ranking_bias['knowledge']).toBe(70);
    expect(result.recent_event_bias['correction']).toBe(35);
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
    // Override review_strict to have domain_fallback=true
    const updated = content.replace(
      'review_strict: load_taskboard=false domain_fallback=false',
      'review_strict: load_taskboard=false domain_fallback=true',
    );
    writeFileSync(policyPath, updated, 'utf-8');

    const policy = loadContextPolicy(vault.root);
    const result = resolveSkillProfilePolicy(policy, 'review_strict');
    expect(result.allow_domain_tag_fallback).toBe(true);
    // Defaults for ranking_bias should still apply
    expect(result.ranking_bias['correction']).toBe(90);
  });
});

// ─── DEFAULT_SKILL_PROFILE_POLICIES ───────────────────────────────────────────

describe('DEFAULT_SKILL_PROFILE_POLICIES', () => {
  it('contains all 6 expected profiles', () => {
    const profiles = [
      'review_strict', 'ask_global', 'daily_global',
      'research_seed', 'project_seed', 'knowledge_strict',
    ];
    for (const p of profiles) {
      expect(DEFAULT_SKILL_PROFILE_POLICIES[p]).toBeDefined();
    }
  });

  it('each profile has required fields', () => {
    for (const [name, profile] of Object.entries(DEFAULT_SKILL_PROFILE_POLICIES)) {
      expect(typeof profile.load_taskboard).toBe('boolean', `${name}.load_taskboard`);
      expect(typeof profile.allow_domain_tag_fallback).toBe('boolean', `${name}.allow_domain_tag_fallback`);
      expect(typeof profile.ranking_bias).toBe('object', `${name}.ranking_bias`);
      expect(typeof profile.recent_event_bias).toBe('object', `${name}.recent_event_bias`);
    }
  });
});
