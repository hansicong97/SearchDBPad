# Elasticsearch 桌面管理工具开发计划

## 1. 项目目标

本项目计划开发一个类似 **Navicat 之于 MySQL** 的 Elasticsearch 操作软件，第一阶段以简单、实用、可迭代为目标。

核心目标：

- 支持连接 Elasticsearch 集群
- 支持查看索引列表
- 支持查看索引 Mapping 和 Settings
- 支持简单查询和 DSL 查询
- 支持新增、编辑、删除文档
- 支持 JSON / NDJSON / CSV 导入导出
- 优先做 Windows 桌面客户端
- 技术栈尽量选择 Node.js / Java / Go 中适合 AI 辅助开发的方案

第一版不追求替代 Kibana，而是做一个轻量、直观、开发者友好的 Elasticsearch 数据操作工具。

---

## 2. 产品定位

产品定位：

> 一个面向开发者、测试人员、数据处理人员的 Elasticsearch 桌面管理工具，用于完成日常连接管理、索引浏览、数据查询、文档维护和数据导入导出。

类似产品参考：

- Navicat for MySQL
- RedisInsight
- MongoDB Compass
- Postman
- Kibana Dev Tools

本项目第一阶段重点不做复杂集群运维，而是聚焦数据操作。

---

## 3. 推荐技术选型

### 3.1 最终推荐方案

推荐使用：

```text
Electron + React + TypeScript + Node.js
```

### 3.2 技术栈明细

| 模块 | 推荐技术 |
|---|---|
| 桌面应用框架 | Electron |
| 前端框架 | React |
| 开发语言 | TypeScript |
| 构建工具 | Vite |
| UI 组件库 | Ant Design |
| 状态管理 | Zustand |
| ES 客户端 | @elastic/elasticsearch |
| JSON 编辑器 | Monaco Editor |
| 表格组件 | Ant Design Table / TanStack Table |
| 本地配置存储 | electron-store |
| 本地数据存储 | SQLite，可后续引入 |
| 文件选择和保存 | Electron Dialog API |
| 应用打包 | electron-builder |
| CSV 解析 | papaparse 或 csv-parse |
| NDJSON 处理 | Node.js fs / readline |

### 3.3 为什么选择 Electron + Node.js

优点：

- Windows 桌面端支持成熟
- Node.js 直接调用 Elasticsearch 官方客户端
- React + Ant Design 可以快速实现管理后台式 UI
- TypeScript 对 AI 生成代码友好
- 前后端都使用同一种语言，降低项目复杂度
- 文件导入导出、系统弹窗、本地配置保存都比较方便
- 后续可以打包成 `.exe` 安装包

### 3.4 暂不推荐浏览器插件作为第一版

浏览器插件问题：

- 跨域限制较多
- 访问内网 Elasticsearch 可能麻烦
- 文件导入导出体验较差
- 后续扩展 SSH 隧道、证书、本地任务管理不方便

结论：

> 第一版优先做 Windows 桌面客户端，不建议先做浏览器插件。

### 3.5 Java / Go 的取舍

#### Java

优点：

- 后端生态成熟
- Elasticsearch Java Client 成熟

缺点：

- 桌面 UI 开发成本较高
- JavaFX / Swing 现代化体验不如 Electron
- AI 辅助前端界面生成不如 React 方便

#### Go

优点：

- 性能好
- 单文件部署方便
- 适合后续做高性能导入导出模块

缺点：

- 桌面 UI 生态不如 Electron
- 第一版开发体验不如 Node.js 快

结论：

> MVP 阶段使用 Node.js 更合适。Go 可以作为后续大批量导入导出引擎的候选方案。

---

## 4. MVP 范围

第一版 MVP 只做基础可用功能。

### 4.1 MVP 必做功能

```text
1. 连接管理
2. 测试连接
3. 查看集群基础信息
4. 查看索引列表
5. 查看 Mapping
6. 查看 Settings
7. 文档分页查询
8. 简单条件查询
9. DSL 查询
10. 新建文档
11. 编辑文档
12. 删除文档
13. JSON 导出
14. NDJSON 导入
15. CSV 导入导出，可放在 MVP 后半段
```

### 4.2 第一版暂不做功能

