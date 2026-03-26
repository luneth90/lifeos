import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

export interface TempVault {
  root: string;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Creates a temporary Vault directory with standard LifeOS zh directory structure.
 */
export function createTempVault(): TempVault {
  const root = mkdtempSync(join(tmpdir(), 'lifeos-test-'));

  // Create standard directories
  const dirs = [
    '00_草稿', '10_日记', '20_项目', '30_研究', '40_知识',
    '50_成果', '60_计划', '70_资源', '80_复盘', '90_系统',
    '90_系统/记忆', '90_系统/模板', '90_系统/规范',
    '40_知识/笔记', '40_知识/百科',
  ];
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  const dbPath = join(root, '90_系统', '记忆', 'memory.db');

  return {
    root,
    dbPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Creates a test database at the given path with WAL mode.
 */
export function createTestDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Writes a markdown file with frontmatter to the vault.
 */
export function writeTestNote(
  vaultRoot: string,
  relativePath: string,
  frontmatter: Record<string, unknown>,
  body: string = '',
): void {
  const fullPath = join(vaultRoot, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });

  const yamlLines = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (typeof v === 'string') return `${k}: "${v}"`;
      if (Array.isArray(v)) return `${k}: [${v.map(i => `"${i}"`).join(', ')}]`;
      return `${k}: ${v}`;
    })
    .join('\n');

  const content = `---\n${yamlLines}\n---\n${body}`;
  writeFileSync(fullPath, content, 'utf-8');
}
