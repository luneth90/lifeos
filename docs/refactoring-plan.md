# LifeOS 重构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除代码重复、类型安全隐患和硬编码路径问题；清理测试套件中的冗余测试（456 → ~365）；删除未使用的生产代码；确保 `lifeos.yaml` 路径间接层在全链路生效。

**Architecture:** 不改变现有 CLI/MCP 分流架构，仅在 `src/cli/` 内部提取共享模块、统一类型定义；在 MCP server 测试中合并冗余用例；修复 skill 和 server 中绕过 `lifeos.yaml` 的硬编码路径。

**Tech Stack:** TypeScript ESM, Node 18+, Vitest, Biome

---

## Context

CLI 脚手架（阶段 1-5）已全部实现并推送到 GitHub（18 commits, 456 tests passing）。项目经历了 Python → TypeScript 迁移和大量重构，积累了两类技术债务：

### A. CLI 代码问题
- init.ts 和 upgrade.ts 有 ~60 行重复的资产安装逻辑
- 4 个文件各自独立创建 `createRequire` 加载 VERSION
- `LifeOSConfig` 缺少 `installed_versions` 字段导致多处 `as` 断言
- 复盘子目录硬编码在 init.ts 而非 config.ts
- `parseArgs` 有两个逻辑完全相同的分支（死代码）
- `mcp-register.ts` 的 JSON.parse 无 try-catch
- `docs/LifeOS.md` 技能数量过时（写 13，实际 9）

### B. lifeos.yaml 路径间接层未全链路生效

`lifeos.yaml` 的核心价值是让目录路径可配置，方便未来升级和用户自定义。评审发现：

- **MCP server 端**：VaultConfig 是唯一路径入口，架构良好（95% 一致）
- **唯一的 server 端违规**：`src/services/layer0.ts:72` — 当 VaultConfig 单例为 null 时 fallback 到硬编码 `'90_系统', '记忆'`
- **Skills 端**：9 个技能中 8 个正确使用逻辑引用（`{项目目录}`、`{知识目录}` 等）
- **唯一的 skill 端违规**：`assets/skills/brainstorm/SKILL.zh.md` — **23 处硬编码物理路径**（英文版已正确使用逻辑引用）
- **CLAUDE.md**：两个语言版本均正确使用逻辑引用

### C. 测试套件膨胀（456 tests → ~365 target）

**测试评审发现：**

| 问题类别 | 涉及测试数 | 说明 |
|----------|-----------|------|
| 静态常量断言 | ~15 | 测试硬编码值不可能变化 |
| 琐碎访问器/类型检查 | ~25 | 测 `typeof`、key 存在性、属性读取 |
| 冗余过滤器变体 | ~15 | 同一逻辑用不同字段名反复测试 |
| 可合并的边界用例 | ~20 | 同一行为的多个细粒度测试 |
| 基础设施自测 | 4 | smoke.test.ts 测试 test helper 本身 |
| 死代码测试 | 8 | `dedupePreserveOrder` 和 `coerceDatetime` 生产代码中未使用 |

**关键发现：**
- `src/utils/shared.ts` 中 `dedupePreserveOrder` 和 `coerceDatetime` 在生产代码中**零引用**——应连同测试一起删除
- `countRows()` 在生产代码中使用但**零测试覆盖**

**各文件削减目标：**

| 文件 | 当前 | 目标 | 削减 | 主要操作 |
|------|------|------|------|----------|
| shared.test.ts | 90 | ~70 | -20 | 删常量断言、合并 loadsJsonList/coerceNow 重复 |
| startup.test.ts | 42 | ~33 | -9 | 合并 trimToBudget 琐碎用例、needsMaintenance 参数化 |
| context-policy.test.ts | 35 | ~20 | -15 | 合并类型断言、参数化 skill profile 测试 |
| retrieval.test.ts | 35 | ~30 | -5 | 合并 exact filter (type/status/domain) 为参数化 |
| vault-indexer.test.ts | 32 | ~26 | -6 | 合并 frontmatter 字段解析测试 |
| config.test.ts | 29 | ~17 | -12 | 参数化访问器测试 (dirPath/subDirPath/prefix) |
| capture.test.ts | 25 | ~21 | -4 | 合并去重测试 |
| core.test.ts | 20 | ~16 | -4 | 合并 importance 验证 (3→1) |
| scan-state.test.ts | 19 | ~15 | -4 | 删除类型强转测试 |
| schema.test.ts | 18 | ~16 | -2 | 合并幂等性测试 |
| active-docs.test.ts | 18 | ~16 | -2 | 合并 key 存在性检查 |
| skill-context.test.ts | 16 | ~12 | -4 | 合并 config 属性测试 |
| smoke.test.ts | 4 | **0** | -4 | **删除整个文件** |
| segmenter.test.ts | 16 | 16 | 0 | 保持不变 |
| derived-memory.test.ts | 9 | 9 | 0 | 保持不变 |
| CLI tests (5 files) | 48 | 53 | +5 | doctor 补充测试 |

---

## 文件结构