```text
1. 用户权限系统
2. 云同步
3. 多人协作
4. 插件市场
5. SQL 转 DSL
6. 复杂图表分析
7. Watcher 管理
8. ILM 管理
9. Snapshot 管理
10. 复杂大数据量导出
11. SSH 隧道
12. Kibana 完整替代能力
13. 自动 Mapping 推断
14. 多集群数据同步
```

---

## 5. 应用整体结构

### 5.1 页面结构

```text
App
├── 连接管理页
│   ├── 连接列表
│   ├── 新建连接弹窗
│   ├── 编辑连接弹窗
│   └── 测试连接结果提示
│
├── 主工作台
│   ├── 顶部工具栏
│   ├── 左侧索引树 / 索引列表
│   └── 右侧内容区
│
├── 索引详情页
│   ├── 文档 Tab
│   ├── 查询 Tab
│   ├── Mapping Tab
│   ├── Settings Tab
│   ├── 导入 Tab
│   └── 导出 Tab
│
├── 文档编辑弹窗
│   ├── JSON 编辑器
│   ├── 格式化按钮
│   └── 保存按钮
│
└── 全局设置页
    ├── 主题设置
    ├── 默认分页大小
    └── 导出限制设置
```

### 5.2 推荐目录结构

```text
es-desktop-client/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── electron-builder.json
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/
│   │   │   ├── connection.ipc.ts
│   │   │   ├── index.ipc.ts
│   │   │   ├── document.ipc.ts
│   │   │   ├── import.ipc.ts
│   │   │   └── export.ipc.ts
│   │   ├── services/
│   │   │   ├── esClient.service.ts
│   │   │   ├── connection.service.ts
│   │   │   ├── index.service.ts
│   │   │   ├── document.service.ts
│   │   │   ├── import.service.ts
│   │   │   └── export.service.ts
│   │   └── store/
│   │       └── localStore.ts
│   │
│   ├── preload/
│   │   └── index.ts
│   │
│   └── renderer/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   └── index.tsx
│       ├── pages/
│       │   ├── ConnectionPage.tsx
│       │   ├── WorkspacePage.tsx
│       │   └── SettingsPage.tsx
│       ├── components/
│       │   ├── ConnectionForm.tsx
│       │   ├── IndexList.tsx
│       │   ├── DocumentTable.tsx
│       │   ├── JsonEditor.tsx
│       │   ├── DslQueryPanel.tsx
│       │   ├── ImportPanel.tsx
│       │   └── ExportPanel.tsx
│       ├── stores/
│       │   ├── connection.store.ts
│       │   ├── workspace.store.ts
│       │   └── settings.store.ts
│       ├── types/
│       │   ├── connection.ts
│       │   ├── index.ts
│       │   ├── document.ts
│       │   └── api.ts
│       └── utils/
│           ├── json.ts
│           ├── file.ts
│           └── format.ts
```

---

## 6. 核心数据模型

### 6.1 ES 连接配置

```ts
export interface EsConnection {
  id: string
  name: string
  url: string
  authType: 'none' | 'basic'
  username?: string
  password?: string
  createdAt: string
  updatedAt: string
}
```

说明：

- `id` 使用 UUID
- `name` 为用户自定义连接名称
- `url` 示例：`http://localhost:9200`
- MVP 只支持 `none` 和 `basic`
- 密码第一版可以先存本地，后续再考虑加密

### 6.2 集群信息

```ts
export interface EsClusterInfo {
  clusterName: string
  clusterUuid: string
  version: string
  tagline?: string
  health?: 'green' | 'yellow' | 'red' | 'unknown'
  nodeCount?: number
  indexCount?: number
}
```

### 6.3 索引信息

```ts
export interface EsIndexInfo {
  index: string
  health: 'green' | 'yellow' | 'red' | string
  status: 'open' | 'close' | string
  docsCount: number
  docsDeleted: number
  storeSize: string
  pri: number
  rep: number
  uuid?: string
}
```

### 6.4 文档信息

```ts
export interface EsDocument {
  _index: string
  _id: string
  _score?: number
  _source: Record<string, unknown>
}
```

### 6.5 查询参数

```ts
export interface EsSearchParams {
  connectionId: string
  index: string
  query: Record<string, unknown>
  from: number
  size: number
}
```

### 6.6 查询结果

