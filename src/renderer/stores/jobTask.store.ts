/**
 * Renderer-side global job-task aggregator (V0.3.10 F-5).
 *
 * Imports and exports push progress events to the renderer over
 * `import:progress` / `export:progress` (see `jobProgress.ts` on the
 * main side). Each panel used to subscribe on its own and render only
 * when the user happened to be on the matching tab. That meant a
 * long-running import running in the background while the user
 * navigated to another index, opened a different connection, or
 * switched tabs disappeared from view.
 *
 * V0.3.10 F-5 introduces this store to keep a single, session-wide
 * view of every import / export job the renderer has heard about,
 * keyed by `jobId`. The `JobTaskFloatButton` reads from this store
 * and surfaces the list as a right-bottom floating panel so the
 * user can keep an eye on jobs in flight regardless of the current
 * page.
 *
 * Design notes:
 *   - The list is NOT persisted: clearing it on app restart is the
 *     intended behavior (per the V0.3.10 plan, no historical task
 *     browser is in scope).
 *   - The store does NOT own the IPC subscription. `JobTaskFloatButton`
 *     subscribes once on mount via the `onProgress` callbacks
 *     already exposed on `window.esApi` and forwards events into
 *     this store. The individual panels keep their own
 *     `onProgress` subscriptions unchanged.
 *   - Job metadata (target index, file path, output path, format)
 *     is registered by the calling panel via `registerImportTask` /
 *     `registerExportTask` BEFORE the IPC `execute` call. The
 *     progress events themselves only carry the `jobId` and the
 *     counters; the metadata is what makes the floating panel
 *     human-readable.
 *   - The aggregator is best-effort: if a panel forgets to register
 *     the metadata, the task will still appear in the panel — the
 *     user just sees less context (jobId, type, stage, counters).
 */

import { create } from 'zustand'
import type {
  ExportFormat,
  ImportFormat,
  ImportProgress,
  ExportProgress
} from '@shared/ipc'

export type JobTaskKind = 'import' | 'export'

export type JobTaskStage = 'queued' | 'running' | 'completed' | 'failed'

export interface ImportJobMeta {
  connectionId: string
  index: string
  filePath: string
  format: ImportFormat
}

export interface ExportJobMeta {
  connectionId: string
  index: string
  format: ExportFormat
  outputPath: string
}

export interface JobTask {
  jobId: string
  kind: JobTaskKind
  /** Wall-clock start (ms). Used to keep the list ordered even when
   *  progress events arrive out of order. */
  startedAt: number
  /** V0.3.10 F-5 metadata. `undefined` for jobs where the calling
   *  panel forgot to register (the panel will still show the
   *  progress counters, just with less context). */
  importMeta?: ImportJobMeta
  exportMeta?: ExportJobMeta
  /** Latest progress snapshot. For imports this is the import-side
   *  fields; for exports the export-side ones. We keep the raw
   *  `import` / `export` snapshots separate so the panel can use
   *  the canonical IPC types when rendering. */
  importProgress?: ImportProgress
  exportProgress?: ExportProgress
  /** Coarse stage derived from the most recent progress event. */
  stage: JobTaskStage
}

interface JobTaskState {
  tasks: JobTask[]

  /* --- registration ---------------------------------------------- */

  /** Register an import job's metadata BEFORE the IPC execute call.
   *  The `jobId` is the one the main process will emit in progress
   *  events. The caller is responsible for generating it (the
   *  `runImport` workspace action does so on its side; the import
   *  panel hands the returned `jobId` to the store immediately
   *  after `runImport` resolves). */
  registerImportTask: (jobId: string, meta: ImportJobMeta) => void
  /** Same as `registerImportTask` for exports. */
  registerExportTask: (jobId: string, meta: ExportJobMeta) => void

  /* --- progress ingestion ---------------------------------------- */

  upsertImportProgress: (p: ImportProgress) => void
  upsertExportProgress: (p: ExportProgress) => void

  /* --- bookkeeping ----------------------------------------------- */

  /** Drop one job from the list (e.g. the user clicked the close
   *  icon next to a finished task). */
  removeTask: (jobId: string) => void
  /** Drop every job that has reached a terminal stage. Running
   *  jobs are kept. */
  clearFinished: () => void
}

export const useJobTaskStore = create<JobTaskState>((set) => ({
  tasks: [],

  registerImportTask: (jobId, meta) => {
    set((s) => {
      // Defensive de-dup: if the jobId is already present (e.g. a
      // rapid second submit), update the metadata in place rather
      // than creating a duplicate entry.
      const existing = s.tasks.find((t) => t.jobId === jobId)
      if (existing) {
        return {
          tasks: s.tasks.map((t) =>
            t.jobId === jobId
              ? { ...t, importMeta: meta, stage: t.stage === 'queued' ? 'running' : t.stage }
              : t
          )
        }
      }
      const next: JobTask = {
        jobId,
        kind: 'import',
        startedAt: Date.now(),
        importMeta: meta,
        stage: 'running'
      }
      return { tasks: [next, ...s.tasks] }
    })
  },

  registerExportTask: (jobId, meta) => {
    set((s) => {
      const existing = s.tasks.find((t) => t.jobId === jobId)
      if (existing) {
        return {
          tasks: s.tasks.map((t) =>
            t.jobId === jobId
              ? { ...t, exportMeta: meta, stage: t.stage === 'queued' ? 'running' : t.stage }
              : t
          )
        }
      }
      const next: JobTask = {
        jobId,
        kind: 'export',
        startedAt: Date.now(),
        exportMeta: meta,
        stage: 'running'
      }
      return { tasks: [next, ...s.tasks] }
    })
  },

  upsertImportProgress: (p) => {
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.jobId === p.jobId)
      const stage: JobTaskStage =
        p.stage === 'completed'
          ? 'completed'
          : p.stage === 'failed'
            ? 'failed'
            : 'running'
      if (idx === -1) {
        // Progress event without prior registration — record a
        // minimal task so the user still sees something.
        const next: JobTask = {
          jobId: p.jobId,
          kind: 'import',
          startedAt: Date.now(),
          importProgress: p,
          stage
        }
        return { tasks: [next, ...s.tasks] }
      }
      const cur = s.tasks[idx]
      const updated: JobTask = {
        ...cur,
        importProgress: p,
        stage
      }
      const copy = s.tasks.slice()
      copy[idx] = updated
      return { tasks: copy }
    })
  },

  upsertExportProgress: (p) => {
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.jobId === p.jobId)
      const stage: JobTaskStage =
        p.stage === 'completed'
          ? 'completed'
          : p.stage === 'failed'
            ? 'failed'
            : 'running'
      if (idx === -1) {
        const next: JobTask = {
          jobId: p.jobId,
          kind: 'export',
          startedAt: Date.now(),
          exportProgress: p,
          stage
        }
        return { tasks: [next, ...s.tasks] }
      }
      const cur = s.tasks[idx]
      const updated: JobTask = {
        ...cur,
        exportProgress: p,
        stage
      }
      const copy = s.tasks.slice()
      copy[idx] = updated
      return { tasks: copy }
    })
  },

  removeTask: (jobId) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.jobId !== jobId) }))
  },

  clearFinished: () => {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.stage === 'running')
    }))
  }
}))

/* ------------------- selectors ------------------- */

/** Number of jobs that are still in flight. Used to render the
 *  badge dot on the floating button. */
export function selectRunningJobCount(s: JobTaskState): number {
  let n = 0
  for (const t of s.tasks) if (t.stage === 'running') n += 1
  return n
}
