import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// listing-photo-hooks.ts — what the publish paths call around the photo pass: the switch (A16), the pending set, and the
// follow-up pass after a publish that was not the release.
const h = vi.hoisted(() => ({
  afters: [] as Array<() => Promise<unknown>>,
  mset: [] as Array<{ entries: Array<[string, unknown]>; ex: number }>,
  del: [] as string[],
  passed: [] as Array<[string, string]>,
  kvFails: false,
  findMany: [] as unknown[],
}))
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => { h.afters.push(fn) } }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    mset: async (entries: Array<[string, unknown]>, ex: number) => { if (h.kvFails) throw new Error('kv down'); h.mset.push({ entries, ex }) },
    del: async (k: string) => { if (h.kvFails) throw new Error('kv down'); h.del.push(k) },
  },
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: async (a: unknown) => { h.findMany.push(a); return [{ id: 'b' }] } } } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/listing-photo-pass', () => ({ photoPassById: async (id: string, lane: string) => { h.passed.push([id, lane]); return { skip: 'gone' } } }))

const { enqueuePhotoChecks, photoCheckDone, photoHeldIds, photoPassSoon, photoRulesLive } = await import('./listing-photo-hooks')

beforeEach(() => { h.afters = []; h.mset = []; h.del = []; h.passed = []; h.kvFails = false; h.findMany = [] })
afterEach(() => { vi.unstubAllEnvs() })

describe('listing-photo-hooks', () => {
  it('⛔ writes are off unless PHOTO_RULES_WRITE=1 (A16): no follow-up pass is even scheduled', () => {
    expect(photoRulesLive()).toBe(false)
    photoPassSoon(['a'])
    expect(h.afters).toHaveLength(0)
    vi.stubEnv('PHOTO_RULES_WRITE', 'true')
    expect(photoRulesLive()).toBe(false)
  })

  it('switched on: queued first, then each id through the pass, after the response, on the sweep lane by default', async () => {
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    photoPassSoon(['a', 'b'])
    expect(h.afters).toHaveLength(1)
    await h.afters[0]()
    expect(h.mset[0].entries).toEqual([['listing-photo:pending:a', 1], ['listing-photo:pending:b', 1]])
    expect(h.passed).toEqual([['a', 'sweep'], ['b', 'sweep']])
    photoPassSoon([])
    expect(h.afters).toHaveLength(1)
  })

  it('the pending set never throws to its caller', async () => {
    h.kvFails = true
    await expect(enqueuePhotoChecks(['a'])).resolves.toBeUndefined()
    await expect(photoCheckDone('a')).resolves.toBeUndefined()
  })

  it('photoHeldIds reads the mark, and nothing for no ids', async () => {
    expect(await photoHeldIds([])).toEqual(new Set())
    expect(h.findMany).toHaveLength(0)
    expect(await photoHeldIds(['a', 'b'])).toEqual(new Set(['b']))
    expect(h.findMany[0]).toEqual({ where: { id: { in: ['a', 'b'] }, verificationNotes: 'photo:held' }, select: { id: true } })
  })
})