```ts
export interface EsSearchResult {
  took: number
  total: number
  hits: EsDocument[]
  raw: unknown
}
```

---

## 7. 功能详细清单

## 7.1 连接管理

### 功能说明

用户可以保存多个 Elasticsearch 连接，并选择其中一个连接进入工作台。

### 功能点

- 新建连接
- 编辑连接
- 删除连接
- 测试连接
- 保存连接到本地
- 进入连接工作台
- 显示连接状态

### 表单字段

```text
连接名称
Elasticsearch 地址
认证方式：无认证 / Basic Auth
用户名
密码
```

### 校验规则

- 连接名称不能为空
- ES 地址不能为空
- ES 地址必须以 `http://` 或 `https://` 开头
- Basic Auth 模式下用户名不能为空

### 测试连接 API

```http
GET /
GET /_cluster/health
```

### 成功标准

- 用户能新增一个连接
- 用户能点击测试连接并看到成功或失败提示
- 用户能保存连接
- 重启应用后连接仍然存在
- 用户能删除连接

---

## 7.2 工作台首页

### 功能说明

用户选择连接后进入工作台，查看集群基础状态。

### 显示信息

```text
连接名称
集群名称
ES 版本
集群健康状态
节点数量
索引数量
```

### 需要调用的 API

```http
GET /
GET /_cluster/health
GET /_cat/indices?format=json
```

### 成功标准

- 能显示当前连接名称
- 能显示 ES 版本
- 能显示集群健康状态
- 能显示索引数量

---

## 7.3 索引列表

### 功能说明

展示当前连接下的全部索引，类似数据库管理工具中的表列表。

### 功能点

- 加载索引列表
- 刷新索引列表
- 搜索索引名称
- 点击索引进入详情
- 显示索引状态

### 列表字段

```text
索引名
健康状态
状态
文档数
删除文档数
存储大小
主分片数量
副本数量
```

### API

```http
GET /_cat/indices?format=json&bytes=b
```

### 成功标准

- 能看到所有��引
- 能按名称搜索索引
- 能刷新索引列表
- 点击索引后能进入索引详情区域

---

## 7.4 索引 Mapping 查看

### 功能说明

查看索引字段定义。

### 功能点

- 展示原始 Mapping JSON
- 支持 JSON 格式化
- 支持复制 Mapping
- 支持折叠查看

### API

```http
GET /{index}/_mapping
```

### 成功标准

- 点击 Mapping Tab 能看到完整 Mapping
- Mapping JSON 格式清晰
- 查询失败时显示错误信息

---

## 7.5 索引 Settings 查看

### 功能说明

查看索引配置。

### 功能点

- 展示原始 Settings JSON
- 支持 JSON 格式化
- 支持复制 Settings

### API

```http
GET /{index}/_settings
```

### 成功标准

- 点击 Settings Tab 能看到完整 Settings
- Settings JSON 格式清晰

---

## 7.6 文档分页查询

### 功能说明

类似数据库表数据浏览，展示某个索引中的文档。

### 功能点

- 默认加载前 20 条文档
- 支持分页
- 支持调整每页数量
- 支持刷新
- 显示 `_id`
- 显示 `_source` 摘要
- 点击行查看完整 JSON

### 默认 DSL

```json
{
  "query": {
    "match_all": {}
  },
  "from": 0,
  "size": 20
}
```

### API

```http
POST /{index}/_search
```

### 成功标准

- 点击文档 Tab 后自动查询文档
- 能看到 `_id` 和 `_source`
- 能翻页
- 能查看单条文档完整 JSON

---

## 7.7 简单查询

### 功能说明

给不熟悉 DSL 的用户提供表单式查询。

### 查询字段

```text
字段名
操作符
查询值
每页数量
```

### 操作符

| 操作符 | ES DSL 类型 |
|---|---|
| 等于 | term |
| 包含 | match |
| 大于 | range gt |
| 大于等于 | range gte |
| 小于 | range lt |
| 小于等于 | range lte |
| 存在 | exists |

### 示例 1：包含查询

用户输入：

```text
字段名：username
操作符：包含
查询值：张三
```

生成 DSL：

```json
{
  "query": {
    "match": {
      "username": "张三"
    }
  }
}
```

