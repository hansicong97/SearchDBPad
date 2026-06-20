# 14. SearchDBPad 品牌与产品定位升级修改说明

## 目标

本次升级只做品牌、文案和产品定位调整，不改现有业务能力。

需要达成三点：

1. 项目名称统一改为 **SearchDBPad**。
2. 项目介绍中删除所有借助其他产品做比较的描述，只介绍当前项目自身。
3. 项目长期目标从“仅支持 Elasticsearch”调整为“支持主流搜索引擎”，当前阶段仍优先支持 Elasticsearch，后续可扩展 Solr 等搜索引擎。

## 本次修改边界

### 本次要做

- 修改用户可见的应用名称、窗口标题、页面标题、安装包名称。
- 修改 README 与产品计划文档中的项目介绍。
- 修改内部协作说明中的项目定位。
- 明确当前实现是 Elasticsearch 优先，长期目标是多搜索引擎支持。

### 本次不要做

- 不实现 Solr 支持。
- 不引入 Solr SDK 或新增依赖。
- 不重构现有 Elasticsearch service、IPC、store、组件结构。
- 不把所有 `ES` / `Elasticsearch` 代码命名强行改成通用搜索引擎命名。
- 不修改现有功能逻辑、数据结构或存储格式。
- 不修改安全基线：`contextIsolation: true`、`nodeIntegration: false` 必须保持不变。

## 推荐修改文件

### 1. 应用名称与打包信息

#### `package.json`

需要修改：

- `name`
- `description`
- `author`
- `build.appId`
- `build.productName`
- `build.copyright`
- `build.nsis.shortcutName`

建议改为：

```json
{
  "name": "searchdbpad",
  "description": "Desktop client for search engine data management",
  "author": "SearchDBPad",
  "build": {
    "appId": "com.searchdbpad.app",
    "productName": "SearchDBPad",
    "copyright": "Copyright © 2026 SearchDBPad",
    "nsis": {
      "shortcutName": "SearchDBPad"
    }
  }
}
```

注意：上方只是需要修改字段的示意，不要覆盖整个 `package.json`。

#### `package-lock.json`

如果修改了 `package.json.name`，同步修改 lock 文件里的包名：

- 顶层 `name`
- `packages[""].name`

建议改为：

```json
"name": "searchdbpad"
```

不要改动依赖版本。

## 2. 用户界面标题

### `src/main/index.ts`

将窗口标题从：

```ts
title: 'ES Desktop Client'
```

改为：

```ts
title: 'SearchDBPad'
```

### `src/renderer/index.html`

将页面标题从：

```html
<title>ES Desktop Client</title>
```

改为：

```html
<title>SearchDBPad</title>
```

不要修改 `<!--CSP-->` 占位符。

### `src/renderer/components/AppHeader.tsx`

将主标题改为：

```tsx
SearchDBPad
```

将副标题从 Elasticsearch 专用表述改为更通用的产品定位，例如：

```tsx
<Text type="secondary">搜索引擎数据管理桌面客户端</Text>
```

### `src/renderer/App.tsx`

将页脚中的：

```tsx
<Text type="secondary">ES Desktop Client</Text>
```

改为：

```tsx
<Text type="secondary">SearchDBPad</Text>
```

## 3. README 英文文档

### `README.md`

#### 标题

从：

```md
# ES Desktop Client
```

改为：

```md
# SearchDBPad
```

#### 项目介绍

删除任何把项目与其他产品进行比较的描述。

建议改为：

```md
SearchDBPad is a desktop client for search engine data management. The current version focuses on Elasticsearch, including saved connections, cluster and index browsing, document CRUD, simple queries, and bulk import / export.

The long-term goal is to support mainstream search engines such as Elasticsearch and Solr through a consistent desktop experience.
```

#### Features

当前功能仍然是 Elasticsearch 优先，不要把尚未实现的 Solr 功能写成已完成能力。

建议把：

```md
- **Connection management** — save / edit / delete / test ES connections, with basic / API-key auth
```

改为：

```md
- **Connection management** — save / edit / delete / test Elasticsearch connections, with basic / API-key auth
```

#### Tech stack

可以保留：

```md
- **@elastic/elasticsearch 8.15** client
```

但建议表述为当前实现细节：

```md
- **@elastic/elasticsearch 8.15** client for the current Elasticsearch implementation
```

#### Repository layout

可以把：

```md
main/         Electron main process — owns the BrowserWindow, registers IPC handlers, talks to ES
```

改为：

```md
main/         Electron main process — owns the BrowserWindow, registers IPC handlers, talks to Elasticsearch in the current implementation
```

