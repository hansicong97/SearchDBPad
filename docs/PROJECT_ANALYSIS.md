# SearchDBPad 项目整体分析

更新时间：2026-10-17

续做验证见 [0.4.0 续做记录](releases/0.4.0-continuation-2026-10-17.md)：本轮 254 项测试、类型检查与构建通过，离线参数下的 Windows 解包 smoke 成功；真实 ES 8.6.1 只读路径和部分 Electron 状态已验收，其余矩阵仍待完成。

本文根据当前工作区代码、`SEARCHDBPad_CLIENT_PLAN.md`、`ai-dev-steps/future-releases/`、架构文档和 ADR 编写。文中把“已实现”和“已验收”分开：fixture、单元测试和源码检查可以证明代码路径存在，但不能代替真实搜索服务、Electron 界面和 Windows 安装包验收。

## 1. 当前交付边界

当前工作区已经从 Elasticsearch 单引擎实现推进到多引擎基线：内置 Elasticsearch、OpenSearch 和 Solr adapter，连接对象带有 `engineType`，旧数据缺失该字段时仍按 Elasticsearch 读取。运行时通过 manifest 描述引擎类型、协议族、版本范围、查询语言、传输格式和能力集合。

Electron 的三层边界基本清晰：

- `src/main/` 持有网络、文件系统、持久化、任务和 IPC handler。
- `src/preload/` 通过 typed `window.searchApi` 暴露有限操作。
- `src/renderer/` 只负责 React/Ant Design 界面和状态，不直接访问 Node API 或搜索服务。
- `src/shared/` 保存 IPC channel、请求/结果和引擎中立模型。
- `src/main/adapters/<engine>/` 保存 URL、认证、响应映射、版本兼容和引擎特有语义。
- `src/main/services/` 负责业务编排，通过 adapter contract 调用引擎能力。

导入导出已经具备有限批次、进度、取消、临时文件和完成后提交的基础；搜索请求也有请求序号和 `AbortSignal` 的路径。适配器 registry 会校验 manifest 和已声明能力的函数存在性。当前证据包括 TypeScript 类型检查、Vitest fixture/contract 测试、生产 renderer 构建和 CI 配置。

以下事项仍属于发布门槛，不能从源码或 fixture 推断已经完成：

- Elasticsearch 6.x–9.x、OpenSearch 1.x/2.x、Solr 8/9 的真实服务器矩阵。
- Electron 中 loading、empty、error、success、cancellation、快速切换连接以及破坏性确认状态。
- Windows `npm run pack`、NSIS 和 portable 产物的实际运行结果。
- 大文件导入导出、代理/TLS、认证失败和网络中断下的行为。

## 2. `CLAUDE.md` 到通用 `AGENTS.md`

仓库已删除仅面向 Claude 的 `CLAUDE.md`，并新增工具无关的 [AGENTS.md](../AGENTS.md) 与同步的 [AGENTS.zh-CN.md](../AGENTS.zh-CN.md)。新文档覆盖项目范围、目录职责、Electron 安全边界、IPC 三层同步要求、adapter 演进约束、测试门槛和交付报告要求，适用于 Codex、Claude、IDE agent 和人工贡献者。

后续维护时应保持英文文件为规范版本，中文文件只做同步翻译。新增 IPC channel、引擎、认证模式或打包命令时，两份 AGENTS 文档和 README 应一并更新；历史发布说明不应被重写，应该追加 erratum 或新的发布记录。

## 3. 仍需优化或重构的代码

### P0：统一 IPC 边界和错误协议

`ResourceQuery` 和 `RequestCancel` 的 IPC 外层边界通过 `resourceIpc.service.ts` 捕获异常。续做时已将对象、资源名、请求序号、文档 ID/source、commitPolicy、任务操作与导入格式/模式等运行时校验补入 document、resource、task 和 import service，在解析 adapter、读文件或开始任务前返回安全 envelope；`tests/unit/ipcValidation.test.ts` 覆盖无副作用的拒绝路径。旧 index/alias/template handler 的全面校验与 Electron sender 生命周期仍需继续验收。

### 已补齐：主进程强制执行 capability

Elasticsearch 版本探测已接入 `versionFeatures`。`requireOperation` 现在在每次调用前重新读取连接级 capability，并对所有 adapter operation 执行完整映射检查；Reindex 和 Query Mutation 还会检查各自子能力。不支持时返回 `unsupported_capability`，legacy 索引/Mapping 接口也不能绕过。流式导出保持 AsyncIterable 和提前退出清理语义，相关拒绝、重新解析和清理路径已有回归测试。真实服务器上的版本、认证权限和能力差异仍需验收。