### 示例 2：范围查询

用户输入：

```text
字段名：age
操作符：大于等于
查询值：18
```

生成 DSL：

```json
{
  "query": {
    "range": {
      "age": {
        "gte": 18
      }
    }
  }
}
```

### 成功标准

- 用户可以通过表单生成查询
- 点击查询后能看到结果
- 查询错误时能看到错误提示

---

## 7.8 DSL 查询

### 功能说明

给熟悉 Elasticsearch 的用户提供原始 DSL 查询能力。

### 功能点

- JSON 编辑器
- 格式化 JSON
- 校验 JSON
- 执行查询
- 展示结果
- 展示耗时
- 展示命中数量
- 展示原始响应

### 默认内容

```json
{
  "query": {
    "match_all": {}
  },
  "size": 20
}
```

### API

```http
POST /{index}/_search
```

### 成功标准

- 能输入合法 JSON DSL
- 能执行查询
- 能展示 hits
- JSON 不合法时不能提交，并显示错误
- ES 返回错误时能显示错误详情

---

## 7.9 新建文档

### 功能说明

向指定索引新增一条文档。

### 功能点

- 选择索引
- 输入 `_id`，可选
- 输入 JSON 文档
- 格式化 JSON
- 校验 JSON
- 提交新增

### API

指定 ID：

```http
PUT /{index}/_doc/{id}
```

不指定 ID：

```http
POST /{index}/_doc
```

### 示例文档

```json
{
  "name": "张三",
  "age": 18,
  "city": "上海"
}
```

### 成功标准

- JSON 合法时可以提交
- 提交成功后提示新增成功
- 新增后刷新文档列表能看到新数据

---

## 7.10 编辑文档

### 功能说明

编辑已有文档的 `_source` 内容。

### 功能点

- 从文档列表打开编辑弹窗
- 显示完整 JSON
- 修改 JSON
- 格式化 JSON
- 保存修改

### API

```http
PUT /{index}/_doc/{id}
```

### 成功标准

- 能打开已有文档
- 能修改 JSON
- 保存后 ES 中数据被更新
- 保存后刷新列表

---

## 7.11 删除文档

### 功能说明

删除指定索引中的单条文档。

### 功能点

- 文档列表中提供删除按钮
- 删除前弹出确认框
- 用户确认后删除
- 删除后刷新列表

### API

```http
DELETE /{index}/_doc/{id}
```

### 成功标准

- 删除前必须确认
- 删除成功后列表刷新
- 删除失败时显示错误原因

---

## 7.12 新建索引

### 功能说明

创建新的 Elasticsearch 索引。

### MVP 功能点

- 输入索引名
- 可选输入 Settings JSON
- 可选输入 Mapping JSON
- 创建索引

### 最简 API

```http
PUT /{index}
```