```
新增：
  src/cli/utils/version.ts                VERSION 共享模块
  src/cli/utils/install-assets.ts         资产安装共享逻辑
  tests/cli/utils/install-assets.test.ts  安装逻辑单元测试

修改（路径间接层修复）：
  assets/skills/brainstorm/SKILL.zh.md  23 处硬编码 → 逻辑引用
  src/services/layer0.ts               消除 '90_系统/记忆' fallback

修改（CLI 重构）：
  src/config.ts                      添加 installed_versions 类型 + 复盘子目录常量
  src/cli/index.ts                   改用 version.ts
  src/cli/commands/init.ts           提取资产安装逻辑 + 移除硬编码
  src/cli/commands/upgrade.ts        提取资产安装逻辑 + 移除类型断言
  src/cli/commands/doctor.ts         动态模板列表 + 移除不安全断言
  src/cli/utils/ui.ts                简化 parseArgs
  src/cli/utils/mcp-register.ts      JSON.parse 错误处理
  tests/cli/doctor.test.ts           补充测试用例
  docs/LifeOS.md                     更新技能数量和升级策略描述

修改（测试清理）：
  src/utils/shared.ts                删除 dedupePreserveOrder + coerceDatetime
  tests/utils/shared.test.ts         删常量断言、死代码测试、合并重复 (-20)
  tests/services/startup.test.ts     合并琐碎用例 (-9)
  tests/utils/context-policy.test.ts 合并类型断言、参数化 profile (-15)
  tests/services/retrieval.test.ts   参数化 exact filter (-5)
  tests/utils/vault-indexer.test.ts  合并 frontmatter 解析 (-6)
  tests/config.test.ts               参数化访问器 (-12)
  tests/services/capture.test.ts     合并去重测试 (-4)
  tests/core.test.ts                 合并 importance 验证 (-4)
  tests/utils/scan-state.test.ts     删类型强转测试 (-4)
  tests/db/schema.test.ts            合并幂等性 (-2)
  tests/active-docs/active-docs.test.ts  合并 key 检查 (-2)
  tests/skill-context/skill-context.test.ts  合并 config 属性 (-4)

删除：
  tests/smoke.test.ts                删除整个文件 (-4)
```

---

## Task 1: 统一 VERSION 加载 + 补全 LifeOSConfig 类型

**Issues:** VERSION 4 处重复加载；`installed_versions` 字段缺失导致多处 `as` 类型断言

**Files:**
- Create: `src/cli/utils/version.ts`
- Modify: `src/config.ts` (lines 48-55)
- Modify: `src/cli/index.ts` (lines 1-4)
- Modify: `src/cli/commands/init.ts` (lines 2, 13-14)
- Modify: `src/cli/commands/upgrade.ts` (lines 2, 10-11, 32-34)
- Modify: `src/cli/commands/doctor.ts` (lines 2, 8-9, 122-123)

- [ ] **Step 1: 创建 `src/cli/utils/version.ts`**

```typescript
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const VERSION: string = require('../../../package.json').version;
```

- [ ] **Step 2: 在 `src/config.ts` LifeOSConfig 接口添加 `installed_versions`**

在 `interface LifeOSConfig` (line 48-55) 添加字段：

```typescript
interface LifeOSConfig {
	version?: string;
	language: string;
	directories: DirectoriesConfig;
	subdirectories: SubdirectoriesConfig;
	memory: MemoryConfig;
	installed_versions?: { cli?: string; assets?: string };
	[key: string]: unknown;
}
```

- [ ] **Step 3: 更新 `src/cli/index.ts`**

替换 lines 1-4：
```typescript
import { VERSION } from './utils/version.js';
```

- [ ] **Step 4: 更新 `src/cli/commands/init.ts`**

移除 `createRequire` import (line 2) 和 lines 13-14，替换为：
```typescript
import { VERSION } from '../utils/version.js';
```

- [ ] **Step 5: 更新 `src/cli/commands/upgrade.ts`**

移除 `createRequire` import (line 2) 和 lines 10-11，替换为：
```typescript
import { VERSION } from '../utils/version.js';
```

移除 line 32-34 的类型断言，简化为：
```typescript
const config = parseYaml(yamlContent) as LifeOSConfig;
```

- [ ] **Step 6: 更新 `src/cli/commands/doctor.ts`**

移除 `createRequire` import (line 2) 和 lines 8-9，替换为：
```typescript
import { VERSION } from '../utils/version.js';
```

替换 line 122-123 的不安全断言：
```typescript
const installedVersion = (config as LifeOSConfig)?.installed_versions?.assets;
```

需要添加 `LifeOSConfig` import：
```typescript
import type { LifeOSConfig } from '../../config.js';
```

- [ ] **Step 7: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 8: 提交**

```
refactor(cli): unify VERSION loading and add installed_versions to LifeOSConfig type
```

---

## Task 2: 提取共享资产安装逻辑

**Issue:** init.ts 和 upgrade.ts 有 ~60 行重复的模板/规范/技能复制代码

**Files:**
- Create: `src/cli/utils/install-assets.ts`
- Create: `tests/cli/utils/install-assets.test.ts`
- Modify: `src/cli/commands/init.ts` (lines 98-130)
- Modify: `src/cli/commands/upgrade.ts` (lines 49-111)

- [ ] **Step 1: 创建 `src/cli/utils/install-assets.ts`**

```typescript
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LifeOSConfig } from '../../config.js';
import { assetsDir, copyDir, ensureDir } from './assets.js';
import { resolveSkillFiles } from './lang.js';
import { log, yellow } from './ui.js';

export interface InstallResult {
	updated: string[];
	skipped: string[];
	unchanged: string[];
}

const SKIP_SKILLS = new Set(['lifeos-init']);

/**
 * Copy language-specific templates from assets to vault.
 * Always overwrites existing files (Tier 1).
 */
export function installTemplates(
	targetPath: string,
	config: LifeOSConfig,
): string[] {
	const lang = config.language === 'en' ? 'en' : 'zh';
	const src = join(assetsDir(), 'templates', lang);
	const dest = join(targetPath, config.directories.system, config.subdirectories.templates);
	if (!existsSync(src)) return [];

	ensureDir(dest);
	copyDir(src, dest);

	return readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => `${config.directories.system}/${config.subdirectories.templates}/${f}`);
}

/**
 * Copy schema files from assets to vault.
 * Always overwrites existing files (Tier 1).
 */
export function installSchema(
	targetPath: string,
	config: LifeOSConfig,
): string[] {
	const src = join(assetsDir(), 'schema');
	const dest = join(targetPath, config.directories.system, config.subdirectories.schema);
	if (!existsSync(src)) return [];

	ensureDir(dest);
	copyDir(src, dest);

	return readdirSync(src)
		.filter((f) => !f.startsWith('.'))
		.map((f) => `${config.directories.system}/${config.subdirectories.schema}/${f}`);
}

/**
 * Copy skills from assets to vault with language resolution.
 *
 * @param mode
 *   - 'overwrite': Always copy (for init)
 *   - 'smart-merge': Skip user-modified files, copy new/unchanged (for upgrade)
 */
export function installSkills(
	targetPath: string,
	lang: 'zh' | 'en',
	mode: 'overwrite' | 'smart-merge',
): InstallResult {
	const result: InstallResult = { updated: [], skipped: [], unchanged: [] };
	const skillsSrc = join(assetsDir(), 'skills');
	const skillsDest = join(targetPath, '.agents', 'skills');
	if (!existsSync(skillsSrc)) return result;

	for (const skillName of readdirSync(skillsSrc)) {
		if (SKIP_SKILLS.has(skillName)) continue;

		const skillSrcDir = join(skillsSrc, skillName);
		const fileMap = resolveSkillFiles(skillSrcDir, lang);

		for (const [destRelPath, srcPath] of fileMap) {
			const destPath = join(skillsDest, skillName, destRelPath);
			const displayPath = `.agents/skills/${skillName}/${destRelPath}`;

			if (mode === 'overwrite') {
				ensureDir(join(destPath, '..'));
				copyFileSync(srcPath, destPath);
				result.updated.push(displayPath);
			} else {
				// smart-merge
				if (!existsSync(destPath)) {
					ensureDir(join(destPath, '..'));
					copyFileSync(srcPath, destPath);
					result.updated.push(displayPath);
				} else {
					const existing = readFileSync(destPath, 'utf-8');
					const incoming = readFileSync(srcPath, 'utf-8');
					if (existing === incoming) {
						result.unchanged.push(displayPath);
					} else {
						result.skipped.push(displayPath);
						log(yellow('⚠'), `Skipping modified: ${displayPath}`);
					}
				}
			}
		}
	}

	return result;
}
```

