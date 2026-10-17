# SearchDBPad architecture

SearchDBPad is a Windows-first Electron application. The renderer is a React 18 and Ant Design UI; the main process owns filesystem, network, persistence, and long-running jobs. `contextIsolation` remains enabled and `nodeIntegration` remains disabled.

The renderer calls a small typed preload bridge. IPC request and result contracts live in `src/shared/ipc.ts`; the bridge and main handlers must be updated together. Services in `src/main/services/` orchestrate product flows and resolve an engine-neutral `SearchEngineAdapter`. Engine-specific URL paths, authentication, response mapping, and compatibility rules remain below `src/main/adapters/<engine>/`.

Adapters publish a manifest with a protocol family, supported transfer formats, query languages, and capabilities. Services select operations through optional adapter methods and do not import Elasticsearch or Solr modules. Import and export file parsing and serialization are shared services; adapters receive parsed rows or generic document hits.

Long-running imports and exports use a job id, progress events, and an `AbortSignal`. Temporary output is written before commit, cancellation closes streams and iterators, and terminal progress is emitted exactly once. Secrets are kept in the main process and are never included in logs or user-facing transport errors.
