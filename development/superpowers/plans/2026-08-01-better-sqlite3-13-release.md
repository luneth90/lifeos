# better-sqlite3 13 与 LifeOS 2.2.1 实施计划

> **面向自动化执行者：** 必须使用 `superpowers:executing-plans` 在当前会话逐项实施。依赖修复必须遵循 `superpowers:test-driven-development`，发布前必须使用 `superpowers:verification-before-completion`。所有步骤使用复选框跟踪。

**目标：** 将 LifeOS 升级到 `better-sqlite3@^13.0.2`，验证常规全局安装不再出现 `prebuild-install` 与 `allowScripts` 警告，并发布 `v2.2.1`。

**架构：** 保持现有数据库适配层、SQL 和运行时契约不变，只升级原生 SQLite 依赖并增加面向安装行为的依赖契约测试。继续使用仓库既有版本同步脚本、Release 工作流和 npm trusted publishing；先推送 `main`，再推送注解标签触发发布。

**技术栈：** TypeScript、Vitest、Node.js 24.14.1+、npm、better-sqlite3 13、GitHub Actions、npm trusted publishing。

## 全局约束

- LifeOS 运行时基线保持 Node.js `>=24.14.1`。
- `better-sqlite3` 依赖声明固定为 `^13.0.2`。
- 生产依赖树不得包含 `prebuild-install`。
- `better-sqlite3` 不得声明 `install` 生命周期脚本或锁文件 `hasInstallScript: true`。
- 用户安装命令保持 `npm install -g lifeos`，不增加 `allowScripts` 或日志隐藏参数。
- 不修改数据库访问接口、SQL、迁移逻辑或用户配置。
- 保留工作区原有 `package.json` 数组格式化结果，不恢复或覆盖该改动。
- 版本统一升级为 `2.2.1`，标签为 `v2.2.1`。
- 只有本地发布验证全部通过后才能推送 `main` 和标签。
- 标签推送后必须等待 Release 工作流完成，并核验 npm registry 与 registry 制品安装。

---

## 文件职责

- `tests/security/native-dependency-install.test.ts`：验证 LifeOS 的 SQLite 生产依赖不会触发目标弃用和安装脚本警告，并执行真实内存数据库查询。
- `package.json`：声明 `better-sqlite3@^13.0.2` 和 LifeOS 版本。
- `package-lock.json`：锁定可复现的 13.x 依赖树，并证明生产树不含 `prebuild-install`。
- `CHANGELOG.md`：记录 2.2.1 的安装警告修复、N-API 升级与验证范围。
- `assets/skills/*/SKILL.{zh,en}.md`：由版本脚本把发布资产版本统一同步到 2.2.1。
- `assets/lifeos-rules.{zh,en}.md`：由版本脚本同步规则资产版本。

---

### 任务一：以依赖契约测试复现安装警告根因

**文件：**

- 创建：`tests/security/native-dependency-install.test.ts`
- 读取：`package.json`
- 读取：`package-lock.json`
- 读取：`node_modules/better-sqlite3/package.json`

**接口：**

- 消费：根 `package.json` 的 `dependencies`、npm v3 锁文件的 `packages`、已安装 `better-sqlite3` manifest。
- 产出：一个真实依赖边界测试，防止 LifeOS 回退到含 `prebuild-install` 或安装脚本的 SQLite 版本。

- [ ] **步骤 1：写入 RED 测试**

创建以下测试：

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface RootPackageJson {
	dependencies?: Record<string, string>;
}

interface LockedPackage {
	hasInstallScript?: boolean;
}

interface PackageLock {
	packages?: Record<string, LockedPackage>;
}

