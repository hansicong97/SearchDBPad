const CANCELLED_ERROR_CODE = 'CANCELLED'

export const USER_STOPPED_MESSAGE = '用户已停止'

const activeJobs = new Set<string>()
const cancelledJobs = new Set<string>()

export function markJobActive(jobId: string): void {
  if (jobId.trim().length === 0) return
  activeJobs.add(jobId)
}

export function isJobActive(jobId: string): boolean {
  return activeJobs.has(jobId)
}

export function markCancelled(jobId: string): void {
  if (jobId.trim().length === 0) return
  cancelledJobs.add(jobId)
}

export function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId)
}

export function clearCancelled(jobId: string): void {
  cancelledJobs.delete(jobId)
  activeJobs.delete(jobId)
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