- [ ] **Step 2: 重构 `src/cli/commands/init.ts`**

替换 lines 98-130（模板/规范/技能复制）为：

```typescript
import { installTemplates, installSchema, installSkills } from '../utils/install-assets.js';

// 5. Copy templates
installTemplates(targetPath, preset);

// 6. Copy schema
installSchema(targetPath, preset);

// 7. Copy skills
installSkills(targetPath, lang, 'overwrite');
```

同时移除不再需要的 imports：`readdirSync`（如果无其他用途）、`copyFileSync`（如果无其他用途，但 CLAUDE.md 复制仍需要）。

- [ ] **Step 3: 重构 `src/cli/commands/upgrade.ts`**

替换 lines 49-111（三档复制）为：

```typescript
import { installTemplates, installSchema, installSkills } from '../utils/install-assets.js';

// 4. Tier 1 — Templates + Schema
result.updated.push(...installTemplates(targetPath, config));
result.updated.push(...installSchema(targetPath, config));

// 5. Tier 2 — Skills
const skillResult = installSkills(targetPath, lang, 'smart-merge');
result.updated.push(...skillResult.updated);
result.skipped.push(...skillResult.skipped);
result.unchanged.push(...skillResult.unchanged);
```

同时移除不再需要的 imports：`copyFileSync`, `readFileSync`（检查是否还有其他用途——`readFileSync` 仍用于读取 YAML）, `readdirSync`, `resolveSkillFiles`, `assetsDir`, `ensureDir`。

- [ ] **Step 4: 写单元测试 `tests/cli/utils/install-assets.test.ts`**

```typescript
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initCommand from '../../../src/cli/commands/init.js';
import { installTemplates, installSchema, installSkills } from '../../../src/cli/utils/install-assets.js';
import { ZH_PRESET } from '../../../src/config.js';

function makeTmpDir() {
	const dir = mkdtempSync(join(tmpdir(), 'lifeos-install-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('installTemplates', () => {
	it('copies zh templates and returns paths', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			// Create target directories
			const sysDir = join(dir, ZH_PRESET.directories.system, ZH_PRESET.subdirectories.templates);
			const paths = installTemplates(dir, ZH_PRESET);
			expect(paths.length).toBeGreaterThan(0);
			expect(existsSync(join(dir, ZH_PRESET.directories.system, ZH_PRESET.subdirectories.templates, 'Daily_Template.md'))).toBe(true);
		} finally {
			cleanup();
		}
	});
});

describe('installSkills', () => {
	it('overwrite mode copies all skills', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			const result = installSkills(dir, 'zh', 'overwrite');
			expect(result.updated.length).toBeGreaterThan(0);
			expect(result.skipped).toHaveLength(0);
			expect(existsSync(join(dir, '.agents', 'skills', 'knowledge', 'SKILL.md'))).toBe(true);
			// lifeos-init should be skipped
			expect(existsSync(join(dir, '.agents', 'skills', 'lifeos-init'))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('smart-merge mode skips user-modified files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			// First install
			installSkills(dir, 'zh', 'overwrite');
			// Modify a skill file
			const skillPath = join(dir, '.agents', 'skills', 'knowledge', 'SKILL.md');
			writeFileSync(skillPath, 'user customized content');
			// Upgrade
			const result = installSkills(dir, 'zh', 'smart-merge');
			expect(result.skipped).toContain('.agents/skills/knowledge/SKILL.md');
			// File should still have user content
			expect(readFileSync(skillPath, 'utf-8')).toBe('user customized content');
		} finally {
			cleanup();
		}
	});

	it('smart-merge mode reports unchanged files', () => {
		const { dir, cleanup } = makeTmpDir();
		try {
			installSkills(dir, 'zh', 'overwrite');
			const result = installSkills(dir, 'zh', 'smart-merge');
			expect(result.unchanged.length).toBeGreaterThan(0);
			expect(result.updated).toHaveLength(0);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 5: 运行测试验证**

Run: `npm run typecheck && npm test`
All existing init/upgrade tests + new install-assets tests 应全部通过。

- [ ] **Step 6: 提交**

```
refactor(cli): extract shared asset installation logic into install-assets.ts
```

---

## Task 3: 复盘子目录移入 config.ts

**Issue:** 复盘子目录硬编码在 init.ts，变更需同步 3 处

**Files:**
- Modify: `src/config.ts` (add constants near line 171)
- Modify: `src/cli/commands/init.ts` (lines 16-19)

- [ ] **Step 1: 在 `src/config.ts` 添加复盘子目录常量**

在 `SUBDIR_PARENTS` 之后（~line 171）添加：

```typescript
/** Reflection subdirectory names by language */
const ZH_REFLECTION_SUBS: readonly string[] = [
	'周复盘', '月复盘', '季度复盘', '年度复盘', '项目复盘', '路径校准',
];
const EN_REFLECTION_SUBS: readonly string[] = [
	'Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Projects', 'Alignment',
];
```

更新 export 行（~line 439）：
```typescript
export { ZH_PRESET, EN_PRESET, SUBDIR_PARENTS, ZH_REFLECTION_SUBS, EN_REFLECTION_SUBS };
```

- [ ] **Step 2: 更新 `src/cli/commands/init.ts`**

移除 lines 16-19 的本地常量，改为 import：
```typescript
import {
	ZH_PRESET, EN_PRESET, SUBDIR_PARENTS,
	ZH_REFLECTION_SUBS, EN_REFLECTION_SUBS,
} from '../../config.js';
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 4: 提交**

