# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

SearchDBPad is a Windows desktop client for search engine data management. The current implementation focuses on Elasticsearch, with long-term plans to support mainstream search engines such as Solr. The full product spec and phased roadmap live in `ES_DESKTOP_CLIENT_PLAN.md`; per-phase work orders live in `ai-dev-steps/`.

## Commands

```bash
npm install              # one-time setup
npm run dev              # Vite (renderer) + Electron together
npm run build            # tsc main/preload + vite build renderer
npm start                # run Electron against the built output
npm run typecheck        # tsc --noEmit for both tsconfigs
npm run pack             # build + electron-builder --dir (unpacked, fast smoke test)
npm run dist             # build + electron-builder (NSIS + portable installer)
npm run dist:win         # same as `dist`, explicit Windows target
npm run dist:portable    # build + electron-builder --win portable (green/免安装 single-file)
```

macOS support is on the roadmap but not currently wired up. electron-builder only supports `--mac` on macOS itself, so to enable it later: re-add a `mac` block to the `build` field in `package.json`, add a `dist:mac` script, and run the build on a Mac (or via a `macos-latest` GitHub Actions runner).

`npm run pack` writes `release/win-unpacked/` (just the .exe + app dir, no installer) — fastest way to verify the bundle runs without waiting for NSIS assembly. `npm run dist` produces `release/SearchDBPad-<version>-x64.exe` (NSIS installer) and `release/SearchDBPad-<version>-portable.exe` (single-file portable). `npm run dist:portable` is the 绿色版: a single self-extracting `.exe` that runs without installation — drop it anywhere, double-click, no registry/start-menu writes.

macOS targets: `dist:mac` produces `release/SearchDBPad-<version>-x64.dmg` / `-arm64.dmg` (DMG requires building on macOS — uses `hdiutil`) and `.zip` of the `.app` folder. From Windows or Linux, only the `.zip` part succeeds — use `dist:mac-zip` to skip the DMG step. Builds are unsigned/unnotarized without an Apple Developer ID; macOS users will need to right-click → Open the first time. For official distribution, build on a Mac with `CSC_LINK` / `CSC_KEY_PASSWORD` set or use a macOS GitHub Actions runner.

Packaging is configured under the `build` field in `package.json` (electron-builder v25). The default Electron icon is used — drop a `build/icon.ico` (256x256 recommended) to override.

The dev script uses `concurrently` + `wait-on` to wait for Vite on `http://localhost:5173` before launching Electron. The main process checks `process.env.NODE_ENV === 'development'` to decide between loading the dev URL and the built `dist/renderer/index.html`.

## Architecture

Three-process Electron layout, all in TypeScript:

- **`src/main/`** — Electron main process. Owns the `BrowserWindow`, registers `ipcMain.handle(...)` for every IPC channel, is the only place that talks to Elasticsearch in the current implementation. Compiled by `tsconfig.main.json` (CommonJS) to `dist/main/`.
- **`src/preload/`** — Runs in the isolated renderer context. Exposes a small typed surface as `window.esApi` via `contextBridge`. Never import Node APIs into the renderer directly.
- **`src/renderer/`** — React 18 + Ant Design + Vite. Bundled by `vite.config.ts` (which uses `src/renderer` as root, builds to `dist/renderer/`).
- **`src/shared/`** — Code imported by more than one of the three layers. Currently just `ipc.ts` (channel name constants + payload/result types). The renderer imports via relative path (Vite bundles it); main/preload import via tsc and rely on the `dist/shared/` output.

Renderer code types `window.esApi` through `src/renderer/types/global.d.ts`, which pulls the `EsApi` type from `src/preload/index.ts`.

### Security baseline (do not relax)

`src/main/index.ts` sets `contextIsolation: true` and `nodeIntegration: false`. Any new code must preserve both. Renderer-side state must never reach the filesystem, network, or shell without going through `preload` → `ipcMain`.

### CSP

`src/renderer/index.html` contains a `<!--CSP-->` placeholder. `vite.config.ts`'s `cspPlugin` replaces it with a permissive CSP in dev (allowing `http://localhost:5173` + `ws://localhost:5173` for HMR) and a strict CSP in the production build. The same `index.html` source is used for both — do not hard-code a meta tag in it.

## Phased development workflow

This project is built one phase at a time. Each phase has its own file under `ai-dev-steps/`:

```
00_AI_COLLABORATION_GUIDE.md   <- how to drive AI through the phases
01_PROJECT_INIT.md             <- done
02_CONNECTION_MANAGEMENT.md
03_CLUSTER_AND_INDEX_LIST.md
04_INDEX_DETAIL.md
05_DOCUMENT_QUERY.md
06_SIMPLE_QUERY.md
07_DOCUMENT_CRUD.md
08_EXPORT.md
09_IMPORT.md
10_PACKAGE_RELEASE.md
11_CODE_REVIEW_CHECKLIST.md    <- run after every phase
12_BUGFIX_TEMPLATE.md
```

When the user asks to "do phase X" or hands you `ai-dev-steps/NN_*.md`:

1. Read `ES_DESKTOP_CLIENT_PLAN.md` for the big picture.
2. Read the current step file in full.
3. Before editing, list the files you intend to create or change.
4. Implement **only** what the current step describes. Do not pull in features from later phases, even if they seem related. Do not refactor earlier-phase code unless the step explicitly asks for it.
5. Do not introduce dependencies that are not already in `package.json` without flagging the addition.
6. After implementation, report: completed items, files touched, how to start, how to verify, items intentionally left for later phases.
7. Run through `11_CODE_REVIEW_CHECKLIST.md` (security, scope, TS, UI checks) before declaring the phase done.

## Conventions

- Path aliases: `@/` → `src/renderer/`, `@shared/` → `src/shared/`. Both are configured in `tsconfig.json` and `vite.config.ts`; main-side resolution uses `tsconfig.main.json` paths.
- New IPC channels go in `src/shared/ipc.ts` first (constant + types), then `src/main/index.ts` registers a handler, then `src/preload/index.ts` exposes a method on `esApi`. Keep all three in sync.
- Ant Design 5 with `zhCN` locale, mounted under `ConfigProvider` + `AntdApp` (see `src/renderer/main.tsx`).
- Type the renderer against `window.esApi` using the exported `EsApi` type from the preload — do not re-declare the shape.
- The renderer's `dist/` output is loaded by the main process at runtime; the `dist/` tree (`main/`, `preload/`, `renderer/`, `shared/`) is the deployable artifact.
