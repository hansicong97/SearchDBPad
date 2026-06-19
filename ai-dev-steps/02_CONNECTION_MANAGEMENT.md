# 阶段 2：连接管理

> ✅ **状态：已完成**  
> 完成日期：2026-06-18  
> 实现要点：`EsConnection` / `EsConnectionInput` / `ConnectionTestResult` / `ApiResponse` 类型与 5 个 IPC channel；主进程 `connectionStore`（electron-store 8.x）+ `connection.service`（CRUD + Node 内置 `fetch` 并行探测 `/` 与 `/_cluster/health`）；preload 暴露 `esApi.connections.*`；渲染端 Zustand store + `ConnectionList` / `ConnectionForm` / `ConnectionPage`；增删改测试全链路接通，本地持久化通过用户验证。代码审查 4 项建议已修复（删除死代码、合并 import、`bodyStyle` → `styles.body`、`test()` 改为可辨识联合返回值解耦副作用）。

## 本阶段目标

实现 Elasticsearch 连接配置的新增、编辑、删除、保存和测试连接。

本阶段只做连接管理，不做索引列表、查询、导入导出。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 2：连接管理】。

目标：
实现 Elasticsearch 连接配置的新增、编辑、删除、保存和测试连接。

要求：
1. 按文档中的 EsConnection 类型设计。
2. 使用 electron-store 保存连接配置。
3. 渲染进程不能直接访问 Elasticsearch。
4. 通过 Electron IPC 调用主进程能力。
5. 支持无认证和 Basic Auth。
6. 支持测试连接。
7. Basic Auth 模式下用户名不能为空。
8. ES 地址必须以 http:// 或 https:// 开头。
9. 不要实现索引列表、文档查询等后续功能。
10. 完成后告诉我如何验证连接管理功能。

请先说明实现方案和文件改动，再开始写代码。
```

## 类型定义

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

## 需要实现的功能

```text
1. 连接列表
2. 新增连接
3. 编辑连接
4. 删除连接
5. 测试连接
6. 本地持久化保存
7. 重启应用后仍可读取连接
```

## 推荐 IPC 接口

```text
connection:list
connection:create
connection:update
connection:delete
connection:test
```

## 测试连接 API

```http
GET /
GET /_cluster/health
```

## UI 要求

连接表单字段：

```text
连接名称
Elasticsearch 地址
认证方式：无认证 / Basic Auth
用户名
密码
```

## 本阶段验收标准

```text
1. 能新增连接。
2. 能编辑连接。
3. 能删除连接。
4. 能测试连接。
5. 能保存连接到本地。
6. 重启应用后连接仍然存在。
7. 测试失败时有明确错误提示。
8. 未实现索引列表、文档查询等后续功能。
```

## 完成后让 AI 自查

```text
请检查阶段 2 是否完成：
1. 连接数据是否持久化？
2. 测试连接是否通过主进程执行？
3. 渲染进程是否没有直接访问 Elasticsearch？
4. 表单校验是否完整？
5. 是否误实现了阶段 3 之后的功能？
```
