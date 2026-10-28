import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── src/lib/user-blocks.ts — blocking behind the `ugc-safety` App Store review gate (plan R3) ─────────

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  calls: [] as string[], rows: [] as Row[], feedback: [] as Row[], feedbackFails: false, kv: new Map<string, unknown>(), kvFails: false,
  // SellerBlock rows, the sellers (id → ownerId), and the table being absent (before scripts/seller-blocks-ddl.mjs).
  shopRows: [] as Row[], sellers: [] as Array<{ id: string; ownerId: string | null }>, shopTableMissing: false,
  // Threads, for hiddenSellerIdsFor's "a person I bought from" rule.
  convos: [] as Array<{ buyerProfileId: string; sellerProfileId: string | null; sellerId: string }>,
}))
/** What Prisma 7 throws for a table that does not exist (P2021). */
const missing = () => Object.assign(new Error('The table `public.SellerBlock` does not exist in the current database.'), { code: 'P2021' })

vi.mock('@/lib/db', () => ({
  db: {
    // The batch form: the operations are already-issued promises; all of them settle, or the first rejection wins.
    $transaction: async (ops: Promise<unknown>[]) => { h.calls.push('$transaction'); return Promise.all(ops) },
    forumUserBlock: {
      findFirst: async (q: Row) => { h.calls.push('findFirst'); const or = (q.where as { OR: Row[] }).OR; return h.rows.find((r) => or.some((c) => c.blockerProfileId === r.blockerProfileId && c.blockedProfileId === r.blockedProfileId)) ?? null },
      findMany: async (q: Row) => {
        h.calls.push('findMany')
        const w = q.where as Row
        // The two-way lookup blockStateBetween makes (an OR of the two directions) …
        if (w.OR) return h.rows.filter((r) => (w.OR as Row[]).some((c) => c.blockerProfileId === r.blockerProfileId && c.blockedProfileId === r.blockedProfileId))
        // … and the one-way list profilesBlockedBy / unblockByHandle read.
        return h.rows.filter((r) => r.blockerProfileId === w.blockerProfileId)
      },
      // createMany({ skipDuplicates }) — the composite key decides, like the real table.
      createMany: async (q: Row) => {
        h.calls.push('createMany')
        let count = 0
        for (const d of q.data as Row[]) {
          if (h.rows.some((r) => r.blockerProfileId === d.blockerProfileId && r.blockedProfileId === d.blockedProfileId)) continue
          h.rows.push(d); count++
        }
        return { count }
      },
      deleteMany: async (q: Row) => { h.calls.push('deleteMany'); const w = q.where as Row; h.rows = h.rows.filter((r) => !(r.blockerProfileId === w.blockerProfileId && r.blockedProfileId === w.blockedProfileId)); return { count: 1 } },
    },
    feedback: { create: async (q: Row) => { if (h.feedbackFails) throw new Error('db down'); h.feedback.push(q.data as Row); return q.data } },
    sellerBlock: {
      findMany: async (q: Row) => { h.calls.push('sellerBlock.findMany'); if (h.shopTableMissing) throw missing(); return h.shopRows.filter((r) => r.blockerProfileId === (q.where as Row).blockerProfileId) },
      createMany: async (q: Row) => {
        if (h.shopTableMissing) throw missing()
        let count = 0
        for (const d of q.data as Row[]) {
          if (h.shopRows.some((r) => r.blockerProfileId === d.blockerProfileId && r.sellerId === d.sellerId)) continue
          h.shopRows.push(d); count++
        }
        return { count }
      },
      deleteMany: async (q: Row) => {
        if (h.shopTableMissing) throw missing()
        const w = q.where as { blockerProfileId: string; sellerId?: string; seller?: { ownerId: string } }
        // By shop id, or (deletePersonBlock) by the shop's owner.
        const hit = (r: Row) => r.blockerProfileId === w.blockerProfileId &&
          (w.sellerId !== undefined ? r.sellerId === w.sellerId : h.sellers.some((x) => x.id === r.sellerId && x.ownerId === w.seller?.ownerId))
        h.shopRows = h.shopRows.filter((r) => !hit(r))
        return { count: 1 }
      },
    },
    conversation: {
      findMany: async (q: { where: { buyerProfileId: string; sellerProfileId: { in: string[] } } }) => {
        h.calls.push('conversation.findMany')
        const ids = new Set(h.convos.filter((c) => c.buyerProfileId === q.where.buyerProfileId && c.sellerProfileId && q.where.sellerProfileId.in.includes(c.sellerProfileId)).map((c) => c.sellerId))
        return [...ids].map((sellerId) => ({ sellerId }))
      },
    },
    seller: {
      findMany: async (q: { where: { ownerId: { in: string[] } } }) => { h.calls.push('seller.findMany'); return h.sellers.filter((x) => x.ownerId && q.where.ownerId.in.includes(x.ownerId)).map((x) => ({ id: x.id })) },
    },
    profile: {
      findUnique: async (q: { where: { id: string } }) => ({ email: q.where.id === 'staff' ? 'support@eno.vn' : `${q.where.id}@example.com` }),
      findMany: async (q: { where: { id: { in: string[] } } }) => { h.calls.push('profile.findMany'); return q.where.id.in.map((id) => ({ id, email: id === 'staff' ? 'support@eno.vn' : `${id}@example.com` })) },
    },
  },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
// The note dedupe claim (kv NX + TTL), the Redis-shaped call shape src/lib/ratelimit.ts exposes.
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (h.kvFails) throw new Error('kv down')
      if (o?.nx && h.kv.has(k)) return null
      h.kv.set(k, v)
      return 'OK'
    },
    del: async (k: string) => { h.kv.delete(k) },
  },
}))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e: string | null | undefined) => e === 'support@eno.vn' }))

