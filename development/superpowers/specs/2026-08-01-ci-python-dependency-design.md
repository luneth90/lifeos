# LifeOS 远程 CI Python 依赖热修设计

## 背景与根因

`v2.2.0` 推送后，CI 的 Node.js 24 任务和 Release 的构建验证都在 PDF 提取测试中失败。失败日志虽然数量很多，但共享同一个根因：GitHub 托管运行器没有安装提供 `fitz` 模块的 PyMuPDF。Node.js 25 矩阵任务只是被 `fail-fast` 取消，并非第二个独立故障。

本地测试之所以通过，是因为本机已经安装 PyMuPDF 1.26.5。当前工作流只安装 Node.js 与 npm 依赖，没有声明测试实际依赖的 Python 运行环境。

## 采用方案

在 CI 与 Release 两个工作流中显式建立相同的 Python 测试环境：

- 使用 `actions/setup-python@v7` 安装 Python 3.12；同时把 checkout 与 setup-node 升到 `v7`，确保三个官方 Action 都使用 `node24` runner。
- 使用 `python -m pip install --disable-pip-version-check PyMuPDF==1.26.5` 安装固定版本依赖。
- 保留现有 Node.js 矩阵、类型检查、lint、测试、构建、打包和发布步骤。

固定 Python 与 PyMuPDF 版本可以消除运行器镜像漂移，并让本地已验证版本与远程环境一致。当前失败栈没有使用 Pillow，因此不把它加入本次热修。

## 测试策略

先扩展现有 GitHub 工作流契约测试，以 YAML 结构而不是文本搜索验证：

1. CI 的 `test` job 与 Release 的 `release` job 都包含 Python 3.12 初始化步骤。
2. 两个 job 都在运行测试前安装 PyMuPDF 1.26.5。
3. 删除任一工作流中的 Python 初始化或依赖安装时，契约测试必须失败。

测试先在现有工作流上观察红灯，再修改生产工作流并观察绿灯。随后运行类型检查、lint、全量测试和构建。

## 首次远程回归暴露的第二根因

补齐 PyMuPDF 后，远程 CI 的 1064 项断言全部通过，但 Vitest 最终报告一个未处理错误：

```text
[vitest-worker]: Timeout calling "onTaskUpdate"
```

`tests/assets/read-pdf-extraction.test.ts` 在 GitHub runner 上耗时 76.92 秒，超过 Vitest worker RPC 固定的 60 秒等待窗口。该文件连续使用 `spawnSync` 调用 Python；每次同步调用返回后，下一项测试会立即再次阻塞事件循环，导致 worker 无法及时消费主进程对 `onTaskUpdate` 的 RPC 回包。本地同一文件约 44 秒，未越过 60 秒窗口，所以本地全绿不能复现该超时。

采用最小修复：把该文件现有的 `afterEach` 清理钩子改为异步，并在清理完成后等待一次 `setImmediate`。这不会改变提取断言、子进程退出码或 fixture 生命周期，只在每个测试之间给 worker 一次处理 IPC 的机会。与把约 80 个同步测试整体重写为异步子进程相比，此方案改动更小，且直接修复事件循环饥饿根因。

同一次运行还显示 checkout、setup-node 与 setup-python 的旧主版本仍以 Node.js 20 运行。官方最新 `v7` 的 `action.yml` 已核实均声明 `using: node24`，因此同步升级并增加工作流契约，避免发布时留下弃用告警。

## 发布策略

`v2.2.0` 已经推送，但第一次发布在构建验证阶段终止，npm publish 与 GitHub Release 均未执行。热修不改 `package.json` 版本，也不新增版本号。

补齐 Python 依赖后，首次远程回归又暴露了测试 worker RPC 超时；这一修复位于源码测试钩子中，旧标签提交无法通过单纯重跑工作流获得。用户因此明确授权把尚未形成 npm/GitHub Release 的 `v2.2.0` 重打到最终热修提交。

最终策略是：最新 `main` 通过全部远程 CI 后，重新创建 annotated tag `v2.2.0`，并使用带旧远端标签对象校验的 `--force-with-lease` 原子更新远端标签。这样只有远端仍保持诊断时记录的旧对象才允许移动，避免覆盖并发变更；标签 push 自动触发包含完整热修的 Release 工作流，不再额外执行 `workflow_dispatch`。

发布完成后同时验证：

- Release 工作流全部步骤成功。
- GitHub Release `v2.2.0` 存在并附带 npm tarball。
- npm registry 可查询到 `lifeos@2.2.0`。
- 远端 `v2.2.0` peeled commit 等于最终热修提交，且只发生一次带 lease 的受控更新。

## 非目标

- 不修改 PDF 提取脚本或测试跳过策略。
- 不改变 CI 的 Node.js 版本矩阵。
- 不修改用户主工作区中未提交的 `package.json`。
- 不创建 `v2.2.1`；只按用户明确授权受控重打尚未发布成功的 `v2.2.0`。
- 不引入与当前失败无关的 Python 包。
