const CANCELLED_ERROR_CODE = 'CANCELLED'

export const USER_STOPPED_MESSAGE = '用户已停止'

const activeJobs = new Set<string>()
const cancelledJobs = new Set<string>()
const jobControllers = new Map<string, AbortController>()
const allJobsSettledWaiters = new Set<() => void>()

export function markJobActive(jobId: string): void {
  if (jobId.trim().length === 0) return
  activeJobs.add(jobId)
  if (!jobControllers.has(jobId)) jobControllers.set(jobId, new AbortController())
}

export function isJobActive(jobId: string): boolean {
  return activeJobs.has(jobId)
}

/** Return whether any import, export, or other long-running job is still active. */
export function hasActiveJobs(): boolean {
  return activeJobs.size > 0
}

/**
 * Resolve when every currently active job has released its lifecycle state.
 *
 * Callers normally cancel jobs before waiting during application shutdown. The
 * promise also resolves immediately when there is no active work, which keeps
 * the helper safe for normal lifecycle checks.
 */
export function waitForAllJobs(): Promise<void> {
  if (!hasActiveJobs()) return Promise.resolve()

  return new Promise<void>((resolve) => {
    allJobsSettledWaiters.add(resolve)
  })
}

export function markCancelled(jobId: string): void {
  if (!activeJobs.has(jobId)) return
  cancelledJobs.add(jobId)
  jobControllers.get(jobId)?.abort(createCancelledError())
}

export function getJobSignal(jobId: string): AbortSignal | undefined {
  return jobControllers.get(jobId)?.signal
}

/** Abort active work before closing its owning window or application. */
export function cancelAllJobs(): void {
  for (const jobId of activeJobs) markCancelled(jobId)
}

export function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId)
}

export function clearCancelled(jobId: string): void {
  cancelledJobs.delete(jobId)
  activeJobs.delete(jobId)
  jobControllers.delete(jobId)

  if (activeJobs.size === 0 && allJobsSettledWaiters.size > 0) {
    const waiters = [...allJobsSettledWaiters]
    allJobsSettledWaiters.clear()
    for (const resolve of waiters) resolve()
  }
}

export interface CancelledJobError extends Error {
  code: typeof CANCELLED_ERROR_CODE
}

export function createCancelledError(): CancelledJobError {
  const err = new Error(USER_STOPPED_MESSAGE) as CancelledJobError
  err.code = CANCELLED_ERROR_CODE
  return err
}

export function isCancelledError(err: unknown): err is CancelledJobError {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code?: unknown }).code === CANCELLED_ERROR_CODE
  )
}
