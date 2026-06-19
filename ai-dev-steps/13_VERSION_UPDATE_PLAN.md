# 版本更新计划：布局滚动、索引操作、导入增强

> 状态：待实施
>
> 目标版本：V0.2.x / V0.3 前置增强
>
> 本文档用于细化本次版本更新范围。实施时只做本文列出的内容，不引入后续高级能力。

## 1. 更新目标

本次版本更新解决三个已发现问题：

1. **工作台滚动体验修正**：左侧连接/索引列表和右侧详情内容应各自独立滚动；滚动内容时顶部工具栏、连接标题、详情页头部保持固定，不应跟随整体页面一起滚动。
2. **索引操作能力补齐**：在现有索引列表、Mapping、Settings 查看基础上，补齐可用的索引管理操作，形成基础索引管理闭环。
3. **导入功能增强**：支持创建索引时直接导入数据，也支持在已有索引内追加、覆盖导入数据；导入时可明确选择数据格式。

## 2. 范围约束

### 2.1 本次要做

```text
1. 修复工作台布局滚动结构。
2. 左侧列表区域独立滚动。
3. 右侧详情区域独立滚动。
4. 顶部区域固定，不参与内容滚动。
5. 增加索引创建入口。
6. 增加索引删除入口和二次确认。
7. 增加索引刷新操作。
8. 增加查看/编辑索引 Mapping、Settings 的必要入口，其中 MVP 优先创建时填写，已存在索引先以查看为主。
9. 导入面板支持手动选择 JSON / NDJSON / CSV。
10. 导入支持追加写入。
11. 导入支持覆盖写入。
12. 创建索引流程可选择文件并在创建成功后导入。
13. 导入完成后刷新索引列表和当前文档列表。
```

### 2.2 本次不做

```text
1. 不做复杂索引模板管理。
2. 不做 ILM、Alias、Snapshot、Reindex 可视化。
3. 不做自动 Mapping 推断。
4. 不做大文件流式导入进度条。
5. 不做导入任务队列、暂停、恢复。
6. 不做多集群同步。
7. 不做删除索引的批量操作。
8. 不做覆盖导入前自动备份。
```

## 3. 问题一：UI 独立滚动与顶部固定

### 3.1 当前问题

工作台页面整体滚动时，左侧连接/索引列表和右侧连接详情区域会一起滚动，导致：

- 左侧列表滚动到深处时，右侧详情也被带动。
- 右侧详情内容较长时，左侧导航也跟随滚动。
- 顶部连接信息、工具栏、详情标题不能稳定停留在可见区域。

### 3.2 目标交互

```text
窗口
├── 顶部应用栏 / 当前连接信息 / 全局操作区（固定）
└── 主工作区（固定高度，占满剩余窗口）
    ├── 左侧面板
    │   ├── 左侧标题 / 搜索 / 刷新（固定）
    │   └── 连接列表 / 索引列表（独立滚动）
    └── 右侧详情
        ├── 详情标题 / Tab / 操作栏（固定）
        └── 详情内容区（独立滚动）
```

### 3.3 实现要求

1. 页面根容器高度应使用 `100vh` 或等价布局，避免 `body` 成为主要滚动容器。
2. 工作台主体使用 flex 布局，左侧和右侧分别设置 `min-height: 0`，保证内部滚动生效。
3. 左侧列表容器设置 `overflow-y: auto`，左侧搜索、刷新、标题区域固定在列表上方。
4. 右侧内容容器设置 `overflow-y: auto`，右侧详情标题、Tab、工具条保持在内容滚动区域外。
5. Ant Design Table 如需滚动，应设置合适的 `scroll`，避免撑开整个页面。
6. 禁止通过全局 `body { overflow: hidden }` 粗暴解决导致弹窗、下拉菜单异常；如需限制滚动，必须只约束应用根布局。

### 3.4 验收标准

```text
1. 左侧列表内容较多时，只滚动左侧列表，不带动右侧。
2. 右侧详情内容较多时，只滚动右侧内容，不带动左侧。
3. 顶部应用栏滚动时始终可见。
4. 左侧搜索栏和刷新按钮滚动时始终可见。
5. 右侧索引名称、Tab、主要操作按钮滚动时始终可见。
6. 弹窗、下拉菜单、表格分页显示正常。
```

## 4. 问题二：索引操作能力

### 4.1 用户目标

用户不仅要查看索引，还需要像数据库客户端操作表一样，对 Elasticsearch 索引做基础管理。

### 4.2 MVP 索引操作清单

