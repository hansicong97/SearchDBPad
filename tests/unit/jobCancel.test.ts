import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelAllJobs, clearCancelled, createCancelledError, getJobSignal, hasActiveJobs,
  isCancelled, isCancelledError, isJobActive, markCancelled, markJobActive,
  waitForAllJobs
} from '../../src/main/services/jobCancel.service'

const jobIds = ['first', 'second', 'inactive', 'reused']

afterEach(() => {
  for (const jobId of jobIds) clearCancelled(jobId)
})

describe('job cancellation lifecycle', () => {
  it('creates a stable signal while a job is active', () => {
    markJobActive('first')
    const signal = getJobSignal('first')
    markJobActive('first')

    expect(isJobActive('first')).toBe(true)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    expect(getJobSignal('first')).toBe(signal)
  })

  it('aborts active work and exposes a recognizable cancellation reason', () => {
    markJobActive('first')
    const signal = getJobSignal('first')

    markCancelled('first')

    expect(signal?.aborted).toBe(true)
    expect(isCancelled('first')).toBe(true)
    expect(isCancelledError(signal?.reason)).toBe(true)
  })

  it('ignores cancellation for inactive and blank job ids', () => {
    markJobActive(' ')
    markCancelled('inactive')

    expect(isJobActive(' ')).toBe(false)
    expect(isCancelled('inactive')).toBe(false)
    expect(getJobSignal('inactive')).toBeUndefined()
  })

  it('clears active, cancelled and controller state before reusing a job id', () => {
    markJobActive('reused')
    const original = getJobSignal('reused')
    markCancelled('reused')
    clearCancelled('reused')

    expect(isJobActive('reused')).toBe(false)
    expect(isCancelled('reused')).toBe(false)
    expect(getJobSignal('reused')).toBeUndefined()

    markJobActive('reused')
    expect(getJobSignal('reused')).not.toBe(original)
    expect(getJobSignal('reused')?.aborted).toBe(false)
  })

  it('aborts all active jobs on shutdown', () => {
    markJobActive('first')
    markJobActive('second')

    cancelAllJobs()

    expect(getJobSignal('first')?.aborted).toBe(true)
    expect(getJobSignal('second')?.aborted).toBe(true)
    expect(isCancelled('first')).toBe(true)
    expect(isCancelled('second')).toBe(true)
  })

  it('reports active work and resolves waiters when the final job is cleared', async () => {
    expect(hasActiveJobs()).toBe(false)
    markJobActive('first')
    markJobActive('second')
    expect(hasActiveJobs()).toBe(true)

    let settled = false
    const allJobsSettled = waitForAllJobs().then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    clearCancelled('first')
    await Promise.resolve()
    expect(settled).toBe(false)

    clearCancelled('second')
    await allJobsSettled
    expect(settled).toBe(true)
    expect(hasActiveJobs()).toBe(false)
  })

  it('resolves immediately when no jobs are active', async () => {
    await expect(waitForAllJobs()).resolves.toBeUndefined()
  })

  it('identifies cancellation by a stable error code', () => {
    expect(createCancelledError()).toMatchObject({ code: 'CANCELLED', message: '用户已停止' })
    expect(isCancelledError(createCancelledError())).toBe(true)
    expect(isCancelledError(new Error('CANCELLED'))).toBe(false)
    expect(isCancelledError({ code: 'CANCELLED' })).toBe(false)
    expect(isCancelledError(undefined)).toBe(false)
  })
})
