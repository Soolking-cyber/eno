import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — the `closed` flag (App Store gate `ugc-safety`, follow-up 2 of 0a470ed98).
 *
 * This is the most-polled route in the app, so the pins are about cost as much as content: gate OFF ⇒ the
 * block table is never read and the payload has no `closed` key at all (byte-for-byte what it was); gate
 * ON ⇒ one read, 'you_blocked' for the blocker, 'blocked' for the other side, and never a profile id.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: null as Row | null,
  blocks: [] as Row[],
  blockReads: 0,
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
  isAdminEmail: (e: string | null | undefined) => e === 'support@eno.vn',
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    seller: { findUnique: async () => null },
    review: { findUnique: async () => null },
    profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: where.id === 'staff-1' ? 'support@eno.vn' : `${where.id}@example.com` }) },
    forumUserBlock: {
      findMany: async ({ where }: { where: { OR: Row[] } }) => {
        h.blockReads += 1
        return h.blocks.filter((b) => where.OR.some((c) => c.blockerProfileId === b.blockerProfileId && c.blockedProfileId === b.blockedProfileId))
      },
    },
  },
}))

const { GET } = await import('./route')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null,
    listing: { id: 'L1', title: 'Honda Wave', images: '[]', price: 1, currency: '₫', priceUnit: 'VND', negotiable: true, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, teacherProfile: null },
    teacherContactShare: null,
    teacherVideoShare: null,
    seller: { id: 'shop-1', ownerId: 'seller-1', name: 'Shop', avatarColor: '#111111', avatarUrl: null, trustScore: 100, trustTier: 'standard', memberSince: new Date('2024-01-01'), reviewCount: 2, officialPartner: false, owner: { lastSeenAt: null, locale: 'vi' } },
    buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#222222', avatarUrl: null, lastSeenAt: null, locale: 'en' },
    messages: [],
    ...over,
  }
}
const get = async () => {
  const res = await GET(new Request('http://localhost/api/conversations/thread-1?peek=1'), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = 'buyer-1'
  h.convo = thread()
  h.blocks = []
  h.blockReads = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('the closed flag', () => {
  it('gate OFF: a stored block is never read and the payload carries no `closed` key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocks = [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }]
    const { status, body } = await get()
    expect(status).toBe(200)
    expect('closed' in body).toBe(false)
    expect(h.blockReads).toBe(0)
  })

  it('gate ON, no block: one read, still no `closed` key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const { body } = await get()
    expect('closed' in body).toBe(false)
    expect(h.blockReads).toBe(1)
  })

  it('gate ON: the blocked side sees "blocked", the blocker sees "you_blocked" — and no profile id rides along', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }]
    const asBuyer = await get()
    expect(asBuyer.body.closed).toBe('blocked')
    h.me = 'seller-1'
    const asSeller = await get()
    expect(asSeller.body.closed).toBe('you_blocked')
    // The other party's profile id appears nowhere — `me` is the caller's own id only.
    expect(JSON.stringify(asSeller.body)).not.toContain('buyer-1')
    expect(JSON.stringify(asBuyer.body)).not.toContain('seller-1')
    expect(asSeller.body.me).toBe('seller-1')
  })

  it('gate ON: a block with the eno team on either side is void (a desk thread never closes)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = thread({ sellerProfileId: 'staff-1', seller: { ...thread().seller, ownerId: 'staff-1' } })
    h.blocks = [{ blockerProfileId: 'buyer-1', blockedProfileId: 'staff-1' }]
    const { body } = await get()
    expect('closed' in body).toBe(false)
  })
})

