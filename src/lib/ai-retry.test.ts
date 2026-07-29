import { describe, expect, it, vi } from 'vitest'
import { aiErrorStatus, isRetryableAiError, withAiRetry } from './ai-retry'

/**
 * This module decides whether a paid AI call is attempted a second time, so both directions cost
 * something real: too strict and the fallback model is unreachable, too loose and a permanent
 * failure is paid for twice out of a shared daily budget.
 */

const withStatus = (status: number, message = 'boom') => Object.assign(new Error(message), { status })

describe('isRetryableAiError — statusless failures', () => {
  it.each(['AbortError', 'TimeoutError', 'ConnectTimeoutError', 'HeadersTimeoutError'])(
    '%s is retryable — it is how a per-call timeout surfaces',
    (name) => {
      // ⚠️ THE BUG THIS EXISTS FOR. A timeout carries no .status/.code, so aiErrorStatus returns
      // null; the old predicate answered false and withAiRetry threw on attempt 1, meaning
      // GEMINI_MODEL_FALLBACK was never tried on the single most likely transient failure. The
      // visa portrait check has a 12s budget, so this was its most common outcome.
      expect(isRetryableAiError(Object.assign(new Error('x'), { name }))).toBe(true)
    },
  )

  it.each(['request timed out', 'socket hang up: ETIMEDOUT', 'the operation was aborted', 'read ECONNRESET'])(
    'retries a statusless error whose message says %s',
    (message) => {
      expect(isRetryableAiError(new Error(message))).toBe(true)
    },
  )

  it('does not retry an ordinary statusless error', () => {
    expect(isRetryableAiError(new Error('invalid argument'))).toBe(false)
  })
})

describe('⚠️ isRetryableAiError — a KNOWN status short-circuits the message heuristics', () => {
  it.each([408, 429, 500, 502, 503, 504])('retries transient status %i', (status) => {
    expect(isRetryableAiError(withStatus(status))).toBe(true)
  })

  it.each([400, 401, 403, 404, 422])('does NOT retry permanent status %i', (status) => {
    expect(isRetryableAiError(withStatus(status))).toBe(false)
  })

  it.each([
    [400, 'invalid value for the timeout parameter'],
    [401, 'credentials request aborted'],
    [403, 'connection timed out while checking permissions'],
  ])('status %i is still permanent even when its message says "%s"', (status, message) => {
    // Regression for the flaw codex caught on 2026-07-29: the first cut ran the message test after
    // the allowlist missed, so provider wording could turn a hard 400 into a second paid call.
    expect(isRetryableAiError(withStatus(status, message))).toBe(false)
  })

  it('a statusless SyntaxError is retryable — it is a bad response body, not a bad request', () => {
    // Both real sources are statusless: JSON.parse, and the extract route's own throw when the
    // parsed body has no `checks`.
    expect(isRetryableAiError(new SyntaxError('image_analysis_missing_checks'))).toBe(true)
  })

  it('⚠️ but a SyntaxError carrying a permanent status is NOT retryable', () => {
    // Second regression from the same review: hoisting the SyntaxError branch above the status
    // check reopened the permanent-retry hole through a narrower door. No SDK path is known to
    // produce this shape — the test pins the ordering rule, not an observed bug.
    expect(isRetryableAiError(Object.assign(new SyntaxError('timeout'), { status: 400 }))).toBe(false)
    expect(isRetryableAiError(Object.assign(new SyntaxError('bad gateway'), { status: 502 }))).toBe(true)
  })
})

describe('aiErrorStatus', () => {
  it('reads .status, then .code', () => {
    expect(aiErrorStatus(withStatus(429))).toBe(429)
    expect(aiErrorStatus(Object.assign(new Error('x'), { code: 503 }))).toBe(503)
  })

  it('is null for a statusless error, which is what made timeouts non-retryable', () => {
    expect(aiErrorStatus(new Error('boom'))).toBeNull()
    expect(aiErrorStatus(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull()
  })
})

describe('withAiRetry', () => {
  const attempts = [{ model: 'primary', delay: 0 }, { model: 'fallback', delay: 0 }]

  it('reaches the fallback model on a timeout — the whole point of the change', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('deadline'), { name: 'AbortError' }))
      .mockResolvedValueOnce('ok')
    await expect(withAiRetry(attempts, run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0]).toEqual({ model: 'fallback', delay: 0 })
  })

  it('does not spend a second call on a permanent failure', async () => {
    const run = vi.fn().mockRejectedValue(withStatus(400, 'timeout parameter invalid'))
    await expect(withAiRetry(attempts, run)).rejects.toMatchObject({ status: 400 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('stops after the last attempt even when the error is retryable', async () => {
    const run = vi.fn().mockRejectedValue(withStatus(503))
    await expect(withAiRetry(attempts, run)).rejects.toMatchObject({ status: 503 })
    expect(run).toHaveBeenCalledTimes(2)
  })
})
