# 阶段 4：索引详情

> ✅ 状态：**已完成**
>
> 完成时间：2026-06-18
>
> 实现摘要：
> - 主进程：`src/main/services/index.service.ts` 新增 `getIndexMapping`（`GET /{index}/_mapping`）和 `getIndexSettings`（`GET /{index}/_settings`）；`describeIndexError` 将 404 转为 `索引 "<name>" 不存在` 等可读消息。
> - 渲染层：新增 `src/renderer/components/JsonView.tsx`（`JSON.stringify(..., null, 2)` + 复制按钮 + 行数/字节数提示）；新增 `src/renderer/components/IndexDetailPanel.tsx`（返回按钮 + Mapping/Settings 两个 Tab，Tabs 结构可扩展）。
> - 状态：`src/renderer/stores/workspace.store.ts` 新增 `selectedIndex` / `mapping` / `settings` 状态及 `selectIndex` / `fetchMapping` / `fetchSettings` / `refreshIndexDetail` action；切换连接时统一清空。`fetchMapping` / `fetchSettings` 在写入前校验 `selectedIndex` 未变更，避免竞态覆盖。
> - IPC：`src/shared/ipc.ts` 新增 `index:mapping` / `index:settings` 通道及 `IndexDetailRequest` / `IndexMappingResult` / `IndexSettingsResult` 类型；`src/main/index.ts` 注册 handler；`src/preload/index.ts` 暴露 `esApi.indices.mapping` / `esApi.indices.settings`。
> - 交互：`IndexList` 行整行可点击（`onRow.onClick` + cursor: pointer），光标 + 提示文案「点击行查看 Mapping / Settings」；选中索引后 `IndexDetailPanel` 替换列表区，cluster info 卡片保持可见。
> - 不在本阶段实现：文档查询 / DSL 编辑 / 文档 CRUD / 导入导出。

## 本阶段目标

点击索引后可以查看 Mapping 和 Settings。

本阶段不实现文档查询、DSL 查询、导入导出。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 4：索引详情】。

目标：
点击索引后可以查看 Mapping 和 Settings。

要求：
1. 实现索引详情 Tab。
2. 实现 Mapping 查询。
3. 实现 Settings 查询。
4. 使用 JSON 展示组件格式化显示。
5. 支持复制 JSON，可选。
6. 查询失败时显示错误信息。
7. 不要实现文档查询、DSL 查询、导入导出等后续功能。

请先说明需要修改哪些组件和 IPC 接口，再开始实现。
```

## 需要调用的 ES API

```http
GET /{index}/_mapping
GET /{index}/_settings
```

## 推荐 IPC 接口

```text
index:mapping
index:settings
```

## UI 要求

```text
索引详情区域使用 Tab：
1. Mapping
2. Settings
```

后续阶段会继续增加：

```text
文档
查询
导入
导出
```

但本阶段不要实现这些 Tab 的业务逻辑。

## 本阶段验收标准

```text
1. 点击索引后进入索引详情区域。
2. 能查看 Mapping。
3. 能查看 Settings。
4. JSON 展示格式清晰。
5. 查询失败时显示错误信息。
6. 未实现文档查询、DSL 查询、导入导出。
```

## 完成后让 AI 自查

```text
请检查阶段 4 是否完成：
1. Mapping 是否能正确加载？
2. Settings 是否能正确加载？
3. JSON 是否格式化展示？
4. 错误信息是否可读？
5. 是否误实现了阶段 5 之后的功能？
```
