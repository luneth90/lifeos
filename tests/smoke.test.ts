import { describe, it, expect, afterEach } from 'vitest';
import { createTempVault, createTestDb, writeTestNote } from './setup.js';
import { existsSync } from 'fs';
import { join } from 'path';

describe('Test Infrastructure', () => {
  let vault: ReturnType<typeof createTempVault> | null = null;

  afterEach(() => {
    vault?.cleanup();
    vault = null;
  });

  it('creates temp vault with standard structure', () => {
    vault = createTempVault();
    expect(existsSync(vault.root)).toBe(true);
    expect(existsSync(join(vault.root, '00_草稿'))).toBe(true);
    expect(existsSync(join(vault.root, '90_系统/记忆'))).toBe(true);
  });

  it('creates test database', () => {
    vault = createTempVault();
    const db = createTestDb(vault.dbPath);
    expect(db).toBeDefined();
    // Verify WAL mode
    const result = db.pragma('journal_mode');
    expect(result[0].journal_mode).toBe('wal');
    db.close();
  });

  it('writes test notes', () => {
    vault = createTempVault();
    writeTestNote(vault.root, '20_项目/test-project.md', {
      title: 'Test Project',
      type: 'project',
      status: 'active',
    }, '# Test\nSome content');
    expect(existsSync(join(vault.root, '20_项目/test-project.md'))).toBe(true);
  });

  it('cleans up vault', () => {
    vault = createTempVault();
    const root = vault.root;
    vault.cleanup();
    vault = null;
    expect(existsSync(root)).toBe(false);
  });
});