```
refactor: move reflection subdirectory names to config.ts
```

---

## Task 4: parseArgs 简化 + MCP 注册错误处理

**Issues:** parseArgs 死代码分支；mergeJsonConfig 无 JSON.parse 错误处理

**Files:**
- Modify: `src/cli/utils/ui.ts` (lines 36-51)
- Modify: `src/cli/utils/mcp-register.ts` (line 57)

- [ ] **Step 1: 简化 `src/cli/utils/ui.ts` parseArgs**

替换 lines 36-48（三个分支）为两个分支：

```typescript
if (next !== undefined && !next.startsWith('-')) {
	if (spec) {
		// Known flag — consume next arg as value
		result.flags[name] = next;
		i++;
	} else {
		// Unknown flag — treat as boolean
		result.flags[name] = true;
	}
} else {
	result.flags[name] = true;
}
```

- [ ] **Step 2: 给 `mergeJsonConfig` 添加 try-catch**

在 `src/cli/utils/mcp-register.ts` line 57，替换：
```typescript
config = JSON.parse(readFileSync(filePath, 'utf-8'));
```

为：
```typescript
try {
	config = JSON.parse(readFileSync(filePath, 'utf-8'));
} catch {
	log(yellow('⚠'), `Malformed JSON in ${filePath}, creating fresh config`);
	config = {};
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 4: 提交**

```
refactor(cli): simplify parseArgs dead branches and add JSON error handling
```

---

## Task 5: doctor 健壮性和测试覆盖

**Issues:** 模板列表硬编码；仅 2 个测试用例覆盖 8+ 检查项

**Files:**
- Modify: `src/cli/commands/doctor.ts` (lines 11-20, 82-94)
- Modify: `tests/cli/doctor.test.ts`

- [ ] **Step 1: 动态获取模板列表**

在 `src/cli/commands/doctor.ts` 中：

移除 lines 11-20 的 `EXPECTED_TEMPLATES` 常量。

添加 import：
```typescript
import { readdirSync } from 'node:fs';
import { assetsDir } from '../utils/assets.js';
```

在 lang 确定后（line 58 之后），动态获取模板列表：
```typescript
const templatesSrc = join(assetsDir(), 'templates', lang);
const expectedTemplates = existsSync(templatesSrc)
	? readdirSync(templatesSrc).filter((f) => f.endsWith('.md'))
	: [];
```

替换 line 88 的 `EXPECTED_TEMPLATES` 引用为 `expectedTemplates`。

- [ ] **Step 2: 补充 doctor 测试**

在 `tests/cli/doctor.test.ts` 添加：

```typescript
test('invalid YAML reports failure', async () => {
	const { dir, cleanup } = makeTmpDir();
	try {
		await initCommand([dir, '--lang', 'zh', '--no-mcp']);
		writeFileSync(join(dir, 'lifeos.yaml'), '{{invalid yaml');
		const result = await doctorCommand([dir]);
		expect(result.passed).toBe(false);
		expect(result.checks.some((c) => c.name === 'lifeos.yaml' && c.status === 'fail')).toBe(true);
	} finally {
		cleanup();
	}
});

test('version mismatch reports warning', async () => {
	const { dir, cleanup } = makeTmpDir();
	try {
		await initCommand([dir, '--lang', 'zh', '--no-mcp']);
		// Patch version
		const yamlPath = join(dir, 'lifeos.yaml');
		const content = readFileSync(yamlPath, 'utf-8');
		writeFileSync(yamlPath, content.replace(/assets: ".+?"/, 'assets: "0.0.1"'));
		const result = await doctorCommand([dir]);
		expect(result.checks.some((c) => c.name === 'assets version' && c.status === 'warn')).toBe(true);
	} finally {
		cleanup();
	}
});

test('missing template reports warning', async () => {
	const { dir, cleanup } = makeTmpDir();
	try {
		await initCommand([dir, '--lang', 'zh', '--no-mcp']);
		unlinkSync(join(dir, '90_系统', '模板', 'Daily_Template.md'));
		const result = await doctorCommand([dir]);
		expect(result.checks.some((c) => c.name.includes('Daily_Template') && c.status === 'warn')).toBe(true);
	} finally {
		cleanup();
	}
});

test('missing skills directory reports warning', async () => {
	const { dir, cleanup } = makeTmpDir();
	try {
		await initCommand([dir, '--lang', 'zh', '--no-mcp']);
		rmSync(join(dir, '.agents'), { recursive: true });
		const result = await doctorCommand([dir]);
		expect(result.checks.some((c) => c.name === '.agents/skills/' && c.status === 'warn')).toBe(true);
	} finally {
		cleanup();
	}
});

test('Node.js version check always present', async () => {
	const { dir, cleanup } = makeTmpDir();
	try {
		await initCommand([dir, '--lang', 'zh', '--no-mcp']);
		const result = await doctorCommand([dir]);
		expect(result.checks.some((c) => c.name === 'Node.js >= 18')).toBe(true);
	} finally {
		cleanup();
	}
});
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 4: 提交**

```
refactor(cli): dynamic template list in doctor + expand test coverage
```

