import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SELLER MUST BE TOLD — a test for the thing whose ABSENCE was the bug.
 *
 * ⛔ WHY THIS FILE EXISTS. Owner, 2026-08-17: "when business registration documents sent and
 * rejected or approved seller doesnt get noticification fix it". The review wrote a status to the
 * database and told nobody. Nothing failed, nothing logged, every gate stayed green — the outcome
 * simply sat there until the seller next opened Settings, and nothing invited them to.
 *
 * ⚠️ A MISSING NOTIFICATION IS INVISIBLE TO EVERY OTHER KIND OF TEST. tsc, lint and the e2e suite
 * all pass on a review that notifies nobody, because the state transition — the part everything
 * else asserts on — is correct. The only guard is to assert the side effect exists.
 *
 * ⚠️ ASSERTS THE TRANSITION GUARD TOO, not just the happy path: a second admin clicking approve on
 * an already-approved case must produce NO second notification. The reviews are compare-and-set
 * updateMany's on status='pending', and the notify call sits behind `count === 1` precisely so a
 * race cannot double-notify a seller.
 */

const h = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  mails: [] as Array<Record<string, unknown>>,
  pushes: [] as Array<Record<string, unknown>>,
  rejectCount: 1,
  seller: { ownerId: 'owner-1', owner: { email: 'seller@example.com', locale: 'en' } } as
    | { ownerId: string | null; owner: { email: string | null; locale: string | null } | null }
    | null,
}))

vi.mock('server-only', () => ({}))
// `after()` runs the callback inline so the email/push assertions are deterministic.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async (id: string, p: unknown) => { h.pushes.push({ id, p }); return 1 } }))
vi.mock('@/lib/mail', () => ({ sendMail: async (m: Record<string, unknown>) => { h.mails.push(m); return true } }))
vi.mock('@/lib/tax-lookup', () => ({ taxVerdict: () => 'verified' }))
/**
 * ⚠️ APPROVAL RE-HASHES THE SELLER'S LIVE IDENTITY and refuses with `identity_moved` if it has
 * drifted from the case — the guard that closes the approve-vs-edit race. Pinned to the fixture's
 * hash so the approval test exercises the NOTIFICATION, not that guard (which is another file's
 * job). Everything else from that module is passed through.
 */
vi.mock('@/lib/business-verification', async (orig) => ({
  ...(await orig<typeof import('@/lib/business-verification')>()),
  sellerIdentityHash: () => 'hash-1',
}))
vi.mock('@/lib/edition', () => ({ SITE_NAME: 'eno.forum', IS_SERVICES: true, IS_MARKETPLACE: false, EDITION: 'services' }))
vi.mock('@/lib/db', () => ({
  db: {
    sellerVerification: {
      updateMany: async () => ({ count: h.rejectCount }),
      findUnique: async () => ({ id: 'case-1', sellerId: 'seller-1', status: 'pending', identityHash: 'hash-1' }),
    },
    seller: { findUnique: async () => h.seller, update: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      sellerVerification: { updateMany: async () => ({ count: h.rejectCount }) },
      seller: { update: async () => ({}) },
    }),
    notification: { create: async ({ data }: { data: Record<string, unknown> }) => { h.notifications.push(data); return data } },
  },
}))

const { rejectVerification, approveVerification } = await import('./business-verification-service')

beforeEach(() => {
  h.notifications = []; h.mails = []; h.pushes = []
  h.rejectCount = 1
  h.seller = { ownerId: 'owner-1', owner: { email: 'seller@example.com', locale: 'en' } }
})

describe('a decided verification tells the seller', () => {
  it('creates a bell notification carrying the operator note', async () => {
    const r = await rejectVerification('case-1', 'admin@eno.vn', 'tax code does not match the licence')
    expect(r).toEqual({ ok: true })
    expect(h.notifications).toHaveLength(1)
    // The note is the actionable half — a rejection that does not say what to fix is useless.
    expect(String(h.notifications[0].body)).toContain('tax code')
    expect(h.notifications[0].url).toBe('/dashboard/settings')
  })

  it('emails the seller, because a review lands when nobody is on the site', async () => {
    await rejectVerification('case-1', 'admin@eno.vn', 'tax code does not match')
    expect(h.mails).toHaveLength(1)
    expect(h.mails[0].to).toBe('seller@example.com')
    // ⚠️ Nothing identifying in the subject — it is what a lock screen shows.
    expect(String(h.mails[0].subject)).not.toContain('tax code')
  })

  it('⚠️ does NOT notify when the transition did not happen — no double-notify on a race', async () => {
    h.rejectCount = 0 // another admin already decided this case
    const r = await rejectVerification('case-1', 'admin@eno.vn', 'note')
    expect(r).toEqual({ ok: false, error: 'not_pending' })
    expect(h.notifications).toHaveLength(0)
    expect(h.mails).toHaveLength(0)
  })

  it('survives an unreachable owner rather than failing the review', async () => {
    h.seller = { ownerId: null, owner: null }
    const r = await rejectVerification('case-1', 'admin@eno.vn', 'note')
    // The badge decision stands even though nobody could be told — best-effort by design.
    expect(r).toEqual({ ok: true })
    expect(h.notifications).toHaveLength(0)
  })

  /** The approval path is a separate transition and was untested — reviewer-caught. */
  it('notifies on APPROVAL too, not only on rejection', async () => {
    const r = await approveVerification('case-1', 'admin@eno.vn')
    expect(r).toEqual({ ok: true })
    expect(h.notifications).toHaveLength(1)
    expect(String(h.notifications[0].title)).toMatch(/verified/i)
    expect(h.mails).toHaveLength(1)
  })

  /**
   * ⛔ A PUSH IS A LOCK-SCREEN OBJECT. The operator note is free text and can name a tax code, a
   * licence number or an account holder; it belongs in the bell (behind auth) and the email body,
   * never in the push. Reviewer-caught after the first version shipped the note to both.
   */
  it('keeps the operator note OUT of the push body', async () => {
    await rejectVerification('case-1', 'admin@eno.vn', 'MST 0123456789 does not match')
    expect(h.pushes).toHaveLength(1)
    const push = h.pushes[0].p as { body: string }
    expect(push.body).not.toContain('0123456789')
    // ...while the bell, which is behind auth, still carries it.
    expect(String(h.notifications[0].body)).toContain('0123456789')
  })

  /** One codebase, two deployments — the copy must name the site that actually reviewed them. */
  it('brands with the running edition, never a hardcoded eno.vn', async () => {
    await rejectVerification('case-1', 'admin@eno.vn', 'note')
    expect(h.notifications[0].actorName).toBe('eno.forum')
  })

  it('localizes to the seller, not to the admin', async () => {
    h.seller = { ownerId: 'owner-1', owner: { email: 'ban@example.com', locale: 'vi' } }
    await rejectVerification('case-1', 'admin@eno.vn', 'ghi chú')
    expect(String(h.notifications[0].title)).toMatch(/Xác minh/)
  })
})
