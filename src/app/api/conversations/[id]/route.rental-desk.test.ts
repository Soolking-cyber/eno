import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] on a DESK thread — the rental desks and, since 2026-10-20, the jobs desk (teacher job DMs,
 * "Alex · eno.vn") — the counterpart carries no storefront and no trust, on either side, and the thread says which desk
 * it is (`desk`).
 *
 * Why it matters, concretely: the desk Seller row is created lazily, so its `memberSince` is recent
 * and its `reviewCount` is 0 — the header would call eno's own team a "New user", link to an empty
 * storefront, and the buyer-side review prompt (which needs a counterpart seller id) could fire on a
 * free availability check. And the operator's counterpart is a person asking for help, whose own
 * shop has nothing to do with the request.
 *
 * The ordinary buyer↔seller thread is pinned alongside, so the exemption cannot quietly widen.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'asker-1' as string | null,
  convo: null as Row | null,
  buyerStorefront: null as Row | null,
  storefrontLookups: 0,
  /**
   * The gone-storefront probes (src/lib/storefront-gone.ts): the public probe's answer, the any-listing
   * probe's answer (an emptied shop still holds rows; a desk never had one), and how often they ran.
   */
  publicListing: { id: 'L-public' } as Row | null,
  anyListing: null as Row | null,
  goneProbes: 0,
  /** The teacher's job-messages switch row (TeacherJobDmConsent), how often it was read, and a read failure. */
  jobConsent: null as Row | null,
  jobConsentReads: 0,
  jobConsentFails: false,
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
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    seller: { findUnique: async () => { h.storefrontLookups += 1; return h.buyerStorefront } },
    // The public probe asks `verified`; the any-listing probe does not.
    listing: { findFirst: async ({ where }: { where: Row }) => { h.goneProbes += 1; return 'verified' in where ? h.publicListing : h.anyListing } },
    review: { findUnique: async () => null },
    teacherJobDmConsent: {
      findUnique: async () => {
        h.jobConsentReads += 1
        if (h.jobConsentFails) throw new Error('relation "TeacherJobDmConsent" does not exist')
        return h.jobConsent
      },
    },
  },
}))

const { GET } = await import('./route')
const { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } = await import('@/lib/teachers/job-dms/constants')

const NEW = new Date()
function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'asker-1', sellerProfileId: 'op-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null, listing: null,
    seller: { id: 'eno-rental-desk', ownerId: null, name: 'eno team', avatarColor: '#dc2626', avatarUrl: null, trustScore: 100, trustTier: 'standard', memberSince: NEW, reviewCount: 0, officialPartner: false, owner: null },
    buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#111111', avatarUrl: null, lastSeenAt: null, locale: 'en' },
    messages: [],
    ...over,
  }
}
const get = async () => {
  const res = await GET(new Request('http://localhost/api/conversations/thread-1'), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.me = 'asker-1'
  h.convo = thread()
  h.buyerStorefront = { id: 'annas-shop', trustScore: 90, trustTier: 'trusted', memberSince: new Date('2024-01-01'), reviewCount: 3 }
  h.storefrontLookups = 0
  h.publicListing = { id: 'L-public' }
  h.anyListing = null
  h.goneProbes = 0
  h.jobConsent = null
  h.jobConsentReads = 0
  h.jobConsentFails = false
})

describe('a rental-desk thread', () => {
  it('the REQUESTER sees "eno team" with no storefront link and no trust chip', async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.counterpart.name).toBe('eno team')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
    expect(body.listing).toBeNull()
    expect(body.kind).toBeNull()
  })

  it("the OPERATOR sees the requester, without the requester's shop or trust — and does not look it up", async () => {
    h.me = 'op-1'
    const { body } = await get()
    expect(body.counterpart.name).toBe('Anna')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
    expect(body.iAmSeller).toBe(true)
    expect(h.storefrontLookups).toBe(0)
  })

  it('works for the forum desk id too', async () => {
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-rental-desk-forum' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
  })
})