#### Packaging 输出文件名

将：

```md
release/ES Desktop Client-<version>-x64.exe
release/ES Desktop Client-<version>-portable.exe
```

改为：

```md
release/SearchDBPad-<version>-x64.exe
release/SearchDBPad-<version>-portable.exe
```

#### Roadmap

在路线图或 Future plans 中增加多搜索引擎方向：

```md
- **Multi-engine support** — the current implementation focuses on Elasticsearch. Future versions should add support for mainstream search engines such as Solr through an adapter/provider layer.
```

## 4. README 中文文档

### `README.zh-CN.md`

#### 标题

从：

```md
# ES Desktop Client（Elasticsearch 桌面客户端）
```

改为：

```md
# SearchDBPad
```

#### 项目介绍

删除任何把项目与其他产品进行比较的描述。

建议改为：

```md
SearchDBPad 是一个面向搜索引擎数据管理的桌面客户端。当前版本聚焦 Elasticsearch，提供连接管理、集群与索引浏览、文档 CRUD、简单查询、批量导入/导出等能力。

项目长期目标是通过统一的桌面体验支持 Elasticsearch、Solr 等主流搜索引擎。
```

#### 功能列表

当前功能仍然以 Elasticsearch 为准，不要把 Solr 写成已支持。

建议把：

```md
- **连接管理** — 新增 / 编辑 / 删除 / 测试 ES 连接，支持 Basic 与 API Key 两种鉴权
```

改为：

```md
- **连接管理** — 新增 / 编辑 / 删除 / 测试 Elasticsearch 连接，支持 Basic 与 API Key 两种鉴权
```

#### 技术栈

建议把：

```md
- **@elastic/elasticsearch 8.15** 客户端（项目中唯一与 ES 通信的地方）
```

改为：

```md
- **@elastic/elasticsearch 8.15** 客户端（当前 Elasticsearch 实现使用）
```

#### 目录结构

建议把：

```md
main/         Electron 主进程 — 持有 BrowserWindow，注册 IPC handler，与 ES 通信
```

改为：

```md
main/         Electron 主进程 — 持有 BrowserWindow，注册 IPC handler，当前实现中负责与 Elasticsearch 通信
```

#### 打包产物

将：

```md
release/ES Desktop Client-<version>-x64.exe
release/ES Desktop Client-<version>-portable.exe
```

改为：

```md
release/SearchDBPad-<version>-x64.exe
release/SearchDBPad-<version>-portable.exe
```

#### 未来计划

增加：

```md
- **多搜索引擎支持** — 当前实现聚焦 Elasticsearch，后续版本应通过 adapter/provider 层扩展支持 Solr 等主流搜索引擎。
```

## 5. 项目计划文档

### `ES_DESKTOP_CLIENT_PLAN.md`

此文件可以暂不改名，避免影响现有引用；本次只调整文档内容。

#### 标题

建议从：

```md
# Elasticsearch 桌面管理工具开发计划
```

改为：

```md
# SearchDBPad 开发计划
```

#### 开头定位

删除原有比较式介绍。

建议替换为：

```md
本项目计划开发 SearchDBPad：一个面向搜索引擎数据管理的桌面客户端。

当前阶段优先支持 Elasticsearch，先完成连接管理、索引浏览、文档查询、文档维护、数据导入导出等基础能力。

长期目标是支持 Elasticsearch、Solr 等主流搜索引擎，并通过统一的桌面交互降低日常数据管理、查询和维护成本。
```

#### 产品一句话定位

建议改为：

```md
> SearchDBPad 是一个面向开发者、测试人员、数据处理人员的搜索引擎桌面管理工具。当前版本聚焦 Elasticsearch，用于完成日常连接管理、索引浏览、数据查询、文档维护和数据导入导出；后续将扩展支持 Solr 等主流搜索引擎。
```

#### 产品参考部分

如果有列出其他产品作为参照的章节，建议删除整段，或改为“设计原则”。

建议改成：

```md
## 设计原则

- 桌面端优先，降低内网与本地环境使用成本。
- 操作路径清晰，优先覆盖高频数据管理任务。
- 当前实现聚焦 Elasticsearch，不提前暴露未完成的多引擎能力。
- 服务层逐步向 adapter/provider 结构演进，为后续 Solr 等搜索引擎接入预留空间。
```

#### 技术选型表

可以保留 `@elastic/elasticsearch`，但要标注为当前 Elasticsearch 实现。

例如：

```md
| Elasticsearch 客户端 | @elastic/elasticsearch |
```

不要在此阶段加入 Solr 客户端。

#### 路线图建议

在后续阶段中增加一个长期方向说明，不需要展开实现细节：

