# AGENTS.md 中文对照版

> 语言： [English（规范主文件）](AGENTS.md) | **简体中文**
>
> 本文件是 `AGENTS.md` 的中文对照版，旨在方便中文读者阅读。英文 `AGENTS.md` 是唯一的规范源；两者存在冲突时，以英文版为准。修改英文规范时，请同步更新本文件，并保持章节、编号、命令、路径和 API 名称对应。

本文件是面向 coding agent 和人类贡献者的仓库开发指南，与具体工具无关：无论任务由 Claude、Codex、IDE 助手还是人工完成，都应遵循本指南。

## 项目范围

SearchDBPad 是一个 Windows 优先的搜索引擎数据管理 Electron 桌面客户端。0.4.0 内置面向 Elasticsearch 6.x–9.x、OpenSearch 1.x/2.x 和 Solr 8/9 的 adapter。Fixtures 验证协议覆盖；真实服务器与桌面验证仍是独立的发布门槛。

产品计划位于 `SEARCHDBPad_CLIENT_PLAN.md`。版本计划和发布说明（如果当前 checkout 中存在对应目录）位于 `ai-dev-steps/future-releases/` 和 `ai-dev-steps/releases/`。`ai-dev-steps/templates/` 包含协作、Bug 修复和代码审查模板。

## 常用命令

```bash
npm install
npm run dev              # Vite 渲染进程 + Electron
npm run typecheck        # renderer/shared 和 main/preload 的 TypeScript 类型检查
npm run build            # 编译 main/preload，并构建 renderer 生产包
npm test                 # Vitest 单元测试和 adapter contract tests
npm start                # 使用已构建的产物启动 Electron
npm run pack             # 未安装版 electron-builder 冒烟打包
npm run dist:win         # Windows NSIS 安装包 + 绿色版
npm run dist:portable    # 仅构建 Windows 绿色版
```

项目要求 Node.js 20 或更高版本，以及 npm 10 或更高版本。`npm run dist:*` 面向 Windows。macOS 打包必须在 macOS 上运行（通常由 macOS CI job 执行），不属于有效的本地 Windows 验证步骤。

## 架构

- `src/main/`：Electron 主进程、IPC handler、持久化、搜索引擎服务和网络访问。
- `src/preload/`：通过隔离桥暴露为 `window.searchApi` 的 preload surface；保持该 surface 小而且类型明确。`window.esApi` 不属于当前 renderer API。
- `src/renderer/`：React 18 + Ant Design + Vite UI。不得直接访问 Node API 或搜索引擎。
- `src/shared/`：三层共用的 IPC channel 名称，以及面向 renderer 的契约。
- `src/main/search/`：与引擎无关的 adapter 契约、registry、错误类型和版本缓存。
- `src/main/adapters/<engine>/`：特定引擎的 HTTP 和版本兼容代码。
- `src/main/services/`：业务编排。Service 应解析 adapter，不应导入特定引擎 API。
- `src/main/store/`：连接、收藏夹及其他应用数据的本地持久化。

renderer bundle 输出到 `dist/renderer/`；编译后的 main、preload 和 shared 代码输出到 `dist/` 下。这些都是生成产物。

## 不可违反的边界

1. 保持 Electron 的 `contextIsolation: true` 和 `nodeIntegration: false`。
2. 文件系统、网络和 shell 访问必须放在 main process 中。只能通过 preload 和 IPC 暴露明确且有类型的操作。
3. 每个 IPC channel 及其 request/result 类型都必须先添加到 `src/shared/ipc.ts`，然后再实现 main handler 和 preload method。三层必须保持同步。
4. 特定引擎的 URL 形状、认证细节、版本差异和响应映射必须放在对应 adapter 内。
5. Service 必须依赖 `SearchEngineAdapter`（或更小的 capability contract），不能依赖 Elasticsearch 模块。
6. 不得记录密码、API key、完整 authorization header 或原始连接 secret。不得在面向用户的错误中回显 secret。
7. 保留 `src/renderer/index.html` 中的 CSP marker；`vite.config.ts` 会注入开发和生产环境的 policy。

