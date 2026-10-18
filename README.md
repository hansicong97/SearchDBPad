# SearchDBPad

> Languages: **English** | [简体中文](README.zh-CN.md)

SearchDBPad is a Windows-first desktop client for search-engine data management. Version 0.4.1 includes built-in Elasticsearch, OpenSearch, and Solr adapters behind a shared capability model. Elasticsearch and OpenSearch expose DSL-oriented workflows; Solr uses collection/schema metadata and native `q`/`fq`/`sort` query parameters.

Download the Windows x64 installer or portable build from [GitHub Release v0.4.1](https://github.com/hansicong97/SearchDBPad/releases/tag/v0.4.1). Release notes include the verification scope and known limitations.

Built on Electron + React + TypeScript with a three-process architecture (main / preload / renderer) and `contextIsolation: true`, `nodeIntegration: false` as the security baseline.

macOS support is on the roadmap but not yet wired up. See [Roadmap](#roadmap).

## Features

- **Connection management** — save / edit / delete / test connections for the built-in engines, with no-auth / Basic Auth
- **Cluster + resource browser** — health, version, index/collection/core lists, schema or mapping metadata
- **Document browser** — paginated list, sort, filter
- **Query** — capability-aware simple queries, Elasticsearch/OpenSearch DSL, and Solr native parameters
- **Document CRUD** — create, edit, delete, bulk delete
- **Export** — manifest-supported JSON / NDJSON / CSV to a file you pick (UTF-8 BOM CSV for Excel compatibility)
- **Import** — manifest-supported JSON / NDJSON / CSV, with bounded batches, progress, cancellation, and preview
- **Localized UI** — Ant Design `zhCN` locale, dialogs and messages in Chinese
- **Appearance settings** — File → Settings offers light, dark, and system themes with a saved preference; the workspace starts directly below the native menu. See the [v0.4.1 release notes](docs/releases/v0.4.1.md).

## Tech stack

- **Electron 32** (main + preload + renderer)
- **React 18 + TypeScript 5 + Vite 5**
- **Ant Design 5** UI kit
- **Monaco Editor** for JSON query body
- **Native HTTP adapters** for Elasticsearch, OpenSearch, and Solr; engine-specific compatibility lives in `src/main/adapters/<engine>/`
- **electron-store 8** for persisting connection configs
- **Zustand** for renderer state
- **electron-builder 25** for packaging

## Repository layout

```
src/
  main/         Electron main process — owns the BrowserWindow, adapters, services, persistence, IPC handlers, and network access
  preload/      typed contextBridge surface exposed to the renderer as window.searchApi
  renderer/     React app (Vite root)
  shared/       ipc.ts — channel constants + payload/result types shared by all three layers
build/          electron-builder resources (installer.nsh, icon if added later)
ai-dev-steps/   Version plans, release notes, and collaboration templates
```

The renderer's `dist/` output is loaded by the main process at runtime; the `dist/` tree (`main/`, `preload/`, `renderer/`, `shared/`) is the deployable artifact. Generated `dist/` files are not source files.

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
npm test              # Vitest unit and adapter contract tests
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

- NSIS: `release/SearchDBPad-<version>-x64.exe` — full installer with desktop / start-menu shortcuts, allows choosing install directory. Uninstaller prompts before deleting `electron-store` data (see `build/installer.nsh`).
- Portable: `release/SearchDBPad-<version>-portable.exe` — double-click to run, no registry / start-menu writes. Good for "drop on a USB stick" use.

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

`src/main/index.ts` sets `contextIsolation: true` and `nodeIntegration: false`. The renderer can only reach the file system, network, and shell through the `preload → ipcMain` surface defined in `src/shared/ipc.ts`. Renderer code is typed against `window.searchApi` via the `SearchApi` type exported from the preload; never re-declare the surface.

A `<!--CSP-->` placeholder in `src/renderer/index.html` is replaced by a Vite plugin (`vite.config.ts` → `cspPlugin`) with a permissive CSP in dev and a strict CSP in the production build. Do not hard-code a `<meta http-equiv="Content-Security-Policy">` in `index.html` — the plugin owns it.

## Roadmap

Product discussion drafts (not committed release scope): [candidate directions](docs/plans/2026-10-18-product-directions.md) and [query workbench upgrade](docs/plans/2026-10-18-query-workbench-discussion.md). Both drafts are currently in Chinese and separate verified implementation from proposed behavior and open decisions.

The product scope is documented in [`SEARCHDBPad_CLIENT_PLAN.md`](SEARCHDBPad_CLIENT_PLAN.md). Current and future version work is organized under `ai-dev-steps/` when that directory is present in the checkout:

```
releases/                    completed version notes (V0.1.x onward)
future-releases/             pending version plans (V0.3.x and V0.4.x)
templates/                   collaboration, review, and bug-fix templates
```

### Future plans

- **macOS support** — wiring up `dist:mac` (DMG + ZIP, Intel + Apple Silicon) is deferred. electron-builder only supports `--mac` on macOS itself, so this will land alongside a `macos-latest` GitHub Actions runner rather than as a local Windows run.
- **Multi-engine support** — built-in Elasticsearch, OpenSearch, and Solr adapters are available in 0.4.0. The compatibility target is Elasticsearch 6.x–9.x, OpenSearch 1.x/2.x, and Solr 8/9. Fixtures and unit/contract tests are available; live servers and Electron UI still require release-gate verification.

### Executable follow-up route

The next work is ordered by risk and reuse. Each phase should close its fixture tests, live-server checks, UI checks, and release documentation before the next phase starts.

| Priority | Focus | Deliverables |
|---|---|---|
| P0 | Stability and maintainability | Versioned adapter contracts, IPC validation and secret redaction, stale-response protection, real cancellation, streaming transfer, Vitest/CI, and the compatibility matrix |
| P1 | Query workflow | Query history and favorites, templates, schema-aware field selection, deep pagination (`search_after`/PIT where supported), configurable result columns, task history, and resumable export jobs |
| P2 | Engine coverage | OpenSearch 1.x/2.x live acceptance, Solr 8/9 read-only acceptance, then Solr writes and JSON/CSV transfer with uniqueKey and commit semantics |
| P3 | Advanced integration | Cross-engine migration wizard, SSH tunnels, connection groups and secret providers, then a signed versioned plugin protocol and optional installation |

External plugins and on-demand downloads remain a later boundary. They should follow at least two stable non-ES adapters, versioned contracts, permission isolation, signature verification, and rollback behavior; a dynamic import alone would not reduce the shipped package.

### Verification checklist

| Area | Current evidence | Still required |
|---|---|---|
| Architecture and IPC | capability manifests, typed preload bridge, and source-level checks | live protocol and security review |
| Adapter behavior | deterministic fixtures and contract tests for ES/OpenSearch/Solr | real ES 6.x–9.x, OpenSearch 1.x/2.x, and Solr 8/9 servers |
| Renderer behavior | capability gating and engine-specific query/transfer controls in source | Electron UI checks for loading, empty, error, success, cancellation, and destructive confirmation |
| Build | `npm run typecheck`, `npm test`, and `npm run build` | run and record `npm run pack`/Windows installers in a stable Node.js 20+ environment |

The [0.4.0 continuation record](docs/releases/0.4.0-continuation-2026-10-17.md) records the resumed work, exact local verification commands, packaging limitations, and remaining release gates. Import preview and execution use the connection manifest: native Solr JSON fields are preserved, while ES/OpenSearch CSV `_id` columns restore document IDs.

## License

MIT
