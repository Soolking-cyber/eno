import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/listings/[id]/buyers — who the mark-sold picker offers.
 *
 * The default answer is the SELLER-wide list the native apps' picker has always read. `?scope=listing`
 * (the web "Who bought it?" sheet, B6) narrows it to the people who messaged about THIS listing: threads
 * anchored here, plus threads that carried an offer about it before a retarget (the seller's 'offer'
 * notifications are the only record of that). The sheet pre-selects "someone not on eno" when that list is
 * EMPTY — so what it holds decides whether one tap files an off-eno sale.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  owner: { ok: true, sellerId: 's1', profileId: 'p-seller' } as Row,
  convoArgs: [] as Row[],
  notifArgs: [] as Row[],
  notifs: [] as Row[],
  convos: [] as Row[],
  /** The listing row the scope=listing answer reads (createdAt, type, category, the decline memory). */
  listing: null as Row | null,
  /** db.conversation.findFirst — "any thread of this seller active since the listing was created?" */
  activeSince: null as Row | null,
  findFirstArgs: [] as Row[],
  desk: false,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => h.owner }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findMany: async (args: Row) => { h.convoArgs.push(args); return h.convos },
      findFirst: async (args: Row) => { h.findFirstArgs.push(args); return h.activeSince },
    },
    notification: { findMany: async (args: Row) => { h.notifArgs.push(args); return h.notifs } },
    listing: { findUnique: async () => h.listing },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ isServicesDeskListing: async () => h.desk, scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')