const {
  blockHandle, blockingOn, blockStateBetween, deletePersonBlock, hiddenSellerIdsFor, isBlockedBetween, isShopOnlyBlock, profilesBlockedBy, SellerBlocksMissing,
  setSellerBlock, setUserBlock, shopBlockHandle, unblockByHandle,
} = await import('./user-blocks')

beforeEach(() => {
  h.calls = []; h.rows = []; h.feedback = []; h.feedbackFails = false; h.kv = new Map(); h.kvFails = false
  h.shopRows = []; h.sellers = []; h.shopTableMissing = false; h.convos = []
})
afterEach(() => vi.unstubAllEnvs())

describe('with the gate OFF (the default)', () => {
  it('answers "nothing is blocked" without a single query — the send path pays nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    expect(blockingOn()).toBe(false)
    expect(await isBlockedBetween('a', 'b')).toBe(false)
    expect(await blockStateBetween('a', 'b')).toBe('none')
    expect([...(await profilesBlockedBy('a'))]).toEqual([])
    expect(h.calls).toEqual([])
  })
})

describe('with ugc-safety ON', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'))

  it('a block counts in BOTH directions', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    expect(await isBlockedBetween('a', 'b')).toBe(true)
    expect(await isBlockedBetween('b', 'a')).toBe(true)
    expect(await isBlockedBetween('a', 'c')).toBe(false)
  })

  it('a block with the eno team on either side is void — an old forum row cannot silence the desk', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'staff' }, { blockerProfileId: 'staff', blockedProfileId: 'c' }]
    expect(await isBlockedBetween('a', 'staff')).toBe(false)
    expect(await isBlockedBetween('c', 'staff')).toBe(false)
  })

  it('an unknown or ownerless side, or the same profile, is never blocked — and costs no query', async () => {
    expect(await isBlockedBetween('a', null)).toBe(false)
    expect(await isBlockedBetween(undefined, 'b')).toBe(false)
    expect(await isBlockedBetween('a', 'a')).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('the inbox list leaves the eno team out too, so it agrees with the send path — in ONE profile query', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'staff' }, { blockerProfileId: 'a', blockedProfileId: 'b' }, { blockerProfileId: 'a', blockedProfileId: 'c' }]
    expect([...(await profilesBlockedBy('a'))]).toEqual(['b', 'c'])
    expect(h.calls.filter((c) => c === 'profile.findMany')).toHaveLength(1)
  })

  it('lists only the profiles THIS user blocked', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }, { blockerProfileId: 'c', blockedProfileId: 'a' }]
    expect([...(await profilesBlockedBy('a'))]).toEqual(['b'])
  })

  it('a new block tells moderators through the feedback queue — never a Report (which would hold the target\'s own deletion)', async () => {
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c1' })
    expect(h.rows).toEqual([{ blockerProfileId: 'a', blockedProfileId: 'b' }])
    expect(h.feedback).toHaveLength(1)
    // The ADMIN thread viewer — /messages/<id> 403s a moderator who is not a party (follow-up 5).
    expect(h.feedback[0]).toMatchObject({ kind: 'other', profileId: 'a', url: '/admin/conversation/c1' })
    expect(String(h.feedback[0].message)).toContain('blocked profile b')
    expect(String(h.feedback[0].message)).toContain('/admin/users/b')
  })

  it('a storefront block links the blocked account\'s admin record', async () => {
    await setUserBlock('a', 'b', true, { surface: 'storefront', sellerId: 's1' })
    expect(h.feedback[0]).toMatchObject({ url: '/admin/users/b' })
    expect(String(h.feedback[0].message)).toContain('from storefront s1')
  })

  it('a block → unblock → block loop files ONE note per pair per day (follow-up 4)', async () => {
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c1' })
    await setUserBlock('a', 'b', false, { surface: 'settings' })
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c1' })
    await setUserBlock('a', 'b', false, { surface: 'settings' })
    await setUserBlock('a', 'b', true, { surface: 'storefront', sellerId: 's1' })
    expect(h.rows).toEqual([{ blockerProfileId: 'a', blockedProfileId: 'b' }])
    expect(h.feedback).toHaveLength(1)
    expect(h.kv.has('user-block-note:a:b')).toBe(true)
    // Directional: B blocking A is a different event for a moderator.
    await setUserBlock('b', 'a', true, { surface: 'chat', conversationId: 'c1' })
    expect(h.feedback).toHaveLength(2)
  })

  it('a note that could not be written releases its claim, so the next block of the pair files it', async () => {
    h.feedbackFails = true
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c1' })
    expect(h.feedback).toEqual([])
    expect(h.kv.has('user-block-note:a:b')).toBe(false)
    h.feedbackFails = false
    await setUserBlock('a', 'b', false, { surface: 'settings' })
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c2' })
    expect(h.feedback).toHaveLength(1)
    expect(h.feedback[0]).toMatchObject({ url: '/admin/conversation/c2' })
  })

  it('the dedupe fails OPEN: a broken claim still files the note', async () => {
    h.kvFails = true
    await setUserBlock('a', 'b', true, { surface: 'chat', conversationId: 'c1' })
    expect(h.feedback).toHaveLength(1)
  })

  it('is idempotent: blocking twice writes one row and one note', async () => {
    await setUserBlock('a', 'b', true, { surface: 'storefront', sellerId: 's1' })
    await setUserBlock('a', 'b', true, { surface: 'storefront', sellerId: 's1' })
    expect(h.rows).toHaveLength(1)
    expect(h.feedback).toHaveLength(1)
  })

  it('two racing taps: one row, one note, no error', async () => {
    await Promise.all([setUserBlock('a', 'b', true, { surface: 'chat' }), setUserBlock('a', 'b', true, { surface: 'chat' })])
    expect(h.rows).toHaveLength(1)
    expect(h.feedback).toHaveLength(1)
  })

  it('the block stands even if the moderator note cannot be written', async () => {
    h.feedbackFails = true
    await expect(setUserBlock('a', 'b', true, { surface: 'chat' })).resolves.toBeUndefined()
    expect(h.rows).toHaveLength(1)
  })

  it('unblock removes the row and files nothing', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    await setUserBlock('a', 'b', false, { surface: 'settings' })
    expect(h.rows).toEqual([])
    expect(h.feedback).toEqual([])
  })
})