```md
### 长期方向：多搜索引擎支持

当前版本以 Elasticsearch 为第一目标。后续版本可在稳定现有功能后，引入搜索引擎适配层，将连接、集群信息、索引/集合浏览、查询、导入导出等能力逐步抽象为 provider 接口，再接入 Solr 等主流搜索引擎。
```

## 6. Claude 协作说明

### `CLAUDE.md`

#### 项目介绍

将：

```md
A Windows desktop client for Elasticsearch, structured like Navicat-for-MySQL.
```

改为：

```md
SearchDBPad is a Windows desktop client for search engine data management. The current implementation focuses on Elasticsearch, with long-term plans to support mainstream search engines such as Solr.
```

#### 架构描述

可以保留当前 ES 实现说明，但建议明确“当前实现”：

```md
- **`src/main/`** — Electron main process. Owns the `BrowserWindow`, registers `ipcMain.handle(...)` for every IPC channel, and is the only place that talks to Elasticsearch in the current implementation.
```

#### 阶段开发说明

不用修改阶段文件名；继续引用 `ES_DESKTOP_CLIENT_PLAN.md` 即可。

## 7. AI 开发步骤说明

### `ai-dev-steps/00_AI_COLLABORATION_GUIDE.md`

将开头类似：

```md
本目录用于指导 AI 按照 `ES_DESKTOP_CLIENT_PLAN.md` 分阶段开发 Elasticsearch 桌面管理工具。
```

改为：

```md
本目录用于指导 AI 按照 `ES_DESKTOP_CLIENT_PLAN.md` 分阶段开发 SearchDBPad。当前阶段以 Elasticsearch 功能为主，长期方向是支持 Solr 等主流搜索引擎。
```

## 8. 推荐保留不改的内容

下列内容是当前真实实现，不建议本次为了“多搜索引擎目标”而强行改名：

- `src/main/services/esClient.ts`
- `@elastic/elasticsearch` 依赖
- `window.esApi` 类型名
- 现有 IPC channel 名称
- 现有文档中“需要调用的 ES API”章节
- 当前功能界面里与 Elasticsearch 专属能力直接相关的字段，如 Mapping、DSL、Bulk API、ES 版本等

原因：这些都是当前功能实现的一部分。过早改成通用命名会造成文案与真实能力不一致，也会增加无必要的重构风险。

## 9. 全局搜索与替换建议

完成修改后，搜索以下关键词：

```txt
ES Desktop Client
Navicat
对标
类似
Elasticsearch 桌面客户端
```

处理原则：

- `ES Desktop Client` 应全部替换为 `SearchDBPad`。
- `Navicat`、`对标`、`类似` 如果出现在项目介绍中，应删除或改写。
- `Elasticsearch` 不需要全部删除；当前实现确实依赖 Elasticsearch。
- `ES` 不需要全部替换；如果是当前实现、API、错误信息、技术细节，可以保留。

## 10. 验收标准

修改完成后应满足：

1. 应用窗口标题显示 `SearchDBPad`。
2. HTML 页面标题显示 `SearchDBPad`。
3. 应用 Header 显示 `SearchDBPad`。
4. 页脚显示 `SearchDBPad`。
5. `package.json` 中产品名、安装快捷方式名、打包产物名均为 `SearchDBPad`。
6. README 英文和中文首页不再使用比较式介绍。
7. README 明确当前版本聚焦 Elasticsearch。
8. README 明确长期目标支持 Solr 等主流搜索引擎。
9. `CLAUDE.md` 中项目介绍与新定位一致。
10. `ES_DESKTOP_CLIENT_PLAN.md` 中项目定位与新方向一致。
11. 没有新增依赖。
12. 没有修改现有业务逻辑。
13. TypeScript 类型检查通过。

## 11. 建议验证命令

```bash
npm run typecheck
npm run build
```

如果只想快速验证文案搜索，可使用项目搜索工具检查以下关键词：

```txt
ES Desktop Client
Navicat
对标
类似
```

## 12. 后续可选改造，不属于本次

等本次品牌与定位调整完成后，后续可以单独规划多搜索引擎架构阶段：

1. 在连接配置中增加搜索引擎类型字段，例如 `engine: 'elasticsearch' | 'solr'`。
2. 抽象搜索引擎 provider 接口。
3. 将现有 Elasticsearch 调用封装为第一个 provider。
4. 设计 Solr provider。
5. 根据不同搜索引擎能力决定 UI 显示项，例如 ES 的 Mapping、Solr 的 Collection / Schema 等。

这些内容需要单独评估，不应混入本次品牌与文案升级。
