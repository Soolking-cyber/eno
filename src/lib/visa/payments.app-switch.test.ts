import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── PAYPAL APP SWITCH: the buyer_user_agent that decides whether the PayPal APP can open ──
//
// Measured 2026-08-20 against PayPal's live apple-app-site-association: 24 apps, 264 explicit
// paths, no wildcard, and `/checkoutnow` — the URL Orders v2 returns by default — is NOT among
// them, so iOS cannot intercept it and the app never opens. `/app-switch-checkout` IS among them,
// and supplying the buyer's user agent is what makes PayPal return that link instead.
//
// What this suite pins is the part we control: EXACTLY when `app_switch_context` is put on the
// wire. Two rules, both of which cost real money if they regress:
//   · a UA PayPal would reject (>512, control chars) must OMIT the block, never a repaired
//     version — the spec says "Merchants must not alter or modify the buyer's device user agent",
//     and a rejected field 400s the whole order so the buyer cannot pay AT ALL;
//   · a desktop UA must leave the request byte-identical to what shipped before app switch.

const ORDER_URL = 'https://api-m.sandbox.paypal.com/v2/checkout/orders'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let bodies: Array<Record<string, any>>

/** The order body PayPal was actually sent, or null if no order was posted. */
function orderBody(): Record<string, any> | null {
  return bodies.length ? bodies[bodies.length - 1] : null
}
function experienceContext(): Record<string, any> {
  return orderBody()?.payment_source?.paypal?.experience_context ?? {}
}

async function createWith(ua: string | null | undefined) {
  const { paypalCreateOrder } = await import('./payments')
  return paypalCreateOrder({
    applicationId: '33333333-3333-4333-8333-333333333333',
    listingId: 'listing_1',
    productTitle: 'e-Visa · single entry',
    amountCents: 11489,
    currency: 'USD',
    quote: { priceVnd: 3_000_000, vndPerUsd: 26_112, quotedAt: '2026-08-20T04:00:00.000Z' },
    buyerUserAgent: ua,
  })
}

beforeEach(() => {
  vi.resetModules()
  bodies = []
  // stubEnv, not assignment: a bare write leaks sandbox creds into every later test in the worker.
  vi.stubEnv('PAYPAL_ENV', 'sandbox')
  vi.stubEnv('PAYPAL_CLIENT_ID', 'test-client-id')
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'test-secret')
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 32000 }), { status: 200 })
    }
    if (u === ORDER_URL) {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({
        id: 'ORDER1',
        links: [{ rel: 'payer-action', href: 'https://www.paypal.com/app-switch-checkout?token=ORDER1' }],
      }), { status: 201 })
    }
    throw new Error(`unexpected fetch: ${u}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('paypalCreateOrder — app switch', () => {
  it('sends buyer_user_agent UNCHANGED for an iPhone', async () => {
    await createWith(IPHONE)
    expect(experienceContext().app_switch_context).toEqual({ mobile_web: { buyer_user_agent: IPHONE } })
  })

  it('sends it for Android too', async () => {
    await createWith(ANDROID)
    expect(experienceContext().app_switch_context?.mobile_web?.buyer_user_agent).toBe(ANDROID)
  })

  it('OMITS the block for a desktop UA, leaving the request as it shipped before', async () => {
    await createWith(DESKTOP)
    expect(experienceContext()).not.toHaveProperty('app_switch_context')
    // and the fields that were always there are untouched
    expect(experienceContext().user_action).toBe('PAY_NOW')
    expect(experienceContext().shipping_preference).toBe('NO_SHIPPING')
  })

  it('OMITS the block when there is no user-agent header at all', async () => {
    await createWith(null)
    expect(experienceContext()).not.toHaveProperty('app_switch_context')
  })

  it('OMITS rather than truncates a UA over the 512-char maximum', async () => {
    const oversized = IPHONE + ' ' + 'x'.repeat(600)
    expect(oversized.length).toBeGreaterThan(512)
    await createWith(oversized)
    expect(experienceContext()).not.toHaveProperty('app_switch_context')
  })

  it('OMITS rather than strips a UA containing a newline — the pattern ^.*$ would reject it', async () => {
    await createWith(`${IPHONE}\nX-Injected: 1`)
    const ec = experienceContext()
    expect(ec).not.toHaveProperty('app_switch_context')
    // the whole point: nothing sanitized was sent in its place
    expect(JSON.stringify(ec)).not.toContain('X-Injected')
  })

  // NOT a claim about what PayPal returns — the mock decides that. What it pins is OUR link
  // preference: `payer-action` is the rel an app-switch link arrives under, and it must win.
  it('prefers the payer-action rel over approve', async () => {
    const res = await createWith(IPHONE)
    expect(res.url).toBe('https://www.paypal.com/app-switch-checkout?token=ORDER1')
    expect(res.ref).toBe('ORDER1')
  })

  it('C1 control characters are rejected too, not just C0', async () => {
    await createWith(`${IPHONE}\u0085`)
    expect(experienceContext()).not.toHaveProperty('app_switch_context')
  })

  // ⛔ The outage guard. If PayPal rejects the block, mobile must fall back to the checkout that
  // shipped before app switch — not fail. Desktop would stay green, so nothing would surface it.
  it('RETRIES WITHOUT app_switch_context when PayPal rejects the block, and still returns a link', async () => {
    let seen = 0
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      const u = String(url)
      if (u.includes('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 32000 }), { status: 200 })
      const body = JSON.parse(init.body)
      bodies.push(body)
      seen++
      // First attempt carries the block and is refused, exactly as an un-enabled merchant would be.
      if (body.payment_source.paypal.experience_context.app_switch_context) {
        return new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY' }), { status: 422 })
      }
      return new Response(JSON.stringify({ id: 'ORDER2', links: [{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=ORDER2' }] }), { status: 201 })
    }))
    const res = await createWith(IPHONE)
    expect(seen).toBe(2)                       // it tried twice
    expect(res.ref).toBe('ORDER2')             // and the buyer still got a payable link
    expect(bodies[1].payment_source.paypal.experience_context).not.toHaveProperty('app_switch_context')
  })

  it('does NOT retry when there was no app_switch_context to blame', async () => {
    let seen = 0
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 32000 }), { status: 200 })
      seen++
      return new Response(JSON.stringify({ name: 'INSTRUMENT_DECLINED' }), { status: 422 })
    }))
    await expect(createWith(DESKTOP)).rejects.toThrow()
    expect(seen).toBe(1)
  })

  it('a mobile UA at exactly 512 chars is still sent — the bound is inclusive', async () => {
    const exact = (IPHONE + ' ' + 'x'.repeat(512)).slice(0, 512)
    expect(exact.length).toBe(512)
    await createWith(exact)
    expect(experienceContext().app_switch_context?.mobile_web?.buyer_user_agent).toBe(exact)
  })
})
