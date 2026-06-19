# 阶段 10：打包和发布

> ✅ 已完成（2026-06-18）

## 本阶段目标

配置 Windows 桌面应用打包，生成可安装或可运行的 `.exe`。

本阶段不修改业务功能。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 10：打包和发布】。

目标：
配置 Windows 桌面应用打包。

要求：
1. 使用 electron-builder。
2. 配置应用名称。
3. 配置 Windows 安装包。
4. 配置打包脚本。
5. 不要改动业务功能。
6. 完成后告诉我如何执行打包命令。
7. 如果需要图标，先使用默认图标或占位配置，不要阻塞打包。

请先说明 package.json 和 electron-builder 配置改动，再开始实现。
```

## 推荐配置内容

```text
应用名称
应用 ID
Windows target
输出目录
打包脚本
构建脚本
```

## 推荐 npm scripts

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "dist": "electron-builder"
  }
}
```

## 本阶段验收标准

```text
1. 能执行构建命令。
2. 能生成 Windows 安装包或 exe。
3. 安装后应用能启动。
4. 基础功能可用。
5. 不修改业务功能。
```

## 完成后让 AI 自查

```text
请检查阶段 10 是否完成：
1. package.json scripts 是否完整？
2. electron-builder 配置是否可用？
3. 是否能生成 Windows 包？
4. 是否改动了无关业务代码？
5. 如何手动验证打包结果？
```
