# ES Desktop Client

> Languages: **English** | [简体中文](README.zh-CN.md)

A Windows desktop client for Elasticsearch, structured like Navicat-for-MySQL — saved connections, cluster + index browsing, document CRUD, simple queries, and bulk import / export.

Built on Electron + React + TypeScript with a three-process architecture (main / preload / renderer) and `contextIsolation: true`, `nodeIntegration: false` as the security baseline.

macOS support is on the roadmap but not yet wired up. See [Roadmap](#roadmap).

## Features

- **Connection management** — save / edit / delete / test ES connections, with basic / API-key auth
- **Cluster + index browser** — health, version, node list, index stats, mapping
- **Document browser** — paginated list, sort, filter
- **Query** — JSON query body editor (Monaco), single-doc get by `_id`
- **Document CRUD** — create, edit, delete, bulk delete
- **Export** — JSON / NDJSON / CSV to a file you pick (UTF-8 BOM CSV for Excel compatibility)
- **Import** — JSON array / NDJSON (Bulk or plain) / CSV, with 10-row preview before commit
- **Localized UI** — Ant Design `zhCN` locale, dialogs and messages in Chinese

## Tech stack

- **Electron 32** (main + preload + renderer)
- **React 18 + TypeScript 5 + Vite 5**
- **Ant Design 5** UI kit
- **Monaco Editor** for JSON query body
- **@elastic/elasticsearch 8.15** client (the only place that talks to ES)
- **electron-store 8** for persisting connection configs
- **Zustand** for renderer state
- **electron-builder 25** for packaging

## Repository layout

```
src/
  main/         Electron main process — owns the BrowserWindow, registers IPC handlers, talks to ES
  preload/      contextBridge surface exposed to the renderer as window.esApi
  renderer/     React app (Vite root)
  shared/       ipc.ts — channel constants + payload/result types shared by all three layers
build/          electron-builder resources (installer.nsh, icon if added later)
ai-dev-steps/   Per-phase work orders (see ES_DESKTOP_CLIENT_PLAN.md for the roadmap)
```

The renderer's `dist/` output is loaded by the main process at runtime; the `dist/` tree (`main/`, `preload/`, `renderer/`, `shared/`) is the deployable artifact.

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Windows 10 / 11 for `npm run dist` targets (NSIS installer + portable `.exe`)

## Install

```bash
npm install
```

## Develop

```bash
npm run dev
```

Vite serves the renderer on `http://localhost:5173`, the main process compiles via `tsconfig.main.json` (CommonJS → `dist/main/`), and Electron launches once the dev server is up. The main process reads `process.env.NODE_ENV === 'development'` to decide between the dev URL and the built `dist/renderer/index.html`.

```bash
npm run typecheck     # tsc --noEmit for both tsconfigs
npm run build         # tsc main + vite build renderer (no packaging)
npm start             # run Electron against the built output
```

## Packaging

`npm run pack` writes `release/win-unpacked/` (just the `.exe` + app dir, no installer) — fastest way to verify the bundle runs without waiting for NSIS assembly. All other `dist:*` commands build via electron-builder.

### Windows

| Command | Output |
| --- | --- |
| `npm run dist` | NSIS installer + portable `.exe` |
| `npm run dist:win` | Same as `dist`, explicit Windows target |
| `npm run dist:portable` | Single-file 绿色版 (self-extracting `.exe`, no installation) |

- NSIS: `release/ES Desktop Client-<version>-x64.exe` — full installer with desktop / start-menu shortcuts, allows choosing install directory. Uninstaller prompts before deleting `electron-store` data (see `build/installer.nsh`).
- Portable: `release/ES Desktop Client-<version>-portable.exe` — double-click to run, no registry / start-menu writes. Good for "drop on a USB stick" use.

### Quick packaging reference

```bash
# Fastest sanity check
npm run pack

# Windows NSIS installer + portable
npm run dist:win

# Windows portable only
npm run dist:portable
```

## Security model

`src/main/index.ts` sets `contextIsolation: true` and `nodeIntegration: false`. The renderer can only reach the file system, network, and shell through the `preload → ipcMain` surface defined in `src/shared/ipc.ts`. Renderer code is typed against `window.esApi` via the `EsApi` type exported from the preload; never re-declare the surface.

A `<!--CSP-->` placeholder in `src/renderer/index.html` is replaced by a Vite plugin (`vite.config.ts` → `cspPlugin`) with a permissive CSP in dev and a strict CSP in the production build. Do not hard-code a `<meta http-equiv="Content-Security-Policy">` in `index.html` — the plugin owns it.

## Roadmap

Full product spec and phased roadmap live in `ES_DESKTOP_CLIENT_PLAN.md`. Per-phase work orders live in `ai-dev-steps/`:

```
01_PROJECT_INIT              done
02_CONNECTION_MANAGEMENT
03_CLUSTER_AND_INDEX_LIST
04_INDEX_DETAIL
05_DOCUMENT_QUERY
06_SIMPLE_QUERY
07_DOCUMENT_CRUD
08_EXPORT
09_IMPORT
10_PACKAGE_RELEASE
```

### Future plans

- **macOS support** — wiring up `dist:mac` (DMG + ZIP, Intel + Apple Silicon) is deferred. electron-builder only supports `--mac` on macOS itself, so this will land alongside a `macos-latest` GitHub Actions runner rather than as a local Windows run.

## License

MIT