### 高级请求体示例

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "name": {
        "type": "text"
      },
      "age": {
        "type": "integer"
      }
    }
  }
}
```

### 成功标准

- 能创建空索引
- 能创建带 Mapping 的索引
- 创建成功后索引列表刷新

---

## 7.13 JSON 导出

### 功能说明

将当前索引或当前查询结果导出为 JSON 文件。

### 导出范围

```text
1. 当前查询结果
2. 当前索引前 N 条数据
3. 指定 DSL 查询结果
```

### MVP 限制

第一版建议限制：

```text
最多导出 10000 条
```

后续再支持 Scroll / Search After 大批量导出。

### 导出 JSON 示例

```json
[
  {
    "_id": "1",
    "_source": {
      "name": "张三",
      "age": 18
    }
  },
  {
    "_id": "2",
    "_source": {
      "name": "李四",
      "age": 20
    }
  }
]
```

### 成功标准

- 能选择导出路径
- 能导出 JSON 文件
- 文件内容可以正常打开
- 导出失败时显示错误信息

---

## 7.14 NDJSON 导出

### 功能说明

导出 Elasticsearch Bulk API 兼容的 NDJSON 文件。

### 导出格式

```json
{"index":{"_index":"users","_id":"1"}}
{"name":"张三","age":18}
{"index":{"_index":"users","_id":"2"}}
{"name":"李四","age":20}
```

### 成功标准

- 能导出 `.ndjson` 文件
- 文件可用于后续 Bulk 导入

---

## 7.15 CSV 导出

### 功能说明

将查询结果中的 `_source` 展平后导出为 CSV。

### MVP 规则

- 只处理 `_source` 第一层字段
- 嵌套对象转成 JSON 字符串
- 数组转成 JSON 字符串

### 示例

源数据：

```json
{
  "name": "张三",
  "age": 18,
  "tags": ["a", "b"],
  "address": {
    "city": "上海"
  }
}
```

CSV：

```csv
name,age,tags,address
张三,18,"[\"a\",\"b\"]","{\"city\":\"上海\"}"
```

### 成功标准

- 能导出 CSV 文件
- Excel 或文本编辑器可打开
- 中文不乱码

---

## 7.16 NDJSON 导入

### 功能说明

从 NDJSON 文件批量导入数据。

### 功能点

- 选择目标索引
- 选择 `.ndjson` 文件
- 预览前 10 条
- 使用 Bulk API 写入
- 显示成功数量
- 显示失败数量
- 显示失败详情

### 支持格式 1：Bulk 格式

```json
{"index":{"_index":"users","_id":"1"}}
{"name":"张三","age":18}
```

### 支持格式 2：纯文档格式

```json
{"name":"张三","age":18}
{"name":"李四","age":20}
```

纯文档格式导入时，目标索引由用户选择，ID 自动生成。

### API

```http
POST /_bulk
```

### 成功标准

- 能读取 NDJSON 文件
- 能预览数据
- 能批量写入 ES
- 能展示导入结果

---

## 7.17 JSON 导入

### 功能说明

从 JSON 文件导入数据。

### 支持格式

数组格式：

```json
[
  {
    "name": "张三",
    "age": 18
  },
  {
    "name": "李四",
    "age": 20
  }
]
```

带 `_id` 格式：

```json
[
  {
    "_id": "1",
    "_source": {
      "name": "张三",
      "age": 18
    }
  }
]
```

### 成功标准

- 能解析 JSON 数组
- 能预览前 10 条
- 能使用 Bulk API 写入
- 能显示成功和失败数量

---

## 7.18 CSV 导入

### 功能说明

从 CSV 文件导入数据。

### MVP 规则

- 第一行作为字段名
- 每一行转换成一个 JSON 文档
- 所有值默认按字符串处理
- 后续再支持字段类型转换

### 示例 CSV

```csv
name,age,city
张三,18,上海
李四,20,北京
```

转换为：

```json
{
  "name": "张三",
  "age": "18",
  "city": "上海"
}
```

### 成功标准

- 能选择 CSV 文件
- 能预览前 10 条
- 能导入目标索引
- 中文不乱码

---

## 8. Electron IPC 设计

渲染进程不直接访问 Elasticsearch，统一通过 Electron 主进程处理。

### 8.1 IPC 接口清单

```ts
// 连接
connection:list
connection:create
connection:update
connection:delete
connection:test

// 集群
cluster:info
cluster:health

// 索引
index:list
index:create
index:mapping
index:settings

// 文档
document:search
document:create
document:update
document:delete

