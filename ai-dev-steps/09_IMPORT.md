# 阶段 9：导入功能

> ✅ 已完成（2026-06-18）

## 本阶段目标

支持 JSON / NDJSON / CSV 文件导入 Elasticsearch。

本阶段只实现导入，不扩展高级导入能力。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 9：导入功能】。

目标：
支持 JSON / NDJSON / CSV 文件导入 Elasticsearch。

要求：
1. 支持选择目标索引。
2. 支持选择文件。
3. 支持预览前 10 条。
4. 支持 NDJSON 导入。
5. 支持 JSON 数组导入。
6. 支持 CSV 导入。
7. 使用 Bulk API 写入。
8. 显示成功数量、失败数量和失败详情。
9. 不要实现其他高级导入功能。

请先说明文件解析策略和 Bulk 请求格式，再开始实现。
```

## 推荐 IPC 接口

```text
import:preview
import:execute
```

## NDJSON 支持格式

### Bulk 格式

```json
{"index":{"_index":"users","_id":"1"}}
{"name":"张三","age":18}
```

### 纯文档格式

```json
{"name":"张三","age":18}
{"name":"李四","age":20}
```

纯文档格式导入时：

```text
1. 目标索引由用户选择。
2. _id 自动生成。
```

## JSON 支持格式

### 普通数组

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

### 带 _id 格式

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

## CSV 导入规则

```text
1. 第一行作为字段名。
2. 每一行转换成一个 JSON 文档。
3. 所有值默认按字符串处理。
4. 后续再支持字段类型转换。
```

## 需要调用的 ES API

```http
POST /_bulk
```

## 本阶段验收标准

```text
1. 能选择目标索引。
2. 能选择文件。
3. 能预览前 10 条。
4. 能导入 NDJSON。
5. 能导入 JSON 数组。
6. 能导入 CSV。
7. 能显示成功数量。
8. 能显示失败数量和失败详情。
```

## 完成后让 AI 自查

```text
请检查阶段 9 是否完成：
1. NDJSON Bulk 格式是否支持？
2. NDJSON 纯文档格式是否支持？
3. JSON 数组是否支持？
4. CSV 第一行表头是否正确处理？
5. Bulk 失败项是否展示详情？
6. 是否误实现了高级导入功能？
```
