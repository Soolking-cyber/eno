import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CONSENT GATE ON SERVER-SIDE AD TRACKING — the invariant a Play Data Safety declaration and
 * Vietnam's PDP Law 91/2025 both rest on, and the one thing here with no test until now.
 *
 * `sendMetaCapiEvent` transfers a user's HASHED EMAIL, HASHED PHONE, stable id, IP address and user
 * agent to Meta. That is a third-party advertising transfer, so it may happen only for someone who
 * chose the 'all' tier in the consent banner. The gate fails CLOSED: no cookie, an older tier, a
 * malformed value or a hand-built `userData` object all send nothing.
 *
 * ⚠️ THE FAILURE MODE THIS GUARDS IS A NEW CALL SITE, NOT A CHANGED FUNCTION. Every current caller
 * builds `userData` with `metaUserDataFromHeaders`, which is what reads the cookie. Someone adding a
 * sixth event and assembling `userData` by hand would produce a call that looks identical, compiles,
 * and silently tracks a user who declined. The last test below pins exactly that shape.
 *
 * ⚠️ NO NETWORK. `fetch` is stubbed; a real request would be a live transfer to Meta.
 */
vi.stubEnv('META_PIXEL_ID', '1234567890')
vi.stubEnv('META_CAPI_TOKEN', 'test-token-not-a-real-credential')

const { sendMetaCapiEvent, metaUserDataFromHeaders } = await import('./meta-capi')

let sent: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

/** A request carrying the given consent cookie value, or none at all. */
const headers = (consent?: string) =>
  new Headers({
    'user-agent': 'Mozilla/5.0 (test)',
    'x-forwarded-for': '203.0.113.9',
    ...(consent === undefined ? {} : { cookie: `eno-cookie-consent=${consent}` }),
  })

const fire = async (consent?: string) => {
  await sendMetaCapiEvent('Contact', {
    userData: metaUserDataFromHeaders(headers(consent), { email: 'buyer@example.com', externalId: 'p1' }),
  })
}

describe('sendMetaCapiEvent consent gate', () => {
  it('sends for a visitor who chose the ad tier', async () => {
    await fire('all')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('1234567890')
  })

  it('sends NOTHING when the visitor declined', async () => {
    await fire('essential')
    expect(sent).toEqual([])
  })

  it('sends NOTHING on the middle tier — personalization is first-party, ads are not', async () => {
    await fire('personalized')
    expect(sent).toEqual([])
  })

  it('sends NOTHING when no choice has been made yet', async () => {
    await fire(undefined)
    expect(sent).toEqual([])
  })

  it('sends NOTHING for the legacy "accepted" value, which predates the ad tier', async () => {
    // ⚠️ FAIL CLOSED ON AN UNRECOGNISED VALUE. A cookie written before the tiers existed must not
    // be read as consent to something the user was never shown.
    await fire('accepted')
    expect(sent).toEqual([])
  })

  it('sends NOTHING for a hand-built userData that never consulted the cookie', async () => {
    // ⛔ THE REGRESSION A NEW CALL SITE WOULD INTRODUCE.
    await sendMetaCapiEvent('Contact', { userData: { email: 'buyer@example.com', externalId: 'p1' } })
    expect(sent).toEqual([])
  })

  it('never puts a raw email or phone on the wire', async () => {
    await sendMetaCapiEvent('Contact', {
      userData: metaUserDataFromHeaders(headers('all'), { email: 'buyer@example.com', phone: '+84901234567' }),
    })
    const wire = JSON.stringify(sent[0].body)
    expect(wire).not.toContain('buyer@example.com')
    expect(wire).not.toContain('901234567')
  })
})