// 导入导出
import:preview
import:execute
export:execute
```

### 8.2 IPC 返回格式

统一返回结构：

```ts
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    message: string
    detail?: unknown
  }
}
```

### 8.3 示例

```ts
const result = await window.esApi.searchDocuments({
  connectionId: 'xxx',
  index: 'users',
  query: {
    query: {
      match_all: {}
    },
    size: 20
  }
})
```

---

## 9. Elasticsearch API 清单

### 9.1 基础信息

```http
GET /
GET /_cluster/health
```

### 9.2 索引

```http
GET /_cat/indices?format=json
PUT /{index}
GET /{index}/_mapping
GET /{index}/_settings
DELETE /{index}
```

MVP 中删除索引可以暂不开放，避免误操作。

### 9.3 文档

```http
POST /{index}/_search
POST /{index}/_doc
PUT /{index}/_doc/{id}
DELETE /{index}/_doc/{id}
```

### 9.4 批量导入

```http
POST /_bulk
```

---

## 10. UI 设计建议

### 10.1 整体布局

建议使用经典管理工具布局：

```text
顶部：当前连接、刷新按钮、设置入口
左侧：索引列表
右侧：索引详情 / 查询 / 文档表格
底部：状态栏，可显示请求耗时和错误信息
```

### 10.2 视觉风格

- 简洁
- 类似数据库客户端
- 信息密度适中
- 优先支持浅色主题
- 后续支持深色主题

### 10.3 关键组件

```text
ConnectionForm       连接表单
IndexList            索引列表
IndexDetailTabs      索引详情 Tab
DocumentTable        文档表格
JsonEditor           JSON 编辑器
DslQueryPanel        DSL 查询面板
SimpleQueryForm      简单查询表单
ImportPanel          导入面板
ExportPanel          导出面板
```

---

## 11. 开发阶段规划

> **阶段状态约定**：每个阶段完成后，会在其对应的 `ai-dev-steps/NN_*.md` 文档顶部标注 `✅ 已完成`，同时在本节相应阶段标题下方同步该标记。`未开始` / `进行中` 的阶段无标记。

## 阶段 1：项目初始化

### 目标

搭建 Electron + React + TypeScript 基础项目。

### 任务清单

```text
1. 初始化 Vite + React + TypeScript 项目
2. 集成 Electron
3. 配置主进程、预加载进程、渲染进程
4. 集成 Ant Design
5. 集成 Zustand
6. 配置路径别名
7. 配置 ESLint / Prettier，可选
8. 配置 electron-builder
9. 实现基础窗口启动
10. 实现基础布局
```

### 验收标准

- 能启动桌面应用
- 能看到基础页面
- 主进程和渲染进程能通过 IPC 通信

---

## 阶段 2：连接管理

### 目标

实现本地连接配置的增删改查和测试连接。

### 任务清单

```text
1. 定义 EsConnection 类型
2. 封装 electron-store
3. 实现连接列表读取
4. 实现新增连接
5. 实现编辑连接
6. 实现删除连接
7. 实现测试连接
8. 实现连接管理页面
9. 实现连接表单弹窗
10. 实现连接成功后进入工作台
```

### 验收标准

- 能新增连接
- 能测试连接
- 能保存连接
- 重启应用后连接仍存在
- 能删除连接

---

## 阶段 3：集群信息和索引列表

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/03_CLUSTER_AND_INDEX_LIST.md`

### 目标

连接 ES 后显示集群基础信息和索引列表。

### 任务清单

```text
1. 封装 Elasticsearch Client 创建逻辑
2. 实现获取集群基础信息
3. 实现获取集群健康状态
4. 实现获取索引列表
5. 实现工作台页面
6. 实现左侧索引列表
7. 实现索引搜索
8. 实现刷新索引
```

### 验收标准

- 进入工作台后能看到集群信息
- 能看到索引列表
- 能搜索索引
- 能刷新索引

---

## 阶段 4：索引详情

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/04_INDEX_DETAIL.md`

### 目标

支持查看 Mapping 和 Settings。

### 任务清单

```text
1. 实现索引详情 Tab
2. 实现 Mapping 查询接口
3. 实现 Settings 查询接口
4. 集成 JSON 展示组件
5. 支持 JSON 格式化
6. 支持复制 JSON
```

### 验收标准

- 点击索引后能查看 Mapping
- 点击索引后能查看 Settings
- JSON 展示清晰

---

## 阶段 5：文档查询

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/05_DOCUMENT_QUERY.md`

### 目标

支持文档分页浏览和 DSL 查询。

### 任务清单

```text
1. 实现文档查询 service
2. 实现 document:search IPC
3. 实现文档列表表格
4. 显示 _id 和 _source
5. 支持分页
6. 支持刷新
7. 实现查看完整文档弹窗
8. 集成 Monaco Editor
9. 实现 DSL 查询面板
10. 实现 JSON 校验和格式化
```

### 验收标准

- 能查看索引文档
- 能分页
- 能执行 DSL 查询
- 能查看查询耗时和总数

---

## 阶段 6：简单查询

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/06_SIMPLE_QUERY.md`

### 目标

提供表单式查询，自动生成 DSL。

### 任务清单

```text
1. 实现 SimpleQueryForm 组件
2. 支持字段名输入
3. 支持操作符选择
4. 支持查询值输入
5. 实现 term DSL 生成
6. 实现 match DSL 生成
7. 实现 range DSL 生成
8. 实现 exists DSL 生成
9. 查询结果复用文档表格展示
```

### 验收标准

- 能通过表单查询文档
- 不需要手写 DSL 也能查询

---

## 阶段 7：文档新增、编辑、删除

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/07_DOCUMENT_CRUD.md`