describe('an ordinary thread is untouched', () => {
  it('still links the seller and carries trust for the buyer', async () => {
    h.convo = thread({
      listing: { id: 'L1', title: 'Studio', images: '[]', price: 1, currency: '₫', priceUnit: 'VND/month', negotiable: true, availabilityConfirmedAt: null, status: 'active' },
      seller: { ...thread().seller, id: 'some-shop', name: 'Some Shop' },
    })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('some-shop')
    expect(body.counterpart.trust).not.toBeNull()
  })

  // The SELLER ID is the discriminator, not the missing listing: every listing-less thread today is
  // a desk thread (support or rental), so this pins that only the rental desk ids trip the exemption.
  it('the exemption keys on the rental-desk seller id, not on the missing listing', async () => {
    h.convo = thread({ seller: { ...thread().seller, id: 'some-shop', name: 'Some Shop' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('some-shop')
  })

  it('the seller side still sees the buyer’s own storefront', async () => {
    h.me = 'op-1'
    h.convo = thread({
      listing: { id: 'L1', title: 'Studio', images: '[]', price: 1, currency: '₫', priceUnit: 'VND/month', negotiable: true, availabilityConfirmedAt: null, status: 'active' },
      seller: { ...thread().seller, id: 'some-shop' },
    })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('annas-shop')
    expect(body.counterpart.trust).toMatchObject({ trustTier: 'trusted' })
  })
})

/**
 * ⛔ THE HEADER LINKS A STOREFRONT ONLY WHEN THERE IS ONE (owner, 2026-10-02). An ownerless shop that had
 * listings and has no public one left is gone — /sellers/<id> 404s — so `storefront: false` and the client
 * renders the name as text. `sellerId` stays: the buyer's review prompt keys on it. An ownerless shop that
 * NEVER had a listing — the support desk every buyer's inbox holds — is not gone, and stays linked. The
 * poll stays free on the common path.
 */
describe('counterpart.storefront — a gone shop is not linked; a desk is', () => {
  const PUBLIC = { id: 'L1', title: 'Shoe', images: '[]', price: 1, currency: '₫', priceUnit: null, negotiable: true, availabilityConfirmedAt: null, status: 'active', verified: true }

  it('this edition’s support desk: sellerId kept, storefront LINKED, and the poll pays no probe', async () => {
    h.publicListing = null
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-support-desk', name: 'eno Support' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('eno-support-desk')
    expect(body.counterpart.storefront).toBe(true)
    expect(h.goneProbes).toBe(0)
  })

  it('the OTHER edition’s desk (ownerless, never had a listing) is linked too, through both probes', async () => {
    h.publicListing = null
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-support-desk-forum', name: 'eno Support' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('eno-support-desk-forum')
    expect(body.counterpart.storefront).toBe(true)
    expect(h.goneProbes).toBe(2)
  })

  it('an emptied import shop whose listing in this thread is hidden: storefront false, sellerId kept', async () => {
    h.publicListing = null
    h.anyListing = { id: 'L1' }
    h.convo = thread({ listing: { ...PUBLIC, status: 'hidden' }, seller: { ...thread().seller, id: 'cmu52jkld0000czq443snv0jh', name: 'SuperSports' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('cmu52jkld0000czq443snv0jh')
    expect(body.counterpart.storefront).toBe(false)
    expect(h.goneProbes).toBe(2)
  })

  it('an emptied import shop seen from a listing-less thread: storefront false too', async () => {
    h.publicListing = null
    h.anyListing = { id: 'hidden-1' }
    h.convo = thread({ seller: { ...thread().seller, id: 'cmu52jkld0000czq443snv0jh', name: 'SuperSports' } })
    const { body } = await get()
    expect(body.counterpart.storefront).toBe(false)
  })

  it('an ownerless shop whose thread listing is public: linked, and the poll pays no probe', async () => {
    h.convo = thread({ listing: PUBLIC, seller: { ...thread().seller, id: 'import-shop', name: 'Import' } })
    const { body } = await get()
    expect(body.counterpart.storefront).toBe(true)
    expect(h.goneProbes).toBe(0)
  })

  it('an OWNED shop is always linked and never probed, even with nothing public', async () => {
    h.publicListing = null
    h.convo = thread({ seller: { ...thread().seller, id: 'annas-shop', ownerId: 'p-anna', name: 'Anna' } })
    const { body } = await get()
    expect(body.counterpart.storefront).toBe(true)
    expect(h.goneProbes).toBe(0)
  })

  it('the operator side (the buyer’s own, owned shop) is linked without a probe', async () => {
    h.me = 'op-1'
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-support-desk' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('annas-shop')
    expect(body.counterpart.storefront).toBe(true)
    expect(h.goneProbes).toBe(0)
  })

  it('a rental-desk thread has no seller id, so nothing to link', async () => {
    const { body } = await get()
    expect(body.counterpart.storefront).toBe(false)
    expect(h.goneProbes).toBe(0)
  })
})

/**
 * THE JOBS DESK (teacher job DMs, 2026-10-20 — src/lib/teachers/job-dms/constants.ts): the same chrome as the rental desk —
 * one desk set, not a copy of the check — plus the two facts the thread page needs: `desk: 'jobs'`, and `fromDesk` on the
 * messages the desk OPERATOR (the thread's sellerProfileId) wrote, which are the only ones whose links are drawn and under
 * whose newest one the teacher gets the two quick replies.
 */
describe('a jobs-desk thread', () => {
  const jobs = (over: Row = {}): Row => thread({ seller: { ...thread().seller, id: 'eno-jobs-desk', name: 'Alex · eno.vn' }, ...over })

  it('the TEACHER sees "Alex · eno.vn" with no storefront link and no trust chip — and pays no probe', async () => {
    h.publicListing = null
    h.convo = jobs()
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.counterpart.name).toBe('Alex · eno.vn')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.storefront).toBe(false)
    expect(body.counterpart.trust).toBeNull()
    expect(body.listing).toBeNull()
    expect(body.kind).toBeNull()
    expect(body.desk).toBe('jobs')
    expect(h.goneProbes).toBe(0)
  })

  it("the OPERATOR sees the teacher, without the teacher's shop or trust — and does not look it up", async () => {
    h.me = 'op-1'
    h.convo = jobs()
    const { body } = await get()
    expect(body.counterpart.name).toBe('Anna')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
    expect(body.iAmSeller).toBe(true)
    expect(body.desk).toBe('jobs')
    expect(h.storefrontLookups).toBe(0)
  })

  it("flags exactly the operator's messages `fromDesk` — never the teacher's, nor a former operator's", async () => {
    // Newest first, as the route reads them; the payload is chronological.
    h.convo = jobs({
      messages: [
        { id: 'm4', senderProfileId: 'op-before-repoint', body: 'an older operator' },
        { id: 'm3', senderProfileId: 'op-1', body: '1. Cover lesson https://eno.vn/listings/1' },
        { id: 'm2', senderProfileId: 'asker-1', body: 'Keep sending jobs' },
        { id: 'm1', senderProfileId: 'op-1', body: 'Hi, this is Alex from eno.vn.' },
      ],
    })
    const { body } = await get()
    expect(body.messages.map((m: Row) => [m.id, m.fromDesk ?? null])).toEqual([['m1', true], ['m2', null], ['m3', true], ['m4', null]])
  })

  /**
   * The teacher's job-messages switch rides along for the two quick replies: after a STOP the desk's acknowledgement is
   * the newest message, and the pair must not come back under it. On = opted in under the CURRENT notice.
   */
  it("tells the TEACHER whether their job-messages switch is on — their own under the current notice, or eno's default-on", async () => {
    h.convo = jobs()
    h.jobConsent = { optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION }
    expect((await get()).body.jobMessagesOn).toBe(true)
    h.jobConsent = { optIn: true, noticeVersion: JOB_DM_DEFAULT_ON }
    expect((await get()).body.jobMessagesOn).toBe(true)
    h.jobConsent = { optIn: false, noticeVersion: JOB_DM_NOTICE_VERSION }
    expect((await get()).body.jobMessagesOn).toBe(false)
    // An opt-in under an older notice no longer counts (the desk does not send by it either).
    h.jobConsent = { optIn: true, noticeVersion: '2000-01-01' }
    expect((await get()).body.jobMessagesOn).toBe(false)
    h.jobConsent = null
    expect((await get()).body.jobMessagesOn).toBe(false)
  })

  it('a failed switch read is false — the thread still opens', async () => {
    h.convo = jobs()
    h.jobConsentFails = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { status, body } = await get()
    err.mockRestore()
    expect(status).toBe(200)
    expect(body.jobMessagesOn).toBe(false)
  })

  it('nobody else pays the read or gets the field — not the operator, not a rental-desk thread', async () => {
    h.me = 'op-1'
    h.convo = jobs()
    expect('jobMessagesOn' in (await get()).body).toBe(false)
    h.me = 'asker-1'
    h.convo = thread()
    expect('jobMessagesOn' in (await get()).body).toBe(false)
    expect(h.jobConsentReads).toBe(0)
  })

  it('flags nothing on a thread with no operator', async () => {
    h.convo = jobs({ sellerProfileId: null, messages: [{ id: 'm1', senderProfileId: 'op-1', body: 'x' }] })
    const { body } = await get()
    expect(body.messages[0].fromDesk).toBeUndefined()
  })
})

describe('the desk flag stays on the desks', () => {
  const msgs = [{ id: 'm1', senderProfileId: 'op-1', body: 'https://eno.vn/listings/1' }]

  it("a rental-desk thread says 'rental' — and its messages are never flagged (links are the jobs desk's alone)", async () => {
    h.convo = thread({ messages: msgs })
    const { body } = await get()
    expect(body.desk).toBe('rental')
    expect(body.messages[0].fromDesk).toBeUndefined()
  })

  it('an ordinary thread carries neither key — its payload is unchanged', async () => {
    h.convo = thread({ seller: { ...thread().seller, id: 'some-shop', name: 'Some Shop' }, messages: msgs })
    const { body } = await get()
    expect('desk' in body).toBe(false)
    expect('fromDesk' in body.messages[0]).toBe(false)
  })

  it('the support desk is not one of them: it keeps its seller id and its link', async () => {
    h.publicListing = null
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-support-desk', name: 'eno Support' }, messages: msgs })
    const { body } = await get()
    expect('desk' in body).toBe(false)
    expect(body.counterpart.sellerId).toBe('eno-support-desk')
  })
})
