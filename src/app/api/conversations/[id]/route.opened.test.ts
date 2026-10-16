import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — the one-time OPEN (si-04) and the read receipt (inbox-07).
 *
 *   · `?opened=1` marks every unread bell notification for THIS thread read, keyed by conversationId and
 *     NOT by type (the rental desk writes a variable type), scoped to the caller's own rows.
 *   · It is not tied to the unread counter: a stale offer notification on a thread with myUnread 0 clears.
 *   · A read that is already clearing unread messages clears the bell too (an offer that arrived while the
 *     thread was open).
 *   · The 15s poll with nothing unread, and a prefetch (`peek=1`, even with the flag), never write.
 *   · A failing clear never breaks the thread.
 *   · `counterpartSeen` is the other side's unread counter at zero.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: null as Row | null,
  notifCalls: [] as Row[],
  notifCount: 2,
  notifThrows: false,
  convoUpdates: 0,
  badgeSyncs: 0,
  // Something AFTER the bell clear's old position throws while the response is being built.
  reactionsThrow: false,
  // writerVerified (src/lib/teachers/writer-verified.ts): each profile's answer, whose each read was for, a failing read.
  tiers: {} as Record<string, string>,
  tierReads: [] as string[],
  tierThrows: false,
  // "Identity verified" (src/lib/teachers/identity-mark.ts identityMarkShownFor): its answer, whether it throws, and the
  // input each read was for.
  markShown: false,
  markThrows: false,
  markReads: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.me,
  getCurrentProfile: async () => (h.me ? { id: h.me } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => { if (h.reactionsThrow) throw new Error('tally down'); return [] } }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => { h.badgeSyncs += 1 } }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
// The writer's public verification (its own rules — a revoked identity, the badge — are writer-verified.test.ts's) — what
// the TEACHER's side shows as `writerVerified`.
// The teacher's opt-in "Identity verified" (its rules — the zero-read short-circuit, the live check — are
// identity-mark.test.ts's) — what the SCHOOL's side shows as `teacherIdentityVerified`.
vi.mock('@/lib/teachers/identity-mark', () => ({
  IDENTITY_MARK_TP_SELECT: { profileId: true, fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true },
  identityMarkShownFor: async (m: Record<string, unknown>) => {
    h.markReads.push(m)
    if (h.markThrows) throw new Error('identity read down')
    return h.markShown
  },
}))
vi.mock('@/lib/teachers/writer-verified', () => ({
  writerVerified: async (profileId: string) => {
    h.tierReads.push(profileId)
    if (h.tierThrows) throw new Error('identity read down')
    return h.tiers[profileId] ?? 'unverified'
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => { h.convoUpdates += 1; return {} } },
    seller: { findUnique: async () => null },
    review: { findUnique: async () => null },
    notification: {
      updateMany: async (args: Row) => {
        h.notifCalls.push(args)
        if (h.notifThrows) throw new Error('db down')
        return { count: h.notifCount }
      },
    },
  },
}))

const { GET } = await import('./route')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null,
    listing: { id: 'L1', title: 'Road bike', images: '["https://x/1.webp"]', price: 3_000_000, currency: '₫', priceUnit: 'VND', negotiable: true, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, subcategorySlug: 'bicycle', category: { slug: 'vehicles' }, teacherProfile: null },
    teacherContactShare: null,
    teacherVideoShare: null,
    seller: { id: 'shop-1', ownerId: 'seller-1', name: 'Shop', avatarColor: '#111', avatarUrl: null, trustScore: 80, trustTier: 'standard', memberSince: new Date('2024-01-01'), reviewCount: 2, officialPartner: false, owner: { lastSeenAt: null, locale: 'vi' } },
    buyer: { displayName: 'An', email: 'an@example.com', avatarColor: '#222', avatarUrl: null, lastSeenAt: null, locale: 'vi' },
    messages: [],
    ...over,
  }
}
const get = async (qs = '') => {
  const res = await GET(new Request(`http://localhost/api/conversations/thread-1${qs}`), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.me = 'buyer-1'
  h.convo = thread()
  h.notifCalls = []
  h.notifCount = 2
  h.notifThrows = false
  h.convoUpdates = 0
  h.badgeSyncs = 0
  h.reactionsThrow = false
  h.tiers = {}
  h.tierReads = []
  h.tierThrows = false
  h.markShown = false
  h.markThrows = false
  h.markReads = []
})

