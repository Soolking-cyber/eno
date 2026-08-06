import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── The VND→USD quote ──────────────────────────────────────────────────────────────
//
// The property this suite exists to keep: THE DOLLARS ARE NEVER GUESSED. Every test below
// is either "the rate is wrong / missing / upside down, so there is no quote" or "the rate
// is good, so the cents are exactly these cents". There is no case in which this module is
// allowed to produce a plausible-looking number from a rate it does not have.
//
// ⚠️ THE INVERSION TESTS ARE THE POINT. The upstream publishes "currency per 1 VND", so
// rates.USD ≈ 0.0000383 and the module must take its reciprocal. Feeding it a rate that is
// already the right way up (26 100) must NOT produce a quote 680 million times too small,
// and a feed that flips must not produce one 26 000 times too large.

import {
  isQuoteChargeable,
  parseVisaQuote,
  quoteVisaUsd,
  visaQuoteDrifted,
  VISA_QUOTE_DRIFT_TOLERANCE_CENTS,
  type VisaQuote,
} from './fx'

/** Today's real shape: dollars per đồng. 1 / 0.0000383 ≈ 26 109. */
const USD_PER_VND = 0.0000383
const VND_PER_USD = 1 / USD_PER_VND

type FxBody = { result?: string; rates?: Record<string, unknown> } | null

const h = vi.hoisted(() => ({
  state: {
    /** What the rate feed answers. */
    body: null as FxBody,
    status: 200,
    /** Set to throw instead of answering (DNS failure, timeout, offline). */
    failure: null as unknown,
    // Every fetch call, so the caching contract can be asserted. `RequestInit` already
    // carries Next's `next` field (next-env.d.ts augments it globally) — intersecting a
    // narrower shape on top of it collides with `revalidate?: number | false`.
    calls: [] as Array<{ url: string; init: RequestInit }>,
    /** Body that is not JSON at all. */
    unparseable: false,
  },
}))

let errors: string[]

beforeEach(() => {
  h.state.body = { result: 'success', rates: { USD: USD_PER_VND, EUR: 0.0000354 } }
  h.state.status = 200
  h.state.failure = null
  h.state.calls = []
  h.state.unparseable = false
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')) })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (h.state.failure) throw h.state.failure
    h.state.calls.push({ url: String(url), init })
    return {
      ok: h.state.status >= 200 && h.state.status < 300,
      status: h.state.status,
      json: async () => {
        if (h.state.unparseable) throw new SyntaxError('Unexpected token < in JSON')
        return h.state.body
      },
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** A rate feed answering a chosen ĐỒNG-per-dollar rate, expressed the way the upstream does. */
function feedRate(vndPerUsd: number) {
  h.state.body = { result: 'success', rates: { USD: 1 / vndPerUsd } }
}

describe('the rate comes from the same upstream /api/fx uses, cached the same way', () => {
  it('fetches open.er-api.com directly with a 6h data cache — never its own endpoint', async () => {
    await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 })
    expect(h.state.calls).toHaveLength(1)
    const [{ url, init }] = h.state.calls
    expect(url).toBe('https://open.er-api.com/v6/latest/VND')
    // The same idiom as src/app/api/fx/route.ts — one cached upstream response feeds both
    // the display path and the charge path, so the two cannot disagree.
    expect(init.next?.revalidate).toBe(21_600)
    // Bounded, so a hanging feed cannot hold a buyer on a spinner forever.
    expect(init.signal).toBeInstanceOf(AbortSignal)
    // Never a self-call: that would be an extra hop and an extra stale-CDN failure mode.
    expect(url).not.toContain('/api/fx')
  })
})

describe('the quote', () => {
  it('converts the admin\'s đồng into the cents that will be charged', async () => {
    const quote = await quoteVisaUsd({ listingId: 'listing-1', priceVnd: 3_000_000 })
    expect(quote).not.toBeNull()
    expect(quote!.listingId).toBe('listing-1')
    // The admin's number, untouched.
    expect(quote!.priceVnd).toBe(3_000_000)
    // ⚠️ DIRECTION: đồng per dollar, in the tens of thousands — not 0.0000383.
    expect(quote!.vndPerUsd).toBeCloseTo(26_109.66, 1)
    // 3 000 000 × 100 / 26 109.66 = 11 490.0 → $114.90
    expect(quote!.serviceUsdCents).toBe(11_490)
    expect(Number.isInteger(quote!.serviceUsdCents)).toBe(true)
  })

  it('is stamped with the instant it was issued and an expiry a quarter of an hour out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-22T09:00:00.000Z'))
    const quote = (await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 }))!
    expect(quote.quotedAt).toBe('2026-07-22T09:00:00.000Z')
    expect(quote.expiresAt).toBe('2026-07-22T09:15:00.000Z')
  })

  it('follows the đồng price, because there is no second copy of it', async () => {
    feedRate(25_000)
    expect((await quoteVisaUsd({ listingId: 'a', priceVnd: 2_500_000 }))!.serviceUsdCents).toBe(10_000)
    // The admin re-prices in the dashboard; the next quote is the new price.
    expect((await quoteVisaUsd({ listingId: 'a', priceVnd: 3_750_000 }))!.serviceUsdCents).toBe(15_000)
  })
})

