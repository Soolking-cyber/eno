import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The per-request read-path memo in src/lib/edition-scope.ts (speed plan item 6). What it may and may not do:
 *   · inside ONE request (Next's work-unit store), the scope's repeats share ONE lookup per email list;
 *   · nothing is shared ACROSS requests — a mapping that changes at runtime shows on the very next request;
 *   · a partial, empty or failed answer is never kept; callers get copies;
 *   · the ingest/exemption path (`requiredDeskSellerIds`, `deskSellerIds()`) always asks;
 *   · outside a request (scripts, every other test file) there is no memo at all.
 */

const h = vi.hoisted(() => ({
  services: false,
  sellersFor: null as null | ((emails: string[]) => Array<{ id: string }>),
  throwOnQuery: null as null | Error,
  gate: null as null | Promise<void>,
  queries: [] as string[][],
}))

vi.mock('@/lib/edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
  get EDITION() { return h.services ? 'services' : 'marketplace' },
}))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['visa@eno.vn'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['trips@eno.vn'] }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => null },
    seller: {
      findMany: async ({ where }: { where: unknown }) => {
        const emails = (where as { owner?: { email?: { in?: string[] } } })?.owner?.email?.in ?? []
        h.queries.push(emails)
        if (h.gate) await h.gate
        if (h.throwOnQuery) throw h.throwOnQuery
        return h.sellersFor ? h.sellersFor(emails) : emails.map((e) => ({ id: `seller-of-${e}` }))
      },
    },
  },
}))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

// ⚠️ What Next's server does at boot (next/dist/server/node-environment-baseline.js): without it, Next's request store is
// a stub whose run() throws and whose getStore() is always undefined — which is exactly the "outside a request" case below.
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external')
const { marketplaceListingScope, editionHiddenSellerIds, deskSellerIds, isServicesDeskListing, deskExcludedListingWhere, DeskResolutionError } = await import('./edition-scope')

/** Run `fn` as one request: inside a fresh store, the way Next runs a route handler (createRequestStoreForAPI). */
const inRequest = <T,>(fn: () => Promise<T>): Promise<T> =>
  workUnitAsyncStorage.run({ type: 'request' } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0], fn)

const DESKS = ['seller-of-visa@eno.vn', 'seller-of-trips@eno.vn']

beforeEach(() => {
  h.services = false
  h.sellersFor = null
  h.throwOnQuery = null
  h.gate = null
  h.queries = []
})

describe('one lookup per email list per request', () => {
  it('twenty reads in one request cost one query, and every one gets the same answer', () => inRequest(async () => {
    const answers: Awaited<ReturnType<typeof marketplaceListingScope>>[] = []
    for (let i = 0; i < 20; i++) answers.push(await marketplaceListingScope())
    expect(h.queries).toHaveLength(1)
    for (const a of answers) expect(a).toEqual({ sellerId: { notIn: DESKS } })
  }))

  it('parallel reads in one request join the one in flight', () => inRequest(async () => {
    let open!: () => void
    h.gate = new Promise<void>((r) => { open = r })
    const pending = Array.from({ length: 10 }, () => marketplaceListingScope())
    await Promise.resolve()
    open()
    const answers = await Promise.all(pending)
    expect(h.queries).toHaveLength(1)
    for (const a of answers) expect(a).toEqual({ sellerId: { notIn: DESKS } })
  }))

  it('the hide-list gate reads the same list and shares the same lookup', () => inRequest(async () => {
    await marketplaceListingScope()
    const hidden = await editionHiddenSellerIds()
    expect(h.queries).toHaveLength(1)
    expect(hidden.slice(0, 2)).toEqual(DESKS)
  }))

  it('⛔ nothing crosses requests: the next request asks again, and sees a mapping that changed in between', async () => {
    await inRequest(async () => { await marketplaceListingScope(); await marketplaceListingScope() })
    expect(h.queries).toHaveLength(1)
    // eno's desk gained a storefront between two requests — the next request must exclude it at once.
    h.sellersFor = (emails) => emails.map((e) => ({ id: `new-seller-of-${e}` }))
    const next = await inRequest(() => marketplaceListingScope())
    expect(h.queries).toHaveLength(2)
    expect(next).toEqual({ sellerId: { notIn: ['new-seller-of-visa@eno.vn', 'new-seller-of-trips@eno.vn'] } })
  })

  it('⛔ no answer outlives 5 s, even on a store a long-lived context kept (a poller started inside a request)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await inRequest(async () => {
        await marketplaceListingScope()
        vi.setSystemTime(Date.now() + 4999)
        await marketplaceListingScope()
        expect(h.queries).toHaveLength(1)
        vi.setSystemTime(Date.now() + 1)
        h.sellersFor = (emails) => emails.map((e) => ({ id: `new-seller-of-${e}` }))
        expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: ['new-seller-of-visa@eno.vn', 'new-seller-of-trips@eno.vn'] } })
        expect(h.queries).toHaveLength(2)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('two requests running at the same time do not share either', async () => {
    let open!: () => void
    h.gate = new Promise<void>((r) => { open = r })
    const a = inRequest(() => marketplaceListingScope())
    const b = inRequest(() => marketplaceListingScope())
    await Promise.resolve()
    open()
    await Promise.all([a, b])
    expect(h.queries).toHaveLength(2)
  })
})

