# Multi-engine continuation implementation plan

**Goal:** Close concrete gaps in the existing 0.4.0 implementation of phases A–F from the supplied multi-engine plan, preserve the interrupted workspace, and record reproducible verification.

**Architecture:** Keep engine semantics in adapters, validate IPC input before side effects, and protect renderer state using connection/resource/request sequence identities. Preserve legacy Elasticsearch connections and compatibility aliases.

**Tech stack:** Electron, React, Zustand, TypeScript, native HTTP, Vitest; no new dependencies.

## Initial assessment

- All three built-in adapters and phases A–F have implementation paths. Initial checks: typecheck passes; 21 test files / 209 tests pass on installed Node 22.22.0.
- Existing implementation is ahead of the supplied plan's starting point. Do not restart it or expand this continuation into the later P1–P3 roadmap.
- Missing live services and desktop verification must remain explicit release gates.

## Tasks

1. **IPC validation:** Test malformed document, resource, task and import requests; validate before resolving an adapter or starting destructive work. Files: `src/main/services/document.service.ts`, `resource.service.ts`, `import.service.ts`, shared validation helpers and `tests/unit/`.
2. **Transfer semantics:** Preserve native Solr JSON fields named `fields`, `_source` and `_id`; keep ES document envelopes and CSV ID handling. Make preview and execution select the same parser semantics using the connection manifest. Files: `src/shared/ipc.ts`, `src/main/services/transferFiles.ts`, `import.service.ts`, `src/renderer/components/ImportPanel.tsx`, transfer tests.
3. **Stale metadata:** Add sequence guards to cluster/version, mapping/settings, aliases/templates and shards; invalidate requests on navigation/reset and settle rejected IPC calls safely. Files: `src/renderer/stores/workspace.store.ts`, `tests/unit/workspaceStore.test.ts`.
4. **Schema:** Recursively map ES/OpenSearch nested/object and multi-fields, including ES 6 typed mappings; retain raw engine metadata. Files: `src/shared/searchEngine.ts`, `src/main/adapters/elasticsearch/`, schema tests.
5. **Delivery:** Run `npm run typecheck`, `npm test`, `npm run build`, `npm run pack`; inspect the packaged application when the environment permits. Update tracked continuation/release documentation with actual results and outstanding live/UI gates.

## Scope decisions

- Keep `0.4.0`: this continues the existing uncommitted version, rather than inventing another release.
- Existing ES type aliases remain harmless compatibility aids; `window.searchApi` is canonical.
- TLS/proxy configuration, system credential storage, PIT, resumable jobs and external plugins are follow-up work, not claims of this baseline.
- Keep the original desktop plan and historical release notes unchanged. This tracked plan and a new verification note provide the handoff.

## Completion evidence

Tasks 1–4 are implemented and covered by regression tests. Task 5 completed typecheck, 24 test files / 254 tests, production build, offline unpacked packaging and partial native Electron UI checks, including read-only access to a real local ES 8.6.1 server. Default packaging remains blocked by mirror DNS resolution; live multi-version/multi-engine and full UI/installer acceptance remain release gates. Exact commands and results are in [the continuation record](../releases/0.4.0-continuation-2026-10-17.md).