describe('rate inversion is caught — the 20 000× money bug', () => {
  it('refuses a feed that publishes ĐỒNG per dollar where dollars per đồng belong', async () => {
    // A feed (or a future refactor) that hands over 26 109 as `rates.USD`. Taking its
    // reciprocal gives 0.0000383 đồng per dollar, i.e. a $78 000 000 000 charge for a
    // 3 000 000 ₫ service. It must never become a quote.
    h.state.body = { result: 'success', rates: { USD: VND_PER_USD } }
    expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 })).toBeNull()
    expect(errors.some((e) => e.includes('implausible VND/USD rate'))).toBe(true)
  })

  it('refuses a feed whose base silently became USD (rates.USD === 1)', async () => {
    h.state.body = { result: 'success', rates: { USD: 1 } }
    expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 })).toBeNull()
  })

  it('refuses a rate quoted in thousands, and one quoted in millions', async () => {
    for (const usdPerVnd of [1 / 26.1, 1 / 26_100_000]) {
      h.state.body = { result: 'success', rates: { USD: usdPerVnd } }
      expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 }), String(usdPerVnd)).toBeNull()
    }
  })

  it('accepts the whole plausible band and nothing outside it', async () => {
    // Vietnam has been in the tens of thousands since the 1990s; the band is ~5× either
    // side of today, so a decade of drift is fine and a unit error never is.
    for (const rate of [5_000, 11_000, 26_109, 40_000, 100_000]) {
      feedRate(rate)
      expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 }), String(rate)).not.toBeNull()
    }
    for (const rate of [4_999.9, 1_000, 26.1, 100_000.1, 1_000_000]) {
      feedRate(rate)
      expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 }), String(rate)).toBeNull()
    }
  })
})

