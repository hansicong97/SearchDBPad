# 阶段 1：项目初始化

> ✅ **状态：已完成**  
> 完成日期：2026-06-18  
> 实现要点：Electron + React + TypeScript + Vite + Ant Design 基础骨架；主进程 / preload / renderer 三层结构；`contextIsolation: true` / `nodeIntegration: false`；`app:getVersion` + `app:getPlatform` 两个示例 IPC；`npm run dev / build / typecheck` 脚本完整。

## 本阶段目标

搭建 Electron + React + TypeScript + Vite + Ant Design 的基础项目骨架。

本阶段只做项目基础结构，不实现 Elasticsearch 业务功能。

## 给 AI 的提示词

```text
请阅读 ES_DESKTOP_CLIENT_PLAN.md。

本次只实现【阶段 1：项目初始化】。

目标：
搭建 Electron + React + TypeScript + Vite + Ant Design 的基础项目。

要求：
1. 使用 Electron 主进程、preload、renderer 三层结构。
2. 开启 contextIsolation。
3. 关闭 nodeIntegration。
4. 配置一个基础 IPC 示例。
5. 集成 Ant Design。
6. 实现一个基础布局页面。
7. 配置基础 npm scripts。
8. 不要实现连接管理、索引列表、查询等后续功能。
9. 完成后告诉我如何启动应用。

请先给出你准备创建和修改的文件清单，然后开始实现。
```

## 推荐技术要求

```text
Electron
React
TypeScript
Vite
Ant Design
Zustand，可先安装但不一定使用
```

## 期望目录结构

```text
src/
├── main/
│   └── index.ts
├── preload/
│   └── index.ts
└── renderer/
    ├── main.tsx
    ├── App.tsx
    └── components/
```

## 本阶段验收标准

```text
1. 应用可以启动。
2. 能打开 Electron 窗口。
3. 页面中能看到基础布局。
4. 主进程和渲染进程可以通过 IPC 通信。
5. Electron 安全配置正确：
   - contextIsolation: true
   - nodeIntegration: false
6. 未实现任何 ES 连接、查询、索引等业务功能。
```

## 完成后让 AI 自查

```text
请检查阶段 1 是否完成：
1. Electron 是否能正常启动？
2. React 页面是否正常渲染？
3. IPC 示例是否可用？
4. 是否开启 contextIsolation？
5. 是否关闭 nodeIntegration？
6. 是否误实现了后续阶段功能？
```
