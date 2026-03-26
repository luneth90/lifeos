import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import {
  VaultConfig,
  resolveConfig,
  getVaultConfig,
  setVaultConfig,
  getOrCreateVaultConfig,
  _resetDefaultInstance,
} from '../src/config.js';

// ─── Helper: minimal temp vault ──────────────────────────────────────────────

interface TempDir {
  root: string;
  cleanup: () => void;
}

function createTempDir(): TempDir {
  const root = mkdtempSync(join(tmpdir(), 'lifeos-cfg-test-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeyaml(root: string, content: string): void {
  writeFileSync(join(root, 'lifeos.yaml'), content, 'utf-8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultConfig — zh preset (default)', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it('loads zh preset when no lifeos.yaml exists', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.rawConfig.language).toBe('zh');
    expect(cfg.rawConfig.directories.drafts).toBe('00_草稿');
  });

  it('vaultRoot returns the absolute path', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.vaultRoot).toBe(tmp.root);
  });

  it.each([
    ['drafts', '00_草稿'],
    ['knowledge', '40_知识'],
    ['system', '90_系统'],
  ] as const)('dirPath(%s) resolves to absolute path', (name, expected) => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.dirPath(name)).toBe(join(tmp.root, expected));
  });

  it('dirPath throws on unknown logical name', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(() => cfg.dirPath('nonexistent')).toThrow(/Unknown directory/);
  });

  it('dirPrefix and subDirPrefix return physical names with trailing slash', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.dirPrefix('drafts')).toBe('00_草稿/');
    expect(cfg.dirPrefix('projects')).toBe('20_项目/');
    expect(cfg.subDirPrefix('knowledge_notes')).toBe('40_知识/笔记/');
    expect(cfg.subDirPrefix('memory')).toBe('90_系统/记忆/');
  });

  it('subDirPath resolves subdirectory to absolute path', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.subDirPath('knowledge_notes')).toBe(join(tmp.root, '40_知识', '笔记'));
    expect(cfg.subDirPath('knowledge_wiki')).toBe(join(tmp.root, '40_知识', '百科'));
    expect(cfg.subDirPath('memory')).toBe(join(tmp.root, '90_系统', '记忆'));
    expect(cfg.subDirPath('templates')).toBe(join(tmp.root, '90_系统', '模板'));
  });

  it('subDirPath throws on unknown subdirectory', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(() => cfg.subDirPath('nonexistent')).toThrow(/Unknown subdirectory/);
  });

  it('memoryDir and dbPath resolve correctly', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.memoryDir()).toBe(join(tmp.root, '90_系统', '记忆'));
    expect(cfg.dbPath()).toBe(join(tmp.root, '90_系统', '记忆', 'memory.db'));
  });

  it('scanPrefixes returns physical dir names with slash', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    const prefixes = cfg.scanPrefixes();
    expect(prefixes).toContain('00_草稿/');
    expect(prefixes).toContain('10_日记/');
    expect(prefixes).toContain('20_项目/');
    expect(prefixes).not.toContain('90_系统/');
  });

  it('excludedPrefixes returns system prefix', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.excludedPrefixes()).toContain('90_系统/');
  });

  it('enhancePriority returns physical prefix → weight map', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    const prio = cfg.enhancePriority();
    expect(prio['20_项目/']).toBe(8);
    expect(prio['40_知识/']).toBe(6);
  });

  it('contextBudgets returns budget object', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    const budgets = cfg.contextBudgets();
    expect(budgets.layer0_total).toBe(1200);
    expect(budgets.userprofile_summary).toBe(400);
  });
});

