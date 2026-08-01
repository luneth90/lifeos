# better-sqlite3 13 与 LifeOS 2.2.1 发布设计

## 目标

将 LifeOS 的 `better-sqlite3` 运行时依赖从 `^12.10.0` 升级到 `^13.0.2`，使常规全局安装命令 `npm install -g lifeos` 不再出现 `prebuild-install` 弃用警告和 `allowScripts` 安装脚本警告，并以 `v2.2.1` 发布该修复。

## 背景与根因

LifeOS 2.2.0 声明 `better-sqlite3: ^12.10.0`。npm 发布制品不携带项目的 `package-lock.json`，所以全局安装会在 12.x 范围内解析最新版本。该依赖链仍包含已弃用的 `prebuild-install@7.1.3`，并通过 `install` 生命周期脚本下载或编译原生模块，因此 npm 同时报告弃用警告和未纳入 `allowScripts` 的脚本警告。

`better-sqlite3@13.0.2` 已改用 N-API，将常用平台的预编译二进制直接包含在包内，不再依赖 `prebuild-install`，也不再显式声明 `install` 生命周期脚本。其 Node.js 要求为 `>=22`，符合 LifeOS 的 `>=24.14.1` 运行时基线。

进一步验证发现，仅升级依赖不能消除 npm 11.17 的 `allowScripts` 警告。13.0.2 的制品仍包含 `binding.gyp` 作为源码编译回退，npm 会据此推导默认的 `node-gyp rebuild` 安装脚本。全局安装没有可由发布者写入的项目级 `allowScripts`，因此必须让 LifeOS 制品直接携带已审查的预编译依赖，避免 npm 在全局安装时把它作为待执行脚本处理。

## 方案

采用范围声明并将原生依赖随制品打包：

```json
"better-sqlite3": "^13.0.2"

"bundleDependencies": ["better-sqlite3"]
```

不增加 `allowScripts`，不修改用户安装命令，也不使用日志级别隐藏警告。升级依赖消除 `prebuild-install`，bundledDependencies 消除全局安装的隐式编译脚本警告。

同时把 npm 完整审计作为发布门禁：升级 `@modelcontextprotocol/sdk`、Vitest 与 tsx 的兼容补丁版本并刷新安全传递依赖，要求生产与开发依赖审计均为 0。

## 变更范围

1. 在依赖契约测试中声明以下要求：
   - `package.json` 必须使用 `better-sqlite3` 13.x，最低版本为 13.0.2；
   - `better-sqlite3` 必须列入 `bundleDependencies`；
   - 锁文件中的 `better-sqlite3` 不得显式声明安装脚本；
   - 生产依赖树不得包含 `prebuild-install`。
2. 更新 `package.json` 和 `package-lock.json`，安装 `better-sqlite3@13.0.2` 并刷新全部安全补丁依赖。
3. 新增锁文件安全基线测试，并要求 `npm audit` 返回 0 漏洞。
4. 使用现有 patch 发布脚本把版本从 2.2.0 升至 2.2.1，并同步全部中英文技能资产和规则文件版本。
5. 在 `CHANGELOG.md` 添加 2.2.1 修复说明。
6. 不修改数据库访问接口、SQL、迁移逻辑或用户配置。

## 验证策略

验证分为四层：

1. **依赖契约**：测试先在 12.x 依赖上失败，升级后通过。
2. **安全审计**：运行完整 `npm audit`，要求生产与开发依赖均为 0 漏洞。
3. **源码回归**：运行类型检查、Biome、完整 Vitest 测试和构建。
4. **发布制品**：运行版本一致性校验并生成 npm tarball，确认 bundledDependencies 包含 `better-sqlite3` 与 `node-addon-api`。
5. **安装行为**：在隔离临时目录全局安装本地 tarball，断言安装输出不包含 `deprecated prebuild-install` 或 `allowScripts`，随后运行 `lifeos --version` 并执行 SQLite 内存查询。

## 发布流程

先推送包含修复的 `main`，再创建并推送注解标签 `v2.2.1`。标签推送触发现有 Release 工作流；工作流从标签检出源码，执行版本一致性校验、全量验证和打包，通过 npm trusted publishing 发布制品，最后创建 GitHub Release。

发布后核验：

- GitHub Actions Release 工作流成功；
- npm registry 中 `lifeos@2.2.1` 存在且 `latest` 指向 2.2.1；
- 从 registry 执行 `npm install -g lifeos` 时不再出现目标警告；
- 安装后的 CLI 与 SQLite 原生模块可正常运行。

## 风险与处理

- **主版本升级兼容性**：`better-sqlite3` 13 改用 N-API。通过完整测试、数据库运行时测试和制品安装测试覆盖现有 API 使用。
- **平台预编译覆盖**：发布前在当前 macOS 环境验证，GitHub Actions 在 Linux Node.js 24.14.1 环境再次安装和执行完整测试；Windows 由上游 13.0.2 预编译制品支持，本次不改变 LifeOS 的平台声明。
- **制品体积增加**：打包常用平台预编译二进制后，npm tarball 压缩体积约增加 11.3 MB；该成本用于保证普通全局安装无需下载器、编译器或脚本批准。
- **发布中断**：只有全部本地验证通过后才推送标签。若远端工作流失败，不重用或覆盖已发布版本号，而是先诊断失败原因再决定后续补丁版本。

## 完成标准

- 所有依赖契约和现有测试通过；
- 本地发布制品的全局安装无两项目标警告；
- `v2.2.1` 标签指向已验证提交；
- GitHub Release 与 npm `lifeos@2.2.1` 发布成功；
- npm `latest` 为 2.2.1。
