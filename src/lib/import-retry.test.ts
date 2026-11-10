/**
 * withOneRetry(): a chunk that failed (after the bundler's own retry) gets exactly one more ask, about 1.5 s later.
 * What must hold: a load that works is untouched; a short outage is survived; a long one costs one extra request and
 * rejects, never a loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withOneRetry } from './import-retry'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('withOneRetry', () => {
  it('a load that works is asked once and answers at once', async () => {
    const mod = { n: 1 }
    const load = vi.fn(async () => mod)
    await expect(withOneRetry(load)).resolves.toBe(mod)
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a failed load is asked once more after 1.5 s, and that answer is the result', async () => {
    const mod = { n: 1 }
    const load = vi.fn().mockRejectedValueOnce(new Error('ChunkLoadError')).mockResolvedValueOnce(mod)
    let got: unknown = null
    void withOneRetry(load).then((m) => { got = m })
    await vi.advanceTimersByTimeAsync(1499)
    expect(load).toHaveBeenCalledTimes(1) // still waiting: not an immediate second ask
    expect(got).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(got).toBe(mod)
  })

  it('a second failure rejects with that failure, and nothing asks a third time', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'))
    const result = withOneRetry(load)
    const settled = expect(result).rejects.toThrow('second')
    await vi.advanceTimersByTimeAsync(60_000)
    await settled
    expect(load).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the wait can be set', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(2)
    const result = withOneRetry(load, 300)
    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toBe(2)
  })
})
