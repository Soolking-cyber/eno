import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A REVIEW SEAT NEVER SEES A TEACHER'S ZALO (src/lib/review-seat-accounts.ts; zalo.ts viewerOf). The seat is an outside
 * reviewer's shared login: a reveal would hand it a real teacher's number and leave a bell naming the shop on that
 * teacher's record. The rest of zalo.ts runs on a real Postgres (zalo.it.test.ts); this pins the one refusal without a
 * database: the profile read and the reveal ledger are faked, and a school that is not a seat, in the same setup, is the
 * control — it gets the button and the number, so the seat's refusal is the guard's and nothing else's.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  profile: null as Row | null,
  tierAsked: 0,
  transactions: 0,
  reveals: [] as Row[],
  bells: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async () => {} }))
vi.mock('@/lib/contact', () => ({ zaloHref: (n: string) => `https://zalo.me/${n}` }))
vi.mock('@/lib/enforcement', () => ({ getEnforcement: async () => ({ state: 'good_standing' }), blocksMessaging: () => false }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('./dm-lock', () => ({ teacherDmLock: async () => {} }))
vi.mock('./dm-quota', () => ({
  poolKeyFor: () => 'teacher-dm-ip:pool',
  vnDayWindow: (now: Date) => ({ day: '2026-11-14', start: now, resetAt: new Date(now.getTime() + 3_600_000) }),
  // A business with a live identity check, below the business badge: the 'school' tier, 1 new number a day.
  teacherDmTier: async () => { h.tierAsked++; return { tier: 'identity', limit: 10, next: 'verify_business', nextLimit: 30, needsPhone: false, pooled: false } },
}))

const { COVER_CONSENT_VERSION } = await import('./cover')
const { COVER_ZALO_NOTICE_VERSION } = await import('./zalo-rules')

vi.mock('@/lib/db', () => {
  const teacher = () => ({
    id: 'tp1', profileId: 'teacher-1', coverOpen: true, coverConsentVersion: COVER_CONSENT_VERSION,
    private: { coverZalo: '0901234567', coverZaloAt: new Date('2026-11-01T00:00:00Z'), coverZaloVersion: COVER_ZALO_NOTICE_VERSION },
  })
  const client: Row = {
    profile: { findUnique: async () => h.profile },
    teacherProfile: { findFirst: async () => teacher() },
    teacherZaloReveal: {
      count: async () => 0,
      create: async ({ data }: Row) => { h.reveals.push(data); return data },
    },
    notification: { create: async ({ data }: Row) => { h.bells.push(data); return data } },
    $executeRaw: async () => 1,
  }
  client.$transaction = async (fn: (tx: Row) => Promise<unknown>) => { h.transactions++; return fn(client) }
  return { db: client }
})

const { revealZalo, zaloStanding } = await import('./zalo')

const SCHOOL = 'viewer-1'
const LISTING = 'listing-cover-teacher'
const IP = '203.0.113.9'
const business = (email: string) => ({ accountType: 'business', email, businessName: 'Review shop', seller: { name: 'eno AI app review (internal)' } })

beforeEach(() => { h.profile = null; h.tierAsked = 0; h.transactions = 0; h.reveals = []; h.bells = [] })

describe('the control — a school that is not a seat', () => {
  it('is offered the button and gets the number, and the teacher is told', async () => {
    h.profile = business('office@saigon-english.example')
    expect(await zaloStanding(SCHOOL, LISTING, IP)).toMatchObject({ available: true, reason: null, tier: 'school' })
    expect(await revealZalo(SCHOOL, LISTING, IP)).toMatchObject({ ok: true, zalo: '0901234567' })
    expect(h.reveals).toHaveLength(1)
    expect(h.bells).toHaveLength(1)
  })

  // Round 4, 2026-11-14: the lawyer's seat (Luật Hoàng Phi's storefront) is no store seat — review-seat-accounts.ts.
  it('…and so is the lawyer\'s seat, a business like any other', async () => {
    h.profile = business('lawyer-review@eno.vn')
    expect(await zaloStanding(SCHOOL, LISTING, IP)).toMatchObject({ available: true, reason: null, tier: 'school' })
  })
})

describe('⛔ a review seat', () => {
  for (const email of ['ai-review@eno.vn', ' AI-Review@ENO.vn ', 'play-review@eno.forum', 'app-review@eno.vn']) {
    it(`${JSON.stringify(email)} as a business: "not available" (no step offered), and a tap reveals nothing and rings nobody`, async () => {
      h.profile = business(email)
      expect(await zaloStanding(SCHOOL, LISTING, IP)).toMatchObject({ available: false, revealed: false, tier: 'none', limit: 0, reason: 'business_only', next: 'none' })
      expect(await revealZalo(SCHOOL, LISTING, IP)).toBeNull() // the route's 404 not_available
      expect(h.transactions).toBe(0)
      expect(h.reveals).toEqual([])
      expect(h.bells).toEqual([])
      expect(h.tierAsked).toBe(0) // refused before the ladder is read
    })
  }

  it('as a personal account too — and it is never told to switch to a business', async () => {
    h.profile = { ...business('app-review@eno.vn'), accountType: 'individual' }
    expect(await zaloStanding(SCHOOL, LISTING, IP)).toMatchObject({ available: false, reason: 'business_only', next: 'none' })
    expect(await revealZalo(SCHOOL, LISTING, IP)).toBeNull()
    expect(h.reveals).toEqual([])
  })
})