describe('an FX outage yields null — never a guessed rate', () => {
  it('refuses when the feed throws, 500s, is unparseable, or reports failure', async () => {
    const outages: Array<[string, () => void]> = [
      ['network failure', () => { h.state.failure = new Error('ENOTFOUND') }],
      ['timeout', () => { h.state.failure = new DOMException('The operation was aborted.', 'TimeoutError') }],
      ['500', () => { h.state.status = 500 }],
      ['503', () => { h.state.status = 503 }],
      ['html error page', () => { h.state.unparseable = true }],
      ['null body', () => { h.state.body = null }],
      ['result: error', () => { h.state.body = { result: 'error', rates: { USD: USD_PER_VND } } }],
      ['no rates', () => { h.state.body = { result: 'success' } }],
      ['no USD rate', () => { h.state.body = { result: 'success', rates: { EUR: 0.0000354 } } }],
      ['USD rate as a string', () => { h.state.body = { result: 'success', rates: { USD: '0.0000383' } } }],
      ['USD rate NaN', () => { h.state.body = { result: 'success', rates: { USD: Number.NaN } } }],
      ['USD rate zero', () => { h.state.body = { result: 'success', rates: { USD: 0 } } }],
      ['USD rate negative', () => { h.state.body = { result: 'success', rates: { USD: -USD_PER_VND } } }],
      ['USD rate Infinity', () => { h.state.body = { result: 'success', rates: { USD: Number.POSITIVE_INFINITY } } }],
    ]
    for (const [name, arrange] of outages) {
      h.state.failure = null
      h.state.status = 200
      h.state.unparseable = false
      h.state.body = { result: 'success', rates: { USD: USD_PER_VND } }
      arrange()
      expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 3_000_000 }), name).toBeNull()
    }
  })

  it('never substitutes a hard-coded rate — no rate-shaped literal exists in the module', async () => {
    // A fallback rate is the one change that would make every test above pass while
    // mis-charging in production (`?? 26_100` in the catch, and the outage tests stay
    // green). So it is asserted against the SOURCE: no executable literal may sit in the
    // plausible-rate band except the two that DEFINE that band.
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./fx.ts', import.meta.url), 'utf8'))
    // Comment prose is exempt — the file explains the 26 000 magnitude at length, and the
    // rule is about executable constants, not about being unable to mention a number.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const inBand = [...code.matchAll(/\b\d[\d_]*(?:\.\d+)?\b/g)]
      .map((m) => Number(m[0].replace(/_/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 5_000 && n <= 100_000)
      .sort((a, b) => a - b)
    // Exactly four, every one of them named and none of them money:
    //   5 000 / 100 000 — the plausibility band itself
    //   8 000           — FX_TIMEOUT_MS (milliseconds)
    //   21 600          — FX_REVALIDATE_SECONDS (the 6h data cache, seconds)
    // A fifth entry here means somebody wrote a number that could be a rate. Look at it.
    expect(inBand).toEqual([5_000, 8_000, 21_600, 100_000])
    expect(code).toContain('MIN_VND_PER_USD = 5_000')
    expect(code).toContain('MAX_VND_PER_USD = 100_000')
  })
})

describe('a price that cannot be quoted', () => {
  it('refuses non-positive, fractional, absurd and non-numeric đồng', async () => {
    for (const priceVnd of [
      0, -1, -3_000_000, 0.5, 3_000_000.5, Number.NaN,
      Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      2_000_000_001, Number.MAX_SAFE_INTEGER,
      '3000000' as unknown as number, null as unknown as number, undefined as unknown as number,
    ]) {
      expect(await quoteVisaUsd({ listingId: 'a', priceVnd }), String(priceVnd)).toBeNull()
    }
    // The ceiling itself is fine — it is a ceiling, not a wall one đồng lower.
    expect(await quoteVisaUsd({ listingId: 'a', priceVnd: 2_000_000_000 })).not.toBeNull()
  })

  it('refuses a missing listing id', async () => {
    for (const listingId of ['', '   ', null as unknown as string, undefined as unknown as string, 5 as unknown as string]) {
      expect(await quoteVisaUsd({ listingId, priceVnd: 3_000_000 }), String(listingId)).toBeNull()
    }
  })

  it('does not even ask for a rate when the price is unusable', async () => {
    await quoteVisaUsd({ listingId: 'a', priceVnd: 0 })
    expect(h.state.calls).toHaveLength(0)
  })
})

