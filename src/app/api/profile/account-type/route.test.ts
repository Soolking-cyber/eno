import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOS_EFFECTIVE_AT, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * POST /api/profile/account-type — the two records onboarding writes about a person.
 *
 * 1. ⛔ THE SERVER COPY OF `eno_attr` ONTO THE PROFILE NEEDS THE ANALYTICS PURPOSE (consent v2).
 *    The cookie itself proves nothing: a visitor re-asked under v2 who DECLINES may still carry an
 *    `eno_attr` written under the old consent until the browser cleanup deletes it, and this route used
 *    to copy it onto their account at signup with no check at all. The gate reads the request's own
 *    consent cookie through the shared rule (src/lib/consent-value.ts), which also forces analytics off
 *    in the app.
 *
 * 2. ONBOARDING STAMPS THE TERMS VERSION IN FORCE — NOT THE NEWEST ONE. This route is the only writer
 *    of Profile.tosVersion / tosAcceptedAt, and those two columns are evidence of what a person agreed
 *    to and when (E-Transactions Law). During a notice window the newly published Terms are not yet
 *    binding, so a person onboarding then accepts the PREVIOUS version; from the in-force instant
 *    (midnight Vietnam time, src/lib/site-legal.ts) they accept the new one. Version 2 had no window
 *    (immediate, in force 01/10/2026 — owner's decision), so before that instant is the day before.
 */

const h = vi.hoisted(() => ({
  /** The stored profile's fields the route branches on — reset per test. */
  accountType: null as string | null,
  tosVersion: null as string | null,
  profileUpdates: [] as Record<string, unknown>[],
  afterWork: [] as Array<() => unknown>,
  capi: [] as Array<{ name: string; customData?: Record<string, unknown> }>,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (fn: () => unknown) => { h.afterWork.push(fn) },
}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({
    id: 'p1', accountType: h.accountType, displayName: 'Lan', phone: null, tosVersion: h.tosVersion, email: 'lan@example.com',
  }),
  getCurrentProfileId: async () => 'p1',
  getAdmin: async () => null,
  getVerifiedPhone: async () => null,
}))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => null },
    profile: { update: async ({ data }: { data: Record<string, unknown> }) => { h.profileUpdates.push(data); return {} } },
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9, resetSec: 0 }) }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/handle', () => ({ consolidateSellerHandle: async () => {}, revertToPersonalHandle: async () => {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ claimGuestStorefront: async () => ({ claimed: false }) }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/seller-pdp-refresh', () => ({ refreshSellerPdps: async () => {} }))
vi.mock('@/lib/meta-capi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendMetaCapiEvent: async (name: string, opts: { customData?: Record<string, unknown> }) => { h.capi.push({ name, customData: opts.customData }) },
}))

const { POST } = await import('./route')

beforeEach(() => {
  h.accountType = null
  h.tosVersion = null
  h.profileUpdates = []
  h.afterWork = []
  h.capi = []
})

