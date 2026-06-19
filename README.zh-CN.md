# ES Desktop Client（Elasticsearch 桌面客户端）

> 语言: [English](README.md) | **简体中文**

一个 Windows 桌面端的 Elasticsearch 管理工具，结构对标 Navicat-for-MySQL — 支持连接管理、集群与索引浏览、文档 CRUD、简单查询、批量导入/导出。

基于 Electron + React + TypeScript，采用三进程架构（main / preload / renderer），安全基线为 `contextIsolation: true`、`nodeIntegration: false`。

macOS 支持已列入路线图，暂未实装。详见 [路线图](#路线图)。

## 功能

- **连接管理** — 新增 / 编辑 / 删除 / 测试 ES 连接，支持 Basic 与 API Key 两种鉴权
- **集群与索引浏览** — 集群健康、版本、节点列表、索引统计、Mapping
- **文档浏览** — 分页、排序、过滤
- **查询** — JSON 查询体编辑器（Monaco），按 `_id` 获取单条文档
- **文档 CRUD** — 新增、编辑、删除、批量删除
- **导出** — JSON / NDJSON / CSV 到用户指定的文件（CSV 带 UTF-8 BOM，Excel 友好）
- **导入** — JSON 数组 / NDJSON（Bulk 或 plain）/ CSV，提交前展示前 10 行预览
- **本地化 UI** — Ant Design `zhCN` 文案，对话框与提示信息均为中文

## 技术栈

- **Electron 32**（主进程 + 预加载 + 渲染进程）
- **React 18 + TypeScript 5 + Vite 5**
- **Ant Design 5** UI 组件库
- **Monaco Editor** — JSON 查询体编辑
- **@elastic/elasticsearch 8.15** 客户端（项目中唯一与 ES 通信的地方）
- **electron-store 8** — 持久化连接配置
- **Zustand** — 渲染端状态管理
- **electron-builder 25** — 打包

## 目录结构

```
src/
  main/         Electron 主进程 — 持有 BrowserWindow，注册 IPC handler，与 ES 通信
  preload/      通过 contextBridge 暴露给渲染端的 window.esApi 表面
  renderer/     React 应用（Vite 根目录）
  shared/       ipc.ts — 三层共用的 channel 常量与请求/响应类型
build/          electron-builder 资源（installer.nsh，后续可放图标）
ai-dev-steps/   阶段开发工单（完整路线图见 ES_DESKTOP_CLIENT_PLAN.md）
```

渲染进程产出的 `dist/` 在运行时由主进程加载；`dist/` 整棵树（`main/`、`preload/`、`renderer/`、`shared/`）就是可部署的产物。

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

- NSIS：`release/ES Desktop Client-<version>-x64.exe` — 完整安装包，创建桌面/开始菜单快捷方式，可选安装目录。卸载时会弹窗询问是否同时删除 `electron-store` 保存的数据（见 `build/installer.nsh`）。
- 绿色版：`release/ES Desktop Client-<version>-portable.exe` — 双击直接运行，不写注册表、不写开始菜单。适合"丢到 U 盘里随便用"的场景。

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

`src/main/index.ts` 设置 `contextIsolation: true` 和 `nodeIntegration: false`。渲染端要访问文件系统、网络、shell，必须走 `preload → ipcMain` 这条通道（定义在 `src/shared/ipc.ts`）。渲染端代码应通过 preload 导出的 `EsApi` 类型为 `window.esApi` 提供类型，不要在渲染端重新声明它的形状。

`src/renderer/index.html` 里有个 `<!--CSP-->` 占位符，由 Vite 插件（`vite.config.ts` → `cspPlugin`）替换：dev 模式下用宽松 CSP（允许 `http://localhost:5173` + `ws://localhost:5173` 的 HMR），生产构建用严格 CSP。**不要在 `index.html` 里硬编码 `<meta http-equiv="Content-Security-Policy">`** — 这个标签由插件统一管理。

## 路线图

完整产品规划与阶段路线图在 `ES_DESKTOP_CLIENT_PLAN.md`，每个阶段的工单在 `ai-dev-steps/`：

```
01_PROJECT_INIT              done
02_CONNECTION_MANAGEMENT
03_CLUSTER_AND_INDEX_LIST
04_INDEX_DETAIL
05_DOCUMENT_QUERY
06_SIMPLE_QUERY
07_DOCUMENT_CRUD
08_EXPORT
09_IMPORT
10_PACKAGE_RELEASE
```

### 未来计划

- **macOS 支持** — `dist:mac`（DMG + ZIP，Intel + Apple Silicon）暂未接入。原因是 electron-builder 只允许在 macOS 本机跑 `--mac`，从 Windows / Linux 上调会直接报 `Build for macOS is supported only on macOS`。后续会配 `macos-latest` GitHub Actions runner 一起做掉，而不是让 Windows 本地能跑。

## 许可

MIT