describe('rounding — up, by one cent at most, and never a fraction of one', () => {
  it('rounds UP so the capture always covers the đồng price', async () => {
    feedRate(25_000)
    // 1 000 001 ₫ / 25 000 = $40.00004 → 4001 cents, never 4000: the dollars must not come
    // out below the number the admin priced.
    const quote = (await quoteVisaUsd({ listingId: 'a', priceVnd: 1_000_001 }))!
    expect(quote.serviceUsdCents).toBe(4_001)
    // The invariant, stated as arithmetic: the charge covers the price.
    expect((quote.serviceUsdCents / 100) * quote.vndPerUsd).toBeGreaterThanOrEqual(quote.priceVnd)
    // …and overshoots by less than a cent's worth of đồng.
    expect((quote.serviceUsdCents / 100) * quote.vndPerUsd - quote.priceVnd).toBeLessThan(quote.vndPerUsd / 100)
  })

  it('does not invent a cent when the conversion lands exactly on one', async () => {
    feedRate(25_000)
    // Exact boundaries: ceil() on a true integer must stay put. These are the values where
    // a float artefact of 1e-12 would have bumped the charge a cent.
    for (const [priceVnd, cents] of [[25_000, 100], [250_000, 1_000], [2_500_000, 10_000], [1_000_000, 4_000]] as const) {
      expect((await quoteVisaUsd({ listingId: 'a', priceVnd }))!.serviceUsdCents, String(priceVnd)).toBe(cents)
    }
  })

  it('is exact at the boundaries of a rate that is not representable in binary', async () => {
    // 0.00004 is not exact in a double, so 1 / 0.00004 is 25 000 ± an ulp. The snap has to
    // absorb that from EITHER side — a rate a hair low would push ceil() up a whole cent.
    h.state.body = { result: 'success', rates: { USD: 0.00004 } }
    expect((await quoteVisaUsd({ listingId: 'a', priceVnd: 2_500_000 }))!.serviceUsdCents).toBe(10_000)
    h.state.body = { result: 'success', rates: { USD: 0.0000390625 } } // exactly 25 600
    expect((await quoteVisaUsd({ listingId: 'a', priceVnd: 2_560_000 }))!.serviceUsdCents).toBe(10_000)
  })

  it('always produces a safe positive integer, across the whole plausible surface', async () => {
    for (const rate of [5_000, 17_777, 26_109.66, 99_999]) {
      feedRate(rate)
      for (const priceVnd of [1, 999, 1_000_000, 3_333_333, 123_456_789, 2_000_000_000]) {
        const quote = await quoteVisaUsd({ listingId: 'a', priceVnd })
        // Sub-cent prices (1 ₫) still quote — ceil takes them to one cent, the smallest
        // thing a card can be charged, and displayed and captured still agree.
        expect(quote, `${rate}/${priceVnd}`).not.toBeNull()
        expect(Number.isSafeInteger(quote!.serviceUsdCents), `${rate}/${priceVnd}`).toBe(true)
        expect(quote!.serviceUsdCents).toBeGreaterThan(0)
      }
    }
  })
})

