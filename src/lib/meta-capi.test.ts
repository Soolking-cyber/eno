import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CONSENT GATE ON SERVER-SIDE AD TRACKING — the invariant a Play Data Safety declaration and
 * Vietnam's PDP Law 91/2025 both rest on, and the one thing here with no test until now.
 *
 * `sendMetaCapiEvent` transfers a user's HASHED EMAIL, HASHED PHONE, stable id, IP address and user
 * agent to Meta. That is a third-party advertising transfer, so it may happen only for someone who
 * switched on the Advertising purpose (consent v2 `d`). The gate fails CLOSED: no cookie, ANY v1 value
 * (including the old 'all' tier, collected on a screen that never named advertising), an expired or
 * malformed v2 value, the native app, or a hand-built `userData` object all send nothing.
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

const nowS = () => Math.floor(Date.now() / 1000)
/** A consent v2 value: `bits` = p a d. */
const v2 = (bits: string, ts = nowS() - 60) => `v2.${bits}.${ts}.c0ffee00-1234-4abc-8def-001122334455`

/** A request carrying the given raw Cookie header, or none at all. */
const headersRaw = (cookie?: string, ua = 'Mozilla/5.0 (test)') =>
  new Headers({
    'user-agent': ua,
    'x-forwarded-for': '203.0.113.9',
    ...(cookie === undefined ? {} : { cookie }),
  })
/** A request carrying a v1 value in the legacy host-only cookie the old gate read. */
const headers = (consent?: string) => headersRaw(consent === undefined ? undefined : `eno-cookie-consent=${consent}`)

const fireWith = async (h: Headers) => {
  await sendMetaCapiEvent('Contact', {
    userData: metaUserDataFromHeaders(h, { email: 'buyer@example.com', externalId: 'p1' }),
  })
}
const fire = (consent?: string) => fireWith(headers(consent))

describe('sendMetaCapiEvent consent gate', () => {
  it('sends for a visitor who switched Advertising on (consent v2)', async () => {
    await fireWith(headersRaw(`eno-consent-v2=${v2('001')}`))
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('1234567890')
  })

  it('⛔ sends NOTHING for a bare v1 "all" — that consent is asked again under v2', async () => {
    await fire('all')
    await fireWith(headersRaw('eno-consent=all; eno-cookie-consent=all'))
    expect(sent).toEqual([])
  })

  it('⛔ sends NOTHING for a shared v2 refusal beside a host-only v1 "all"', async () => {
    await fireWith(headersRaw(`eno-cookie-consent=all; eno-consent-v2=${v2('000')}`))
    expect(sent).toEqual([])
  })

  it('sends NOTHING with Personalization and Analytics but not Advertising', async () => {
    await fireWith(headersRaw(`eno-consent-v2=${v2('110')}`))
    expect(sent).toEqual([])
  })

  it('⛔ sends NOTHING from inside the native app, whatever is stored (Apple ATT)', async () => {
    await fireWith(headersRaw(`eno-consent-v2=${v2('111')}`, 'Mozilla/5.0 (iPhone) AppleWebKit EnoNativeApp/1'))
    expect(sent).toEqual([])
  })

  it('sends NOTHING once the answer is older than 12 months', async () => {
    await fireWith(headersRaw(`eno-consent-v2=${v2('111', nowS() - 366 * 24 * 3600)}`))
    expect(sent).toEqual([])
  })

  it('sends NOTHING when the visitor declined', async () => {
    await fire('essential')
    await fireWith(headersRaw(`eno-consent-v2=${v2('000')}`))
    expect(sent).toEqual([])
  })

  it('sends NOTHING on the old middle tier — personalization is first-party, ads are not', async () => {
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
      userData: metaUserDataFromHeaders(headersRaw(`eno-consent-v2=${v2('001')}`), { email: 'buyer@example.com', phone: '+84901234567' }),
    })
    const wire = JSON.stringify(sent[0].body)
    expect(wire).not.toContain('buyer@example.com')
    expect(wire).not.toContain('901234567')
  })
})