describe('blockStateBetween — which way a block runs (the thread\'s "closed" banner)', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'))

  it('mine / theirs / none, and a mutual block counts as mine (the blocker always sees the way back)', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    expect(await blockStateBetween('a', 'b')).toBe('mine')
    expect(await blockStateBetween('b', 'a')).toBe('theirs')
    expect(await blockStateBetween('a', 'c')).toBe('none')
    h.rows.push({ blockerProfileId: 'b', blockedProfileId: 'a' })
    expect(await blockStateBetween('b', 'a')).toBe('mine')
  })

  it('a block with the eno team on either side is void, as for enforcement', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'staff' }]
    expect(await blockStateBetween('a', 'staff')).toBe('none')
    expect(await blockStateBetween('staff', 'a')).toBe('none')
  })

  it('a missing side or the same profile costs no query', async () => {
    expect(await blockStateBetween('a', null)).toBe('none')
    expect(await blockStateBetween(null, 'a')).toBe('none')
    expect(await blockStateBetween('a', 'a')).toBe('none')
    expect(h.calls).toEqual([])
  })
})

describe('the opaque unblock handle (follow-up 3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-for-block-handles')
  })

  it('is 22 url-safe characters, stable, and bound to the BLOCKER — never the profile id', () => {
    const h1 = blockHandle('a', 'b')!
    expect(h1).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(blockHandle('a', 'b')).toBe(h1)
    expect(blockHandle('c', 'b')).not.toBe(h1)
    const uuid = '11111111-1111-4111-8111-111111111111'
    expect(blockHandle('a', uuid)).not.toContain(uuid.slice(0, 8))
  })

  it('unblocks only the caller\'s own row; a foreign or unknown handle is inert', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }, { blockerProfileId: 'c', blockedProfileId: 'b' }]
    // c's handle for b, sent by a: matches nothing in a's list.
    expect(await unblockByHandle('a', blockHandle('c', 'b')!)).toBe(false)
    expect(await unblockByHandle('a', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
    expect(await unblockByHandle('a', 'not a handle')).toBe(false)
    expect(h.rows).toHaveLength(2)
    expect(await unblockByHandle('a', blockHandle('a', 'b')!)).toBe(true)
    expect(h.rows).toEqual([{ blockerProfileId: 'c', blockedProfileId: 'b' }])
  })

  it('a SHOP block has its own handle (over `shop:<id>`), unblocks only the caller\'s shop row, and never answers for a person', async () => {
    h.shopRows = [{ blockerProfileId: 'a', sellerId: 'linked' }, { blockerProfileId: 'c', sellerId: 'linked' }]
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'linked' }]
    const shop = shopBlockHandle('a', 'linked')!
    expect(shop).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(shop).not.toBe(blockHandle('a', 'linked'))
    expect(await unblockByHandle('a', shopBlockHandle('c', 'linked')!)).toBe(false)
    expect(await unblockByHandle('a', shop)).toBe(true)
    expect(h.shopRows).toEqual([{ blockerProfileId: 'c', sellerId: 'linked' }])
    expect(h.rows).toHaveLength(1) // the person row of the same id stands
  })

  it('before the SellerBlock DDL a handle still unblocks a person, and an unknown one is a plain miss', async () => {
    h.shopTableMissing = true
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    expect(await unblockByHandle('a', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
    expect(await unblockByHandle('a', blockHandle('a', 'b')!)).toBe(true)
  })
})