| 操作 | 本次是否实现 | 说明 |
|---|---:|---|
| 查看索引列表 | 已有 | 保留现有能力 |
| 搜索索引 | 已有 | 保留现有能力 |
| 刷新索引 | 已有/补强 | 操作后统一刷新 |
| 查看 Mapping | 已有 | 保留现有能力 |
| 查看 Settings | 已有 | 保留现有能力 |
| 创建索引 | 本次实现 | 支持索引名、Settings JSON、Mapping JSON |
| 创建索引并导入 | 本次实现 | 创建成功后按选择格式导入文件 |
| 删除索引 | 本次实现 | 必须二次确认，显示索引名 |
| 编辑 Mapping | 暂缓 | ES 仅支持新增字段，容易误解，后续单独做 |
| 编辑 Settings | 暂缓 | 动态/静态设置规则复杂，后续单独做 |
| 关闭/打开索引 | 暂缓 | 后续索引运维增强再做 |
| Alias 管理 | 暂缓 | 后续高级功能 |

### 4.3 创建索引交互

入口建议：

```text
1. 工作台左侧索引列表工具栏：新建索引按钮。
2. 空状态页面：创建索引按钮。
```

表单字段：

```text
索引名称（必填）
Settings JSON（可选）
Mapping JSON（可选）
创建后导入数据（可选开关）
导入文件（开启导入时必填）
导入格式：自动识别 / JSON / NDJSON / CSV
导入模式：追加 / 覆盖（创建新索引时默认追加，覆盖不可选或等价于追加）
```

请求体规则：

```json
{
  "settings": {},
  "mappings": {}
}
```

规则说明：

1. Settings 和 Mapping 都为空时，调用 `PUT /{index}` 创建空索引。
2. Settings 不为空时写入 `settings`。
3. Mapping 不为空时写入 `mappings`。
4. JSON 不合法时禁止提交。
5. 创建成功后刷新索引列表。
6. 如果勾选导入，创建成功后继续执行导入；导入失败时索引保留，并展示导入失败原因。

### 4.4 删除索引交互

入口建议：

```text
1. 索引列表每行更多菜单。
2. 索引详情页右上角危险操作按钮。
```

确认要求：

```text
1. 使用 Popconfirm 或 Modal.confirm。
2. 文案必须包含索引名。
3. 用户必须明确确认后才执行。
4. 删除成功后清空当前选中索引并刷新列表。
5. 删除失败时展示 ES 返回错误摘要。
```

### 4.5 推荐 IPC 接口

在 `src/shared/ipc.ts` 中补齐或确认以下通道：

```text
index:create
index:delete
index:list
index:mapping
index:settings
```

推荐类型：

```ts
export interface CreateIndexPayload {
  connectionId: string
  index: string
  settings?: Record<string, unknown>
  mappings?: Record<string, unknown>
}

export interface DeleteIndexPayload {
  connectionId: string
  index: string
}
```

### 4.6 需要调用的 ES API

```http
PUT /{index}
DELETE /{index}
GET /_cat/indices?format=json&bytes=b
GET /{index}/_mapping
GET /{index}/_settings
```

### 4.7 验收标准

```text
1. 能打开新建索引弹窗。
2. 只输入索引名时能创建空索引。
3. 输入合法 Settings / Mapping JSON 时能创建带配置的索引。
4. Settings / Mapping JSON 不合法时不能提交。
5. 创建成功后索引列表刷新并能看到新索引。
6. 能删除指定索引。
7. 删除前必须二次确认且显示索引名。
8. 删除成功后索引列表刷新，当前详情状态正确清空或切换。
9. 删除失败时显示错误信息。
```

## 5. 问题三：导入功能增强

### 5.1 当前问题

现有导入功能已支持 JSON / NDJSON / CSV 文件导入，但能力偏基础：

- 导入格式不够显式，用户需要清楚知道当前按什么格式解析。
- 只能面向已有目标索引导入。
- 创建索引时不能顺手导入初始化数据。
- 对追加和覆盖的语义不够明确。

### 5.2 目标能力

```text
1. 用户可以在导入时选择数据格式。
2. 用户可以对已有索引追加导入。
3. 用户可以对已有索引覆盖导入。
4. 用户可以在创建索引时直接导入文件。
5. 导入前仍然支持预览前 10 条。
6. 导入结果继续显示成功数量、失败数量和失败详情。
```

### 5.3 导入入口

建议保留和新增以下入口：

```text
1. 索引详情页：导入 Tab / 导入按钮。
2. 索引列表：选中索引后的导入操作。
3. 新建索引弹窗：创建后导入数据开关。
```

### 5.4 导入格式选择

格式选项：

```text
自动识别
JSON
NDJSON
CSV
```

自动识别规则：

```text
1. `.json` 默认按 JSON 解析。
2. `.ndjson` / `.jsonl` 默认按 NDJSON 解析。
3. `.csv` 默认按 CSV 解析。
4. 无法识别时要求用户手动选择。
5. 用户手动选择优先级高于扩展名。
```

