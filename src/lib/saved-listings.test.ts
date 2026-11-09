import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── src/lib/saved-listings.ts — an account's saved listings (owner, 2026-11-09: "3 ok") ──────────────────────────────────
// Only what the public saved-ids path shows in this edition is stored or returned; past the cap nothing of a write is.

type Row = { profileId: string; listingId: string; createdAt: Date }
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  visible: new Set<string>(),
  calls: [] as Array<{ op: string; args: unknown }>,
  locks: [] as string[],
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object, o: object) => ({ scoped: w, opts: o }) }))
vi.mock('@/lib/db', () => {
  const savedListing = {
      findMany: async (a: unknown) => { h.calls.push({ op: 'savedListing.findMany', args: a }); return h.rows.map((r) => ({ listingId: r.listingId })) },
      count: async (a: { where: { profileId: string; listingId?: { in: string[] } } }) =>
        h.rows.filter((r) => r.profileId === a.where.profileId && (!a.where.listingId || a.where.listingId.in.includes(r.listingId))).length,
      createMany: async (a: { data: Row[]; skipDuplicates: boolean }) => {
        h.calls.push({ op: 'createMany', args: a })
        for (const d of a.data) if (!h.rows.some((r) => r.profileId === d.profileId && r.listingId === d.listingId)) h.rows.push(d)
        return { count: a.data.length }
      },
      deleteMany: async (a: { where: { profileId: string; listingId: { in: string[] } } }) => {
        h.calls.push({ op: 'deleteMany', args: a })
        h.rows = h.rows.filter((r) => !(r.profileId === a.where.profileId && a.where.listingId.in.includes(r.listingId)))
        return { count: 0 }
      },
  }
  // The transaction runs its callback on the same stand-ins; the advisory lock's key is recorded.
  const tx = { savedListing, $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.calls.push({ op: 'lock', args: strings.join('?') }); h.locks.push(String(values[0])); return 1 } }
  return { db: {
    $transaction: async (fn: (t: typeof tx) => unknown) => { h.calls.push({ op: 'transaction', args: null }); return fn(tx) },
    listing: {
      findMany: async (a: { where: { scoped: { id: { in: string[] } } } }) => {
        h.calls.push({ op: 'listing.findMany', args: a })
        return a.where.scoped.id.in.filter((id) => h.visible.has(id)).map((id) => ({ id }))
      },
    },
    savedListing,
  } }
})

import { SAVED_LISTINGS_CAP, savedListingIds, visibleSavedWhere, writeSavedListings } from './saved-listings'
import { SAVED_KEEPABLE_STATUSES } from './listing-ids'

const ME = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { h.rows = []; h.visible = new Set(); h.calls = []; h.locks = [] })

describe('visibleSavedWhere', () => {
  it('is the public saved-ids predicate: verified, a kept status, this edition, teachers included', async () => {
    expect(SAVED_KEEPABLE_STATUSES).toEqual(['active', 'sold', 'expired', 'stale'])
    expect(await visibleSavedWhere({ id: { in: ['a'] } })).toEqual({
      scoped: { id: { in: ['a'] }, verified: true, status: { in: ['active', 'sold', 'expired', 'stale'] } },
      opts: { teachers: true },
    })
  })
})

describe('savedListingIds', () => {
  it('reads the account\'s rows whose listing is visible here, newest saved first, at most the cap', async () => {
    h.rows = [{ profileId: ME, listingId: 'b', createdAt: new Date(2) }, { profileId: ME, listingId: 'a', createdAt: new Date(1) }]
    expect(await savedListingIds(ME)).toEqual(['b', 'a'])
    const q = h.calls.find((c) => c.op === 'savedListing.findMany')!.args as Record<string, unknown>
    expect(q).toMatchObject({
      where: { profileId: ME, listing: { is: { scoped: { verified: true, status: { in: ['active', 'sold', 'expired', 'stale'] } }, opts: { teachers: true } } } },
      orderBy: [{ createdAt: 'desc' }, { listingId: 'asc' }],
      take: SAVED_LISTINGS_CAP,
      select: { listingId: true },
    })
  })
})

