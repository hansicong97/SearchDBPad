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
 *     `registerExportTask`. Progress events themselves only carry
 *     the `jobId` and counters; the metadata is what makes the
 *     floating panel human-readable.
 *   - V0.3.11 adds a renderer-only `cancelling` stage so the UI can
 *     respond immediately after the user clicks Stop. The final
 *     state still comes from main-process progress events.
 *   - The aggregator is best-effort: if a panel forgets to register
 *     the metadata, the task will still appear in the panel — the
 *     user just sees less context (jobId, type, stage, counters).
 */

import { create } from 'zustand'
import type {
  ApiResponse,
  ExportCancelResult,
  ExportFormat,
  ExportProgress,
  ImportCancelResult,
  ImportFormat,
  ImportProgress
} from '@shared/ipc'

export type JobTaskKind = 'import' | 'export'

export type JobTaskStage = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed'

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

type CancelTaskResponse = ApiResponse<ImportCancelResult | ExportCancelResult>

interface JobTaskState {
  tasks: JobTask[]
  /** Job ids the user explicitly removed from the floating list.
   *  This is session-only and prevents late progress events from
   *  recreating a removed running task. */
  dismissedJobIds: Set<string>

  /* --- registration ---------------------------------------------- */

  registerImportTask: (jobId: string, meta: ImportJobMeta) => void
  registerExportTask: (jobId: string, meta: ExportJobMeta) => void

  /* --- progress ingestion ---------------------------------------- */

  upsertImportProgress: (p: ImportProgress) => void
  upsertExportProgress: (p: ExportProgress) => void

  /* --- actions / bookkeeping ------------------------------------- */

  cancelTask: (jobId: string) => Promise<CancelTaskResponse>
  /** Drop one job from the list. Removing a running/cancelling task
   *  also dismisses its jobId so later progress events do not make
   *  it reappear. */
  removeTask: (jobId: string) => void
  /** Drop every job that has reached a terminal stage. Running and
   *  cancelling jobs are kept. */
  clearFinished: () => void
}

function taskStageFromProgress(
  current: JobTask | undefined,
  progressStage: 'completed' | 'failed' | string
): JobTaskStage {
  if (progressStage === 'completed') return 'completed'
  if (progressStage === 'failed') return 'failed'
  return current?.stage === 'cancelling' ? 'cancelling' : 'running'
}

function errorResponse(message: string): CancelTaskResponse {
  return { success: false, error: { message } }
}

export const useJobTaskStore = create<JobTaskState>((set, get) => ({
  tasks: [],
  dismissedJobIds: new Set(),

  registerImportTask: (jobId, meta) => {
    set((s) => {
      if (s.dismissedJobIds.has(jobId)) return {}
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
      if (s.dismissedJobIds.has(jobId)) return {}
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
      if (s.dismissedJobIds.has(p.jobId)) return {}
      const idx = s.tasks.findIndex((t) => t.jobId === p.jobId)
      const cur = idx >= 0 ? s.tasks[idx] : undefined
      const stage = taskStageFromProgress(cur, p.stage)
      if (idx === -1) {
        const next: JobTask = {
          jobId: p.jobId,
          kind: 'import',
          startedAt: Date.now(),
          importProgress: p,
          stage
        }
        return { tasks: [next, ...s.tasks] }
      }
      const updated: JobTask = {
        ...cur!,
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
      if (s.dismissedJobIds.has(p.jobId)) return {}
      const idx = s.tasks.findIndex((t) => t.jobId === p.jobId)
      const cur = idx >= 0 ? s.tasks[idx] : undefined
      const stage = taskStageFromProgress(cur, p.stage)
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
      const updated: JobTask = {
        ...cur!,
        exportProgress: p,
        stage
      }
      const copy = s.tasks.slice()
      copy[idx] = updated
      return { tasks: copy }
    })
  },

  cancelTask: async (jobId) => {
    const task = get().tasks.find((t) => t.jobId === jobId)
    if (!task) return errorResponse('未找到任务')
    if (task.stage === 'completed' || task.stage === 'failed') {
      return { success: true, data: { jobId, cancelled: false } }
    }

    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.jobId === jobId && t.stage !== 'completed' && t.stage !== 'failed'
          ? { ...t, stage: 'cancelling' }
          : t
      )
    }))

    const res =
      task.kind === 'import'
        ? await window.esApi.importDocs.cancel({ jobId })
        : await window.esApi.exportDocs.cancel({ jobId })

    if (!res.success) {
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.jobId === jobId && t.stage === 'cancelling'
            ? { ...t, stage: 'running' }
            : t
        )
      }))
    }
    return res
  },

  removeTask: (jobId) => {
    set((s) => {
      const dismissedJobIds = new Set(s.dismissedJobIds)
      dismissedJobIds.add(jobId)
      return {
        dismissedJobIds,
        tasks: s.tasks.filter((t) => t.jobId !== jobId)
      }
    })
  },

  clearFinished: () => {
    set((s) => ({
      tasks: s.tasks.filter((t) => selectIsJobRunning(t))
    }))
  }
}))

/* ------------------- selectors ------------------- */

export function selectIsJobRunning(task: JobTask): boolean {
  return task.stage === 'running' || task.stage === 'cancelling'
}

/** Number of jobs that are still in flight. Used to render the
 *  badge dot on the floating button. */
export function selectRunningJobCount(s: JobTaskState): number {
  let n = 0
  for (const t of s.tasks) if (selectIsJobRunning(t)) n += 1
  return n
}