interface DependencyManifest {
	version: string;
	dependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('原生数据库生产依赖', () => {
	it('使用无弃用下载器和安装脚本的 better-sqlite3 13', () => {
		const packageJson = readJson<RootPackageJson>('package.json');
		const packageLock = readJson<PackageLock>('package-lock.json');
		const sqliteManifest = readJson<DependencyManifest>(
			require.resolve('better-sqlite3/package.json'),
		);
		const lockedSqlite = packageLock.packages?.['node_modules/better-sqlite3'];

		expect(packageJson.dependencies?.['better-sqlite3']).toBe('^13.0.2');
		expect(sqliteManifest.version).toMatch(/^13\./);
		expect(sqliteManifest.dependencies).not.toHaveProperty('prebuild-install');
		expect(sqliteManifest.scripts?.install).toBeUndefined();
		expect(lockedSqlite?.hasInstallScript).not.toBe(true);
		expect(packageLock.packages).not.toHaveProperty('node_modules/prebuild-install');
	});

	it('通过 N-API 预编译模块执行真实 SQLite 查询', () => {
		const db = new Database(':memory:');
		try {
			expect(db.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
		} finally {
			db.close();
		}
	});
});
```

该测试捕获的生产回归是：LifeOS 再次声明 12.x、锁入 `prebuild-install`，或选用需要安装脚本的 `better-sqlite3` 制品。

- [ ] **步骤 2：运行 RED 测试并确认失败原因**

运行：

```bash
npx vitest run tests/security/native-dependency-install.test.ts
```

预期：第一个用例因实际依赖仍为 `^12.10.0`、manifest 包含 `prebuild-install` 与 `scripts.install`、锁文件包含 `hasInstallScript` 和 `node_modules/prebuild-install` 而失败；第二个真实数据库用例继续通过。不得接受模块解析、JSON 语法或测试导入错误。

---

### 任务二：升级 better-sqlite3 并关闭依赖契约

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 保留：`tests/security/native-dependency-install.test.ts`

**接口：**

- 消费：任务一的 RED 测试。
- 产出：`better-sqlite3@^13.0.2` 依赖声明、13.0.2 锁定制品和不含 `prebuild-install` 的生产依赖树。

- [ ] **步骤 1：安装目标依赖并刷新锁文件**

运行：

```bash
npm install --save 'better-sqlite3@^13.0.2'
```

预期：`package.json` 写入 `^13.0.2`；`package-lock.json` 锁定 13.0.2，删除 `prebuild-install` 及其仅由旧链路需要的传递依赖。安装输出不得包含目标两项警告。

- [ ] **步骤 2：运行 GREEN 测试**

运行：

```bash
npx vitest run tests/security/native-dependency-install.test.ts
```

预期：两个用例全部通过，真实 SQLite 查询返回 `{ ok: 1 }`。

- [ ] **步骤 3：运行数据库与 CLI 定向回归**

运行：

```bash
npx vitest run tests/db tests/services tests/active-docs tests/runtime-contract.test.ts tests/cli/doctor.test.ts tests/cli/rules.test.ts
```

预期：全部通过，无原生模块加载、事务、FTS5、迁移或 CLI 回归。

- [ ] **步骤 4：检查依赖树和差异**

运行：

```bash
npm ls better-sqlite3 prebuild-install --omit=dev
git diff --check
git diff -- package.json package-lock.json tests/security/native-dependency-install.test.ts
```

预期：依赖树只显示 `better-sqlite3@13.0.2`，不显示 `prebuild-install`；差异仅包含测试和依赖升级，以及分析前已存在的 `package.json` 数组格式化。

- [ ] **步骤 5：提交依赖修复**

```bash
git add package.json package-lock.json tests/security/native-dependency-install.test.ts
git commit -m "fix: 升级 better-sqlite3 13"
```

---

### 任务三：同步 LifeOS 2.2.1 发布版本与更新日志

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`CHANGELOG.md`
- 修改：`assets/lifeos-rules.zh.md`
- 修改：`assets/lifeos-rules.en.md`
- 修改：`assets/skills/*/SKILL.zh.md`
- 修改：`assets/skills/*/SKILL.en.md`

**接口：**

- 消费：仓库现有 `release:bump` 与 `release:check-version` 脚本。
- 产出：所有发布资产一致的 `2.2.1` 版本和可被 Release 工作流提取的 Changelog 条目。

- [ ] **步骤 1：执行 patch 版本同步**

运行：

```bash
npm run release:bump -- patch
```

预期：脚本报告 `2.2.0 → 2.2.1`，同步根 manifest、锁文件、全部 11 项双语技能和两份规则资产。

- [ ] **步骤 2：添加 2.2.1 更新日志**

在 `CHANGELOG.md` 顶部 `# 更新日志` 之后加入：

```markdown
## 2.2.1 (2026-08-01)

### 修复

- 将 `better-sqlite3` 升级至 13.0.2，改用随包发布的 N-API 预编译二进制，移除已弃用的 `prebuild-install` 传递依赖和原生模块安装脚本，消除 `npm install -g lifeos` 的弃用与 `allowScripts` 警告

### 测试

- 新增原生数据库生产依赖契约测试，并验证真实 SQLite 查询、完整数据库回归、npm 发布制品和全局安装路径
```

- [ ] **步骤 3：校验版本一致性**

运行：

```bash
npm run --silent release:check-version -- v2.2.1
```

预期：输出 `已验证发布版本 v2.2.1，package.json、锁文件、更新日志与发布资产一致`。

- [ ] **步骤 4：检查版本差异**

运行：

```bash
git diff --check
git status --short
git diff --stat
```

预期：除依赖修复提交外，未提交差异只包含 2.2.1 版本同步和更新日志。

- [ ] **步骤 5：提交发布元数据**

```bash
git add CHANGELOG.md package.json package-lock.json assets/lifeos-rules.zh.md assets/lifeos-rules.en.md assets/skills
git commit -m "release: LifeOS 2.2.1"
```

---

### 任务四：执行本地发布验证

**文件：**

- 验证：全部源码、测试和发布资产。
- 生成后移出仓库：`lifeos-2.2.1.tgz`。
- 创建：`/private/tmp/lifeos-2.2.1-install-*` 隔离安装目录。

**接口：**

- 消费：任务三的 2.2.1 提交。
- 产出：类型、格式、测试、构建、制品内容和全局安装行为的完整证据。

- [ ] **步骤 1：运行完整发布门禁**

运行：

```bash
npm run release:verify
```

预期：typecheck、Biome、完整 Vitest 和 build 全部以退出码 0 完成。

- [ ] **步骤 2：生成发布制品**

运行：

```bash
npm run --silent release:pack
```

预期：输出 `lifeos-2.2.1.tgz`。将该文件移动到 `/private/tmp/lifeos-2.2.1.tgz`，避免仓库遗留未跟踪制品。

- [ ] **步骤 3：在隔离目录执行全局安装**

创建临时目录并运行：

```bash
lifeos_install_dir="$(mktemp -d /private/tmp/lifeos-2.2.1-install.XXXXXX)"
npm install --global --prefix "$lifeos_install_dir" /private/tmp/lifeos-2.2.1.tgz
```

预期：安装成功，完整 stdout/stderr 不包含 `deprecated prebuild-install`、`allow-scripts` 或 `better-sqlite3 (install:`。

- [ ] **步骤 4：验证安装后的 CLI 与 SQLite**

沿用上一步的 `lifeos_install_dir` 运行：

```bash
"$lifeos_install_dir/bin/lifeos" --version
node -e "const Database = require(process.argv[1] + '/lib/node_modules/lifeos/node_modules/better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('SELECT 1 AS ok').get()); db.close();" "$lifeos_install_dir"
```

预期：CLI 输出 `lifeos v2.2.1`，SQLite 输出 `{ ok: 1 }`。

- [ ] **步骤 5：确认发布提交状态**

运行：

```bash
git status --short --branch
git log -3 --oneline --decorate
```

预期：工作区干净，`main` 领先 `origin/main` 四个提交：设计、实施计划、依赖修复、2.2.1 发布元数据。

---

### 任务五：推送、打标签并核验远端发布

**文件与外部状态：**

- 推送：GitHub `main`。
- 创建并推送：注解标签 `v2.2.1`。
- 触发：`.github/workflows/release.yml`。
- 发布：npm `lifeos@2.2.1` 与 GitHub Release `v2.2.1`。

**接口：**

- 消费：任务四已验证且工作区干净的发布提交。
- 产出：远端 Git 标签、GitHub Release、npm 2.2.1 和 `latest` 标记。

- [ ] **步骤 1：最终确认版本号未被占用**

运行：

```bash
git ls-remote --tags origin refs/tags/v2.2.1
npm view lifeos versions --json
```

预期：远端标签查询无输出，npm 版本列表不包含 `2.2.1`。

- [ ] **步骤 2：推送 main**

运行：

```bash
git push origin main
```

预期：远端 `main` 快进到 2.2.1 发布提交。

- [ ] **步骤 3：创建并推送注解标签**

运行：

```bash
git tag -a v2.2.1 -m "LifeOS 2.2.1"
git push origin v2.2.1
```

预期：标签推送成功并触发 Release 工作流。禁止覆盖或强推标签。

- [ ] **步骤 4：等待 Release 工作流终态**

使用 GitHub CLI 查找由 `v2.2.1` 触发的 Release 工作流并等待完成：

```bash
release_run_id="$(gh run list --workflow Release --branch v2.2.1 --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$release_run_id" --exit-status
```

预期：工作流成功完成 npm publish 和 GitHub Release 创建；若失败，读取失败日志并停止发布后核验，不重打同名标签。

- [ ] **步骤 5：核验 npm 与 GitHub Release**

运行：

```bash
npm view lifeos@2.2.1 version
npm view lifeos dist-tags --json
gh release view v2.2.1
```

预期：npm 返回 `2.2.1`，`latest` 为 `2.2.1`，GitHub Release 存在并附带 `lifeos-2.2.1.tgz`。

- [ ] **步骤 6：从 registry 做最终安装验证**

创建新的 registry 隔离目录并运行：

```bash
lifeos_registry_dir="$(mktemp -d /private/tmp/lifeos-2.2.1-registry.XXXXXX)"
npm install --global --prefix "$lifeos_registry_dir" lifeos@2.2.1
"$lifeos_registry_dir/bin/lifeos" --version
```

预期：安装输出无两项目标警告，CLI 输出 `lifeos v2.2.1`。

- [ ] **步骤 7：最终核验本地与远端指针**

运行：

```bash
git status --short --branch
git rev-parse HEAD
git rev-list -n 1 v2.2.1
git ls-remote origin refs/heads/main refs/tags/v2.2.1
```

预期：工作区干净，本地 `main` 与 `origin/main` 一致，标签解引用到同一发布提交。
