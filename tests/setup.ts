import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

export interface TempVault {
  root: string;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Creates a temporary Vault directory with standard LifeOS structure and lifeos.yaml.
 */
export function createTempVault(): TempVault {
  const tempRoot = join(process.cwd(), 'tmp');
  mkdirSync(tempRoot, { recursive: true });
  const root = mkdtempSync(join(tempRoot, 'lifeos-test-'));

  // Create standard directories
  const dirs = [
    '00_草稿', '10_日记', '20_项目', '30_研究', '40_知识',
    '50_成果', '60_计划', '70_资源', '80_复盘', '90_系统',
    '90_系统/记忆', '90_系统/模板', '90_系统/规范', '90_系统/归档/日记',
    '40_知识/笔记', '40_知识/百科',
  ];
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  // Write lifeos.yaml
  const yamlContent = `version: '1.0'
language: zh
directories:
  drafts: "00_草稿"
  diary: "10_日记"
  projects: "20_项目"
  research: "30_研究"
  knowledge: "40_知识"
  outputs: "50_成果"
  plans: "60_计划"
  resources: "70_资源"
  reflection: "80_复盘"
  system: "90_系统"
subdirectories:
  knowledge:
    notes: "笔记"
    wiki: "百科"
  system:
    templates: "模板"
    schema: "规范"
    memory: "记忆"
    archive:
      projects: "归档/项目"
      drafts: "归档/草稿"
      plans: "归档/计划"
      diary: "归档/日记"
memory:
  db_name: memory.db
  scan_prefixes:
    - drafts
    - diary
    - projects
    - research
    - knowledge
    - outputs
    - plans
    - resources
    - reflection
  excluded_prefixes:
    - system
`;
  writeFileSync(join(root, 'lifeos.yaml'), yamlContent, 'utf-8');

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