---

## Task 6: 更新 docs/LifeOS.md

**Issue:** 技能数量、升级策略描述与实现不符

**Files:**
- Modify: `docs/LifeOS.md`

- [ ] **Step 1: 修正技能数量**

Line 116: `13 个技能` → `9 个技能`
Line 120: `13 个技能` → `9 个技能`

- [ ] **Step 2: 修正资产文件引用**

Line 68: `claude.md` → `claude.zh.md` + `claude.en.md`

- [ ] **Step 3: 修正升级策略表**

Lines 84-88 升级策略表与实际实现不符。替换为：

```markdown
| 策略 | 适用文件 | 行为 |
|---|---|---|
| **自动覆盖** | 模板 `Templates/`、规范 `Schema/` | 始终更新到最新版 |
| **智能合并** | 技能文件 `.agents/skills/` | 未修改→更新，已修改→跳过并警告 |
| **不触碰** | `CLAUDE.md`、`lifeos.yaml` | 保留用户自定义 |
```

- [ ] **Step 4: 提交**

```
docs: fix outdated skill counts and upgrade strategy in LifeOS.md
```

---

## Task 7: brainstorm 中文版路径间接化

**Issue:** `assets/skills/brainstorm/SKILL.zh.md` 有 23 处硬编码物理路径（`00_草稿/`、`20_项目/`、`90_系统/模板/` 等），绕过了 `lifeos.yaml` 的路径间接层。英文版已正确使用逻辑引用。如果用户在 `lifeos.yaml` 中自定义了目录名，brainstorm 中文版会失效。

**Files:**
- Modify: `assets/skills/brainstorm/SKILL.zh.md`

- [ ] **Step 1: 添加路径配置块**

参照 `knowledge/SKILL.zh.md` 和 `project/SKILL.zh.md` 的模式，在文件头部（必读资源之后）添加路径配置说明：

```markdown
> [!config] 路径配置
> 本技能中的路径引用使用逻辑名（如 `{项目目录}`）。
> Agent 从 `lifeos.yaml` 解析实际路径后注入上下文。
> 后续所有路径操作使用配置值，不使用硬编码路径。
```

- [ ] **Step 2: 替换所有硬编码路径**

对照替换表，将 23 处硬编码改为逻辑引用：

| 硬编码 | 逻辑引用 |
|--------|----------|
| `00_草稿/` | `{草稿目录}/` |
| `20_项目/` | `{项目目录}/` |
| `30_研究/` | `{研究目录}/` |
| `40_知识/` | `{知识目录}/` |
| `40_知识/百科/` | `{知识目录}/{百科子目录}/` |
| `50_成果/` | `{成果目录}/` |
| `60_计划/` | `{计划目录}/` |
| `70_资源/` | `{资源目录}/` |
| `90_系统/模板/` | `{系统目录}/{模板子目录}/` |
| `90_系统/规范/` | `{系统目录}/{规范子目录}/` |

逐行替换（共 23 处，见 Context B 部分的完整行号列表）。

- [ ] **Step 3: 与英文版交叉验证**

逐段对比 `SKILL.en.md`，确保中英文版使用相同的逻辑引用模式，仅语言不同。

- [ ] **Step 4: 提交**

```
fix(skill): replace 23 hardcoded paths with logical references in brainstorm zh
```

---

## Task 8: layer0.ts 消除硬编码 fallback

**Issue:** `src/services/layer0.ts:72` 在 VaultConfig 单例为 null 时 fallback 到硬编码 `join(vaultRoot, '90_系统', '记忆')`，绕过了 `lifeos.yaml` 路径间接层。

**Files:**
- Modify: `src/services/layer0.ts` (line 72)

- [ ] **Step 1: 使用 resolveConfig 替代硬编码 fallback**

替换 line 71-72：

```typescript
// Before:
const vc = getVaultConfig();
const memoryDir = vc ? vc.memoryDir() : join(vaultRoot, '90_系统', '记忆');

// After:
import { getVaultConfig, resolveConfig } from '../config.js';
// ...
const vc = getVaultConfig() ?? resolveConfig(vaultRoot);
const memoryDir = vc.memoryDir();
```

`resolveConfig(vaultRoot)` 会读取 `lifeos.yaml`（如果存在），否则使用语言预设——始终通过配置解析路径，不硬编码。

同时检查其他文件是否有类似 fallback 模式（`active-docs/index.ts` 的 `getMemoryDir` 已正确使用 `resolveConfig`）。

- [ ] **Step 2: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 3: 提交**

```
fix: remove hardcoded path fallback in layer0.ts, use resolveConfig instead
```

---

## Task 9: 删除死代码 + smoke.test.ts

**Issue:** `dedupePreserveOrder` 和 `coerceDatetime` 在生产代码中零引用；`smoke.test.ts` 测试 test helper 本身（已被其它测试隐式覆盖）

**Files:**
- Modify: `src/utils/shared.ts` — 删除 `dedupePreserveOrder` 和 `coerceDatetime` 函数
- Modify: `tests/utils/shared.test.ts` — 删除对应的 describe 块（~8 tests）
- Delete: `tests/smoke.test.ts` （4 tests）

- [ ] **Step 1: 确认死代码**

Run: `grep -r 'dedupePreserveOrder' src/` 和 `grep -r 'coerceDatetime' src/`
Expected: 仅在 `shared.ts` 定义处出现，无外部调用。

- [ ] **Step 2: 从 `src/utils/shared.ts` 删除两个函数**

删除 `dedupePreserveOrder` 函数及其导出。
删除 `coerceDatetime` 函数及其导出。

- [ ] **Step 3: 从 `tests/utils/shared.test.ts` 删除对应测试**

删除 `describe('dedupePreserveOrder', ...)` 块（4 tests）。
删除 `describe('coerceDatetime', ...)` 块（4 tests）。
删除 import 中的 `dedupePreserveOrder`, `coerceDatetime`。

- [ ] **Step 4: 删除 `tests/smoke.test.ts`**

整个文件删除（4 tests）。test helper 的正确性已被使用它们的 15+ 个测试文件隐式验证。