JSON 支持格式：

```json
[
  { "name": "张三", "age": 18 },
  { "_id": "1", "_source": { "name": "李四" } }
]
```

NDJSON 支持格式：

```json
{"index":{"_index":"users","_id":"1"}}
{"name":"张三","age":18}
{"name":"李四","age":20}
```

CSV 支持规则：

```text
1. 第一行作为字段名。
2. 每一行转换成一个 JSON 文档。
3. 默认所有值按字符串处理。
4. 后续再做类型推断，不在本次实现。
```

### 5.5 导入模式

#### 5.5.1 追加导入

语义：

```text
保留索引现有数据，将文件数据写入目标索引。
```

Bulk 行为：

```text
1. 默认使用 index 操作。
2. 如果文件记录包含 _id，则使用该 _id，可能覆盖同 ID 文档。
3. 如果文件记录不包含 _id，则由 ES 自动生成。
```

适用场景：

```text
1. 新增一批数据。
2. 创建索引后初始化导入。
3. 按 _id 更新同一批数据。
```

#### 5.5.2 覆盖导入

本次 MVP 采用安全、可理解的覆盖语义：

```text
先清空目标索引内现有文档，再导入文件数据；保留索引本身、Mapping 和 Settings。
```

实现方式：

```http
POST /{index}/_delete_by_query
{
  "query": {
    "match_all": {}
  }
}

POST /_bulk
```

覆盖确认要求：

```text
1. 用户选择覆盖导入时必须二次确认。
2. 确认文案必须包含目标索引名。
3. 明确提示：会删除该索引下现有文档，但不会删除索引结构。
4. 清空失败时不得继续导入。
5. 清空成功、导入失败时，展示明确错误，用户可重新导入。
```

不采用的覆盖语义：

```text
1. 不删除并重建索引，避免丢失 Mapping / Settings。
2. 不先删除索引再创建索引，避免高风险。
3. 不自动备份旧数据。
```

### 5.6 创建索引时导入

流程：

```text
1. 用户打开新建索引弹窗。
2. 输入索引名，可选填写 Settings / Mapping。
3. 开启“创建后导入数据”。
4. 选择文件。
5. 选择导入格式或自动识别。
6. 预览前 10 条。
7. 点击创建。
8. 先创建索引。
9. 创建成功后执行导入。
10. 展示创建结果和导入结果。
11. 刷新索引列表，并选中新索引。
```

失败处理：

```text
1. 创建索引失败：不执行导入。
2. 创建索引成功但导入失败：保留索引，展示导入失败详情。
3. 文件解析失败：不创建索引，提示用户修正文件或格式。
```

### 5.7 推荐 IPC 接口

保留现有通道并扩展 payload：

```text
import:preview
import:execute
```

推荐类型：

```ts
export type ImportFormat = 'auto' | 'json' | 'ndjson' | 'csv'
export type ImportMode = 'append' | 'replace'

export interface ImportPreviewPayload {
  connectionId: string
  filePath: string
  format: ImportFormat
}

export interface ImportExecutePayload {
  connectionId: string
  index: string
  filePath: string
  format: ImportFormat
  mode: ImportMode
}

export interface ImportExecuteResult {
  total: number
  success: number
  failed: number
  errors: Array<{
    line?: number
    id?: string
    message: string
    detail?: unknown
  }>
}
```

创建索引并导入可由渲染层串联调用：

```text
1. index:create
2. import:execute
3. index:list
```

不强制新增单独的 `index:create-and-import` IPC，避免主进程接口过早复杂化。

### 5.8 需要调用的 ES API

```http
PUT /{index}
POST /{index}/_delete_by_query
POST /_bulk
GET /_cat/indices?format=json&bytes=b
POST /{index}/_refresh
```

说明：

1. 追加导入只需要 Bulk。
2. 覆盖导入先 `_delete_by_query`，再 Bulk。
3. 导入后可对目标索引执行 `_refresh`，确保 UI 刷新后能看到新数据。

### 5.9 验收标准

```text
1. 导入面板能选择自动识别 / JSON / NDJSON / CSV。
2. 选择文件后能按指定格式预览前 10 条。
3. 格式与文件内容不匹配时显示解析错误。
4. 已有索引支持追加导入。
5. 已有索引支持覆盖导入。
6. 覆盖导入前必须二次确认，确认文案包含索引名和清空文档说明。
7. 覆盖清空失败时不会继续导入。
8. 创建索引时可以勾选创建后导入数据。
9. 创建索引并导入成功后能在文档列表看到数据。
10. 导入后显示总数、成功数、失败数、失败详情。
11. 导入后刷新索引列表和当前文档列表。
```

## 6. 建议实施顺序

### 6.1 第一步：布局修复

涉及文件预计：

