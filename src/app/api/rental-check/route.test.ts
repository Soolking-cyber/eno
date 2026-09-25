import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/rental-check — the "check these rentals for me" write.
 *
 * It writes a conversation and a card carrying a contact into production, so every refusal path is
 * pinned here AND every refusal is proven to write nothing: a 409/422/503 that still created a thread
 * or left the idempotency claim behind would be a silent failure no manual click shows.
 *
 * The two idempotency layers get the most attention, because they are the path a human cannot click:
 * a replay out of kv, a replay out of the DATABASE when kv lost the body (a crash after commit), and
 * the honest 409 when a first attempt is genuinely still running.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  services: false,
  profile: { id: 'asker-1', locale: 'vi' } as Row | null,
  rateOk: true,
  // The strict per-card limit ('rental-check'), separate from the wrapper's attempt limit.
  cardRateOk: true,
  rateBuckets: [] as string[],
  gate: null as Row | null,
  kv: new Map<string, unknown>(),
  kvSets: [] as Array<{ key: string; value: unknown; opts?: Row }>,
  kvDels: [] as string[],
  kvThrows: false,
  deletedThreads: [] as Row[],
  rentals: [] as Row[],
  checkableCalls: [] as string[][],
  operator: 'op-1' as string | null,
  repointed: [] as string[],
  ensured: 0,
  thread: { id: 'thread-1', created: true } as { id: string; created: boolean },
  threadCalls: [] as Row[],
  // The committed card findCommitted() can see, if any.
  existingThread: null as { id: string } | null,
  committedCards: [] as Array<{ id: string; metaJson: string }>,
  messageFindWhere: null as Row | null,
  inserts: [] as Array<{ convo: Row; sender: string; text: string; opts: Row }>,
  insertThrows: null as Error | null,
}))

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/edition', () => ({ get IS_SERVICES() { return h.services }, get IS_MARKETPLACE() { return !h.services } }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  getCurrentProfileId: async () => h.profile?.id ?? null,
  getAdmin: async () => null,
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (bucket: string) => {
    h.rateBuckets.push(bucket)
    const ok = bucket === 'rental-check' ? h.cardRateOk : h.rateOk
    return ok ? { success: true, remaining: 5, resetSec: 0 } : { success: false, remaining: 0, resetSec: bucket === 'rental-check' ? 2400 : 1800 }
  },
  // An in-memory kv with the real NX semantics: set(nx) on an existing key loses (null).
  kv: {
    set: async (key: string, value: unknown, opts?: Row) => {
      if (h.kvThrows) throw new Error('kv down')
      h.kvSets.push({ key, value, opts })
      if (opts?.nx && h.kv.has(key)) return null
      h.kv.set(key, value)
      return 'OK'
    },
    get: async (key: string) => (h.kv.has(key) ? h.kv.get(key) : null),
    del: async (key: string) => { h.kvDels.push(key); h.kv.delete(key) },
  },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => h.gate }))
vi.mock('@/lib/rental-check/desk', () => ({
  resolveCheckableRentals: async (ids: string[]) => { h.checkableCalls.push(ids); return h.rentals.filter((r) => ids.includes(r.id)) },
  resolveRentalOperatorProfileId: async () => h.operator,
  repointRentalDeskThreads: async (id: string) => { h.repointed.push(id) },
  ensureRentalDeskSeller: async () => { h.ensured += 1 },
}))
vi.mock('@/lib/support-thread', () => ({
  getOrCreateListinglessThread: async (_db: unknown, args: Row) => { h.threadCalls.push(args); return h.thread },
}))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (convo: Row, sender: string, text: string, opts: Row) => {
    if (h.insertThrows) throw h.insertThrows
    h.inserts.push({ convo, sender, text, opts })
    return { id: 'msg-new' }
  },
  // The route re-parses a found card before trusting it; the real parser is strict zod (tested in
  // messages.availability.test.ts). Here a plain parse is enough to exercise the route's own logic.
  parseMessageMeta: (_kind: string, json: string | null) => { try { return json ? JSON.parse(json) : null } catch { return null } },
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findFirst: async () => h.existingThread,
      deleteMany: async (args: Row) => { h.deletedThreads.push(args); return { count: 1 } },
    },
    message: {
      // Models the LIKE: `_` in the needle matches any one character, the way Postgres would.
      findMany: async ({ where }: Row) => {
        h.messageFindWhere = where
        const needle = String(where.metaJson.contains)
        const like = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'))
        return h.committedCards.filter((c) => like.test(c.metaJson))
      },
    },
  },
}))