- [ ] **Step 5: 运行测试验证**

Run: `npm run typecheck && npm test`
Expected: 456 - 12 = 444 tests passing。

- [ ] **Step 6: 提交**

```
chore: remove unused dedupePreserveOrder/coerceDatetime and smoke tests
```

---

## Task 10: 合并 shared.test.ts 冗余测试（90 → ~70）

**Issue:** 8 个静态常量断言、loadsJsonList 空值重复、coerceNow 重复

**File:** `tests/utils/shared.test.ts`

- [ ] **Step 1: 删除或合并常量断言（8 → 2）**

删除以下 describe 块中的逐项断言，仅保留 2 个关键常量集合测试：
- 保留 `ALLOWED_COUNT_TABLES` 测试（安全关键，防止 SQL 注入）
- 保留 `BUCKET_TYPE_MAP` 测试（影响索引逻辑）
- 删除 `SESSION_ID_ENV_KEYS`、`KEY_ENTRY_TYPES`、`VALID_ENTRY_TYPES`、`ACTIVE_DOC_TARGETS`、`RULE_KEY_PREFIXES`、数值常量 的独立断言

- [ ] **Step 2: 合并 loadsJsonList 空值测试（3 → 1）**

将 null / undefined / empty string 三个测试合并为一个参数化测试：
```typescript
it.each([null, undefined, ''])('returns empty array for %s', (input) => {
	expect(loadsJsonList(input)).toEqual([]);
});
```

- [ ] **Step 3: 合并 coerceNow 重复（2 → 1）**

删除 "returns a Date when called with no arguments"（仅检查 instanceof），保留 "returns current time (approximately)" 时间窗口检查。

- [ ] **Step 4: 合并 containsCjk false 用例（2 → 1）**

将 "empty string" 和 "numbers/punctuation" 合并为 "returns false for non-CJK content"。

- [ ] **Step 5: 删除 inferTemporaryPreference 冗余（1）**

删除 "neutral text returns temporary: false"——被关键词测试隐式覆盖。

- [ ] **Step 6: 运行测试验证**

Run: `npm test`

- [ ] **Step 7: 提交**

```
test: consolidate shared.test.ts redundant assertions (90 → ~70)
```

---

## Task 11: 合并 MCP server 测试冗余（剩余文件）

**Issue:** config/context-policy/startup/retrieval 等文件中存在冗余访问器测试和重复过滤器变体

**Files:** 见文件结构中「修改（测试清理）」列表

- [ ] **Step 1: config.test.ts（29 → ~17）**

参数化 VaultConfig 访问器：
- `dirPath` 3 个字段测试 → 1 个 `it.each` 测试
- `dirPrefix` + `subDirPrefix` → 1 个参数化测试
- `memoryDir` + `dbPath` → 合并为 1 个
- `inferDomainFromPath` 3 个路径变体 → 1 个 `it.each`
- `pathToBucket` mapping + null → 合并为 1 个 `it.each`
- 保留：YAML 加载、config 注入、singleton、error 用例

- [ ] **Step 2: context-policy.test.ts（35 → ~20）**

- 路径 helper 3 个测试 → 1 个
- `ensureContextPolicyExists` 创建 + 结构 + frontmatter → 合并为 1 个
- `loadContextPolicy` 类型断言 4 个 → 1 个
- `resolveSkillProfilePolicy` 6 个 profile → 1 个 `it.each`
- `DEFAULT_SKILL_PROFILE_POLICIES` 2 个 → 1 个
- 保留：override 合并、token 检测、scene 解析、边界用例

- [ ] **Step 3: startup.test.ts（42 → ~33）**

- `trimToBudget` 3 个琐碎 (within budget / zero / blank) → 1 个 `it.each`
- `needsMaintenance` 3 个 false 用例 → 1 个参数化
- `pruneSessionLog` preserve 2 个用例 → 1 个参数化
- `queueFileForEnhance` upgrade/no-downgrade → 合并为 1 个
- 保留：runStartup 集成测试 5 个、processEnhanceQueue 3 个

- [ ] **Step 4: retrieval.test.ts（35 → ~30）**

- `queryVaultIndex` exact filter (type/status/domain) 3 个 → 1 个 `it.each`
- `queryRecentEvents` filter (entry_type/scope) 2 个 → 1 个 `it.each`
- 保留：中文分词搜索、字段结构验证、limit、路径/标题/前缀查询

- [ ] **Step 5: 其余文件（小幅合并）**

- vault-indexer.test.ts：frontmatter 字段 6 个 → 1 个参数化 (-5)
- capture.test.ts：去重 3 个 → 1 个 (-2)
- core.test.ts：importance 验证 3 个 → 1 个 (-2)、query 空值 3 个 → 1 个 (-2)
- scan-state.test.ts：删除类型强转 3 个、null hash 1 个 (-4)
- schema.test.ts：幂等性 2 个 → 1 个 (-1)
- active-docs.test.ts：key 存在性 2 个 → 合入内容测试 (-2)
- skill-context.test.ts：config 属性 4 个 → 1 个 (-3)

- [ ] **Step 6: 运行完整测试套件**

Run: `npm run typecheck && npm test`
Expected: ~365 tests passing。

- [ ] **Step 7: 提交**

```
test: consolidate redundant MCP server tests (~91 tests removed)
```

---

## Task 12: subdirectories 嵌套化

**Issue:** 当前 `lifeos.yaml` 中子目录是扁平列表，用户无法看出 `knowledge_notes` 属于 `knowledge`。父子关系藏在 TypeScript 代码的 `SUBDIR_PARENTS` 常量里，用户不可见、不可改。

**Files:**
- Modify: `src/config.ts` — 类型定义、预设、VaultConfig 解析逻辑
- Modify: `src/cli/commands/init.ts` — 目录创建逻辑
- Modify: `src/cli/commands/upgrade.ts` — 兼容迁移逻辑
- Modify: `src/cli/commands/doctor.ts` — 子目录检查
- Modify: `tests/config.test.ts` — 更新访问器测试
- Modify: `tests/cli/init.test.ts` — 更新结构断言