// The intro video in a teacher thread (gate review, 2026-10-08): the SCHOOL (buyer) of a thread closed by a block is told
// nothing about it — as the watch route and GET /api/teachers/video-share; the TEACHER keeps the flags, so a share made
// before the block stays withdrawable.
describe('a teacher thread closed by a block — the intro video', () => {
  const teacherThread = (): Row => thread({
    listing: { ...thread().listing, listingType: 'teacher', teacherProfile: { status: 'live', videoOnRequest: true, private: { videoPath: 'p1/intro.mp4' } } },
    teacherVideoShare: { requestedAt: null, sharedAt: new Date(), revokedAt: null },
    teacherContactShare: { sharedAt: new Date(), revokedAt: null },
    buyer: { ...thread().buyer, accountType: 'business' },
  })
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'); h.convo = teacherThread() })

  it('⛔ the school gets no video flags — whichever side blocked; the teacher still sees the standing share', async () => {
    for (const block of [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }, { blockerProfileId: 'buyer-1', blockedProfileId: 'seller-1' }]) {
      h.blocks = [block]
      h.me = 'buyer-1'
      const asSchool = await get()
      expect(asSchool.status).toBe(200)
      expect('closed' in asSchool.body).toBe(true)
      expect(asSchool.body.teacher.video).toBeNull()
      expect(asSchool.body.teacher.shared).toBe(false) // nor the contact share
      h.me = 'seller-1'
      const asTeacher = await get()
      expect(asTeacher.body.teacher.video).toMatchObject({ shareOn: true, shared: true })
      expect(asTeacher.body.teacher.shared).toBe(true)
    }
  })
  it('an open thread still carries the school\'s flags', async () => {
    const { body } = await get()
    expect('closed' in body).toBe(false)
    expect(body.teacher.video).toMatchObject({ shareOn: true, shared: true, forBusiness: true })
  })
})

// A3 (owner, 2026-10-08): the phone is optional unless "Our staff may call me" is on, so the TEACHER's share button names
// only what it hands over. Whether the number exists is the teacher's own fact: sent to the teacher, never to the school —
// and only ever as a boolean.
describe('a teacher thread — hasPhone, for the teacher only', () => {
  const withPhone = (phone: string | null): Row => thread({
    listing: { ...thread().listing, listingType: 'teacher', teacherProfile: { status: 'live', videoOnRequest: false, private: { videoPath: null, phone } } },
    buyer: { ...thread().buyer, accountType: 'business' },
  })
  afterEach(() => { h.me = 'buyer-1' })

  it('the teacher is told whether a phone is on file', async () => {
    h.me = 'seller-1'
    h.convo = withPhone(null)
    expect((await get()).body.teacher.hasPhone).toBe(false)
    h.convo = withPhone('+84 90 123 4567')
    const { body } = await get()
    expect(body.teacher.hasPhone).toBe(true)
    expect(JSON.stringify(body)).not.toContain('123 4567') // the number itself never leaves the server here
  })
  it('the school is told nothing about it', async () => {
    h.me = 'buyer-1'
    h.convo = withPhone('+84 90 123 4567')
    const { body } = await get()
    expect('hasPhone' in body.teacher).toBe(false)
    expect(JSON.stringify(body)).not.toContain('123 4567')
  })
})

// ⛔ A SHARE RECORDS WHETHER ITS TAP INCLUDED THE PHONE (gate review, 2026-10-09 — TeacherContactShare.phoneShared). The
// teacher's strip reads it to keep saying "email and CV" after a phone is added, and to offer "Share my phone too".
describe('a teacher thread — phoneShared, for the teacher only', () => {
  const sharedAs = (phoneShared: boolean, revokedAt: Date | null = null): Row => thread({
    listing: { ...thread().listing, listingType: 'teacher', teacherProfile: { status: 'live', videoOnRequest: false, private: { videoPath: null, phone: '+84 90 123 4567' } } },
    teacherContactShare: { revokedAt, phoneShared },
    buyer: { ...thread().buyer, accountType: 'business' },
  })
  afterEach(() => { h.me = 'buyer-1' })

  it('the teacher is told whether the standing share included the phone — not whether one is on file now', async () => {
    h.me = 'seller-1'
    h.convo = sharedAs(false) // shared as "email & CV", a phone added since
    let { body } = await get()
    expect(body.teacher).toMatchObject({ shared: true, hasPhone: true, phoneShared: false })
    h.convo = sharedAs(true)
    ;({ body } = await get())
    expect(body.teacher.phoneShared).toBe(true)
    h.convo = sharedAs(true, new Date()) // stopped: no share stands
    ;({ body } = await get())
    expect(body.teacher).toMatchObject({ shared: false, phoneShared: false })
  })
  it('the school is told nothing about it — its own contact read already shows what it got', async () => {
    h.me = 'buyer-1'
    h.convo = sharedAs(false)
    const { body } = await get()
    expect(body.teacher.shared).toBe(true)
    expect('phoneShared' in body.teacher).toBe(false)
  })
})