const { POST } = await import('./route')

const IMG = 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp'
const rental = (id: string, over: Row = {}) => ({
  id, title: `Rental ${id}`, titleVi: `Căn ${id}`, images: JSON.stringify([IMG, 'https://sb.eno.vn/b.webp']),
  price: 9_000_000, currency: '₫', priceUnit: 'VND/month', ...over,
})
const RID = 'req-abcdef01'
const body = (over: Row = {}) => ({
  listingIds: ['L1', 'L2'],
  requirements: 'Pets allowed?',
  contact: { channel: 'zalo', value: '090 123 4567' },
  clientRequestId: RID,
  lang: 'en',
  ...over,
})
const post = (b: unknown) => POST(new Request('http://localhost/api/rental-check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof b === 'string' ? b : JSON.stringify(b),
}))
const KEY = `rentalchk:vn:asker-1:${RID}`
const storedCard = (requestId = RID) => ({
  id: 'msg-old',
  metaJson: JSON.stringify({ v: 1, requestId, items: [{ id: 'L1' }, { id: 'L2' }] }),
})

beforeEach(() => {
  h.services = false
  h.profile = { id: 'asker-1', locale: 'vi' }
  h.rateOk = true
  h.cardRateOk = true
  h.rateBuckets = []
  h.gate = null
  h.kv = new Map()
  h.kvSets = []
  h.kvDels = []
  h.kvThrows = false
  h.deletedThreads = []
  h.rentals = [rental('L1'), rental('L2'), rental('L3'), rental('L4'), rental('L5')]
  h.checkableCalls = []
  h.operator = 'op-1'
  h.repointed = []
  h.ensured = 0
  h.thread = { id: 'thread-1', created: true }
  h.threadCalls = []
  h.existingThread = null
  h.committedCards = []
  h.messageFindWhere = null
  h.inserts = []
  h.insertThrows = null
})

/** Nothing was written, and the claim (if one was taken) is gone. */
function expectNothingWritten() {
  expect(h.inserts).toHaveLength(0)
  expect(h.threadCalls).toHaveLength(0)
  expect(h.ensured).toBe(0)
  expect(h.repointed).toHaveLength(0)
  expect(h.kv.has(KEY)).toBe(false)
}

describe('refusals before any work', () => {
  it('401 auth_required for a guest', async () => {
    h.profile = null
    const res = await post(body())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'auth_required' })
    expectNothingWritten()
  })

  it('429 rate_limited with Retry-After', async () => {
    h.rateOk = false
    const res = await post(body())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1800')
    expectNothingWritten()
  })

  it("403 with the gate's own body for a suspended account — before the body is read", async () => {
    h.gate = { error: 'account_suspended' }
    const res = await post('{not json')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_suspended' })
    expectNothingWritten()
  })

  it.each([
    ['malformed JSON', '{nope'],
    ['no ids', body({ listingIds: [] })],
    ['six unique ids', body({ listingIds: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] })],
    ['an id with free text', body({ listingIds: ['L1', 'call 0901234567'] })],
    ['a bad clientRequestId', body({ clientRequestId: 'x' })],
    ['an unknown channel', body({ contact: { channel: 'sms', value: '0901234567' } })],
    ['requirements over 1000 after cleanup', body({ requirements: 'x'.repeat(1001) })],
  ])('400 bad_request for %s', async (_label, b) => {
    const res = await post(b)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
    expectNothingWritten()
  })

  it('collapses duplicate ids BEFORE the 1..5 rule', async () => {
    const res = await post(body({ listingIds: ['L1', 'L2', 'L3', 'L4', 'L5', 'L1'] }))
    expect(res.status).toBe(200)
    expect(h.checkableCalls[0]).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
  })

  it.each([
    ['zalo', 'zalo', '+1 415 555 0100', 'zalo_needs_vn_mobile'],
    ['whatsapp', 'whatsapp', '12', 'phone_invalid'],
    ['email', 'email', 'not-an-email', 'email_invalid'],
    ['empty', 'email', '   ', 'empty'],
  ])('422 invalid_contact (%s) with the reason, and writes nothing', async (_l, channel, value, reason) => {
    const res = await post(body({ contact: { channel, value } }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'invalid_contact', reason })
    expectNothingWritten()
  })
})

