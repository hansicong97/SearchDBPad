# AGENTS.md

> Language: **English (canonical)** | [简体中文对照](AGENTS.zh-CN.md)

This file is the repository guide for coding agents and human contributors. It is tool-agnostic: follow it whether the task is performed by Claude, Codex, an IDE assistant, or a person.

`AGENTS.zh-CN.md` is the informational Chinese translation. Keep its sections, commands, paths, and API names synchronized whenever this file changes; resolve any conflict in favor of this English file.

## Project scope

SearchDBPad is a Windows-first Electron desktop client for search-engine data management. Version 0.4.0 includes built-in adapters targeting Elasticsearch 6.x–9.x, OpenSearch 1.x/2.x, and Solr 8/9. Fixtures establish protocol coverage; live-server and desktop verification remain separate release gates.

The product plan is in `SEARCHDBPad_CLIENT_PLAN.md`. Version plans and release notes are under `ai-dev-steps/future-releases/` and `ai-dev-steps/releases/` when that directory is available in the checkout. `ai-dev-steps/templates/` contains the collaboration, bug-fix, and review templates.

## Useful commands

```bash
npm install
npm run dev              # Vite renderer + Electron
npm run typecheck        # renderer/shared and main/preload TypeScript checks
npm run build            # main/preload compilation + renderer production build
npm test                 # Vitest unit and adapter contract tests
npm start                # Electron against the built output
npm run pack             # unpacked electron-builder smoke package
npm run dist:win         # Windows NSIS + portable packages
npm run dist:portable    # Windows portable package only
```

The project expects Node.js 20 or newer and npm 10 or newer. `npm run dist:*` targets Windows. macOS packaging must run on macOS (normally in a macOS CI job) and is not a valid local Windows verification step.

## Architecture

- `src/main/`: Electron main process, IPC handlers, persistence, search-engine services, and network access.
- `src/preload/`: isolated bridge exposed as `window.searchApi`; keep this surface small and typed. `window.esApi` is not part of the current renderer API.
- `src/renderer/`: React 18 + Ant Design + Vite UI. It must not access Node APIs or search engines directly.
- `src/shared/`: IPC channel names and renderer-facing contracts shared by the three layers.
- `src/main/search/`: engine-neutral adapter contracts, registry, errors, and version cache.
- `src/main/adapters/<engine>/`: engine-specific HTTP and version compatibility code.
- `src/main/services/`: business orchestration. Services resolve an adapter and should not import engine-specific APIs.
- `src/main/store/`: local persistence for connections, favorites, and other app data.

The renderer bundle is written to `dist/renderer/`; compiled main, preload, and shared code is written below `dist/`. These build outputs are generated artifacts.

## Non-negotiable boundaries

1. Preserve Electron `contextIsolation: true` and `nodeIntegration: false`.
2. Keep filesystem, network, and shell access in the main process. Expose only explicit, typed operations through preload and IPC.
3. Add every IPC channel and its request/result types to `src/shared/ipc.ts` first, then implement the main handler and preload method. Keep all three layers synchronized.
4. Keep engine-specific URL shapes, authentication details, version quirks, and response mapping inside the corresponding adapter.
5. Services must depend on `SearchEngineAdapter` (or a smaller capability contract), not on Elasticsearch modules.
6. Do not log passwords, API keys, full authorization headers, or raw connection secrets. Do not echo secrets in user-facing errors.
7. Preserve the CSP marker in `src/renderer/index.html`; `vite.config.ts` injects the dev and production policies.

## Working on a feature

Before editing:

1. Inspect `git status` and preserve unrelated user changes.
2. Read the relevant section of `SEARCHDBPad_CLIENT_PLAN.md` and, for versioned work, the single matching plan under `ai-dev-steps/future-releases/`.
3. Check the current implementation and nearby types before introducing a new abstraction.
4. State the files and behavior that will change. Keep the scope to the requested version or bug.

During implementation:

- Prefer the existing React, Ant Design, Zustand, TypeScript, and HTTP adapter patterns.
- Do not add a dependency unless the requirement cannot be met with the current stack; explain the reason and update the lockfile when a dependency is approved.
- Avoid speculative abstractions. Extract a shared contract only when two engines or two real product flows need it.
- Keep compatibility behavior explicit. Persisted connections without `engineType` must continue to read as Elasticsearch until a migration is deliberately introduced.
- For long-running import, export, or cluster operations, use the existing job/progress/cancellation mechanism and ensure cleanup on success, failure, and cancellation.
- For destructive actions, require a clear confirmation and return actionable errors.

## Adapter and multi-engine evolution

Adapters implement a minimal base contract and optional capability contracts. Do not force an engine to implement methods it cannot support. When adding or expanding an adapter:

- publish a versioned adapter manifest and declare implemented capabilities;
- use capability-sized contracts and explicit optional operations;
- use engine-neutral resource/result names where the UI is shared, while retaining compatibility aliases for existing Elasticsearch IPC types;
- let the renderer hide or disable unsupported actions from capabilities rather than discovering support through failed requests;
- keep engine-specific views for genuinely different models (for example Solr collections/schema versus Elasticsearch indices/mappings);
- add contract tests for each adapter and a compatibility matrix for supported server versions.

## Testing and verification

Vitest is configured in `vitest.config.mts`; deterministic tests live in `tests/unit`. Windows CI runs typecheck, tests, production build, and unpacked packaging. Fixtures alone do not establish live-server compatibility.

At minimum, run `npm run typecheck`, `npm test`, and `npm run build` after source changes. For packaging changes, also run `npm run pack` when the local environment permits. For UI changes, manually verify loading, empty, error, success, cancellation, and destructive-confirmation states. For adapter changes, use representative fixtures for Elasticsearch 6.x–9.x, OpenSearch 1.x/2.x, and Solr 8/9; live-server verification remains a separate release gate.

Record verification at the level actually performed: deterministic unit or contract fixtures, live server checks, and Electron UI checks are separate evidence. Do not describe fixture coverage as proof of live compatibility, and do not claim `npm run pack` passed unless it was run successfully in the current environment.

Maintain deterministic unit tests for:

- adapter registry and capability resolution;
- version and request-shape compatibility helpers;
- IPC request/result validation and error mapping;
- import/export parsing, escaping, batching, progress, and cancellation;
- connection persistence migration and secret redaction.

## Documentation and delivery

Use the current code and `package.json` as the source of truth for shipped behavior, authentication modes, dependencies, and app version. Use a matching future release plan as the source of truth for that change's scope; the older product plan is background and may describe historical states.

Update the relevant plan or release note when behavior, IPC contracts, supported engines, or packaging changes. Keep both READMEs consistent with the actual UI, dependencies, and supported auth modes. Do not rewrite historical release notes; add a new note or an erratum.

At the end of a change, report the behavior implemented, files changed, commands run, verification result, and intentional follow-up work. If a check could not run because of the environment, say so explicitly.