### P0：保留 Solr `commitPolicy`

共享 IPC、document service 和 Solr adapter 现在会透传 `auto`、`commit`、`softCommit`、`none` 提交策略，代码级测试已覆盖 adapter 路径。仍需在 Solr 8/9 真实服务验证每种策略的可见时序、重复写入和失败语义，避免把 fixture 结果当作服务器兼容性证明。

### P0：统一资源名和路径策略

Elasticsearch 文档和 alias 路径使用 URL 编码。续做时进一步拒绝文档 ID 的裸 `.`/`..`，避免 URL 规范化改变 CRUD 请求目标；服务层共用资源名基础校验，拒绝点段、控制字符、路径分隔符、查询/片段字符和首尾空格。Solr、task 与旧 index/alias/template 接口仍有引擎专用或历史规则，后续继续统一各 endpoint 的 segment encoder 和长度约束。

### 已补齐：ES/OpenSearch 通用 Schema 的递归字段

通用 `getSchema` 已改用 adapter 内的 `schemaApi.ts`，递归输出 object/nested 子字段和 multi-field 路径，在可选 `metadata` 中保留 nested 祖先路径、multi-field 所属字段和 ES 6 mapping type；支持别名响应以实际索引名为键的情况，保留原始 mapping。OpenSearch 复用同一协议实现，Solr 的 `uniqueKey`、`multiValued` 等元数据保持自身语义。fixture 回归测试已覆盖，真实服务器仍待验收。

### 已补齐：引擎原生导入与元数据请求序号

导入预览可携带 `connectionId`，主进程按 manifest 选择与执行相同的解析规则。Solr 原生 JSON 中的 `fields`、`_source`、`_id` 保持普通文档字段；ES/OpenSearch 继续解析文档包装和 CSV 的 `_id` 元数据列。旧预览调用未传连接时保留 ES 语义。

cluster/version、Mapping/Settings、Alias、Template 和 shard 刷新已增加序号保护，导航与重置会使旧请求失效；元数据和查询的 IPC Promise 拒绝会结束 loading 并显示固定安全消息。确定性测试覆盖重叠刷新、重复访问和异常清理；这些测试不能代替完整 Electron 状态验收。

### P1：拆分版本化 adapter contract

现在 `SearchEngineManifest.manifestVersion` 已存在，但 operation contract 仍是一个不断扩展的类型集合。应将基础连接/探测、资源目录、schema、查询、文档写入、维护、任务和传输拆成可独立版本的 capability contract；每个 contract 明确输入、错误码、取消和幂等语义。这样新增 SolrCloud 或 OpenSearch 专属能力时，不会继续向所有 adapter 追加 Elasticsearch 必选方法。

### P1：改进 secret 持久化和红测覆盖

公开错误和日志路径应继续避免密码、API key、Authorization header 和连接 URL 中的秘密。对外发行前应把 electron-store 中的持久化密码迁移到 Windows Credential Manager（或受控 keytar provider），连接配置只保存引用；增加 URL、401/403、bulk 错误、异常 stack 和导入失败的 redaction 测试，并确认导出/诊断日志不会泄露原始请求。

### P1：补足取消、过期响应和临时文件的真实验证

源码已具备 AbortSignal、请求注册和临时文件清理路径，但仍需 Electron 验收长查询、导入、导出、窗口关闭、重复取消、快速切换 connection/resource 的场景。验收应确认 terminal progress 只发一次、旧请求结果不能覆盖当前 workspace、取消不会替换目标文件、临时文件最终清理，且网络请求在服务端或客户端可接受时尽快终止。

### P2：渲染包和大结果体验

renderer 生产构建已有大 chunk 警告，Monaco、Ant Design 和所有引擎面板可能被一次性打包。可按工作区、Monaco、Solr 专用组件和维护面板拆分动态 import，并对文档表格使用虚拟化、列配置和服务端分页。优化应以后续性能基准为依据，避免为拆包引入会破坏 CSP 或 Electron preload 边界的动态依赖。

### 文档一致性