### 目标

支持基础文档维护。

### 任务清单

```text
1. 实现新建文档弹窗
2. 实现 JSON 校验
3. 实现 document:create IPC
4. 实现编辑文档弹窗
5. 实现 document:update IPC
6. 实现删除确认框
7. 实现 document:delete IPC
8. 操作成功后刷新列表
```

### 验收标准

- 能新增文档
- 能编辑文档
- 能删除文档
- 删除前有确认

---

## 阶段 8：导出功能

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/08_EXPORT.md`

### 目标

支持将查询结果导出为 JSON / NDJSON / CSV。

### 任务清单

```text
1. 实现导出面板
2. 支持选择导出格式
3. 支持选择导出范围
4. 支持设置最大导出数量
5. 实现 JSON 导出
6. 实现 NDJSON 导出
7. 实现 CSV 导出
8. 调用系统保存文件弹窗
9. 导出完成后提示文件路径
```

### 验收标准

- 能导出 JSON
- 能导出 NDJSON
- 能导出 CSV
- 导出文件内容正确

---

## 阶段 9：导入功能

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/09_IMPORT.md`

### 目标

支持 JSON / NDJSON / CSV 文件导入。

### 任务清单

```text
1. 实现导入面板
2. 支持选择目标索引
3. 支持选择文件
4. 实现 NDJSON 解析
5. 实现 JSON 解析
6. 实现 CSV 解析
7. 实现前 10 条预览
8. 实现 Bulk 请求构造
9. 实现导入执行
10. 显示成功数量、失败数量、失败详情
```

### 验收标准

- 能导入 NDJSON
- 能导入 JSON 数组
- 能导入 CSV
- 能看到导入结果

---

## 阶段 10：打包和发布

> ✅ 已完成（2026-06-18） — 详见 `ai-dev-steps/10_PACKAGE_RELEASE.md`

### 目标

打包 Windows 可执行安装包。

### 任务清单

```text
1. 配置应用名称
2. 配置应用图标
3. 配置 electron-builder
4. 生成 Windows 安装包
5. 生成便携版，可选
6. 测试安装后运行
7. 测试配置保存路径
8. 测试卸载
```

### 验收标准

- 能生成 `.exe` 安装包
- 安装后能正常启动
- 基础功能可用

---

## 12. 错误处理规范

### 12.1 前端显示原则

- 用户输入错误：直接在表单附近提示
- ES 请求失败：弹窗或消息提示错误摘要
- JSON 格式错误：编辑器下方提示
- 导入失败：展示失败行数和失败详情
- 导出失败：提示失败原因

### 12.2 常见错误

```text
1. ES 地址不可访问
2. 用户名密码错误
3. 索引不存在
4. JSON 格式错误
5. DSL 查询语法错误
6. Bulk 导入部分失败
7. 文件读取失败
8. 文件写入失败
```

### 12.3 错误返回格式

```ts
export interface AppError {
  message: string
  detail?: unknown
  code?: string
}
```

---

## 13. 安全注意事项

### 13.1 连接密码保存

MVP 可以先使用本地存储，但需要注意：

- 不要把密码打印到日志
- 不要在错误信息中显示密码
- UI 中密码默认隐藏
- 后续可以使用系统密钥链保存密码

可选后续方案：

- Windows Credential Manager
- keytar

### 13.2 Electron 安全配置

