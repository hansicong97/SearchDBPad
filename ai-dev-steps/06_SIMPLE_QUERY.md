# 阶段 6：简单查询

> ✅ 状态：**已完成**
>
> 完成时间：2026-06-18
>
> 实现摘要：
> - DSL 生成：`src/renderer/utils/buildSimpleDsl.ts` 提供 `buildSimpleDsl(field, operator, value)` 与 `SIMPLE_OPERATORS` 元数据；7 个操作符映射见下表。`coerceSimpleValue` 把 `"18"`/`"true"`/`"null"` 转成原生类型（`term` 命中数值字段、`range` 数值比较靠它），`match` 始终是字符串，`exists` 不要求 value。
> - UI：新增 `src/renderer/components/SimpleQueryPanel.tsx`，用 Ant Design `Form` `layout="inline"` 渲染「字段 / 操作符 / 值 / 查询 / 重置」；操作符切到「存在」时值输入框禁用并提示；表单级错误用 `Alert` 内联。结果区直接复用阶段 5 的「_id / _score / _source」表格样式，无分页，固定 `size: 20`。
> - 状态：`src/renderer/stores/workspace.store.ts` 新增 `simpleResults` / `simpleLoading` / `simpleError` 状态及 `runSimpleQuery(connectionId, index, body)` action；写入前校验 `selectedIndex` 未变更避免竞态；`setActiveConnection` / `selectIndex(null)` / `selectIndex(other)` / `clear()` 四个分支统一清空简单查询状态。表单的字段 / 操作符 / 值是组件局部 state，不进 store。
> - Tab：`src/renderer/components/IndexDetailPanel.tsx` 现有顺序改为 **文档 → 简单查询 → 查询 → Mapping → Settings**；header 刷新按钮在 简单查询 / 查询 Tab 时禁用（两个 Tab 都有自己的提交按钮）。
> - 错误：`src/renderer/pages/WorkspacePage.tsx` 新增 `simpleError` 的 toast effect；面板同时内联 Alert 显示，不双 toast。
> - IPC / 主进程：复用 `document:search` + `document.service.ts`，**未新增通道、未新增依赖**。
> - 不在本阶段实现：文档 CRUD、导入导出、多条 clause 组合、DSL 编辑器中的多 clause 化语法糖。

## 本阶段目标

实现表单式查询，自动生成 Elasticsearch DSL。

本阶段可以在阶段 5 之后实现，也可以后补。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 6：简单查询】。

目标：
实现表单式查询，自动生成 Elasticsearch DSL。

要求：
1. 支持字段名输入。
2. 支持操作符：
   - 等于 term
   - 包含 match
   - 大于 range gt
   - 大于等于 range gte
   - 小于 range lt
   - 小于等于 range lte
   - 存在 exists
3. 自动生成 DSL。
4. 查询结果复用已有文档表格。
5. 不要实现新的文档操作功能。
6. 不要实现导入导出。

请先说明 DSL 生成逻辑，再开始实现。
```

## 操作符映射

| 操作符 | DSL 类型 |
|---|---|
| 等于 | term |
| 包含 | match |
| 大于 | range gt |
| 大于等于 | range gte |
| 小于 | range lt |
| 小于等于 | range lte |
| 存在 | exists |

## 示例：包含查询

输入：

```text
字段名：username
操作符：包含
查询值：张三
```

输出 DSL：

```json
{
  "query": {
    "match": {
      "username": "张三"
    }
  }
}
```

## 示例：范围查询

输入：

```text
字段名：age
操作符：大于等于
查询值：18
```

输出 DSL：

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

## 本阶段验收标准

```text
1. 能通过表单输入字段名、操作符和值。
2. 能生成正确 DSL。
3. 能执行查询。
4. 查询结果复用阶段 5 的文档表格。
5. 不影响原 DSL 查询能力。
```

## 完成后让 AI 自查

```text
请检查阶段 6 是否完成：
1. 每个操作符是否生成正确 DSL？
2. exists 查询是否不要求查询值？
3. range 查询是否正确处理 gt/gte/lt/lte？
4. 查询结果是否复用现有表格？
5. 是否误实现了其他功能？
```