describe('?opened=1 clears this thread\'s bell — and only the caller\'s rows', () => {
  it('marks unread notifications for this conversation read, with no type list', async () => {
    const { status, body } = await get('?opened=1')
    expect(status).toBe(200)
    expect(h.notifCalls).toHaveLength(1)
    expect(h.notifCalls[0]).toEqual({ where: { recipientId: 'buyer-1', conversationId: 'thread-1', read: false, createdAt: { lte: new Date(body.seenAsOf) } }, data: { read: true } })
    expect(h.notifCalls[0].where).not.toHaveProperty('type')
    expect(body.notificationsCleared).toBe(2)
    // The app-icon badge dropped, so it is re-synced once.
    expect(h.badgeSyncs).toBe(1)
  })

  it('⛔ clears only rows that existed when the read began: createdAt <= seenAsOf (taken before the thread was read)', async () => {
    const before = Date.now()
    const { body } = await get('?opened=1')
    const bound = (h.notifCalls[0].where as { createdAt: { lte: Date } }).createdAt.lte
    expect(bound).toBeInstanceOf(Date)
    expect(bound.toISOString()).toBe(body.seenAsOf)
    expect(bound.getTime()).toBeGreaterThanOrEqual(before - 1)
    expect(bound.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('is NOT gated on the unread counter: myUnread 0 still clears a stale offer notification', async () => {
    h.convo = thread({ buyerUnread: 0 })
    await get('?opened=1')
    expect(h.notifCalls).toHaveLength(1)
    expect(h.convoUpdates).toBe(0)
  })

  it('nothing to clear → no badge sync', async () => {
    h.notifCount = 0
    const { body } = await get('?opened=1')
    expect(body.notificationsCleared).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('⛔ a stranger\'s `?opened=1` is a 403 that writes NOTHING — no bell rows, no unread counter, no badge sync', async () => {
    h.me = 'stranger-9'
    h.convo = thread({ buyerUnread: 2, sellerUnread: 3 })
    const { status } = await get('?opened=1')
    expect(status).toBe(403)
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('fails soft: a broken clear never 500s the thread — and says so (openCleared false), so the page asks again', async () => {
    h.notifThrows = true
    const { status, body } = await get('?opened=1')
    expect(status).toBe(200)
    expect(body.notificationsCleared).toBe(0)
    expect(body.openCleared).toBe(false)
  })

  it('openCleared is the server\'s word that THIS open cleared — true on a clean open, false on a plain read', async () => {
    expect((await get('?opened=1')).body.openCleared).toBe(true)
    h.convo = thread({ buyerUnread: 1 })
    // A read that clears the bell alongside an unread write is not an open.
    expect((await get()).body.openCleared).toBe(false)
  })

  it('⛔ the clear runs LAST: if building the response throws, the person keeps the notification', async () => {
    h.reactionsThrow = true
    const { status } = await get('?opened=1')
    expect(status).toBeGreaterThanOrEqual(500)
    expect(h.notifCalls).toHaveLength(0)
  })
})

describe('polling stays write-free', () => {
  it('the poll (no flag) with nothing unread never touches notifications', async () => {
    const { body } = await get()
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
    expect(body.notificationsCleared).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('a prefetch is never an open, even if it carries the flag', async () => {
    await get('?peek=1&opened=1')
    expect(h.notifCalls).toHaveLength(0)
  })

  it('a prefetch writes nothing even with messages unread', async () => {
    h.convo = thread({ buyerUnread: 2 })
    await get('?peek=1')
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
  })
})

describe('an offer that arrives while the thread is open', () => {
  it('the refetch that clears the unread counter clears its bell row too — one badge sync for both', async () => {
    h.convo = thread({ buyerUnread: 1 })
    const { body } = await get()
    expect(h.convoUpdates).toBe(1)
    expect(h.notifCalls).toEqual([{ where: { recipientId: 'buyer-1', conversationId: 'thread-1', read: false, createdAt: { lte: new Date(body.seenAsOf) } }, data: { read: true } }])
    expect(body.notificationsCleared).toBe(2)
    expect(h.badgeSyncs).toBe(1)
  })

  it('the open with messages unread still clears once, not twice', async () => {
    h.convo = thread({ buyerUnread: 3 })
    await get('?opened=1')
    expect(h.notifCalls).toHaveLength(1)
    expect(h.convoUpdates).toBe(1)
    expect(h.badgeSyncs).toBe(1)
  })
})

describe('counterpartSeen — the other side\'s unread counter at zero', () => {
  it('rides with seenAsOf: the server instant it vouches for, taken before the read', async () => {
    const t0 = Date.now()
    const { body } = await get()
    expect(typeof body.seenAsOf).toBe('string')
    const asOf = Date.parse(body.seenAsOf)
    expect(asOf).toBeGreaterThanOrEqual(t0 - 1)
    expect(asOf).toBeLessThanOrEqual(Date.now())
  })

  it('buyer viewing: seen when the SELLER has nothing unread', async () => {
    h.convo = thread({ sellerUnread: 0, buyerUnread: 3 })
    expect((await get()).body.counterpartSeen).toBe(true)
    h.convo = thread({ sellerUnread: 1 })
    expect((await get()).body.counterpartSeen).toBe(false)
  })

  it('seller viewing: seen when the BUYER has nothing unread', async () => {
    h.me = 'seller-1'
    h.convo = thread({ buyerUnread: 2, sellerUnread: 0 })
    expect((await get()).body.counterpartSeen).toBe(false)
  })
})

describe('the listing carries the opener facts', () => {
  it('categorySlug and subcategorySlug ride on the listing', async () => {
    const { body } = await get()
    expect(body.listing.categorySlug).toBe('vehicles')
    expect(body.listing.subcategorySlug).toBe('bicycle')
  })
})

// The intro video sent on request (2026-10-07): a teacher thread's payload carries the FLAGS the strip needs — never
// where the private video is stored (the select reads the path only to know one exists). Any account the teacher sends
// it to may watch (owner, 2026-10-13 — the DM ladder): the teacher's Send in THAT conversation is the only key, and the
// 2026-10-08 `forBusiness` flag went with the business-only rule it served.
describe('a teacher thread\'s intro video', () => {
  const teacherThread = (over: Row = {}) => thread({
    listing: { ...thread().listing as Row, listingType: 'teacher', teacherProfile: { status: 'live', videoOnRequest: true, private: { videoPath: 'p1/secret-intro.mp4' } } },
    ...over,
  })
  it('is flags only — the stored path never reaches either side', async () => {
    h.convo = teacherThread({ teacherVideoShare: { requestedAt: new Date(), sharedAt: null, revokedAt: null } })
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.teacher.video).toEqual({ available: true, shareOn: false, shared: false, requested: true, askAgain: false })
    expect(JSON.stringify(body)).not.toContain('secret-intro')
  })
  it('the same derivation as the video routes: a day-old ask may be repeated; whoever the teacher sent it to may watch it', async () => {
    h.convo = teacherThread({ teacherVideoShare: { requestedAt: new Date(Date.now() - 25 * 3600_000), sharedAt: null, revokedAt: null } })
    expect((await get()).body.teacher.video).toMatchObject({ requested: true, askAgain: true })
    // A personal account's thread. The read selects no account type any more; one on the row changes nothing — and
    // never reaches the payload.
    const sentToPersonal = () => teacherThread({ teacherVideoShare: { requestedAt: null, sharedAt: new Date(), revokedAt: null }, buyer: { ...thread().buyer as Row, accountType: 'individual' } })
    // Read by the teacher (the seller side), whose counterpart block describes the buyer.
    h.me = 'seller-1'
    h.convo = sentToPersonal()
    const asTeacher = await get()
    expect(asTeacher.status).toBe(200)
    expect(asTeacher.body.teacher.video).toEqual({ available: true, shareOn: true, shared: true, requested: false, askAgain: false })
    expect(JSON.stringify(asTeacher.body)).not.toContain('individual')
    // …and by the person it was sent to: watchable.
    h.me = 'buyer-1'
    h.convo = sentToPersonal()
    const asWriter = await get()
    expect(asWriter.body.teacher.video).toEqual({ available: true, shareOn: true, shared: true, requested: false, askAgain: false })
    expect(JSON.stringify(asWriter.body)).not.toContain('individual')
  })
})

/**
 * WHO IS WRITING, FOR THE TEACHER ONLY (teacher DM ladder, owner 2026-10-13): any account may now start a teacher chat,
 * so the teacher's side carries the WRITER's public verification — 'business' | 'identity' | 'unverified' — derived live
 * for the thread's buyer (writer-verified.ts), before the teacher taps Share. The writer's own read
 * carries no such key and pays no read; nor does any other thread on this most-polled route.
 */
describe('a teacher thread — writerVerified, for the teacher only', () => {
  const teacherThread = () => thread({
    listing: { ...thread().listing as Row, listingType: 'teacher', teacherProfile: { status: 'live', videoOnRequest: false, private: { videoPath: null, phone: null } } },
  })
  beforeEach(() => { h.convo = teacherThread() })

  it('the teacher is told the writer\'s verification — read for the BUYER, never for the caller', async () => {
    h.me = 'seller-1'
    h.tiers = { 'seller-1': 'business' } // the teacher's own rung must never be what is shown
    const cases = [['business', 'business'], ['identity', 'identity'], ['unverified', 'unverified']] as const
    for (const [tier, shown] of cases) {
      h.tiers['buyer-1'] = tier
      h.tierReads = []
      const { status, body } = await get()
      expect(status).toBe(200)
      expect(body.teacher.writerVerified).toBe(shown)
      expect(h.tierReads).toEqual(['buyer-1'])
    }
  })
  it('a failed rung read fails soft: null, and the thread still opens', async () => {
    h.me = 'seller-1'
    h.tierThrows = true
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.teacher.writerVerified).toBeNull()
  })
  it('the writer\'s own read carries no writerVerified — and pays no rung read', async () => {
    h.tiers = { 'buyer-1': 'business' }
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.teacher).not.toBeNull()
    expect('writerVerified' in body.teacher).toBe(false)
    expect(h.tierReads).toEqual([])
  })
  it('an ordinary thread pays no rung read on either side', async () => {
    for (const who of ['buyer-1', 'seller-1']) {
      h.me = who
      h.convo = thread()
      const { status, body } = await get()
      expect(status).toBe(200)
      expect(body.teacher).toBeNull()
    }
    expect(h.tierReads).toEqual([])
  })
})

/**
 * ⛔ `me` IS THE AUTHENTICATED ACCOUNT — the JWT subject getCurrentProfileId() returns, which is the client's
 * `user.id` (both are Supabase's auth user id: src/lib/admin.ts reads `sub`; auth-context holds `session.user`).
 * The thread page refuses any answer whose `me` is not the account on screen, and the chat cache labels entries by it
 * (F5), so this is the contract both rest on — for either side of the conversation, on every kind of read.
 */
describe('the answer names the account it was read for (F5)', () => {
  it('`me` is the caller\'s id — the buyer\'s, the seller\'s — on the open, a refetch and a peek', async () => {
    for (const who of ['buyer-1', 'seller-1']) {
      h.me = who
      for (const qs of ['?opened=1', '', '?peek=1']) {
        h.convo = thread()
        const { status, body } = await get(qs)
        expect(status).toBe(200)
        expect(body.me).toBe(who)
      }
    }
  })
})

/**
 * …AND THE MIRROR, FOR THE SCHOOL (owner, 2026-10-15): the TEACHER's opt-in "Identity verified", asked of the one
 * predicate (identityMarkShownFor) about the teacher's own four inputs — never the caller's. Only a boolean leaves: no
 * reason, name, version or account id. The teacher's own read carries no such key and pays no read; nor does any other
 * thread, nor a stranger. A failed read is false, and the thread still opens.
 */
describe('a teacher thread — teacherIdentityVerified, for the school only', () => {
  const TP = { status: 'live', videoOnRequest: false, private: { videoPath: null, phone: null }, profileId: 'seller-1', fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: '2026-10-16' }
  const teacherThread = () => thread({ listing: { ...thread().listing as Row, listingType: 'teacher', teacherProfile: { ...TP } } })
  beforeEach(() => { h.convo = teacherThread() })

  it('the school gets the predicate\'s boolean — read about the TEACHER, with exactly the four inputs', async () => {
    for (const shown of [true, false]) {
      h.markShown = shown
      h.markReads = []
      const { status, body } = await get()
      expect(status).toBe(200)
      expect(body.teacher.teacherIdentityVerified).toBe(shown)
      expect(h.markReads).toEqual([{ profileId: 'seller-1', fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: '2026-10-16' }])
    }
    // The writer's own verification is the teacher's view, and it is not paid for here.
    expect(h.tierReads).toEqual([])
  })
  it('⛔ only a boolean leaves: no reason, name, version or account id of the teacher', async () => {
    h.markShown = true
    const { body } = await get()
    expect(typeof body.teacher.teacherIdentityVerified).toBe('boolean')
    const json = JSON.stringify(body)
    expect(json).not.toContain('Anna Eriksson')
    // The version as a WHOLE JSON value — a bare '2026-10-16' also matches any timestamp of that day (`seenAsOf`), which
    // failed this test on the version's own date.
    expect(json).not.toContain('"2026-10-16"')
    expect(json).not.toMatch(/identityMarkOn|identityMarkNoticeVersion|"reason"|notice_changed|name_mismatch/)
  })
  it('a failed read fails soft: false, and the thread opens', async () => {
    h.markThrows = true
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.teacher.teacherIdentityVerified).toBe(false)
  })
  it('the teacher\'s own read carries no such key — and pays no read', async () => {
    h.me = 'seller-1'
    h.markShown = true
    const { status, body } = await get()
    expect(status).toBe(200)
    expect('teacherIdentityVerified' in body.teacher).toBe(false)
    expect(h.markReads).toEqual([])
  })
  it('an ordinary thread pays no read on either side', async () => {
    for (const who of ['buyer-1', 'seller-1']) {
      h.me = who
      h.convo = thread()
      const { body } = await get()
      expect(body.teacher).toBeNull()
    }
    expect(h.markReads).toEqual([])
  })
  it('a stranger is refused (403) before any read', async () => {
    h.me = 'stranger-9'
    expect((await get()).status).toBe(403)
    expect(h.markReads).toEqual([])
  })
})