describe('isQuoteChargeable', () => {
  const at = (iso: string) => new Date(iso)
  const live = (over: Partial<VisaQuote> = {}): VisaQuote => ({
    listingId: 'listing-1',
    priceVnd: 2_500_000,
    // 2 500 000 đ ÷ 25 000 = $100.00 service; grossed up for a 4.4% + 30¢ processor cut
    // ⇒ (10000 + 30) / 0.956 = 10 491.6 → 10 492 charged, of which 492 is the surcharge.
    serviceUsdCents: 10_000,
    processingUsdCents: 492,
    amountUsdCents: 10_492,
    feePercent: 4.4,
    feeFixedCents: 30,
    vndPerUsd: 25_000,
    quotedAt: '2026-07-22T09:00:00.000Z',
    expiresAt: '2026-07-22T09:15:00.000Z',
    ...over,
  })

  it('accepts a live, self-consistent quote', () => {
    expect(isQuoteChargeable(live(), at('2026-07-22T09:00:00.000Z'))).toBe(true)
    expect(isQuoteChargeable(live(), at('2026-07-22T09:14:59.999Z'))).toBe(true)
  })

  it('expires — at the instant, not a moment later', () => {
    expect(isQuoteChargeable(live(), at('2026-07-22T09:15:00.000Z'))).toBe(false)
    expect(isQuoteChargeable(live(), at('2026-07-22T09:15:00.001Z'))).toBe(false)
    expect(isQuoteChargeable(live(), at('2026-07-23T09:00:00.000Z'))).toBe(false)
  })

  it('refuses a quote that claims a longer life than the server ever issues', () => {
    // The forgery that would otherwise matter most: a real quote with the expiry moved out.
    expect(isQuoteChargeable(live({ expiresAt: '2027-07-22T09:00:00.000Z' }), at('2026-07-22T09:01:00.000Z'))).toBe(false)
    // …and one that expires before it was issued.
    expect(isQuoteChargeable(live({ expiresAt: '2026-07-22T08:59:00.000Z' }), at('2026-07-22T08:59:30.000Z'))).toBe(false)
    expect(isQuoteChargeable(live({ expiresAt: '2026-07-22T09:00:00.000Z' }), at('2026-07-22T08:59:59.000Z'))).toBe(false)
  })

  it('refuses a quote whose three money fields do not agree with each other', () => {
    // Same price, same rate, a cheaper amount — the naive tamper.
    expect(isQuoteChargeable(live({ amountUsdCents: 1 }), at('2026-07-22T09:00:00.000Z'))).toBe(false)
    expect(isQuoteChargeable(live({ amountUsdCents: 9_999 }), at('2026-07-22T09:00:00.000Z'))).toBe(false)
    expect(isQuoteChargeable(live({ amountUsdCents: 10_001 }), at('2026-07-22T09:00:00.000Z'))).toBe(false)
    // A price edited without re-deriving the amount.
    expect(isQuoteChargeable(live({ priceVnd: 5_000_000 }), at('2026-07-22T09:00:00.000Z'))).toBe(false)
  })

  it('refuses an out-of-band rate even when the arithmetic closes', () => {
    // Internally consistent, but at a rate no feed would ever publish.
    expect(isQuoteChargeable(
      { ...live(), vndPerUsd: 2_500_000, amountUsdCents: 100 },
      at('2026-07-22T09:00:00.000Z'),
    )).toBe(false)
    // The inverted rate, with an amount that matches it.
    expect(isQuoteChargeable(
      { ...live(), vndPerUsd: 1 / 25_000, amountUsdCents: 6_250_000_000 },
      at('2026-07-22T09:00:00.000Z'),
    )).toBe(false)
  })

  it('refuses garbage of every shape', () => {
    const now = at('2026-07-22T09:00:00.000Z')
    for (const bad of [null, undefined, 0, '', 'quote', [], { }]) {
      expect(isQuoteChargeable(bad as unknown as VisaQuote, now), String(bad)).toBe(false)
    }
    expect(isQuoteChargeable(live({ listingId: '' }), now)).toBe(false)
    expect(isQuoteChargeable(live({ listingId: '   ' }), now)).toBe(false)
    expect(isQuoteChargeable(live({ quotedAt: 'yesterday' }), now)).toBe(false)
    expect(isQuoteChargeable(live({ expiresAt: 'soon' }), now)).toBe(false)
    expect(isQuoteChargeable(live({ priceVnd: 2_500_000.5 }), now)).toBe(false)
    expect(isQuoteChargeable(live({ amountUsdCents: 100.5 }), now)).toBe(false)
    expect(isQuoteChargeable(live(), new Date('nope'))).toBe(false)
    expect(isQuoteChargeable(live(), '2026-07-22T09:00:00.000Z' as unknown as Date)).toBe(false)
  })

  it('accepts every quote quoteVisaUsd issues, at the instant it issues it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-22T09:00:00.000Z'))
    for (const rate of [5_000, 26_109.66, 100_000]) {
      feedRate(rate)
      for (const priceVnd of [1, 3_000_000, 2_000_000_000]) {
        const quote = (await quoteVisaUsd({ listingId: 'a', priceVnd }))!
        expect(isQuoteChargeable(quote, new Date()), `${rate}/${priceVnd}`).toBe(true)
      }
    }
  })
})