```text
src/renderer/pages/WorkspacePage.tsx
src/renderer/components/AppSidebar.tsx
src/renderer/components/IndexList.tsx
src/renderer/components/IndexDetailTabs.tsx 或同类详情组件
src/renderer/**/*.css
```

任务：

```text
1. 梳理工作台 DOM 结构。
2. 调整根布局为固定高度 flex。
3. 分离左侧固定头部和滚动列表。
4. 分离右侧固定头部/Tab 和滚动内容。
5. 验证弹窗、下拉、表格分页不受影响。
```

### 6.2 第二步：索引创建和删除

涉及文件预计：

```text
src/shared/ipc.ts
src/main/index.ts
src/main/services/index.service.ts
src/preload/index.ts
src/renderer/types/global.d.ts
src/renderer/components/IndexList.tsx
src/renderer/pages/WorkspacePage.tsx
新增或修改：src/renderer/components/CreateIndexModal.tsx
```

任务：

```text
1. 补齐 index:create / index:delete 类型。
2. 主进程实现创建和删除索引。
3. preload 暴露 indices.create / indices.delete。
4. 渲染层增加新建索引弹窗。
5. 渲染层增加删除索引入口和确认。
6. 操作成功后刷新列表。
```

### 6.3 第三步：导入格式和模式增强

涉及文件预计：

```text
src/shared/ipc.ts
src/main/services/import.service.ts
src/main/index.ts
src/preload/index.ts
src/renderer/components/ImportPanel.tsx
src/renderer/components/CreateIndexModal.tsx
```

任务：

```text
1. 扩展 ImportFormat 和 ImportMode 类型。
2. 预览接口支持显式格式。
3. 执行接口支持 append / replace。
4. replace 模式先执行 delete_by_query。
5. 导入后 refresh 目标索引。
6. UI 增加格式选择和模式选择。
7. 覆盖导入增加二次确认。
```

### 6.4 第四步：创建索引并导入

任务：

```text
1. 在新建索引弹窗加入“创建后导入数据”。
2. 复用导入格式选择和文件预览逻辑。
3. 提交前先解析文件，解析失败不创建索引。
4. 创建成功后调用 import:execute。
5. 展示创建和导入结果。
6. 刷新索引列表并选中新索引。
```

### 6.5 第五步：自查和验证

必须运行：

```bash
npm run typecheck
npm run build
```

按 `ai-dev-steps/11_CODE_REVIEW_CHECKLIST.md` 自查：

```text
1. 是否仍保持 contextIsolation: true 和 nodeIntegration: false。
2. 渲染进程是否没有直接访问 Node、文件系统或 Elasticsearch。
3. 新 IPC 类型是否 main / preload / renderer 三处同步。
4. 删除索引和覆盖导入是否都有二次确认。
5. 是否误加入本计划以外的高级功能。
```

## 7. 风险点和处理策略

### 7.1 覆盖导入风险

风险：覆盖导入会删除目标索引现有文档。

处理：

```text
1. 必须二次确认。
2. 文案明确说明“删除现有文档，不删除索引结构”。
3. 不提供默认选中覆盖，默认使用追加。
```

### 7.2 删除索引风险

风险：删除索引不可逆。

处理：

```text
1. 删除按钮放在危险操作区域。
2. 必须二次确认。
3. 文案包含索引名。
4. 不做批量删除。
```

### 7.3 创建索引并导入的中间失败

风险：索引创建成功后导入失败，用户可能误以为全部成功。

处理：

```text
1. 结果提示拆分为“索引创建结果”和“数据导入结果”。
2. 导入失败时保留索引。
3. 提供重试导入入口。
```

### 7.4 JSON / NDJSON 判断错误

风险：自动识别可能选错解析器。

处理：

```text
1. 提供手动格式选择。
2. 手动选择优先于扩展名。
3. 解析失败时提示当前使用的格式。
```

## 8. 最终验收清单

```text
[ ] 左侧列表和右侧详情可以分别滚动。
[ ] 顶部应用栏固定。
[ ] 左侧搜索/刷新区域固定。
[ ] 右侧详情标题/Tab/操作栏固定。
[ ] 可以创建空索引。
[ ] 可以创建带 Settings / Mapping 的索引。
[ ] 可以删除索引，且删除前二次确认。
[ ] 删除索引后列表和详情状态正确。
[ ] 导入时可以选择自动识别 / JSON / NDJSON / CSV。
[ ] 导入时可以选择追加 / 覆盖。
[ ] 覆盖导入前二次确认。
[ ] 创建索引时可以直接导入数据。
[ ] 导入结果显示总数、成功数、失败数、失败详情。
[ ] 导入后刷新索引列表和文档列表。
[ ] npm run typecheck 通过。
[ ] npm run build 通过。
```
