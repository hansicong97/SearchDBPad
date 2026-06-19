# 阶段 5：文档查询和 DSL 查询

> ✅ 状态：**已完成**
>
> 完成时间：2026-06-18
>
> 实现摘要：
> - 主进程：`src/main/services/document.service.ts` 新增 `searchDocuments`（`POST /{index}/_search`，转发调用方传入的 DSL body），复用 `index.service.ts` 的 `describeIndexError` 把 404 / 400 转为可读消息；`hits.total` 同时支持 `number`（旧版）和 `{ value, relation }`（ES 7+），`totalRelation` 一并返回给前端。
> - IPC：`src/shared/ipc.ts` 新增 `document:search` 通道及 `DocumentSearchRequest` / `DocumentHit` / `DocumentSearchResult` 类型；`src/main/index.ts` 注册 handler；`src/preload/index.ts` 暴露 `esApi.documents.search`。
> - 状态：`src/renderer/stores/workspace.store.ts` 新增 `documentHits` / `documentTotal` / `documentTotalRelation` / `documentTook` / `documentPage` / `documentPageSize` + `dslResults` / `dslLoading` / `dslError` 状态，以及 `setDocumentPage` / `setDocumentPageSize` / `fetchDocumentPage` / `refreshDocumentPage` / `runDslQuery` action。切换连接 / 切换选中索引时统一清空。`fetchDocumentPage` / `runDslQuery` 在写入前校验 `selectedIndex` + `(page, pageSize)` 未变更，避免竞态覆盖。
> - UI：`src/renderer/components/IndexDetailPanel.tsx` 在 Mapping / Settings 之上新增 **文档** + **查询** 两个 Tab；`src/renderer/components/DocumentPanel.tsx` 提供分页表格（_id / _score / _source，每页 10/20/50/100，`totalRelation === 'gte'` 时显示 ≥ 前缀）、刷新按钮；`src/renderer/components/DslQueryPanel.tsx` 提供 Monaco JSON 编辑器 + 格式化 + 执行（JSON 不合法时按钮禁用）+ 校验错误 Alert + took / total / hits 结果区 + 「查看原始响应」折叠面板（复用 `JsonView`）。
> - Monaco 集成：新增 `src/renderer/components/monacoEnv.ts`，用 Vite 的 `?worker` 后缀分别打包 `editor.worker` + `json.worker`，通过 `window.MonacoEnvironment.getWorker` 路由；用 `loader.config({ monaco })` 走本地 `monaco-editor`，**不联网拉 CDN**。运行时打包相关（`extraResources` / `asarUnpack` 等）属于 phase 10 范围。
> - 依赖：`monaco-editor@^0.52.0` + `@monaco-editor/react@^4.6.0` 已加入 `dependencies`（需要在打包阶段保留这些资源到产物中，已在 `05` 完成说明里记录）。
> - 不在本阶段实现：文档 CRUD / 导入 / 导出 / 简单查询表单。

## 本阶段目标

支持索引文档分页浏览和 DSL 查询。

本阶段不实现新增、编辑、删除文档，也不实现导入导出。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 5：文档查询】。

目标：
支持索引文档分页浏览和 DSL 查询。

要求：
1. 实现 document:search IPC。
2. 默认查询 match_all。
3. 默认每页 20 条。
4. 展示 _id 和 _source。
5. 支持分页。
6. 支持刷新。
7. 集成 Monaco Editor。
8. 支持 DSL JSON 格式化和校验。
9. 展示 took、total、hits。
10. 查询失败时显示 ES 错误信息。
11. 不要实现新增、编辑、删除文档。
12. 不要实现导入导出。

请先给出实现方案，再修改代码。
```

## 默认查询 DSL

```json
{
  "query": {
    "match_all": {}
  },
  "from": 0,
  "size": 20
}
```

## 需要调用的 ES API

```http
POST /{index}/_search
```

## 推荐 IPC 接口

```text
document:search
```

## 结果展示字段

```text
_id
_score
_source
```

## DSL 查询面板要求

```text
1. JSON 编辑器。
2. 格式化按钮。
3. 执行查询按钮。
4. 查询耗时 took。
5. 命中总数 total。
6. 查询结果表格。
7. 原始响应查看，可选。
```

## 本阶段验收标准

```text
1. 点击文档 Tab 后能默认查询数据。
2. 能看到 _id 和 _source。
3. 能分页。
4. 能刷新。
5. 能手写 DSL 查询。
6. JSON 不合法时不能提交。
7. ES 查询错误时显示错误信息。
8. 未实现新增、编辑、删除文档。
```

## 完成后让 AI 自查

```text
请检查阶段 5 是否完成：
1. 默认 match_all 查询是否可用？
2. 分页参数 from/size 是否正确？
3. DSL 编辑器是否能校验 JSON？
4. 查询结果是否显示 took、total、hits？
5. 是否误实现了文档 CRUD 或导入导出？
```