- [ ] **Step 1: 设计新的 YAML 结构**

```yaml
# Before (flat):
subdirectories:
  knowledge_notes: "笔记"
  knowledge_wiki: "百科"
  templates: "模板"
  schema: "规范"
  memory: "记忆"
  archive_projects: "归档/项目"
  archive_drafts: "归档/草稿"
  archive_plans: "归档/计划"

# After (nested, parent visible):
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
```

- [ ] **Step 2: 更新 TypeScript 类型**

```typescript
// Before:
interface SubdirectoriesConfig {
  knowledge_notes: string;
  knowledge_wiki: string;
  templates: string;
  // ...
  [key: string]: string;
}

// After:
interface SubdirectoriesConfig {
  knowledge: { notes: string; wiki: string };
  system: {
    templates: string;
    schema: string;
    memory: string;
    archive: { projects: string; drafts: string; plans: string };
  };
}
```

- [ ] **Step 3: 更新 ZH_PRESET / EN_PRESET**

在 `src/config.ts` 中按新结构重写两个预设的 `subdirectories` 部分。

- [ ] **Step 4: 删除 SUBDIR_PARENTS 常量**

父子关系现在由 YAML 嵌套结构直接表达，不再需要硬编码映射。

- [ ] **Step 5: 重写 VaultConfig 的子目录解析**

`subDirPath()` 和 `subDirPrefix()` 改为从嵌套结构直接读取：

```typescript
// Before:
subDirPath(logicalName: string): string {
  const parentLogical = SUBDIR_PARENTS[logicalName]; // 查硬编码表
  return join(this.dirPath(parentLogical), subdirs[logicalName]);
}

// After:
subDirPath(parent: string, child: string): string {
  const parentDir = this._config.directories[parent];
  const childDir = this._config.subdirectories[parent]?.[child];
  return join(this._vaultRoot, parentDir, childDir);
}
```

需要审计所有 `subDirPath()` 调用点并更新参数签名。

- [ ] **Step 6: 更新所有消费方**

搜索 `subDirPath(`、`subDirPrefix(`、`subdirectories.`、`SUBDIR_PARENTS` 的所有引用，逐一更新：
- `src/cli/commands/init.ts` — 目录创建循环
- `src/cli/commands/upgrade.ts` — 资产定位
- `src/cli/commands/doctor.ts` — 子目录检查
- `src/services/layer0.ts` — memoryDir
- `src/active-docs/index.ts` — getMemoryDir
- `src/skill-context/index.ts` — loadTaskboardSummary
- `src/utils/context-policy.ts` — contextPolicyPath

- [ ] **Step 7: 更新测试**

- config.test.ts：更新 `subDirPath` / `subDirPrefix` 测试为新签名
- init.test.ts：更新子目录断言
- doctor.test.ts：更新子目录检查期望

- [ ] **Step 9: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 10: 提交**

```
refactor: nest subdirectories in lifeos.yaml, remove SUBDIR_PARENTS constant
```

---

## Task 13: lifeos rename 交互式命令

**Issue:** 用户修改目录名称后无全链路刷新机制。`lifeos.yaml` 在 Obsidian 中不可见（`.yaml` 文件不在文件浏览器中显示），用户需要通过 CLI 交互式操作来修改配置。

**Files:**
- Create: `src/cli/commands/rename.ts`
- Modify: `src/cli/index.ts` — 添加 rename 路由
- Modify: `bin/lifeos.js` — 添加 rename 到 CLI_COMMANDS
- Create: `tests/cli/rename.test.ts`

- [ ] **Step 1: 实现交互式选择**

使用 Node.js 内置 `readline` 模块（零新增依赖），编号列表选择：

```
$ lifeos rename

当前目录配置:

  顶级目录:
   1) drafts         → 00_草稿
   2) diary          → 10_日记
   3) projects       → 20_项目
   ...

  子目录:
  11) knowledge/notes → 40_知识/笔记
  12) knowledge/wiki  → 40_知识/百科
  13) system/templates → 90_系统/模板
  ...

? 选择要重命名的目录 [编号]: 1
? 新名称 (当前: 00_草稿): 00_Inbox
```

- [ ] **Step 2: 实现全链路刷新**

```typescript
export default async function rename(args: string[]): Promise<void> {
  const targetPath = resolve(args[0] ?? '.');
  const config = loadYaml(join(targetPath, 'lifeos.yaml'));

  // 1. 交互式选择
  const { logicalName, isSubdir, oldPhysical } = await promptSelection(config);
  const newPhysical = await promptNewName(oldPhysical);

  // 2. 重命名物理目录
  const oldPath = join(targetPath, oldPhysical);
  const newPath = join(targetPath, newPhysical);
  if (existsSync(oldPath)) {
    renameSync(oldPath, newPath);
  }

  // 3. 更新 lifeos.yaml
  updateConfigValue(config, logicalName, isSubdir, newPhysical);
  writeFileSync(join(targetPath, 'lifeos.yaml'), stringifyYaml(config));

  // 4. 批量替换 wikilinks
  const replaced = replaceWikilinks(targetPath, oldPhysical, newPhysical);

  // 5. 输出摘要
  log(green('✔'), bold('重命名完成'));
  log('  ', `目录:  ${oldPhysical} → ${newPhysical}`);
  log('  ', `配置:  lifeos.yaml 已更新`);
  log('  ', `链接:  ${replaced} 个 wikilinks 已更新`);
}
```

- [ ] **Step 3: 实现 wikilink 批量替换**

递归扫描 Vault 中所有 `.md` 文件，替换：
- `[[oldPhysical/` → `[[newPhysical/`
- `](oldPhysical/` → `](newPhysical/`

