/**
 * preloadable(): a code-split module that renders without its placeholder once it has been fetched ahead. What must hold
 * is exactly what React.lazy's initializer relies on: after the module has loaded, `loader().then(a).then(b).then(resolve)`
 * calls `resolve` before `loader()`'s caller regains control.
 */
import { describe, expect, it, vi } from 'vitest'
import { preloadable } from './preloadable'

describe('preloadable', () => {
  it('before the module has loaded, loader() is the import\'s own promise (asynchronous, as dynamic() expects)', async () => {
    const mod = { Row: () => null }
    const p = preloadable(async () => mod)
    let got: unknown = null
    const t = p.loader().then((m) => { got = m })
    expect(got).toBeNull() // not yet: a real promise
    expect(p.loaded()).toBe(false)
    await t
    expect(got).toBe(mod)
    expect(p.loaded()).toBe(true)
  })

  it('once loaded, loader() settles SYNCHRONOUSLY through a chain, the way React.lazy reads it', async () => {
    const mod = { Row: () => null }
    const p = preloadable(async () => mod)
    await p.preload()
    // The exact call shape: ours (.then pick), next/dynamic's (.then convertModule), React's (.then(resolve, reject)).
    let status = -1; let result: unknown = null
    p.loader().then((m) => m.Row).then((c) => ({ default: c })).then(
      (moduleObject) => { status = 1; result = moduleObject },
      () => { status = 2 },
    )
    expect(status).toBe(1) // in the same call: no microtask was needed
    expect(result).toEqual({ default: mod.Row })
  })

  it('the loaded thenable also answers `catch` and `finally` the way a fulfilled promise would', async () => {
    const mod = { Row: () => null }
    const p = preloadable(async () => mod)
    await p.preload()
    const done = vi.fn(); let got: unknown = null
    const t = p.loader() as unknown as { catch: (f: () => void) => { finally: (f: () => void) => PromiseLike<typeof mod> } }
    t.catch(() => { throw new Error('never') }).finally(done).then((m) => { got = m })
    expect(done).toHaveBeenCalledTimes(1)
    expect(got).toBe(mod)
  })

  it('keeps a promise chain\'s rules for everything but timing: a returned promise is adopted, a throw becomes a rejection', async () => {
    const mod = { n: 1 }
    const p = preloadable(async () => mod)
    await p.preload()
    // An asynchronous step in the chain: the next link receives the module, not a promise of it.
    await expect(p.loader().then(async (m) => m).then((m) => m.n)).resolves.toBe(1)
    // A throwing callback does not throw out of `.then`; it rejects.
    let chained: PromiseLike<unknown> | undefined
    expect(() => { chained = p.loader().then(() => { throw new Error('boom') }) }).not.toThrow()
    await expect(chained).rejects.toThrow('boom')
  })

  it('loads once however often it is asked', async () => {
    const load = vi.fn(async () => ({ n: 1 }))
    const p = preloadable(load)
    await Promise.all([p.preload(), p.preload(), p.loader()])
    p.loader(); void p.preload()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed load, so the next ask tries again', async () => {
    let fail = true
    const load = vi.fn(async () => { if (fail) throw new Error('offline'); return { n: 1 } })
    const p = preloadable(load)
    await expect(p.preload()).rejects.toThrow('offline')
    expect(p.loaded()).toBe(false)
    fail = false
    await expect(p.preload()).resolves.toEqual({ n: 1 })
    expect(load).toHaveBeenCalledTimes(2)
    expect(p.loaded()).toBe(true)
  })
})