describe('VaultConfig — lifeos.yaml loading', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it('loads and merges user lifeos.yaml over zh preset', () => {
    tmp = createTempDir();
    writeyaml(tmp.root, `version: '1.0'\nlanguage: zh\ndirectories:\n  drafts: "Draft"\n`);
    const cfg = new VaultConfig(tmp.root);
    // User override applies
    expect(cfg.dirPath('drafts')).toBe(join(tmp.root, 'Draft'));
    // Preset values preserved
    expect(cfg.dirPath('diary')).toBe(join(tmp.root, '10_日记'));
  });

  it('respects language: en in lifeos.yaml', () => {
    tmp = createTempDir();
    writeyaml(tmp.root, `version: '1.0'\nlanguage: en\n`);
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.rawConfig.language).toBe('en');
    // en preset uses English folder names
    expect(cfg.dirPath('drafts')).toBe(join(tmp.root, '00_Drafts'));
  });

  it('custom db_name overrides default', () => {
    tmp = createTempDir();
    writeyaml(tmp.root, `memory:\n  db_name: custom.db\n`);
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.dbPath()).toBe(join(tmp.root, '90_系统', '记忆', 'custom.db'));
  });
});

describe('VaultConfig — config object injection', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it('accepts config object directly (skips file loading)', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root, {
      language: 'zh',
      directories: { drafts: 'MyDrafts' },
    });
    expect(cfg.dirPath('drafts')).toBe(join(tmp.root, 'MyDrafts'));
    // Merged with preset — other dirs still exist
    expect(cfg.dirPath('diary')).toBe(join(tmp.root, '10_日记'));
  });
});

describe('VaultConfig — path inference', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it.each([
    ['40_知识/笔记/Math/LinearAlgebra/ch1.md', 'Math'],
    ['40_知识/百科/CS/Recursion.md', 'CS'],
    ['30_研究/SpatialAI/report.md', 'SpatialAI'],
  ] as const)('inferDomainFromPath(%s) → %s', (path, expected) => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.inferDomainFromPath(path)).toBe(expected);
  });

  it('inferDomainFromPath returns null for non-domain paths', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.inferDomainFromPath('00_草稿/note.md')).toBeNull();
    expect(cfg.inferDomainFromPath('10_日记/2025-01-01.md')).toBeNull();
  });

  it.each([
    ['10_日记/2025-01-01.md', 'daily'],
    ['00_草稿/idea.md', 'draft'],
    ['20_项目/my-project.md', 'project'],
    ['30_研究/topic/report.md', 'research'],
    ['40_知识/笔记/book.md', 'knowledge'],
    ['70_资源/Books/book.pdf', 'resource'],
    ['90_系统/记忆/memory.db', null],
    ['unknown/file.md', null],
  ] as const)('pathToBucket(%s) → %s', (path, expected) => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    expect(cfg.pathToBucket(path)).toBe(expected);
  });
});

describe('resolveConfig convenience function', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it('returns a VaultConfig instance', () => {
    tmp = createTempDir();
    const cfg = resolveConfig(tmp.root);
    expect(cfg).toBeInstanceOf(VaultConfig);
    expect(cfg.vaultRoot).toBe(tmp.root);
  });
});

describe('singleton helpers', () => {
  let tmp: TempDir;

  afterEach(() => {
    tmp?.cleanup();
    _resetDefaultInstance();
  });

  it('getVaultConfig returns null before set', () => {
    expect(getVaultConfig()).toBeNull();
  });

  it('setVaultConfig / getVaultConfig round-trip', () => {
    tmp = createTempDir();
    const cfg = new VaultConfig(tmp.root);
    setVaultConfig(cfg);
    expect(getVaultConfig()).toBe(cfg);
  });

  it('getOrCreateVaultConfig creates and caches', () => {
    tmp = createTempDir();
    const cfg = getOrCreateVaultConfig(tmp.root);
    expect(cfg).toBeInstanceOf(VaultConfig);
    // Second call returns same instance
    expect(getOrCreateVaultConfig()).toBe(cfg);
  });

  it('getOrCreateVaultConfig throws without vault_root when no instance', () => {
    expect(() => getOrCreateVaultConfig()).toThrow(/vault_root/);
  });
});
