# SearchDBPad

> 语言: [English](README.md) | **简体中文**

SearchDBPad 是一个 Windows 优先的搜索引擎数据管理桌面客户端。0.4.1 通过统一的能力模型内置 Elasticsearch、OpenSearch 和 Solr adapter。Elasticsearch / OpenSearch 使用 DSL 查询工作流，Solr 使用 Collection、Schema 以及原生 `q` / `fq` / `sort` 查询参数。

Windows x64 安装版和便携版可在 [GitHub Release v0.4.1](https://github.com/hansicong97/SearchDBPad/releases/tag/v0.4.1) 下载；发布说明列出了验证范围与已知限制。

项目长期目标是通过统一的桌面体验支持 Elasticsearch、Solr 等主流搜索引擎。

基于 Electron + React + TypeScript，采用三进程架构（main / preload / renderer），安全基线为 `contextIsolation: true`、`nodeIntegration: false`。

macOS 支持已列入路线图，暂未实装。详见 [路线图](#路线图)。

## 功能

- **连接管理** — 新增 / 编辑 / 删除 / 测试内置引擎连接，支持无认证与 Basic Auth
- **集群与资源浏览** — 集群健康、版本、索引 / Collection / Core 列表，以及 Schema 或 Mapping 元数据
- **文档浏览** — 分页、排序、过滤
- **查询** — 能力感知的简单查询、Elasticsearch / OpenSearch DSL，以及 Solr 原生参数查询
- **文档 CRUD** — 新增、编辑、删除、批量删除
- **导出** — 按 manifest 支持的 JSON / NDJSON / CSV 导出到指定文件（CSV 带 UTF-8 BOM，Excel 友好）
- **导入** — 按 manifest 支持的 JSON / NDJSON / CSV，支持有限批次、进度、取消和预览
- **本地化 UI** — Ant Design `zhCN` 文案，对话框与提示信息均为中文
- **外观设置** — “文件 → 设置”可选择浅色、深色或跟随系统，并保存偏好；工作区直接从原生菜单下方开始。详见 [v0.4.1 发布说明](docs/releases/v0.4.1.md)。

## 技术栈

- **Electron 32**（主进程 + 预加载 + 渲染进程）
- **React 18 + TypeScript 5 + Vite 5**
- **Ant Design 5** UI 组件库
- **Monaco Editor** — JSON 查询体编辑
- **原生 HTTP adapter** — Elasticsearch、OpenSearch、Solr 的引擎差异位于 `src/main/adapters/<engine>/`
- **electron-store 8** — 持久化连接配置
- **Zustand** — 渲染端状态管理
- **electron-builder 25** — 打包

## 目录结构

```
src/
  main/         Electron 主进程 — 持有 BrowserWindow，注册 IPC handler、adapter、service、持久化和网络访问
  preload/      通过 contextBridge 暴露给渲染端的 typed window.searchApi 表面
  renderer/     React 应用（Vite 根目录）
  shared/       ipc.ts — 三层共用的 channel 常量与请求/响应类型
build/          electron-builder 资源（installer.nsh，后续可放图标）
ai-dev-steps/   版本计划、发布说明与协作模板
```

渲染进程产出的 `dist/` 在运行时由主进程加载；`dist/` 整棵树（`main/`、`preload/`、`renderer/`、`shared/`）就是可部署的产物，生成的 `dist/` 不属于源码。

## 环境要求

- Node.js ≥ 20
- npm ≥ 10
- Windows 10 / 11（`npm run dist` 产出 NSIS 安装包和绿色版 `.exe`）

## 安装

```bash
npm install
```

## 开发

```bash
npm run dev
```

Vite 在 `http://localhost:5173` 启动渲染端，主进程通过 `tsconfig.main.json`（CommonJS → `dist/main/`）编译，dev server 就绪后 Electron 自动启动。主进程通过 `process.env.NODE_ENV === 'development'` 决定加载 dev URL 还是构建产物 `dist/renderer/index.html`。

```bash
npm run typecheck     # 对两个 tsconfig 跑 tsc --noEmit
npm test              # Vitest 单元测试和 adapter contract tests
npm run build         # tsc main + vite build renderer（仅构建，不打包）
npm start             # 用构建产物跑 Electron
```

## 打包

`npm run pack` 产物为 `release/win-unpacked/`（只有 `.exe` 和应用目录，没有安装包）— 不等 NSIS 装配就能快速验证 bundle 能否启动。其余 `dist:*` 命令都走 electron-builder。

### Windows

| 命令 | 产物 |
| --- | --- |
| `npm run dist` | NSIS 安装包 + 绿色版 `.exe` |
| `npm run dist:win` | 同 `dist`，显式指定 Windows 目标 |
| `npm run dist:portable` | 单文件绿色版（自解压 `.exe`，免安装） |

- NSIS：`release/SearchDBPad-<version>-x64.exe` — 完整安装包，创建桌面/开始菜单快捷方式，可选安装目录。卸载时会弹窗询问是否同时删除 `electron-store` 保存的数据（见 `build/installer.nsh`）。
- 绿色版：`release/SearchDBPad-<version>-portable.exe` — 双击直接运行，不写注册表、不写开始菜单。适合"丢到 U 盘里随便用"的场景。

### 打包速查

```bash
# 最快冒烟测试
npm run pack

# Windows NSIS 安装包 + 绿色版
npm run dist:win

# Windows 只要绿色版
npm run dist:portable
```

## 安全模型

`src/main/index.ts` 设置 `contextIsolation: true` 和 `nodeIntegration: false`。渲染端要访问文件系统、网络、shell，必须走 `preload → ipcMain` 这条通道（定义在 `src/shared/ipc.ts`）。渲染端代码应通过 preload 导出的 `SearchApi` 类型使用 `window.searchApi`，不要在渲染端重新声明它的形状。

`src/renderer/index.html` 里有个 `<!--CSP-->` 占位符，由 Vite 插件（`vite.config.ts` → `cspPlugin`）替换：dev 模式下用宽松 CSP（允许 `http://localhost:5173` + `ws://localhost:5173` 的 HMR），生产构建用严格 CSP。**不要在 `index.html` 里硬编码 `<meta http-equiv="Content-Security-Policy">`** — 这个标签由插件统一管理。

## 路线图

产品讨论草案（尚未确定为发布范围）：[后续候选方向](docs/plans/2026-10-18-product-directions.md)与[查询工作台升级](docs/plans/2026-10-18-query-workbench-discussion.md)。两份草案目前以中文编写，分别标明已核实实现、建议行为和待讨论决策。

产品范围说明见 [`SEARCHDBPad_CLIENT_PLAN.md`](SEARCHDBPad_CLIENT_PLAN.md)。当前与后续版本文档在工作区存在 `ai-dev-steps/` 时按以下目录组织：

```
releases/                    已完成版本说明（V0.1.x 起）
future-releases/             待实现版本计划（V0.3.x 与 V0.4.x）
templates/                   协作、审查与 Bug 修复模板
```

### 未来计划

- **macOS 支持** — `dist:mac`（DMG + ZIP，Intel + Apple Silicon）暂未接入。原因是 electron-builder 只允许在 macOS 本机跑 `--mac`，从 Windows / Linux 上调会直接报 `Build for macOS is supported only on macOS`。后续会配 `macos-latest` GitHub Actions runner 一起做掉，而不是让 Windows 本地能跑。
- **多搜索引擎支持** — 0.4.0 已内置 Elasticsearch、OpenSearch 和 Solr adapter。目标兼容范围为 Elasticsearch 6.x–9.x、OpenSearch 1.x/2.x 和 Solr 8/9。当前已有 fixtures 及 unit/contract tests；真实服务器和 Electron UI 仍是发布门槛。

### 可执行的后续路线

后续工作按风险和复用价值排序。每个阶段都应先完成 fixtures、真实服务器检查、UI 检查和发布文档，再进入下一阶段。

| 优先级 | 重点 | 交付内容 |
|---|---|---|
| P0 | 稳定性与可维护性 | 版本化 adapter contract、IPC 校验与 secret redaction、过期响应保护、真正取消、流式传输、Vitest/CI 和兼容矩阵 |
| P1 | 查询体验 | 查询历史与收藏、查询模板、Schema 感知字段选择、深度分页（按能力支持 `search_after`/PIT）、结果列配置、任务历史和可恢复导出 |
| P2 | 引擎覆盖 | OpenSearch 1.x/2.x 真实验收、Solr 8/9 只读验收，再实现 Solr 写入与 JSON/CSV 传输及 uniqueKey、commit 语义 |
| P3 | 高级集成 | 跨引擎迁移向导、SSH 隧道、连接分组与密钥提供方，再实现带签名、版本兼容和权限隔离的插件协议及按需安装 |

外部插件和按需下载应放在至少两个非 ES adapter 稳定、contract 已版本化、权限隔离、签名验证和回滚策略明确之后。仅使用动态 `import()` 不会减少安装包内容。

### 验收清单

| 范围 | 当前证据 | 仍需完成 |
|---|---|---|
| 架构与 IPC | capability manifest、typed preload bridge 和源码检查 | 真实协议及安全审查 |
| Adapter 行为 | ES/OpenSearch/Solr 的确定性 fixtures 与 contract tests | 真实 ES 6.x–9.x、OpenSearch 1.x/2.x、Solr 8/9 服务器 |
| Renderer 行为 | 能力门控和引擎专用查询/传输控制已接入源码 | Electron UI 的 loading、empty、error、success、cancellation、破坏性确认检查 |
| 构建 | `npm run typecheck`、`npm test`、`npm run build` | 在稳定 Node.js 20+ 环境执行并记录 `npm run pack`/Windows 安装包 |

[0.4.0 续做记录](docs/releases/0.4.0-continuation-2026-10-17.md) 记录了恢复开发后的改动、实际验证命令、打包限制和剩余发布门槛。导入预览与执行按连接 manifest 选择解析规则：Solr 原生 JSON 字段保持不变，ES/OpenSearch CSV 的 `_id` 列用于还原文档 ID。

## 许可

MIT
