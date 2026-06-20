# ai-dev-steps · 开发文档目录

本目录按"通用模板 + 版本发布说明"两个维度组织。

## 目录结构

```text
ai-dev-steps/
├── README.md                       本文件（导航）
├── releases/                       版本发布说明（按版本号排序）
│   ├── V0.1.0_RELEASES.md          阶段 1～10 汇总：连接管理 → Windows 打包
│   ├── V0.2.0_RELEASES.md          布局滚动、索引操作、导入增强
│   ├── V0.2.1_RELEASES.md          SearchDBPad 品牌与产品定位升级
│   ├── V0.2.2_RELEASES.md          UI 布局优化与连接目录
│   └── V0.2.3_RELEASES.md          Elasticsearch 客户端协议兼容性修复
└── templates/                      通用模板与流程文档
    ├── AI_COLLABORATION_GUIDE.md   与 AI 协作推进阶段的总体指引
    ├── CODE_REVIEW_CHECKLIST.md    每个阶段完成后的审查清单
    └── BUGFIX_TEMPLATE.md          Bug 修复流程模板
```

## 版本号约定

- **V0.1.x**：第一个对外可交付版本（阶段 1～10），是产品闭环的最小集合。
- **V0.2.x**：在 V0.1 基础上的体验与能力增强（UI 布局、目录、品牌、协议兼容等），保持向后兼容。
- 后续每个独立交付周期新建一个 `releases/Vx.y.z_RELEASES.md`，不要就地修改历史版本。

## 文档维护规则

1. **新增版本说明**：在 `releases/` 下新建 `V<major>.<minor>.<patch>_RELEASES.md`，顶部写明版本号、发布日期、范围、对外能力总结。
2. **修改历史版本**：禁止覆盖。如需更正，注明"勘误"段落；如需修订方案，发布新版本。
3. **阶段汇总**：V0.1.0 由阶段 1～10 汇总而成，未来如果继续做阶段 11+，需要先合并到新的 V0.x.0 汇总，再追加 V0.x.1+ 的小版本。
4. **通用流程文档**：放在 `templates/` 下，按"流程 / 模板"语义命名；不在 `releases/` 里维护。

## 协作流程

每个版本开发请按 `templates/AI_COLLABORATION_GUIDE.md` 执行；版本结束后用 `templates/CODE_REVIEW_CHECKLIST.md` 做一轮自查；bug 修复走 `templates/BUGFIX_TEMPLATE.md`。