## 开发功能前

1. 检查 `git status`，保留与当前任务无关的用户改动。
2. 阅读 `SEARCHDBPad_CLIENT_PLAN.md` 的相关章节；对于有版本号的工作，还要阅读 `ai-dev-steps/future-releases/` 下唯一匹配的计划。
3. 在引入新 abstraction 前，检查当前实现和附近的类型定义。
4. 说明将要修改的文件和行为。范围应限定在请求的版本或 Bug 内。

开发过程中：

- 优先使用现有的 React、Ant Design、Zustand、TypeScript 和 HTTP adapter 模式。
- 如果现有技术栈无法满足需求，不要新增 dependency；确需新增时说明原因，并在获得批准后更新 lockfile。
- 避免推测性 abstraction。只有当两个引擎或两个真实产品流程确实需要时，才提取共享 contract。
- 明确处理兼容行为。没有 `engineType` 的已持久化连接必须继续按 Elasticsearch 读取，除非已经有明确的 migration。
- 对于长时间运行的导入、导出或集群操作，使用现有的 job/progress/cancellation 机制，并确保成功、失败和取消时都能清理资源。
- 对于破坏性操作，必须要求清晰确认，并返回可执行的错误信息。

## Adapter 与多引擎演进

Adapter 实现最小基础 contract 和可选的 capability contract。不要强迫引擎实现其无法支持的方法。新增或扩展 adapter 时，应当：

- 提供版本化的 adapter manifest，并声明已实现的 capability；
- 使用按 capability 划分的 contract 和明确的可选 operation；
- 共享 UI 使用与引擎无关的 resource/result 名称，同时为现有 Elasticsearch IPC 类型保留兼容别名；
- 让 renderer 根据 capability 隐藏或禁用不支持的操作，而不是通过失败请求来发现支持情况；
- 对于模型确实不同的场景使用特定引擎的视图，例如 Solr collections/schema 与 Elasticsearch indices/mappings；
- 为每个 adapter 增加 contract tests，并建立受支持 server version 的兼容矩阵。

## 测试与验证

Vitest 配置位于 `vitest.config.mts`，确定性测试位于 `tests/unit`。Windows CI 运行 typecheck、测试、生产构建和未安装版打包。Fixtures 本身不能证明真实服务器兼容性。

至少在源代码变更后运行 `npm run typecheck`、`npm test` 和 `npm run build`。涉及打包变更时，如果本地环境允许，还要运行 `npm run pack`。对于 UI 变更，应手动验证 loading、empty、error、success、cancellation 和破坏性确认状态。对于 adapter 变更，应使用 Elasticsearch 6.x–9.x、OpenSearch 1.x/2.x 和 Solr 8/9 的代表性 fixtures；真实服务器验证仍是独立的发布门槛。

应按实际完成的层次记录验证：确定性的 unit 或 contract fixtures、真实服务器检查以及 Electron UI 检查分别记录。不要把 fixture 覆盖描述为真实兼容性证明；只有在当前环境成功执行后，才能声称 `npm run pack` 通过。

持续为以下内容维护确定性的 unit tests：

- adapter registry 和 capability resolution；
- version 与 request-shape compatibility helper；
- IPC request/result validation 和 error mapping；
- import/export parsing、escaping、batching、progress 和 cancellation；
- connection persistence migration 和 secret redaction。

## 文档与交付

以当前代码和 `package.json` 作为已发布行为、认证模式、依赖和应用版本的事实来源。以匹配的 future release plan 作为该变更范围的事实来源；较旧的产品计划只是背景资料，可能描述历史状态。

当行为、IPC contract、支持的引擎或打包方式发生变化时，更新对应的计划或 release note。保持两个 README 与实际 UI、依赖和支持的认证模式一致。不要改写历史 release note；新增 note 或 erratum。

变更结束时，报告已实现的行为、修改的文件、运行的命令、验证结果和有意保留的后续工作。如果某项检查因环境原因无法运行，必须明确说明。
