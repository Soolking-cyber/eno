import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE SERVER COPY OF `eno_attr` ONTO THE PROFILE NEEDS THE ANALYTICS PURPOSE (consent v2).
 *
 * The cookie itself proves nothing: a visitor re-asked under v2 who DECLINES may still carry an
 * `eno_attr` written under the old consent until the browser cleanup deletes it, and this route used to
 * copy it onto their account at signup with no check at all. The gate reads the request's own consent
 * cookie through the shared rule (src/lib/consent-value.ts), which also forces analytics off in the app.
 */

const h = vi.hoisted(() => ({
  profileUpdates: [] as Record<string, unknown>[],
  afterWork: [] as Array<() => unknown>,
  capi: [] as Array<{ name: string; customData?: Record<string, unknown> }>,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (fn: () => unknown) => { h.afterWork.push(fn) },
}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'p1', accountType: null, displayName: 'Lan', phone: null, tosVersion: null, email: 'lan@example.com' }),
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
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9 }) }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/handle', () => ({ consolidateSellerHandle: async () => {}, revertToPersonalHandle: async () => {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ claimGuestStorefront: async () => ({ claimed: false }) }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/meta-capi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendMetaCapiEvent: async (name: string, opts: { customData?: Record<string, unknown> }) => { h.capi.push({ name, customData: opts.customData }) },
}))

const { POST } = await import('./route')

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

beforeEach(() => {
  h.profileUpdates = []
  h.afterWork = []
  h.capi = []
})

describe('account-type — first-touch attribution needs the Analytics purpose', () => {
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