```typescript
function replaceWikilinks(
  vaultRoot: string,
  oldPrefix: string,
  newPrefix: string,
): number {
  let count = 0;
  walkMdFiles(vaultRoot, (filePath) => {
    const content = readFileSync(filePath, 'utf-8');
    // 替换 wikilinks 和 markdown links 中的路径前缀
    const updated = content
      .replaceAll(`[[${oldPrefix}/`, `[[${newPrefix}/`)
      .replaceAll(`[[${oldPrefix}]]`, `[[${newPrefix}]]`)
      .replaceAll(`](${oldPrefix}/`, `](${newPrefix}/`);
    if (updated !== content) {
      writeFileSync(filePath, updated);
      count++;
    }
  });
  return count;
}
```

- [ ] **Step 4: 添加 CLI 路由**

`bin/lifeos.js` — 添加 `'rename'` 到 `CLI_COMMANDS` 数组。
`src/cli/index.ts` — 添加 rename case。

- [ ] **Step 5: 写集成测试**

```typescript
describe('lifeos rename', () => {
  test('renames directory and updates lifeos.yaml', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      await initCommand([dir, '--lang', 'zh', '--no-mcp']);
      // 非交互式测试模式
      await renameCommand([dir, '--logical', 'drafts', '--name', '00_Inbox']);
      expect(existsSync(join(dir, '00_Inbox'))).toBe(true);
      expect(existsSync(join(dir, '00_草稿'))).toBe(false);
      const yaml = parseYaml(readFileSync(join(dir, 'lifeos.yaml'), 'utf-8'));
      expect(yaml.directories.drafts).toBe('00_Inbox');
    } finally {
      cleanup();
    }
  });

  test('updates wikilinks in markdown files', async () => {
    const { dir, cleanup } = makeTmpDir();
    try {
      await initCommand([dir, '--lang', 'zh', '--no-mcp']);
      // 创建含 wikilink 的测试文件
      writeFileSync(join(dir, '10_日记', 'test.md'), '链接到 [[00_草稿/idea]]');
      await renameCommand([dir, '--logical', 'drafts', '--name', '00_Inbox']);
      const content = readFileSync(join(dir, '10_日记', 'test.md'), 'utf-8');
      expect(content).toBe('链接到 [[00_Inbox/idea]]');
    } finally {
      cleanup();
    }
  });
});
```

命令同时支持交互式模式（无参数）和脚本模式（`--logical` + `--name`）。

- [ ] **Step 6: 运行测试验证**

Run: `npm run typecheck && npm test`

- [ ] **Step 7: 提交**

```
feat(cli): add interactive lifeos rename command with wikilink refresh
```

---

## Task 14: 模板路径引用修复

**Issue:** `assets/templates/zh/Project_Template.md` 有 2 处硬编码路径（AI 指令注释中的 `[[40_知识/笔记/...]]` 和 `[[40_知识/百科/...]]`），如果用户改名会导致 AI 生成错误路径。

**Files:**
- Modify: `assets/templates/zh/Project_Template.md` (lines 59-60)

- [ ] **Step 1: 替换硬编码路径**

```markdown
<!-- Before: -->
- 笔记 (体系): `[[40_知识/笔记/<Domain>/<BookName>/<ChapterName>/<ChapterName>]]`
- 百科 (原子): `[[40_知识/百科/<Domain>/<概念名称>]]`

<!-- After: -->
- 笔记 (体系): `[[{知识目录}/{笔记子目录}/<Domain>/<BookName>/<ChapterName>/<ChapterName>]]`
- 百科 (原子): `[[{知识目录}/{百科子目录}/<Domain>/<概念名称>]]`
```

- [ ] **Step 2: 全面扫描其他模板**

确认英文模板无硬编码路径（已确认为空），扫描中文模板其他文件无遗漏。

- [ ] **Step 3: 提交**

```
fix(template): replace hardcoded paths with logical references in Project_Template
```

---

## 依赖关系

```
── 第一批（独立，最安全）──────────────────────────
Task 7  (brainstorm 路径)          完全独立
Task 8  (layer0 fallback)          完全独立
Task 9  (死代码)                   完全独立
Task 14 (模板路径)                 完全独立

── 第二批（CLI 重构核心）──────────────────────────
Task 1  (类型 + VERSION) ──→ Task 2 (install-assets) ──→ Task 3 (复盘子目录)
Task 4  (parseArgs + MCP)          完全独立
Task 5  (doctor 增强)              Task 1 之后

── 第三批（测试清理）──────────────────────────────
Task 10 (shared 测试合并)          Task 9 之后
Task 11 (MCP 测试合并)             完全独立

── 第四批（配置架构升级）──────────────────────────
Task 6  (文档) ──→ Task 12 (subdirectories 嵌套化) ──→ Task 13 (lifeos rename)
```

**推荐执行顺序：**
1. Task 7 + 8 + 9 + 14（路径修复 + 死代码）— 最安全
2. Task 1 → 2（CLI 重构核心）
3. Task 3 + 4 + 5 + 10 + 11（可并行）
4. Task 6 → 12 → 13（配置架构升级，串行）

---

## 验证方案

```bash
# 1. 编译 + 类型检查
npm run build && npm run typecheck

# 2. 全量测试
npm test

# 3. Lint 检查
npm run lint

# 4. 手动验证 init（新的嵌套 subdirectories 格式）
node bin/lifeos.js init /tmp/test-refactor --lang zh --no-mcp
cat /tmp/test-refactor/lifeos.yaml
# 确认 subdirectories 是嵌套格式

# 5. 手动验证 rename
cd /tmp/test-refactor
node ~/code/node/lifeos/bin/lifeos.js rename --logical drafts --name 00_Inbox
cat lifeos.yaml  # directories.drafts = "00_Inbox"
ls               # 00_Inbox/ 存在, 00_草稿/ 不存在

# 6. 手动验证 upgrade 迁移（旧格式 → 新格式）
# 用旧版 init 创建 vault，然后 upgrade 应自动迁移 subdirectories 格式

# 7. 手动验证 doctor
node ~/code/node/lifeos/bin/lifeos.js doctor .

# 8. 确认无硬编码残留
grep -rn '00_\|10_\|20_\|30_\|40_\|50_\|60_\|70_\|80_\|90_' assets/skills/brainstorm/SKILL.zh.md
grep -n "90_系统" src/services/layer0.ts
grep -rn '00_\|40_\|90_' assets/templates/

# 9. 清理
rm -rf /tmp/test-refactor
```