describe('only a complete, healthy answer is kept', () => {
  it('a partial answer (one desk unresolved) is asked again on every call — and still applied as before', () => inRequest(async () => {
    h.sellersFor = (emails) => emails.filter((e) => e === 'visa@eno.vn').map((e) => ({ id: `seller-of-${e}` }))
    expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: ['seller-of-visa@eno.vn'] } })
    expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: ['seller-of-visa@eno.vn'] } })
    expect(h.queries).toHaveLength(2)
  }))

  it('an empty answer throws every time — the licensing failure stays loud — and is asked again', () => inRequest(async () => {
    h.sellersFor = () => []
    await expect(marketplaceListingScope()).rejects.toBeInstanceOf(DeskResolutionError)
    await expect(marketplaceListingScope()).rejects.toBeInstanceOf(DeskResolutionError)
    expect(h.queries).toHaveLength(2)
  }))

  it('a failure reaches every caller waiting on it, is never kept, and the next call asks again', () => inRequest(async () => {
    let open!: () => void
    h.gate = new Promise<void>((r) => { open = r })
    h.throwOnQuery = new Error('db down')
    const pending = Array.from({ length: 3 }, () => marketplaceListingScope())
    await Promise.resolve()
    open()
    for (const p of pending) await expect(p).rejects.toThrow('db down')
    expect(h.queries).toHaveLength(1)
    h.gate = null
    h.throwOnQuery = null
    expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: DESKS } })
    expect(h.queries).toHaveLength(2)
  }))

  it('callers get copies — changing one answer, fresh or remembered, cannot change the next', () => inRequest(async () => {
    const fresh = await marketplaceListingScope()
    const remembered = await marketplaceListingScope() // served from the memo
    for (const a of [fresh, remembered]) {
      a.sellerId!.notIn.push('injected')
      a.sellerId!.notIn.splice(0, 1)
    }
    expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: DESKS } })
    expect(h.queries).toHaveLength(1)
  }))
})

describe('what never uses it', () => {
  it('the Vertex-ingest helpers and deskSellerIds() ask every time, however warm the memo', () => inRequest(async () => {
    await marketplaceListingScope()
    expect(h.queries).toHaveLength(1)
    await deskSellerIds()
    await isServicesDeskListing({ sellerId: 'x' })
    await deskExcludedListingWhere({ status: 'active' })
    expect(h.queries).toHaveLength(4)
  }))

  it('outside a request (scripts, tests) there is no memo: every read asks', async () => {
    await marketplaceListingScope()
    await marketplaceListingScope()
    expect(h.queries).toHaveLength(2)
  })
})