建议：

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  preload: preloadPath
}
```

渲染进程不要直接使用 Node.js API，统一通过 preload 暴露安全接口。

---

## 14. 性能和限制

### 14.1 MVP 限制

```text
1. 默认每页 20 条
2. 单次查询最大 1000 条
3. 导出最大 10000 条
4. 导入文件建议小于 100MB
5. CSV 只处理第一层字段
6. 不处理超复杂嵌套数据编辑体验
```

### 14.2 后续优化方向

```text
1. Search After 大数据分页
2. Scroll API 批量导出
3. 导入任务队列
4. 导入进度条
5. 大文件流式读取
6. Worker Thread 处理文件解析
7. 虚拟表格提升大数据展示性能
```

---

## 15. 后续版本规划

### V0.1 MVP

```text
连接管理
测试连接
索引列表
Mapping 查看
Settings 查看
文档分页查询
DSL 查询
新建文档
JSON 导出
NDJSON 导入
```

### V0.2 基础增强

```text
编辑文档
删除文档
简单查询表单
CSV 导入
CSV 导出
查询历史
```

### V0.3 实用增强

```text
多标签查询
收藏 DSL
字段列表浏览
Mapping 可视化
导入进度条
导出进度条
```

### V0.4 高级功能

```text
大批量导出
Search After 支持
Scroll 导出
Reindex 可视化
索引复制
AI 生成 DSL
```

### V1.0

```text
稳定 Windows 安装包
完善错误处理
完善导入导出
完整使用文档
基础 ES 数据管理闭环
```

---

## 16. AI 开发提示词模板

后续可以让 AI 按以下方式逐步实现。

### 16.1 初始化项目

```text
请基于 Electron + React + TypeScript + Vite + Ant Design 初始化一个 Windows 桌面客户端项目。
要求：
1. 使用 Electron 主进程、preload、renderer 三层结构。
2. 开启 contextIsolation，关闭 nodeIntegration。
3. 配置基础 IPC 示例。
4. 配置 Ant Design。
5. 给出完整目录结构和可运行代码。
```

### 16.2 实现连接管理

```text
请根据开发计划中的“连接管理”章节，实现 Elasticsearch 连接管理功能。
要求：
1. 支持新增、编辑、删除连接。
2. 使用 electron-store 保存连接配置。
3. 支持测试连接。
4. Basic Auth 模式支持用户名和密码。
5. 渲染进程通过 IPC 调用主进程，不直接访问 ES。
```

### 16.3 实现索引列表

```text
请根据开发计划中的“索引列表”章节，实现 Elasticsearch 索引列表功能。
要求：
1. 调用 _cat/indices API。
2. 展示索引名、健康状态、文档数、存储大小、主分片、副本。
3. 支持刷新。
4. 支持按索引名搜索。
5. 点击索引后进入详情页。
```

### 16.4 实现 DSL 查询

```text
请根据开发计划中的“DSL 查询”章节，实现 DSL 查询功能。
要求：
1. 使用 Monaco Editor 编辑 JSON DSL。
2. 支持 JSON 格式化和校验。
3. 调用 /{index}/_search。
4. 展示 took、total、hits。
5. 查询失败时显示 ES 返回的错误信息。
```

### 16.5 实现导入导出

```text
请根据开发计划中的“导入导出”章节，实现 JSON / NDJSON / CSV 的基础导入导出功能。
要求：
1. 导出支持当前查询结果。
2. JSON 导出为数组。
3. NDJSON 导出为 Bulk API 兼容格式。
4. CSV 导出只处理 _source 第一层字段。
5. 导入使用 Bulk API。
6. 导入前预览前 10 条。
7. 显示成功数量、失败数量和失败详情。
```

---

## 17. 最小可交付版本定义

如果只做最小可交付版本，必须包含：

```text
1. Windows 桌面应用可启动
2. 可新增 ES 连接
3. 可测试 ES 连接
4. 可查看索引列表
5. 可查看某个索引的文档
6. 可执行 DSL 查询
7. 可新增一条文档
8. 可导出当前查询结果为 JSON
9. 可从 NDJSON 导入数据
```

只要以上 9 点完成，就可以认为项目 V0.1 可用。

---

## 18. 推荐项目名称

可选名称：

```text
ElasticDesk
ESDesk
ElasticNav
SearchPilot
IndexPilot
ES Studio
```

推荐：

```text
ElasticDesk
```

原因：

- 表达清晰
- 符合桌面工具定位
- 容易记忆
- 后续扩展空间大

---

## 19. 总结

本项目建议采用：

```text
Electron + React + TypeScript + Node.js
```

第一版重点是：

```text
连接管理
索引浏览
DSL 查询
文档操作
导入导出
```

开发原则：

```text
先简单可用
再逐步增强
避免第一版做复杂集群管理
每个功能都要有明确验收标准
方便 AI 按清单逐步实现
```
