import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// The server-side TikTok sender (2026-10-12). What these hold: it is silent until configured, it FAILS CLOSED on an
// Advertising answer given to words that named TikTok (never an earlier "yes"), it sends TikTok's Events API 2.0 shape
// with hashed identifiers, an Apple-shared email never leaves, and a 200 whose `code` is not 0 is a failure. It also
// refuses unless the caller attests the consent RECORD names TikTok (recordNamesTikTok).
vi.mock('server-only', () => ({}))

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
type Sent = { url: string; headers: Record<string, string>; body: Record<string, any> }

async function load(env: Record<string, string> = { TIKTOK_PIXEL_ID: 'PIX1', TIKTOK_EVENTS_TOKEN: 'tok-1' }) {
  vi.resetModules()
  for (const k of ['TIKTOK_PIXEL_ID', 'TIKTOK_EVENTS_TOKEN', 'TIKTOK_TEST_EVENT_CODE']) vi.stubEnv(k, env[k] ?? '')
  return import('./tiktok-events')
}

let sent: Sent[]
let answer: { status: number; body: string }
let logged: unknown[][]
beforeEach(() => {
  sent = []; logged = []
  answer = { status: 200, body: JSON.stringify({ code: 0, message: 'OK' }) }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return new Response(answer.body, { status: answer.status })
  }))
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a) })
  // A fixed day after the card named TikTok: the consent answers below are never "expired", whenever this runs.
  vi.useFakeTimers({ now: new Date('2026-10-14T03:00:00Z'), toFake: ['Date'] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** A consent v2 cookie: bits = personalization · analytics · advertising; `ts` in unix SECONDS. */
const cookie = (bits: string, ts: number) => `eno-consent-v2=v2.${bits}.${ts}.c0ffee00-1234-4abc-8def-001122334455`
const headersWith = (c: string, extra: Record<string, string> = {}) => new Headers({ cookie: c, 'user-agent': 'UA/1', 'x-forwarded-for': '203.0.113.9', ...extra })

describe('who may be reported to TikTok (tiktokConsent)', () => {
  it('⛔ only an Advertising answer given AT OR AFTER the day the card named TikTok — in seconds, the cookie’s unit', async () => {
    const t = await load()
    const from = t.TIKTOK_NAMED_FROM_S
    const now = (from + 3600) * 1000
    expect(from).toBe(Date.UTC(2026, 9, 12, 17, 0, 0) / 1000) // 2026-10-13 00:00 in Vietnam
    expect(String(from)).toHaveLength(10) // seconds: a millisecond value here would never be reached by any cookie
    expect(t.tiktokConsent(headersWith(cookie('001', from)), now)).toBe(true)
    expect(t.tiktokConsent(headersWith(cookie('111', from + 60)), now)).toBe(true)
    // A "yes" given one second earlier was given to "Meta, Google" — not to TikTok.
    expect(t.tiktokConsent(headersWith(cookie('001', from - 1)), now)).toBe(false)
    expect(t.tiktokConsent(headersWith(cookie('111', from - 86400 * 10)), now)).toBe(false)
  })
  it('never without Advertising, never with no or a legacy answer, never inside the app', async () => {
    const t = await load()
    const from = t.TIKTOK_NAMED_FROM_S
    const now = (from + 3600) * 1000
    expect(t.tiktokConsent(headersWith(cookie('110', from + 60)), now)).toBe(false)
    expect(t.tiktokConsent(new Headers(), now)).toBe(false)
    expect(t.tiktokConsent(headersWith('eno-consent=all; eno-cookie-consent=all'), now)).toBe(false)
    expect(t.tiktokConsent(headersWith(cookie('001', from + 60), { 'user-agent': 'EnoNativeApp/1.0' }), now)).toBe(false)
  })
})

describe('sendTikTokEvent', () => {
  const user = async (t: Awaited<ReturnType<typeof load>>, extra: Record<string, unknown> = {}, c?: string) =>
    t.tiktokUserFromHeaders(headersWith(c ?? cookie('001', t.TIKTOK_NAMED_FROM_S + 60)), extra as never)

  it('sends TikTok’s Events API 2.0 shape: the pixel, the event, hashed identifiers, the page', async () => {
    const t = await load()
    await t.sendTikTokEvent('CompleteRegistration', {
      recordNamesTikTok: true,
      eventId: 'evt-1',
      pageUrl: 'https://eno.vn/teachers/join',
      user: await user(t, { email: ' Teacher@Example.com ', appleLinked: false, phone: '+84 901 234 567', externalId: 'p-1' }),
      properties: { content_type: 'product', contents: [{ content_id: 'L1' }] },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/')
    expect(sent[0].headers['access-token']).toBe('tok-1')
    expect(sent[0].body).toEqual({
      event_source: 'web',
      event_source_id: 'PIX1',
      data: [{
        event: 'CompleteRegistration',
        event_time: Math.floor(Date.UTC(2026, 9, 14, 3, 0, 0) / 1000),
        event_id: 'evt-1',
        user: {
          email: sha('teacher@example.com'),
          phone: sha('+84901234567'),
          external_id: sha('p-1'),
          ip: '203.0.113.9',
          user_agent: 'UA/1',
        },
        page: { url: 'https://eno.vn/teachers/join' },
        properties: { content_type: 'product', contents: [{ content_id: 'L1' }] },
      }],
    })
    // The token travels in the header, never in the address or the body.
    expect(JSON.stringify(sent[0].body) + sent[0].url).not.toContain('tok-1')
    expect(logged).toHaveLength(0)
  })

  it('the phone is hashed in E.164 with its plus sign — a local 09… number becomes +849…, the form TikTok matches', async () => {
    const t = await load()
    for (const phone of ['0901 234 567', '84901234567', '+84 901-234-567']) {
      sent = []
      await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t, { phone }) })
      expect(sent[0].body.data[0].user.phone).toBe(sha('+84901234567'))
    }
  })
  it('⛔ FAILS CLOSED: no consent, an answer from before TikTok was named, or a user not built from the request — nothing leaves', async () => {
    const t = await load()
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t, {}, cookie('001', t.TIKTOK_NAMED_FROM_S - 1)) })
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t, {}, cookie('110', t.TIKTOK_NAMED_FROM_S + 60)) })
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: { email: 'a@b.co', appleLinked: false } })
    expect(sent).toHaveLength(0)
  })
  it('⛔ …and REFUSES without the caller’s word that the consent record names TikTok — the date floor alone is never enough', async () => {
    const t = await load()
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: false, user: await user(t) })
    await t.sendTikTokEvent('CompleteRegistration', { user: await user(t) } as never) // a call site that forgot it
    await t.sendTikTokEvent('CompleteRegistration', undefined as never)
    expect(sent).toHaveLength(0)
  })

  it('a silent no-op until BOTH the pixel and the token are set', async () => {
    const partial: Record<string, string>[] = [{}, { TIKTOK_PIXEL_ID: 'PIX1' }, { TIKTOK_EVENTS_TOKEN: 'tok-1' }]
    for (const env of partial) {
      const t = await load(env)
      expect(t.tiktokEventsConfigured()).toBe(false)
      await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })
    }
    expect(sent).toHaveLength(0)
  })

  it('⛔ D14: an Apple-linked account, an unanswered one, or a relay address sends NO email — phone and id still go', async () => {
    const t = await load()
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t, { email: 'a@b.co', appleLinked: true, phone: '+84901234567', externalId: 'p-1' }) })
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: { ...(await user(t)), email: 'a@b.co' } }) // no answer at all
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t, { email: 'x@privaterelay.appleid.com', appleLinked: false }) })
    expect(sent).toHaveLength(3)
    for (const s of sent) expect(s.body.data[0].user.email).toBeUndefined()
    expect(sent[0].body.data[0].user).toMatchObject({ phone: sha('+84901234567'), external_id: sha('p-1') })
  })

  it('the test code routes events to the dataset’s Test events tab — and in production it says so, every time', async () => {
    const t = await load({ TIKTOK_PIXEL_ID: 'PIX1', TIKTOK_EVENTS_TOKEN: 'tok-1', TIKTOK_TEST_EVENT_CODE: 'TEST123' })
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })
    expect(sent[0].body.test_event_code).toBe('TEST123')
    expect(logged).toHaveLength(0) // not production: quiet
    vi.stubEnv('NODE_ENV', 'production')
    const p = await load({ TIKTOK_PIXEL_ID: 'PIX1', TIKTOK_EVENTS_TOKEN: 'tok-1', TIKTOK_TEST_EVENT_CODE: 'TEST123' })
    await p.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(p) })
    expect(JSON.stringify(logged)).toContain('TIKTOK_TEST_EVENT_CODE is set')
  })

  it('⚠️ a 200 whose `code` is not 0 is a FAILURE and is logged; so is a non-200 — and neither logs the token', async () => {
    const t = await load()
    answer = { status: 200, body: JSON.stringify({ code: 40105, message: 'Access token is incorrect or has been revoked.' }) }
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })
    answer = { status: 500, body: 'upstream' }
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })
    answer = { status: 200, body: 'not json' }
    await t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })
    expect(logged).toHaveLength(3)
    expect(JSON.stringify(logged)).not.toContain('tok-1')
  })

  it('never throws: a network failure is swallowed — and LOGGED, in production too (a box that cannot reach TikTok must not be silent)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const t = await load()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    await expect(t.sendTikTokEvent('CompleteRegistration', { recordNamesTikTok: true, user: await user(t) })).resolves.toBeUndefined()
    expect(logged).toHaveLength(1)
    expect(JSON.stringify(logged)).toContain('ECONNRESET')
    expect(JSON.stringify(logged)).not.toContain('tok-1')
  })
})