`SEARCHDBPad_CLIENT_PLAN.md` 的历史章节保留了 Elasticsearch 优先路线，文首现已补充 0.4.0 多引擎基线和真实验收门槛，IPC 示例也已改为当前 `window.searchApi.documents.search`。README 与 AGENTS 以当前代码为准；仍应逐步修正旧代码注释和共享类型中的 ES 专属描述，避免后续 agent 依据历史背景继续设计错误的必选接口。

## 4. 详细后续功能路线

### P0：稳定性、可发布性和安全基线

1. 将 resource IPC 已采用的 runtime schema 和错误 envelope 推广到所有 handler，覆盖畸形请求、超时、取消和 sender 生命周期。
2. 在已集中的主进程 capability 检查上，进一步区分 adapter 静态能力、服务器版本能力和认证后权限，并验收缓存失效行为。
3. 完成 Solr commitPolicy 的真实验证；继续推进 resource/path validator、secret redaction、Windows Credential Manager 迁移设计。
4. 建立真实服务器验收脚本：ES 6/7/8/9、OpenSearch 1/2、Solr 8/9 至少覆盖探测、认证、资源列表、schema、查询、CRUD（支持时）、导入导出和错误映射。
5. 建立 Electron smoke checklist 和可重复的 Windows pack job。验收记录必须包含环境、引擎版本、认证模式、结果和已知差异。

### P1：查询和数据工作流

1. 查询历史、收藏、模板和最近使用的连接/资源；保存前校验 query language 和敏感字段。
2. Schema 感知字段选择、字段搜索、结果列配置、JSON/表格双视图和可复制路径。
3. 深度分页：ES/OpenSearch 使用 `search_after`/PIT（按能力启用），Solr 使用 cursorMark；显示快照/一致性限制。
4. 可恢复导入导出任务：断点、重试、部分失败重跑、失败行下载、任务历史和磁盘空间预检。
5. 查询超时、取消和服务端错误提供可操作提示；长任务支持后台继续并在窗口恢复后重新订阅状态。

### P2：引擎特有能力和运维

1. 完成 Solr uniqueKey、commit/softCommit、Schema 字段类型、partial failure 和 CSV/JSON 语义的真实验收。
2. OpenSearch 适配 Security/TLS/代理部署差异；在能力允许时增加索引模板、snapshot、ISM 等独立 capability，不把它们塞进 ES 通用接口。
3. 为 Elasticsearch/OpenSearch 增加 PIT、scroll 生命周期、任务状态和 reindex 风险提示；破坏性操作统一二次确认、权限提示和审计摘要。
4. 结果表虚拟化、列缓存、请求去重和性能指标；定义 10 万行查询、百万行导出等基准，记录内存峰值和取消延迟。

### P3：跨引擎集成和插件前提

1. 跨引擎迁移向导先支持离线映射预览：字段类型映射、ID/uniqueKey 规则、冲突处理、dry-run、校验报告和可恢复批次。
2. SSH tunnel、代理、TLS 证书、连接分组和外部 secret provider 应先完成权限、生命周期和诊断设计。
3. 插件协议应在至少两个非 ES adapter 经过真实验收后再启动：版本协商、能力 manifest、最小权限（网络/文件范围）、进程隔离、签名验证、来源信任、回滚和卸载。
4. 插件不应通过 renderer 动态执行任意代码，也不应仅以 `import()` 作为“按需安装”；需要独立 host 或受限 worker、清晰的数据边界和可审计日志。

## 5. 建议验收矩阵

| 层次 | 每个版本应提供的证据 |
|---|---|
| 类型与单元 | `npm run typecheck`、`npm test`，覆盖 adapter contract、IPC 校验、错误映射、分页、转义、取消和 secret redaction |
| 构建 | `npm run build`；Electron 相关变更再运行 `npm run pack`，记录实际产物启动结果 |
| 真实服务 | 按兼容矩阵逐项记录版本、认证、代理/TLS、读写、传输、错误和取消行为；fixture 只能作为补充 |
| Electron UI | loading、empty、error、success、cancellation、快速切换和 destructive-confirmation；截图或录屏应对应测试用例 |
| 安全 | contextIsolation/nodeIntegration/CSP 回归，日志和错误 redaction，路径/资源名 fuzz，凭据存储检查 |
| 发布 | Windows 安装/卸载、portable、升级迁移、旧连接读取、配置备份与回滚 |

建议把每个版本的“已实现”和“已验收”分别记录在 release note；任何未执行的 live server、UI 或 packaging 检查都明确标记为待完成。
