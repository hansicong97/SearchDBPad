# 阶段 3：集群信息和索引列表

> ✅ 状态：**已完成**
>
> 完成时间：2026-06-18
>
> 实现摘要：
> - 主进程：`src/main/services/esClient.ts`（连接解析 + ES 客户端构建）、`src/main/services/cluster.service.ts`（`GET /` 与 `GET /_cluster/health`）、`src/main/services/index.service.ts`（`GET /_cat/indices?format=json&bytes=b`）。
> - 渲染层：`src/renderer/stores/workspace.store.ts`、`src/renderer/components/AppSidebar.tsx`（左侧边栏）、`src/renderer/components/ClusterInfoCard.tsx`、`src/renderer/components/IndexList.tsx`、`src/renderer/pages/WorkspacePage.tsx`。
> - IPC：`src/shared/ipc.ts` 新增 `cluster:info` / `cluster:health` / `index:list` 三个通道及对应类型；`src/main/index.ts` 注册 handler；`src/preload/index.ts` 暴露 `esApi.cluster.*` 与 `esApi.indices.list`。
> - 新增依赖：`@elastic/elasticsearch ^8.15.0`（用户已确认）。
> - 搜索仅在前端基于 `useMemo` 过滤已获取的索引列表，不发起新的 IPC 请求。
> - 不在本阶段实现：Mapping / Settings、文档查询、文档 CRUD、导入导出。

## 本阶段目标

连接 Elasticsearch 后显示集群基础信息和索引列表。

本阶段不实现 Mapping、Settings、文档查询、导入导出。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 3：集群信息和索引列表】。

目标：
连接 Elasticsearch 后显示集群基础信息和索引列表。

要求：
1. 使用 @elastic/elasticsearch 客户端。
2. 实现获取集群信息。
3. 实现获取集群健康状态。
4. 实现获取索引列表。
5. 索引列表显示：
   - 索引名
   - 健康状态
   - 状态
   - 文档数
   - 存储大小
   - 主分片
   - 副本
6. 支持刷新索引列表。
7. 支持按索引名搜索。
8. 不要实现 Mapping、Settings、文档查询等后续功能。

请先给出实现计划，再修改代码。
```

## 需要调用的 ES API

```http
GET /
GET /_cluster/health
GET /_cat/indices?format=json&bytes=b
```

## 推荐 IPC 接口

```text
cluster:info
cluster:health
index:list
```

## 集群信息字段

```text
集群名称
ES 版本
集群健康状态
节点数量
索引数量
```

## 索引列表字段

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

## 本阶段验收标准

```text
1. 进入工作台后能看到当前连接名称。
2. 能显示 ES 版本。
3. 能显示集群健康状态。
4. 能显示索引数量。
5. 能看到索引列表。
6. 能搜索索引。
7. 能刷新索引列表。
8. 未实现 Mapping、Settings、文档查询等后续功能。
```

## 完成后让 AI 自查

```text
请检查阶段 3 是否完成：
1. 集群信息是否正确显示？
2. 索引列表字段是否完整？
3. 刷新是否可用？
4. 搜索是否只在前端过滤？
5. 是否误实现了阶段 4 之后的功能？
```