describe('listings and the operator', () => {
  it('409 listings_unavailable names every id that is not checkable here, writes nothing, releases the claim', async () => {
    h.rentals = [rental('L1')]
    const res = await post(body({ listingIds: ['L1', 'L2', 'L9'] }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'listings_unavailable', unavailable: ['L2', 'L9'] })
    expectNothingWritten()
    expect(h.kvDels).toContain(KEY)
  })

  it('503 desk_unavailable when no operator resolves — never a thread nobody reads', async () => {
    h.operator = null
    const res = await post(body())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'desk_unavailable' })
    expectNothingWritten()
  })
})

describe('a successful request', () => {
  it('200 with the thread, the message and the ids, in the order they were collected', async () => {
    const res = await post(body({ listingIds: ['L2', 'L1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversationId: 'thread-1', messageId: 'msg-new', threadCreated: true, listingIds: ['L2', 'L1'] })
  })

  it("opens the requester's thread with THIS edition's desk and the operator behind it", async () => {
    await post(body())
    expect(h.ensured).toBe(1)
    expect(h.repointed).toEqual(['op-1'])
    expect(h.threadCalls).toEqual([{ buyerProfileId: 'asker-1', sellerId: 'eno-rental-desk', sellerProfileId: 'op-1' }])
  })

  it('posts ONE card as the requester, with the desk seller so the card gate can bind it', async () => {
    await post(body())
    expect(h.inserts).toHaveLength(1)
    const { convo, sender, text, opts } = h.inserts[0]
    expect(convo).toEqual({ id: 'thread-1', buyerProfileId: 'asker-1', sellerProfileId: 'op-1', listingId: null, sellerId: 'eno-rental-desk' })
    expect(sender).toBe('asker-1')
    expect(text).toBe('')
    expect(opts.kind).toBe('availability_request')
  })

  it('snapshots the items SERVER-SIDE from the database rows, ignoring anything the client claims', async () => {
    h.rentals = [
      rental('L1', { title: 'T'.repeat(200), images: JSON.stringify(['http://insecure/a.jpg']) }),
      rental('L2', { currency: 'dong', titleVi: null, images: 'not json' }),
    ]
    await post(body({ items: [{ id: 'L1', title: 'forged', price: 1 }] }))
    const meta = h.inserts[0].opts.meta
    expect(meta.items).toEqual([
      { id: 'L1', title: 'T'.repeat(140), titleVi: 'Căn L1', image: null, price: 9_000_000, currency: '₫', priceUnit: 'VND/month' },
      { id: 'L2', title: 'Rental L2', titleVi: null, image: null, price: 9_000_000, currency: '₫', priceUnit: 'VND/month' },
    ])
  })

  it('stores the NORMALISED contact, the request id, the origin and the language', async () => {
    await post(body())
    expect(h.inserts[0].opts.meta).toMatchObject({
      v: 1, requestId: RID, requirements: 'Pets allowed?',
      contact: { channel: 'zalo', value: '84901234567' }, origin: 'vn', lang: 'en',
    })
    expect(h.inserts[0].opts.meta.items[0].image).toBe(IMG)
  })

  it('falls back to the profile language when the client sends none', async () => {
    await post(body({ lang: undefined }))
    expect(h.inserts[0].opts.meta.lang).toBe('vi')
  })

  it('marks a forum request as forum-origin, on the forum desk, under a forum kv key', async () => {
    // The desk id is a build-scoped constant read at import, so the forum build is a fresh import.
    vi.resetModules()
    h.services = true
    const forum = await import('./route')
    await forum.POST(new Request('http://localhost/api/rental-check', { method: 'POST', body: JSON.stringify(body()) }))
    expect(h.inserts[0].opts.meta.origin).toBe('forum')
    expect(h.threadCalls[0].sellerId).toBe('eno-rental-desk-forum')
    expect(h.kvSets[0].key).toBe(`rentalchk:forum:asker-1:${RID}`)
  })

  it('the inbox preview names the count and NEVER the contact', async () => {
    await post(body())
    expect(h.inserts[0].opts.preview).toBe('Kiểm tra phòng trống · Availability check (2)')
    expect(h.inserts[0].opts.preview).not.toContain('0901')
  })

  it('strips control and bidi characters from requirements, keeping line breaks', async () => {
    const bidi = String.fromCharCode(0x202e)
    const zw = String.fromCharCode(0x200b)
    const nul = String.fromCharCode(0)
    await post(body({ requirements: `  Line one\r\nLine${nul} two${bidi}\tend${zw}  ` }))
    expect(h.inserts[0].opts.meta.requirements).toBe('Line one\nLine two end')
  })

  it('claims with NX for 300 s, then stores the body for a day', async () => {
    await post(body())
    expect(h.kvSets[0]).toEqual({ key: KEY, value: 'pending', opts: { nx: true, ex: 300 } })
    expect(h.kvSets[1]).toEqual({ key: KEY, value: { conversationId: 'thread-1', messageId: 'msg-new', threadCreated: true, listingIds: ['L1', 'L2'] }, opts: { ex: 86_400 } })
    expect(h.kvDels).not.toContain(KEY)
  })

  it('500 internal_error when the insert throws — and the claim is released so a retry can run', async () => {
    h.insertThrows = new Error('rental_card_thread_mismatch')
    const res = await post(body())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
    expect(h.kv.has(KEY)).toBe(false)
  })

  it('removes the thread it JUST opened when the card then fails — only while it is still empty', async () => {
    h.insertThrows = new Error('db blip')
    h.thread = { id: 'thread-new', created: true }
    await post(body())
    expect(h.deletedThreads).toEqual([{ where: { id: 'thread-new', listingId: null, messages: { none: {} } } }])
  })

  it('never removes a thread it did not open', async () => {
    h.insertThrows = new Error('db blip')
    h.thread = { id: 'thread-old', created: false }
    await post(body())
    expect(h.deletedThreads).toEqual([])
  })

  it('FAILS CLOSED when the claim cannot be taken — no card without the lock', async () => {
    h.kvThrows = true
    const res = await post(body())
    expect(res.status).toBe(500)
    expect(h.inserts).toHaveLength(0)
    expect(h.threadCalls).toHaveLength(0)
  })
})

describe('idempotency — one logical submit is one card', () => {
  it('replays the stored body out of kv without touching anything', async () => {
    const stored = { conversationId: 'thread-1', messageId: 'msg-1', threadCreated: true, listingIds: ['L1', 'L2'] }
    h.kv.set(KEY, stored)
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(stored)
    expect(h.inserts).toHaveLength(0)
    expect(h.checkableCalls).toHaveLength(0)
  })

  it('409 send_in_flight while a first attempt is genuinely still running', async () => {
    h.kv.set(KEY, 'pending')
    const res = await post(body())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'send_in_flight' })
    expect(h.inserts).toHaveLength(0)
    // The other attempt's claim is not ours to release.
    expect(h.kv.get(KEY)).toBe('pending')
  })

  /**
   * ⛔ THE CRASHED WINNER. The first attempt committed its card and died before storing the body, so
   * kv still says 'pending'. Answering 409 would make the client retry until the claim expired — and
   * then insert a SECOND card. The database knows the truth.
   */
  it("replays from the DATABASE when kv says 'pending' but the card is committed", async () => {
    h.kv.set(KEY, 'pending')
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [storedCard()]
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversationId: 'thread-1', messageId: 'msg-old', threadCreated: false, listingIds: ['L1', 'L2'] })
    expect(h.inserts).toHaveLength(0)
    expect(h.kv.get(KEY)).toMatchObject({ messageId: 'msg-old' })
  })

  it('replays from the DATABASE when kv lost everything (claim expired) and the card exists', async () => {
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [storedCard()]
    const res = await post(body())
    expect(res.status).toBe(200)
    expect((await res.json()).messageId).toBe('msg-old')
    expect(h.inserts).toHaveLength(0)
    // Looked up by the exact JSON key the card writes, in this requester's thread.
    expect(h.messageFindWhere).toEqual({ conversationId: 'thread-1', kind: 'availability_request', metaJson: { contains: `"requestId":"${RID}"` } })
  })

  it("is not fooled by a LIKE wildcard: '_' in the id matching ANOTHER card listed first", async () => {
    // 'req_0000001' as a LIKE pattern also matches 'reqX0000001'. The impostor comes back first
    // (newest); the exact re-check must skip it and replay the real one.
    const id = 'req_0000001'
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [{ ...storedCard('reqX0000001'), id: 'msg-impostor' }, storedCard(id)]
    const res = await post(body({ clientRequestId: id }))
    expect(res.status).toBe(200)
    expect((await res.json()).messageId).toBe('msg-old')
    expect(h.inserts).toHaveLength(0)
  })

  it('does not mistake another request id’s card for this one', async () => {
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [storedCard('req-someother')]
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(h.inserts).toHaveLength(1)
  })

  it('a first request with no thread yet looks for no card at all', async () => {
    h.existingThread = null
    await post(body())
    expect(h.messageFindWhere).toBeNull()
    expect(h.inserts).toHaveLength(1)
  })

})

