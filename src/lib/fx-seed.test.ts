import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const load = async () => (await import('./fx-seed')).fxSeedUsd
const answer = (body: unknown) => vi.fn(async () => ({ json: async () => body }))

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('fxSeedUsd', () => {
  it('is the rate, read with force-cache so it never lowers a page\'s revalidate', async () => {
    const f = answer({ rates: { USD: 1 / 26_000 } })
    vi.stubGlobal('fetch', f)
    expect(await (await load())()).toBeCloseTo(1 / 26_000)
    const options = (f.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }])[1]
    expect(options.cache).toBe('force-cache')
    expect(options.next).toBeUndefined()
  })

  it.each([[{ rates: {} }], [{ rates: { USD: 'x' } }], [{ rates: { USD: 1 } }], [{ rates: { USD: 1 / 500_000 } }], [{}], [null]])('no usable rate is no seed: %j', async (body) => {
    vi.stubGlobal('fetch', answer(body))
    expect(await (await load())()).toBeNull()
  })

  it('a failure is no seed, and is remembered: a build must not wait on it page after page', async () => {
    vi.useFakeTimers()
    const f = vi.fn(async () => { throw new Error('down') })
    vi.stubGlobal('fetch', f)
    const seed = await load()
    expect(await seed()).toBeNull()
    expect(await seed()).toBeNull()
    expect(f).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(11 * 60 * 1000)
    await seed()
    expect(f).toHaveBeenCalledTimes(2)
  })
})