describe('parseVisaQuote — the hostile-input door', () => {
  const wire = {
    listingId: 'listing-1',
    priceVnd: 2_500_000,
    // 2 500 000 đ ÷ 25 000 = $100.00 service; grossed up for a 4.4% + 30¢ processor cut
    // ⇒ (10000 + 30) / 0.956 = 10 491.6 → 10 492 charged, of which 492 is the surcharge.
    serviceUsdCents: 10_000,
    processingUsdCents: 492,
    amountUsdCents: 10_492,
    feePercent: 4.4,
    feeFixedCents: 30,
    vndPerUsd: 25_000,
    quotedAt: '2026-07-22T09:00:00.000Z',
    expiresAt: '2026-07-22T09:15:00.000Z',
  }

  it('accepts a well-shaped quote and keeps exactly its six fields', () => {
    const parsed = parseVisaQuote({ ...wire, extra: 'ignored' })
    expect(parsed).toEqual(wire)
  })

  it('refuses anything that is not a quote object', () => {
    for (const bad of [null, undefined, 0, 1, '', 'quote', [wire], true, () => wire]) {
      expect(parseVisaQuote(bad), String(bad)).toBeNull()
    }
  })

  it('refuses a quote with a field of the wrong type', () => {
    for (const key of Object.keys(wire) as Array<keyof typeof wire>) {
      expect(parseVisaQuote({ ...wire, [key]: null }), key).toBeNull()
      expect(parseVisaQuote({ ...wire, [key]: undefined }), key).toBeNull()
    }
    expect(parseVisaQuote({ ...wire, priceVnd: '2500000' })).toBeNull()
    expect(parseVisaQuote({ ...wire, amountUsdCents: '10000' })).toBeNull()
    expect(parseVisaQuote({ ...wire, quotedAt: 1_753_174_800_000 })).toBeNull()
    expect(parseVisaQuote({ ...wire, listingId: '  ' })).toBeNull()
  })

  it('is SHAPE only — liveness is isQuoteChargeable\'s job, and the split is deliberate', () => {
    // A structurally perfect but long-expired quote parses (so the UI can be told "stale")
    // and is then refused as unchargeable (so it can never be charged).
    const stale = parseVisaQuote({ ...wire, quotedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-01T00:15:00.000Z' })
    expect(stale).not.toBeNull()
    expect(isQuoteChargeable(stale!, new Date('2026-07-22T09:00:00.000Z'))).toBe(false)
  })
})

describe('visaQuoteDrifted — "the price updated, confirm again"', () => {
  const q = (over: Partial<VisaQuote> = {}): VisaQuote => ({
    listingId: 'listing-1',
    priceVnd: 2_500_000,
    // 2 500 000 đ ÷ 25 000 = $100.00 service; grossed up for a 4.4% + 30¢ processor cut
    // ⇒ (10000 + 30) / 0.956 = 10 491.6 → 10 492 charged, of which 492 is the surcharge.
    serviceUsdCents: 10_000,
    processingUsdCents: 492,
    amountUsdCents: 10_492,
    feePercent: 4.4,
    feeFixedCents: 30,
    vndPerUsd: 25_000,
    quotedAt: '2026-07-22T09:00:00.000Z',
    expiresAt: '2026-07-22T09:15:00.000Z',
    ...over,
  })

  it('tolerates exactly one cent of movement and no more', () => {
    expect(VISA_QUOTE_DRIFT_TOLERANCE_CENTS).toBe(1)
    expect(visaQuoteDrifted(q(), q())).toBe(false)
    expect(visaQuoteDrifted(q({ amountUsdCents: 10_491 }), q())).toBe(false)
    expect(visaQuoteDrifted(q({ amountUsdCents: 10_493 }), q())).toBe(false)
    expect(visaQuoteDrifted(q({ amountUsdCents: 10_490 }), q())).toBe(true)
    expect(visaQuoteDrifted(q({ amountUsdCents: 10_494 }), q())).toBe(true)
  })

  it('catches an admin re-pricing the listing even when the dollars happen to match', () => {
    // A đồng price edit and an FX move that cancel out. The buyer is still owed the new
    // number — they are about to pay for a listing that is not the one they were shown.
    const shown = q({ priceVnd: 2_500_000, vndPerUsd: 25_000, amountUsdCents: 10_492 })
    const fresh = q({ priceVnd: 2_600_000, vndPerUsd: 26_000, amountUsdCents: 10_492 })
    expect(visaQuoteDrifted(shown, fresh)).toBe(true)
  })

  it('catches a quote for a different product', () => {
    expect(visaQuoteDrifted(q({ listingId: 'other' }), q())).toBe(true)
  })

  it('catches a real rate refresh, which is the whole reason it exists', () => {
    // 25 000 → 26 100 on a 2 500 000 ₫ product: $100.00 becomes $95.79.
    const shown = q()
    const fresh = q({ vndPerUsd: 26_100, amountUsdCents: 9_579 })
    expect(visaQuoteDrifted(shown, fresh)).toBe(true)
  })
})