/**
 * ⛔ A REPLAY IS NEVER RATE-LIMITED. The strict limit counts NEW cards; every replay path runs before
 * it. Before this, the 6/hour bucket sat on the wrapper and a person whose request had already been
 * delivered could be told 429 by their own retry.
 */
describe('the two rate limits', () => {
  it('the wrapper bounds ATTEMPTS generously, the strict bucket is checked only before a new card', async () => {
    await post(body())
    expect(h.rateBuckets).toEqual(['rental-check-attempt', 'rental-check'])
  })

  it('429 from the strict bucket writes nothing — no card, no empty thread — and releases the claim', async () => {
    h.cardRateOk = false
    const res = await post(body())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2400')
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfterSeconds: 2400 })
    expectNothingWritten()
  })

  it('a kv replay is answered even when the strict bucket is exhausted', async () => {
    h.cardRateOk = false
    const stored = { conversationId: 'thread-1', messageId: 'msg-1', threadCreated: true, listingIds: ['L1', 'L2'] }
    h.kv.set(KEY, stored)
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(stored)
    expect(h.rateBuckets).not.toContain('rental-check')
  })

  it('a DATABASE replay is answered even when the strict bucket is exhausted', async () => {
    h.cardRateOk = false
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [storedCard()]
    const res = await post(body())
    expect(res.status).toBe(200)
    expect((await res.json()).messageId).toBe('msg-old')
    expect(h.rateBuckets).not.toContain('rental-check')
  })

  it('a refused request (409 unavailable) does not spend the strict bucket', async () => {
    h.rentals = []
    await post(body())
    expect(h.rateBuckets).not.toContain('rental-check')
  })
})

describe('a delivered request is answered, whatever changed since', () => {
  beforeEach(() => {
    h.existingThread = { id: 'thread-1' }
    h.committedCards = [storedCard()]
  })

  it('200 replay even though one of its rentals has since gone', async () => {
    h.rentals = []
    const res = await post(body())
    expect(res.status).toBe(200)
    expect((await res.json()).messageId).toBe('msg-old')
    expect(h.checkableCalls).toHaveLength(0)
  })

  it('200 replay even though the operator no longer resolves', async () => {
    h.operator = null
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(h.inserts).toHaveLength(0)
  })
})
