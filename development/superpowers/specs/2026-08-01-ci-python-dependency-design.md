# LifeOS 远程 CI Python 依赖热修设计

## 背景与根因

`v2.2.0` 推送后，CI 的 Node.js 24 任务和 Release 的构建验证都在 PDF 提取测试中失败。失败日志虽然数量很多，但共享同一个根因：GitHub 托管运行器没有安装提供 `fitz` 模块的 PyMuPDF。Node.js 25 矩阵任务只是被 `fail-fast` 取消，并非第二个独立故障。

本地测试之所以通过，是因为本机已经安装 PyMuPDF 1.26.5。当前工作流只安装 Node.js 与 npm 依赖，没有声明测试实际依赖的 Python 运行环境。

## 采用方案

在 CI 与 Release 两个工作流中显式建立相同的 Python 测试环境：

- 使用 `actions/setup-python@v5` 安装 Python 3.12。
- 使用 `python -m pip install --disable-pip-version-check PyMuPDF==1.26.5` 安装固定版本依赖。
- 保留现有 Node.js 矩阵、类型检查、lint、测试、构建、打包和发布步骤。

固定 Python 与 PyMuPDF 版本可以消除运行器镜像漂移，并让本地已验证版本与远程环境一致。当前失败栈没有使用 Pillow，因此不把它加入本次热修。

## 测试策略

先扩展现有 GitHub 工作流契约测试，以 YAML 结构而不是文本搜索验证：

1. CI 的 `test` job 与 Release 的 `release` job 都包含 Python 3.12 初始化步骤。
2. 两个 job 都在运行测试前安装 PyMuPDF 1.26.5。
3. 删除任一工作流中的 Python 初始化或依赖安装时，契约测试必须失败。

测试先在现有工作流上观察红灯，再修改生产工作流并观察绿灯。随后运行类型检查、lint、全量测试和构建。

## 发布策略

`v2.2.0` 已经推送，但第一次发布在构建验证阶段终止，npm publish 与 GitHub Release 均未执行。热修不改 `package.json` 版本、不新增版本号，也不移动远端标签。

修复提交进入 `main` 且远程 CI 全绿后，从最新 `main` 手动触发 Release 工作流，并传入现有标签 `v2.2.0`。工作流定义来自修复后的 `main`，源码检出仍指向既有标签；由于 Python 安装命令直接写在工作流中，即使标签提交本身不含热修，也能获得完整测试环境。

发布完成后同时验证：

- Release 工作流全部步骤成功。
- GitHub Release `v2.2.0` 存在并附带 npm tarball。
- npm registry 可查询到 `lifeos@2.2.0`。
- 远端 `v2.2.0` peeled commit 仍为原提交，证明没有重写标签。

## 非目标

- 不修改 PDF 提取脚本或测试跳过策略。
- 不改变 CI 的 Node.js 版本矩阵。
- 不修改用户主工作区中未提交的 `package.json`。
- 不改写 `v2.2.0` 标签，不创建 `v2.2.1`。
- 不引入与当前失败无关的 Python 包。