describe('writeSavedListings', () => {
  it('stores only listings visible here — the rest come back as notStored (a browser puts those hearts back)', async () => {
    h.visible = new Set(['live1', 'live2'])
    expect(await writeSavedListings(ME, { add: ['live1', 'hidden', 'live2', 'nope'] }, 1_000_000)).toEqual({ result: 'ok', notStored: ['hidden', 'nope'] })
    expect(h.rows.map((r) => r.listingId)).toEqual(['live1', 'live2'])
  })

  it('⛔ one writer per account: the write runs in a transaction under the account\'s advisory lock', async () => {
    h.visible = new Set(['a'])
    await writeSavedListings(ME, { add: ['a'] })
    expect(h.calls.map((c) => c.op)).toEqual(['listing.findMany', 'transaction', 'lock', 'createMany'])
    expect(h.locks).toEqual([`saved-listings:${ME}`])
    expect(String(h.calls.find((c) => c.op === 'lock')!.args)).toContain('pg_advisory_xact_lock(hashtext(?))')
  })

  it('the LAST id named is the newest save (a device\'s list is oldest first), and a repeat keeps its first save', async () => {
    h.visible = new Set(['a', 'b', 'c'])
    await writeSavedListings(ME, { add: ['a', 'b', 'c', 'a'] }, 1_000_000)
    const made = (h.calls.find((c) => c.op === 'createMany')!.args as { data: Row[]; skipDuplicates: boolean })
    expect(made.skipDuplicates).toBe(true)
    expect(made.data.map((d) => [d.listingId, d.createdAt.getTime()])).toEqual([['a', 999_998], ['b', 999_999], ['c', 1_000_000]])
  })

  it('removes any of the account\'s rows, visible or not, and only the account\'s', async () => {
    h.rows = [{ profileId: ME, listingId: 'x', createdAt: new Date() }, { profileId: 'other', listingId: 'x', createdAt: new Date() }]
    expect(await writeSavedListings(ME, { remove: ['x'] })).toEqual({ result: 'ok', notStored: [] })
    expect(h.rows).toEqual([expect.objectContaining({ profileId: 'other', listingId: 'x' })])
  })

  it('⛔ past the cap NOTHING of the write is stored — the browser puts its hearts back', async () => {
    h.rows = Array.from({ length: SAVED_LISTINGS_CAP - 1 }, (_, i) => ({ profileId: ME, listingId: `old${i}`, createdAt: new Date(i) }))
    h.visible = new Set(['n1', 'n2', 'old1'])
    // One already saved (old1) does not count again; one new fits…
    expect((await writeSavedListings(ME, { add: ['old1', 'n1'] })).result).toBe('ok')
    expect(h.rows).toHaveLength(SAVED_LISTINGS_CAP)
    // …and the next new one does not, so nothing of that write lands.
    expect((await writeSavedListings(ME, { add: ['n2'] })).result).toBe('limit_reached')
    expect(h.rows.some((r) => r.listingId === 'n2')).toBe(false)
    // An unsave still works at the cap.
    expect((await writeSavedListings(ME, { remove: ['n1'] })).result).toBe('ok')
    expect(h.rows).toHaveLength(SAVED_LISTINGS_CAP - 1)
  })

  it('⛔ a write refused at the cap has removed nothing either (all or nothing)', async () => {
    h.rows = Array.from({ length: SAVED_LISTINGS_CAP }, (_, i) => ({ profileId: ME, listingId: `old${i}`, createdAt: new Date(i) }))
    h.visible = new Set(['n1', 'n2'])
    expect((await writeSavedListings(ME, { add: ['n1', 'n2'], remove: ['old0'] })).result).toBe('limit_reached')
    expect(h.rows).toHaveLength(SAVED_LISTINGS_CAP)
    expect(h.rows.some((r) => r.listingId === 'old0')).toBe(true)
    // Room made by the same write counts: one out, one in.
    expect((await writeSavedListings(ME, { add: ['n1'], remove: ['old0'] })).result).toBe('ok')
    expect(h.rows.some((r) => r.listingId === 'n1')).toBe(true)
    expect(h.rows.some((r) => r.listingId === 'old0')).toBe(false)
  })

  it('an add of nothing visible changes nothing', async () => {
    expect(await writeSavedListings(ME, { add: ['hidden'] })).toEqual({ result: 'ok', notStored: ['hidden'] })
    expect(h.calls.map((c) => c.op).filter((op) => op === 'createMany' || op === 'deleteMany')).toEqual([])
  })
})
