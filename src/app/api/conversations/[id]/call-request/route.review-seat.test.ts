import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/:id/call-request — "<seat> would like to call you" (round 4, codex P1). The REAL callPermit
 * (calls/server/eligibility.ts), its dependencies faked as eligibility.test.ts fakes them, so the route is judged end to
 * end: a review seat SELLING a job to a teacher who wrote in (both verified, calls on — the identity check cannot save
 * it) writes NO card, rings no bell, sends no push, records no consent and claims no cooldown. The control — an ordinary
 * school in the same thread — asks as before.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  me: 'seller' as string,
  emails: {} as Record<string, string>,
  teachers: ['buyer'] as string[],
  cards: [] as unknown[][],
  consents: [] as unknown[],
  claims: [] as string[],
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: h.me }), getCurrentProfileId: async () => h.me, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async (key: string) => { h.claims.push(key); return 'OK' }, del: async () => 1 },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
// The card writer is the thread write itself (insertMessage + the bell + the push, cards.ts): a call here IS a card sent.
vi.mock('@/lib/calls/server/cards', () => ({ writeCallRequest: async (...args: unknown[]) => { h.cards.push(args); return true } }))
vi.mock('@/lib/db', () => ({
  db: {
    // A JOB thread: the seat (or a school) is the SELLER, the teacher who wrote in is the BUYER.
    conversation: {
      findUnique: async () => ({ id: 'c1', buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop', listingId: 'J1', visaApplicationId: null, listing: { listingType: 'job' } }),
    },
    identityVerification: { findFirst: async () => null }, // nobody a minor
    profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: h.emails[where.id] ?? `${where.id}@example.com` }) },
    teacherProfile: { findUnique: async ({ where }: { where: { profileId: string } }) => (h.teachers.includes(where.profileId) ? { id: `tp-${where.profileId}` } : null) },
    // hasCallConsent: none yet. setCallConsent: recorded.
    $queryRaw: async () => [],
    $executeRaw: async (...args: unknown[]) => { h.consents.push(args); return 1 },
  },
}))
vi.mock('@/lib/calls/server/config', async (orig) => {
  const real = await orig<typeof import('@/lib/calls/server/config')>()
  return { ...real, readCallsConfig: async () => real.configFromRow({ mode: 'all', cohort: [], video: true, relay: 'cloudflare' }) }
})
vi.mock('@/lib/user-blocks', () => ({ blockingOn: () => true, isStaffProfile: async () => false, isBlockedBetween: async () => false }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/kyc/identity', () => ({ verifiedIdentityFor: async (id: string) => ({ profileId: id }) })) // both verified
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => [] }))
vi.mock('@/lib/ios-hide-visa-server', () => ({ isEVisaThread: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))

const { POST } = await import('./route')
const ask = async () => {
  const res = await POST(new Request('https://eno.vn/api/conversations/c1/call-request', { method: 'POST' }), { params: Promise.resolve({ id: 'c1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.me = 'seller'; h.emails = {}; h.teachers = ['buyer']; h.cards = []; h.consents = []; h.claims = [] })

describe('POST /api/conversations/:id/call-request — a review seat never asks a teacher (src/lib/review-seat-accounts.ts)', () => {
  it('⛔ seat seller, teacher buyer, a job listing → 403 calls_thread_unavailable: no card, no consent, no cooldown claimed', async () => {
    h.emails = { seller: 'ai-review@eno.vn' }
    expect(await ask()).toEqual({ status: 403, body: { error: 'calls_thread_unavailable' } })
    expect(h.cards).toEqual([])
    expect(h.consents).toEqual([])
    expect(h.claims).toEqual([])
  })

  it('CONTROL: an ordinary school in the same thread asks the teacher as before — one card, to the teacher', async () => {
    expect(await ask()).toEqual({ status: 200, body: { requested: true, alreadyAllowed: false } })
    expect(h.cards).toEqual([['c1', 'seller', 'buyer']])
  })

  it('CONTROL: the seat asking someone who is not a teacher is untouched', async () => {
    h.emails = { seller: 'ai-review@eno.vn' }
    h.teachers = []
    expect((await ask()).status).toBe(200)
    expect(h.cards).toHaveLength(1)
  })
})
