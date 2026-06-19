# AI 开发协作总说明

本目录用于指导 AI 按照 `ES_DESKTOP_CLIENT_PLAN.md` 分阶段开发 Elasticsearch 桌面管理工具。

## 使用方式

每次只把一个阶段文档交给 AI 执行，不要一次性要求 AI 完成整个项目。

推荐顺序：

```text
00_AI_COLLABORATION_GUIDE.md
01_PROJECT_INIT.md
02_CONNECTION_MANAGEMENT.md
03_CLUSTER_AND_INDEX_LIST.md
04_INDEX_DETAIL.md
05_DOCUMENT_QUERY.md
06_SIMPLE_QUERY.md
07_DOCUMENT_CRUD.md
08_EXPORT.md
09_IMPORT.md
10_PACKAGE_RELEASE.md
11_CODE_REVIEW_CHECKLIST.md
12_BUGFIX_TEMPLATE.md
```

## 核心原则

```text
1. 每次只实现一个阶段。
2. 每次开始前先让 AI 阅读 ES_DESKTOP_CLIENT_PLAN.md。
3. 明确告诉 AI 不要实现后续阶段功能。
4. 修改代码前先让 AI 给出计划和文件清单。
5. 实现完成后必须说明如何启动和验证。
6. 出错时只修相关问题，不要大范围重写。
```

## 通用提示词

```text
请先阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现文档中的【阶段 X：XXX】。

要求：
1. 严格按照文档中的功能范围实现。
2. 不要实现其他阶段的功能。
3. 修改代码前，先告诉我你准备修改哪些文件。
4. 优先保持代码简单，不要过度封装。
5. 不要引入额外技术栈，除非先说明原因并征求确认。
6. 实现完成后，告诉我：
   - 完成了哪些功能
   - 修改了哪些文件
   - 如何启动
   - 如何验证
   - 还有哪些未完成项

现在请开始。
```

## 防止 AI 跑偏的固定约束

后续每次让 AI 开发时，可以附加以下内容：

```text
请注意：
1. 不要实现本阶段之外的功能。
2. 不要重构无关代码。
3. 不要为了未来功能提前设计复杂抽象。
4. 不要加入文档中没有要求的新依赖。
5. 保持代码简单，可运行优先。
6. 如果发现文档要求不明确，先问我，不要自行扩展。
```

## 推荐开发节奏

```text
第 1 次：项目初始化
第 2 次：连接管理
第 3 次：集群信息和索引列表
第 4 次：Mapping / Settings
第 5 次：文档查询和 DSL 查询
第 6 次：简单查询，可选，可后补
第 7 次：新建 / 编辑 / 删除文档
第 8 次：导出
第 9 次：导入
第 10 次：打包
```

## 每个阶段完成后的检查

每个阶段完成后，建议继续让 AI 执行：

```text
请根据 ES_DESKTOP_CLIENT_PLAN.md 和本阶段文档，检查刚才实现是否符合要求。

请输出：
1. 已完成项
2. 未完成项
3. 是否误实现了其他阶段功能
4. 是否存在 TypeScript 类型问题
5. 是否存在 Electron 安全问题
6. 如何手动验证
```