async function get(qs = '') {
  const res = await GET(new Request(`https://eno.vn/api/listings/L1/buyers${qs}`) as never, { params: Promise.resolve({ id: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

const convo = (id: string, buyer: Row | null) => ({ id, buyerProfileId: `p-${id}`, lastMessageAt: new Date('2026-10-01T00:00:00.000Z'), buyer })

const CREATED = new Date('2026-09-20T00:00:00.000Z')
beforeEach(() => {
  h.owner = { ok: true, sellerId: 's1', profileId: 'p-seller' }
  h.convoArgs = []
  h.notifArgs = []
  h.notifs = []
  h.convos = []
  h.listing = { createdAt: CREATED, sellerId: 's1', listingType: 'sell', category: { slug: 'sports' }, saleBuyerHistory: null, saleDeclinedAt: null, soldToProfileId: null }
  h.activeSince = null
  h.findFirstArgs = []
  h.desk = false
})

describe('the default answer is unchanged — the seller-wide list (the native picker)', () => {
  it('every thread with this seller, and no notification read at all', async () => {
    const { status } = await get()
    expect(status).toBe(200)
    expect(h.convoArgs[0].where).toEqual({ sellerId: 's1' })
    expect(h.notifArgs).toEqual([])
  })
})

describe('?scope=listing — the people who messaged about THIS listing (B6)', () => {
  it('threads anchored here — and nothing else when no offer was ever made about it', async () => {
    await get('?scope=listing')
    expect(h.convoArgs[0].where).toEqual({ sellerId: 's1', OR: [{ listingId: 'L1' }] })
  })

  it('PLUS threads that carried an offer about it before being retargeted (read off the SELLER\'s own offer notifications)', async () => {
    h.notifs = [{ conversationId: 'c-moved' }, { conversationId: 'c-moved' }, { conversationId: 'c-other' }]
    await get('?scope=listing')
    expect(h.notifArgs[0].where).toEqual({ recipientId: 'p-seller', type: 'offer', listingId: 'L1', conversationId: { not: null } })
    expect(h.notifArgs[0].orderBy).toEqual({ createdAt: 'desc' }) // the cap keeps the newest
    expect(h.convoArgs[0].where).toEqual({ sellerId: 's1', OR: [{ listingId: 'L1' }, { id: { in: ['c-moved', 'c-other'] } }] })
  })

  it('a name the seller can tell apart: the display name, else the MASKED e-mail handle — never the address', async () => {
    h.convos = [convo('a', { displayName: 'Minh', email: 'minh@x.vn' }), convo('b', { displayName: null, email: 'lan.tran@x.vn' }), convo('c', null)]
    const { body } = await get('?scope=listing')
    expect(body.buyers.map((b: Row) => b.name)).toEqual(['Minh', 'la***', null])
    expect(JSON.stringify(body)).not.toContain('@')
    expect(body.buyers[0]).toEqual({ conversationId: 'a', profileId: 'p-a', name: 'Minh', avatarUrl: null, avatarColor: null, lastMessageAt: '2026-10-01T00:00:00.000Z' })
  })
})

describe('⛔ "nobody messaged" is PROVED, never inferred from an empty list (B6 review)', () => {
  it('an empty scope AND no thread of this seller active since the listing was created → nobodyMessaged', async () => {
    const { body } = await get('?scope=listing')
    expect(body.buyers).toEqual([])
    expect(body.nobodyMessaged).toBe(true)
    // The proof: one probe over EVERY thread of this seller since the listing existed — a thread that
    // was about this listing and then moved away still has its activity after that instant.
    expect(h.findFirstArgs).toEqual([{ where: { sellerId: 's1', lastMessageAt: { gte: CREATED } }, select: { id: true } }])
  })

  it('⛔ an empty scope but SOME thread active since then → unsure (it may have been about this listing and moved)', async () => {
    h.activeSince = { id: 'c-moved' }
    const { body } = await get('?scope=listing')
    expect(body.buyers).toEqual([])
    expect(body.nobodyMessaged).toBe(false)
  })

  it('people listed → never "nobody", and the proof is not even paid for', async () => {
    h.convos = [convo('a', { displayName: 'Minh', email: null })]
    const { body } = await get('?scope=listing')
    expect(body.nobodyMessaged).toBe(false)
    expect(h.findFirstArgs).toEqual([])
  })

  it('the seller-wide default (the native picker) carries none of it — its wire shape is unchanged', async () => {
    const { body } = await get()
    expect(body).toEqual({ buyers: [] })
  })
})

describe('who POST /sold would refuse is not offered', () => {
  it('⛔ a buyer who said "No, I did not" about this listing is left out — /sold refuses them (buyer_declined)', async () => {
    h.convos = [convo('a', { displayName: 'Minh', email: null }), convo('b', { displayName: 'Lan', email: null })]
    h.listing!.saleBuyerHistory = JSON.stringify([{ i: 'p-a', a: 1, d: 2 }])
    const { body } = await get('?scope=listing')
    expect(body.buyers.map((b: Row) => b.name)).toEqual(['Lan'])
    // A decline means there WAS a conversation: never "nobody messaged".
    expect(body.nobodyMessaged).toBe(false)
  })

  it('…including the current attribution\'s scalar decline stamp (a history that failed to parse forgets nothing here)', async () => {
    h.convos = [convo('a', { displayName: 'Minh', email: null })]
    h.listing = { ...h.listing!, saleBuyerHistory: 'not json', saleDeclinedAt: new Date(), soldToProfileId: 'p-a' }
    const { body } = await get('?scope=listing')
    expect(body.buyers).toEqual([])
    expect(body.nobodyMessaged).toBe(false)
  })
})

describe('`asksBuyer` — whether naming someone REALLY sends them the question (the sheet\'s footer promise)', () => {
  it('a sale of goods → yes', async () => {
    expect((await get('?scope=listing')).body.asksBuyer).toBe(true)
  })
  it('a rental, a "wanted" post, a community giveaway → no', async () => {
    for (const l of [{ listingType: 'rent' }, { listingType: 'wanted' }, { listingType: 'free', category: { slug: 'community-events' } }]) {
      h.listing = { ...h.listing!, ...l }
      expect((await get('?scope=listing')).body.asksBuyer).toBe(false)
    }
  })
  it('⛔ the services desk → never (the bell is shared with eno.vn)', async () => {
    h.desk = true
    expect((await get('?scope=listing')).body.asksBuyer).toBe(false)
  })
})

describe('⛔ owner-only, whatever the scope', () => {
  it('someone else\'s listing → 403 forbidden, and nothing is read', async () => {
    h.owner = { ok: false, code: 403, error: 'forbidden' }
    const { status, body } = await get('?scope=listing')
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    expect(h.convoArgs).toEqual([])
    expect(h.notifArgs).toEqual([])
  })

  it('a guest → 401', async () => {
    h.owner = { ok: false, code: 401, error: 'auth_required' }
    expect((await get('?scope=listing')).status).toBe(401)
  })
})