describe('shop blocks — a shop no blockable person runs (App Store 1.2 rejection, 2026-10-28)', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'))

  it('a shop with no owner, or the eno team\'s, is blocked as a shop; a person\'s shop is not', async () => {
    expect(await isShopOnlyBlock(null)).toBe(true)
    expect(await isShopOnlyBlock('staff')).toBe(true)
    expect(await isShopOnlyBlock('someone')).toBe(false)
  })

  it('a new shop block tells moderators — naming the listing it was made on — once per (blocker → shop) per day', async () => {
    await setSellerBlock('a', 'linked', true, { surface: 'listing', sellerId: 'linked', listingId: 'l1' })
    expect(h.shopRows).toEqual([{ blockerProfileId: 'a', sellerId: 'linked' }])
    expect(h.feedback).toHaveLength(1)
    expect(h.feedback[0]).toMatchObject({ kind: 'other', profileId: 'a', url: '/listings/l1' })
    expect(String(h.feedback[0].message)).toContain('[shop block] Profile a blocked shop linked (listing) from listing l1')
    await setSellerBlock('a', 'linked', false, { surface: 'settings' })
    expect(h.shopRows).toEqual([])
    await setSellerBlock('a', 'linked', true, { surface: 'storefront', sellerId: 'linked' })
    await setSellerBlock('a', 'linked', true, { surface: 'storefront', sellerId: 'linked' })
    expect(h.shopRows).toHaveLength(1)
    expect(h.feedback).toHaveLength(1)
  })

  it('a storefront shop block links the storefront', async () => {
    await setSellerBlock('a', 'linked', true, { surface: 'storefront', sellerId: 'linked' })
    expect(h.feedback[0]).toMatchObject({ url: '/sellers/linked' })
  })

  it('before the DDL a shop block throws SellerBlocksMissing (the route says "unavailable"), and files nothing', async () => {
    h.shopTableMissing = true
    await expect(setSellerBlock('a', 'linked', true, { surface: 'storefront', sellerId: 'linked' })).rejects.toBeInstanceOf(SellerBlocksMissing)
    expect(h.feedback).toEqual([])
  })

  it('the shops to hide: every SellerBlock row, plus the shop of every blocked person `me` BOUGHT from — the eno team never', async () => {
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }, { blockerProfileId: 'a', blockedProfileId: 'staff' }, { blockerProfileId: 'x', blockedProfileId: 'c' }]
    h.sellers = [{ id: 'shop-b', ownerId: 'b' }, { id: 'shop-staff', ownerId: 'staff' }, { id: 'shop-c', ownerId: 'c' }]
    h.convos = [{ buyerProfileId: 'a', sellerProfileId: 'b', sellerId: 'shop-b' }, { buyerProfileId: 'a', sellerProfileId: 'staff', sellerId: 'shop-staff' }]
    h.shopRows = [{ blockerProfileId: 'a', sellerId: 'linked' }, { blockerProfileId: 'x', sellerId: 'other' }]
    expect((await hiddenSellerIdsFor('a')).sort()).toEqual(['linked', 'shop-b'])
    // The THREAD's own shop — never a lookup by owner (review): no other id can come back for b.
    expect(h.calls).not.toContain('seller.findMany')
  })

  it('⛔ a BUYER blocked from a chat keeps their shop off the list — it would tell the blocker which shop they run (review)', async () => {
    h.rows = [{ blockerProfileId: 'seller', blockedProfileId: 'buyer' }]
    h.sellers = [{ id: 'shop-of-buyer', ownerId: 'buyer' }]
    h.convos = [{ buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop-of-seller' }]
    expect(await hiddenSellerIdsFor('seller')).toEqual([])
    // …unless the blocker also blocked them from that shop's own page (the route then writes the shop's row).
    h.shopRows = [{ blockerProfileId: 'seller', sellerId: 'shop-of-buyer' }]
    expect(await hiddenSellerIdsFor('seller')).toEqual(['shop-of-buyer'])
  })

  it('unblocking a person lifts their shop\'s row with them — by handle, or by setUserBlock(off)', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-for-block-handles')
    h.sellers = [{ id: 'shop-b', ownerId: 'b' }, { id: 'linked', ownerId: null }]
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    h.shopRows = [{ blockerProfileId: 'a', sellerId: 'shop-b' }, { blockerProfileId: 'a', sellerId: 'linked' }, { blockerProfileId: 'x', sellerId: 'shop-b' }]
    expect(await unblockByHandle('a', blockHandle('a', 'b')!)).toBe(true)
    expect(h.shopRows).toEqual([{ blockerProfileId: 'a', sellerId: 'linked' }, { blockerProfileId: 'x', sellerId: 'shop-b' }])
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    h.shopRows.push({ blockerProfileId: 'a', sellerId: 'shop-b' })
    await setUserBlock('a', 'b', false, { surface: 'storefront', sellerId: 'shop-b' })
    expect(h.shopRows).toEqual([{ blockerProfileId: 'a', sellerId: 'linked' }, { blockerProfileId: 'x', sellerId: 'shop-b' }])
    h.shopTableMissing = true
    // Before the DDL: the person row alone, no error.
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    await expect(deletePersonBlock('a', 'b')).resolves.toBeUndefined()
    expect(h.rows).toEqual([])
  })

  it('a person-run shop\'s row written beside the person block files no second note', async () => {
    await setSellerBlock('a', 'shop-b', true, { surface: 'listing', sellerId: 'shop-b', listingId: 'l1' }, { note: false })
    expect(h.shopRows).toEqual([{ blockerProfileId: 'a', sellerId: 'shop-b' }])
    expect(h.feedback).toEqual([])
  })

  it('before the DDL, the person half alone; with the gate off, nothing and no query', async () => {
    h.shopTableMissing = true
    h.rows = [{ blockerProfileId: 'a', blockedProfileId: 'b' }]
    h.sellers = [{ id: 'shop-b', ownerId: 'b' }]
    h.convos = [{ buyerProfileId: 'a', sellerProfileId: 'b', sellerId: 'shop-b' }]
    expect(await hiddenSellerIdsFor('a')).toEqual(['shop-b'])
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.calls = []
    expect(await hiddenSellerIdsFor('a')).toEqual([])
    expect(h.calls).toEqual([])
  })

  it('a database failure that is NOT a missing table still throws', async () => {
    const real = h.shopRows
    Object.defineProperty(h, 'shopRows', { get: () => { throw new Error('db down') }, configurable: true })
    await expect(hiddenSellerIdsFor('a')).rejects.toThrow('db down')
    Object.defineProperty(h, 'shopRows', { value: real, writable: true, configurable: true })
  })
})