describe('account-type — first-touch attribution needs the Analytics purpose', () => {
  const nowS = () => Math.floor(Date.now() / 1000)
  const v2 = (bits: string) => `v2.${bits}.${nowS() - 60}.c0ffee00-1234-4abc-8def-001122334455`
  const ATTR = `eno_attr=${encodeURIComponent(JSON.stringify({ s: 'facebook', m: 'paid-social', c: 'launch', t: '2026-09-01T00:00:00.000Z' }))}`

  async function signup(cookie: string, ua = 'Mozilla/5.0 (Macintosh)') {
    const r = await POST(new Request('https://eno.vn/api/profile/account-type', {
      method: 'POST',
      body: JSON.stringify({ accountType: 'individual', displayName: 'Lan' }),
      headers: { 'content-type': 'application/json', cookie, 'user-agent': ua },
    }))
    expect(r.status).toBe(200)
    for (const fn of h.afterWork) await fn()
  }
  const attrWrites = () => h.profileUpdates.filter((d) => 'attrSource' in d)

  it('copies eno_attr onto the profile with Analytics granted', async () => {
    await signup(`${ATTR}; eno-consent-v2=${v2('010')}`)
    expect(attrWrites()).toEqual([expect.objectContaining({ attrSource: 'facebook', attrMedium: 'paid-social', attrCampaign: 'launch' })])
  })

  it('⛔ writes NOTHING when the visitor declined (the cookie outlived the old consent)', async () => {
    await signup(`${ATTR}; eno-consent-v2=${v2('000')}`)
    expect(attrWrites()).toEqual([])
    // …and the channel does not ride along on the Meta event either.
    expect(h.capi.every((e) => !e.customData || !('source' in e.customData))).toBe(true)
  })

  it('⛔ writes NOTHING for a bare v1 "all" — that consent is asked again, not honoured', async () => {
    await signup(`${ATTR}; eno-consent=all; eno-cookie-consent=all`)
    expect(attrWrites()).toEqual([])
  })

  it('⛔ writes NOTHING with Personalization + Advertising but not Analytics', async () => {
    await signup(`${ATTR}; eno-consent-v2=${v2('101')}`)
    expect(attrWrites()).toEqual([])
  })

  it('⛔ writes NOTHING from inside the native app, whatever is stored', async () => {
    await signup(`${ATTR}; eno-consent-v2=${v2('111')}`, 'Mozilla/5.0 (iPhone) EnoNativeApp/1')
    expect(attrWrites()).toEqual([])
  })
})

describe('POST /api/profile/account-type — the Terms acceptance stamp', () => {
  /**
   * An individual RE-onboarding (accountType already set): no storefront, attribution or CAPI path, so
   * the profile write under test is the only one. The clock is pinned (Date only) per call.
   */
  async function onboardAt(at: number) {
    vi.setSystemTime(at)
    const res = await POST(new Request('https://eno.vn/api/profile/account-type', {
      method: 'POST',
      body: JSON.stringify({ accountType: 'individual', displayName: 'Lan' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    return h.profileUpdates.at(-1) ?? {}
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    h.accountType = 'individual'
  })
  afterEach(() => vi.useRealTimers())

  it('stamps the PREVIOUS version one millisecond before the in-force instant', async () => {
    const data = await onboardAt(TOS_EFFECTIVE_AT - 1)
    expect(data.tosVersion).toBe(TOS_PREVIOUS_VERSION)
    expect((data.tosAcceptedAt as Date).getTime()).toBe(TOS_EFFECTIVE_AT - 1)
  })

  it('stamps the NEW version from the instant', async () => {
    const data = await onboardAt(TOS_EFFECTIVE_AT)
    expect(data.tosVersion).toBe(TOS_VERSION)
    expect((data.tosAcceptedAt as Date).getTime()).toBe(TOS_EFFECTIVE_AT)
  })

  it('leaves a profile alone that already holds the version in force', async () => {
    h.tosVersion = TOS_PREVIOUS_VERSION
    const data = await onboardAt(TOS_EFFECTIVE_AT - 60_000)
    expect(data).not.toHaveProperty('tosVersion')
    expect(data).not.toHaveProperty('tosAcceptedAt')
  })

  it('re-stamps an acceptance of the previous version once the new one is in force', async () => {
    h.tosVersion = TOS_PREVIOUS_VERSION
    const data = await onboardAt(TOS_EFFECTIVE_AT + 60_000)
    expect(data.tosVersion).toBe(TOS_VERSION)
  })

  // ⛔ Version 2 is an IMMEDIATE amendment (owner, 2026-10-01: "just change now … no need for announcement"):
  // in force from midnight Vietnam time on its publication day, so onboarding on 01/10 accepts version 2.
  it('stamps version 2 on 01/10/2026 itself — no notice window', async () => {
    const at = Date.parse('2026-10-01T18:00:00+07:00')
    expect(TOS_EFFECTIVE_AT).toBe(Date.parse('2026-10-01T00:00:00+07:00'))
    const data = await onboardAt(at)
    expect(data.tosVersion).toBe('2')
    expect((data.tosAcceptedAt as Date).getTime()).toBe(at)
    // …and an account that accepted version 1 earlier that day is re-stamped on its next onboarding.
    h.tosVersion = '1'
    expect((await onboardAt(at + 60_000)).tosVersion).toBe('2')
  })
})
