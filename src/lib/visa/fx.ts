import 'server-only'

// ── The SERVER-ISSUED VND → USD quote ─────────────────────────────────────────────
//
// THE OWNER'S RULE (2026-07-22): "admin posts in vnd and you show in vnd and usd to
// users they checkout accordingly usd from their paypal but the vnd equivalent that
// admin set."
//
// Read literally, and it decides the whole design:
//   · Listing.price is ĐỒNG and it is AUTHORITATIVE. There is no USD listing currency —
//     a visa service is an ordinary marketplace listing priced like every other one.
//   · The buyer is shown BOTH numbers.
//   · The provider captures USD, and that USD must be the equivalent of the admin's VND.
//
// ⚠️ WHICH IS WHY THE CONVERSION CANNOT HAPPEN IN THE BROWSER. src/context/currency-context
// holds live rates client-side and refreshes them every 12h, so a card rendered from a
// half-day-old rate and a charge computed from a fresh one are the same listing at two
// different prices — and the second one is the one that leaves the buyer's card. So the
// SERVER issues ONE quote, the UI renders THAT quote, and the charge is THAT quote. The
// number a buyer agreed to is the number that is captured, or nothing happens at all.
//
// ⚠️ FAIL CLOSED, ALWAYS. No rate, an implausible rate, an unusable price → null, and
// null is not chargeable anywhere downstream. There is NO hard-coded fallback rate in
// this file and there must never be one: a stale FX feed makes the checkout unavailable
// for a few minutes, which is annoying; a guessed rate mis-charges a stranger's card,
// which is not recoverable. "Guess" includes "use last week's number", "use 25000", and
// "use whatever the client sent".
//
// Nothing here touches an application, a payload, or a document: it deals in a listing id
// and a price, both public marketplace facts. No PII crosses this module.

/**
 * A server-issued price quote. The UI renders THIS; checkout charges THIS.
 *
 * All five money/rate fields are recorded with the payment as dispute evidence (see the
 * checkout route): months later, "why was this card charged $114.89?" is answered by
 * priceVnd × the rate that was in force at quotedAt, from our own append-only log.
 */
export type VisaQuote = {
  listingId: string
  /** The admin's number, authoritative — whole đồng off Listing.price. */
  priceVnd: number
  /** The service itself, in cents: priceVnd converted at vndPerUsd. What the desk keeps. */
  serviceUsdCents: number
  /** The payment-processing surcharge, in cents. See grossUpForProcessing. */
  processingUsdCents: number
  /** Integer cents actually charged = serviceUsdCents + processingUsdCents. */
  amountUsdCents: number
  /** The rate used, recorded for evidence. ĐỒNG PER ONE DOLLAR (≈ 26 000). */
  vndPerUsd: number
  /**
   * ⚠️ THE FEE TERMS ARE RECORDED IN THE QUOTE, FOR THE SAME REASON `vndPerUsd` IS.
   * The first version re-read them from the environment at validation time, so correcting the rate
   * — which the comment below explicitly tells you to do once a real capture settles — instantly
   * made every outstanding quote unchargeable, and a rolling deploy made a quote chargeable on one
   * instance and refused on another. All three reviewers found it. A quote must carry its own
   * terms; validation re-derives from THESE, never from live config.
   */
  feePercent: number
  feeFixedCents: number
  /** ISO. */
  quotedAt: string
  /** ISO — beyond this the quote must be re-issued. */
  expiresAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────────

/**
 * The same upstream /api/fx uses, fetched DIRECTLY. The server must never call its own
 * HTTP endpoint for this: that is an extra hop, an extra failure mode, and (behind the
 * load balancer) an extra place for a stale CDN copy to answer a money question.
 */
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/VND'

/**
 * 6h data cache — the same idiom as src/app/api/fx/route.ts, deliberately byte-equal so
 * the rate the display path uses and the rate the charge path uses come from ONE cached
 * upstream response rather than two independent fetches that can disagree.
 *
 * ⚠️ The `signal` is a considered addition, not a copy-paste slip. Next's data cache keys
 * on the URL and the cache directives, and an AbortSignal is not one of them; the worst
 * case is one extra upstream call. The alternative — an unbounded fetch on the checkout
 * path — is a request that hangs until the platform kills it, holding a buyer on a spinner
 * with a provider session that was never opened. A bounded failure beats an unbounded wait.
 */
const FX_REVALIDATE_SECONDS = 21_600
const FX_TIMEOUT_MS = 8_000

/**
 * THE PLAUSIBILITY BAND, and the reason it exists: `rates` from this upstream are
 * "currency per 1 VND", so rates.USD ≈ 0.0000383 and vndPerUsd = 1 / rates.USD ≈ 26 100.
 * Getting that division upside down is a ~680 000 000× money bug in one direction and a
 * ~26 000× one in the other, and BOTH read as a perfectly ordinary number in a log.
 *
 * So the magnitude is asserted, not assumed. A VND/USD rate is in the TENS OF THOUSANDS —
 * it has been since the 1990s (≈11 000 in 1995, ≈19 000 in 2010, ≈26 000 in 2026) and the
 * đồng is not redenominated on a whim. The band below is roughly 5× either side of today,
 * which survives a decade of drift while refusing every unit error that matters:
 *   · inverted rate (0.0000383)            → far below the floor, refused
 *   · upstream switched base to USD (1.0)  → far below the floor, refused
 *   · rate quoted in thousands (26.1)      → far below the floor, refused
 *   · rate already inverted upstream       → refused by the same floor
 * Anything outside is a feed we do not understand, and we do not charge on a feed we do
 * not understand.
 */
const MIN_VND_PER_USD = 5_000
const MAX_VND_PER_USD = 100_000

/**
 * A sanity ceiling on a quotable price, mirroring MAX_PRICE_VND in src/lib/visa-shop.ts
 * (2 tỷ ≈ US$77 000 — an absurd visa fee, so this only ever catches a data-entry accident
 * or a corrupted row). Deliberately NOT imported from there: this module must be usable
 * without dragging in the catalogue, and it must not TRUST the catalogue either — a price
 * arriving from a future caller gets re-asserted here, at the boundary where it becomes a
 * charge. Keep the two numbers equal.
 *
 * At the floor rate this caps a quote at 2 000 000 000 × 100 / 5 000 = 40 000 000 cents
 * (US$400 000), comfortably inside payments.ts's MAX_CHARGE_CENTS ($1 000 000) — so a
 * price this module accepts can never be refused downstream for being too large.
 */
const MAX_PRICE_VND = 2_000_000_000

/** Mirrors MAX_CHARGE_CENTS in src/lib/visa/payments.ts. Same "keep them equal" note. */
const MAX_QUOTE_CENTS = 1_000_000_00

/**
 * How long a quote may be honoured. The rate itself is data-cached for 6h, so this is not
 * about the rate going stale — it is about how long a buyer may sit on a number. Fifteen
 * minutes covers reading the review step, checking a passport, and clicking; beyond that
 * the price is re-issued and re-shown rather than silently carried forward.
 */
const QUOTE_TTL_MS = 15 * 60 * 1000

/**
 * How far the freshly-issued amount may sit from the one the buyer was shown before the
 * checkout refuses and asks for a new confirmation.
 *
 * ONE CENT, i.e. essentially zero. That is affordable precisely because the rate is
 * data-cached for 6h: within a cache window the re-issued quote is bit-identical to the
 * one on screen, so this tolerance only ever absorbs the boundary case where the cache
 * refreshed between render and click. Any REAL movement — a rate refresh, or the admin
 * re-pricing the listing — exceeds it and the buyer is asked to confirm the new number,
 * which is the entire point. A wider tolerance would also be a discount an attacker could
 * ask for by echoing a cheap quote, so it stays at the smallest value that means anything.
 */
export const VISA_QUOTE_DRIFT_TOLERANCE_CENTS = 1

/**
 * The window inside which a raw cent value is treated as landing exactly on a cent.
 *
 * A hair under a millionth of a cent: ~1e-8 dollars, ~0.0003 đồng. Double rounding error
 * at these magnitudes (raw ≈ 1e4) is ~1e-12, so this is six orders of magnitude above the
 * noise it absorbs and six below the smallest fraction of a cent that could ever be real.
 * It exists because `Math.ceil` is unforgiving: a true quotient of exactly 10 000.00 that
 * the FPU hands back as 10 000.000000000002 would become 10 001 — a cent conjured out of
 * float representation, at the charge boundary, which is the one place it must not happen.
 */
const CENT_SNAP_EPSILON = 1e-6

// ── The rate ──────────────────────────────────────────────────────────────────────

/**
 * ĐỒNG PER ONE DOLLAR, or null. THE DIRECTION IS THE WHOLE FUNCTION, so it is spelled out:
 *
 *   upstream `rates` are "currency per 1 VND"  ⇒  rates.USD = dollars per đồng ≈ 0.0000383
 *   we want   đồng per 1 dollar                 ⇒  vndPerUsd = 1 / rates.USD    ≈ 26 100
 *
 * The reciprocal is taken ONCE, here, and the result is band-checked before it can reach
 * any arithmetic that produces money. Everything downstream consumes vndPerUsd only — no
 * other function in the codebase gets to decide which way up the rate is.
 *
 * Every failure is a null and a log, never a throw and never a substitute: a checkout that
 * cannot price itself must refuse, and the caller turns that into an honest 503.
 */
async function vndPerUsdRate(): Promise<number | null> {
  try {
    const res = await fetch(FX_ENDPOINT, {
      next: { revalidate: FX_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(FX_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[visa-fx] rate feed answered ${res.status}`)
      return null
    }
    const data = (await res.json().catch(() => null)) as { result?: string; rates?: Record<string, unknown> } | null
    // The upstream's own success flag. A body without it is a proxy/error page, not a rate.
    if (data?.result !== 'success' || !data.rates) {
      console.error('[visa-fx] rate feed did not report success')
      return null
    }
    const usdPerVnd = data.rates.USD
    if (typeof usdPerVnd !== 'number' || !Number.isFinite(usdPerVnd) || usdPerVnd <= 0) {
      console.error('[visa-fx] rate feed carried no usable USD rate')
      return null
    }
    const vndPerUsd = 1 / usdPerVnd
    if (!Number.isFinite(vndPerUsd) || vndPerUsd < MIN_VND_PER_USD || vndPerUsd > MAX_VND_PER_USD) {
      // Loud, and it names the number: this is the log line that catches an inverted feed
      // in the five minutes after it starts, rather than in a chargeback three weeks later.
      console.error(`[visa-fx] implausible VND/USD rate ${vndPerUsd} (from rates.USD=${usdPerVnd}) — refusing to quote`)
      return null
    }
    return vndPerUsd
  } catch (e) {
    console.error('[visa-fx] rate lookup failed', (e as Error)?.message?.slice(0, 200))
    return null
  }
}

// ── The money ─────────────────────────────────────────────────────────────────────

/**
 * ĐỒNG → integer US cents at a given rate, or null.
 *
 * ROUNDING IS **UP**, and the direction is a decision, not a default:
 *   · the amount owed is the ĐỒNG figure; the dollars are a conversion OF it, so the
 *     capture must never come out BELOW what the admin priced — ceil guarantees
 *     amountUsdCents / 100 × vndPerUsd ≥ priceVnd, always;
 *   · the buyer's detriment is bounded by one cent (~260 đồng) and, crucially, is not
 *     hidden: the rounded-up figure IS the number rendered on the page, so the buyer
 *     agrees to the exact integer that will be captured;
 *   · rounding to nearest would sometimes short the desk and would buy nothing in
 *     exchange, since the displayed number is the charged number either way.
 *
 * NO FRACTIONAL CENT CAN SURVIVE THIS, by construction: one double division on values far
 * below 2^53, a snap of pure float noise onto the cent it is trying to be (see
 * CENT_SNAP_EPSILON — without it `Math.ceil` would invent a cent out of 1e-12 of error),
 * then a hard integer/positivity/ceiling assertion. The return type is an integer or null;
 * there is no third outcome to leak into a provider payload.
 */
function usdCentsForVnd(priceVnd: number, vndPerUsd: number): number | null {
  if (!Number.isFinite(priceVnd) || !Number.isFinite(vndPerUsd) || vndPerUsd <= 0) return null
  const raw = (priceVnd * 100) / vndPerUsd
  if (!Number.isFinite(raw) || raw <= 0) return null
  const nearest = Math.round(raw)
  const cents = Math.abs(raw - nearest) < CENT_SNAP_EPSILON ? nearest : Math.ceil(raw)
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_QUOTE_CENTS) return null
  return cents
}

// ── The payment-processing surcharge ────────────────────────────────────────────────────────────
//
// Owner, 2026-08-04: "prices for each visa differ so checkout should specify price from marketplace
// and add paypal processing fees on checkout." The price half was already true — the charge is
// derived from Listing.price on every request — so this adds the fee half.
//
// ⚠️⚠️ IT IS A GROSS-UP, NOT AN ADDITION, AND THE DIFFERENCE IS THE WHOLE POINT. PayPal takes its
// percentage off the TOTAL it captures, so adding 4.4% to the price does NOT recover 4.4%:
//     price 100 → charge 104.40 → PayPal takes 4.4% of 104.40 = 4.59 → desk nets 99.81. Still short.
// The amount that nets the price exactly is  (price + fixed) / (1 - pct):
//     (100 + 0.30) / (1 - 0.044) = 104.92 → PayPal takes 4.92 → desk nets exactly 100.00.
// Naive addition under-recovers on every single transaction, by a little, forever — the kind of
// leak that is invisible per order and only shows up when the books do not reconcile.
//
// ⚠️ THE RATE IS A GUESS UNTIL MEASURED. PayPal's cross-border commercial rate varies by the
// RECEIVING account's country and the buyer's funding source; the defaults below are the common
// international figures, not a quoted rate for this account. Once a real capture settles, read the
// actual fee off the PayPal transaction and correct PAYPAL_FEE_PERCENT — do not leave a guess
// priced into every order.
const DEFAULT_FEE_PERCENT = 4.4
/** No real processor charges over 15%; a higher value is a typo, not a price. */
const MAX_FEE_PERCENT = 15
const DEFAULT_FEE_FIXED_CENTS = 30
/**
 * Ceiling on the per-transaction fixed fee. $9.99 is already absurd — real processors charge
 * $0.30–0.49 — and the tight bound is deliberate twice over: it catches a units error (3000 for
 * $0.30), and it keeps this file free of any 4–6 digit literal that could be mistaken for an FX
 * rate. The "no rate-shaped literal" test caught a 10_000 bound here and was right to.
 */
const MAX_FEE_FIXED_CENTS = 999

function feeConfig(): { percent: number; fixedCents: number } {
  const p = Number.parseFloat(process.env.PAYPAL_FEE_PERCENT || '')
  const f = Number.parseInt(process.env.PAYPAL_FEE_FIXED_CENTS || '', 10)
  return {
    // ⚠️ Clamped, and a nonsense value falls back rather than pricing off it. A percent ≥ 100 would
    // divide by zero or negative below and mint an absurd charge; env is a string and typos happen.
    // ⚠️ BAND, NOT JUST A SANITY CHECK (codex). `< 50` accepted a fat-fingered 44 for 4.4 — a 78%
    // surcharge on every order, from one missing decimal point. No real processor charges over 15%.
    percent: Number.isFinite(p) && p >= 0 && p <= MAX_FEE_PERCENT ? p : DEFAULT_FEE_PERCENT,
    fixedCents: Number.isFinite(f) && f >= 0 && f <= MAX_FEE_FIXED_CENTS ? f : DEFAULT_FEE_FIXED_CENTS,
  }
}

/**
 * The total to charge so that `serviceCents` survives the processor's cut, and the surcharge itself.
 *
 * Exported for the test, which pins the round-trip: charge − processor's actual cut === service.
 */
export function grossUpForProcessing(
  serviceCents: number,
  terms: { percent: number; fixedCents: number } = feeConfig(),
): { totalCents: number; processingCents: number; percent: number; fixedCents: number } | null {
  if (!Number.isSafeInteger(serviceCents) || serviceCents <= 0) return null
  const { percent, fixedCents } = terms
  if (!Number.isFinite(percent) || percent < 0 || percent > MAX_FEE_PERCENT) return null
  if (!Number.isSafeInteger(fixedCents) || fixedCents < 0 || fixedCents > MAX_FEE_FIXED_CENTS) return null
  const total = (serviceCents + fixedCents) / (1 - percent / 100)
  if (!Number.isFinite(total) || total <= 0) return null
  // ⚠️ CEIL, so rounding never lands the desk a cent short; the buyer pays at most one cent extra.
  const totalCents = Math.ceil(total - CENT_SNAP_EPSILON)
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_QUOTE_CENTS) return null
  return { totalCents, processingCents: totalCents - serviceCents, percent, fixedCents }
}

/** A whole, positive, in-range đồng amount, or null. VND has no minor unit, so a
 *  fractional price is a corrupt row rather than a rounding question. */
function usablePriceVnd(priceVnd: unknown): number | null {
  if (typeof priceVnd !== 'number' || !Number.isFinite(priceVnd)) return null
  if (!Number.isInteger(priceVnd) || priceVnd <= 0 || priceVnd > MAX_PRICE_VND) return null
  return priceVnd
}

/** An ISO instant's epoch ms, or null. Rejects anything Date cannot parse. */
function isoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// ── The contract ──────────────────────────────────────────────────────────────────

/**
 * Issue the quote for one product at one price.
 *
 * null when FX is unavailable or the price is unusable. NEVER guesses a rate — see the
 * file header. The caller turns null into a refusal; nothing downstream may fill the gap.
 */
export async function quoteVisaUsd(input: { listingId: string; priceVnd: number }): Promise<VisaQuote | null> {
  const listingId = typeof input?.listingId === 'string' ? input.listingId.trim() : ''
  if (!listingId) return null
  const priceVnd = usablePriceVnd(input?.priceVnd)
  if (priceVnd === null) return null

  const vndPerUsd = await vndPerUsdRate()
  if (vndPerUsd === null) return null

  const serviceUsdCents = usdCentsForVnd(priceVnd, vndPerUsd)
  if (serviceUsdCents === null) return null

  // ⚠️ The charge is the GROSSED-UP total, not the service price — see grossUpForProcessing.
  const grossed = grossUpForProcessing(serviceUsdCents)
  if (grossed === null) return null
  const amountUsdCents = grossed.totalCents

  const quotedAt = new Date()
  const quote: VisaQuote = {
    listingId,
    priceVnd,
    serviceUsdCents,
    processingUsdCents: grossed.processingCents,
    amountUsdCents,
    feePercent: grossed.percent,
    feeFixedCents: grossed.fixedCents,
    vndPerUsd,
    quotedAt: quotedAt.toISOString(),
    expiresAt: new Date(quotedAt.getTime() + QUOTE_TTL_MS).toISOString(),
  }
  // Belt-and-braces: a quote this module issues must satisfy the same predicate the
  // charge path applies to one it is handed. If it does not, the bug is here and the
  // answer is still "no quote" rather than "a quote nobody would accept".
  return isQuoteChargeable(quote, quotedAt) ? quote : null
}

/**
 * True when the quote is still chargeable: not expired, and its rate is still within
 * tolerance — meaning the recorded rate is in the plausible band AND it REPRODUCES the
 * recorded amount to the cent.
 *
 * That last check is what makes an echoed quote safe to accept from a browser: a client
 * cannot hand back a $1 quote for a ₫3.000.000 product, because the amount, the price and
 * the rate must agree with each other under the same rounding rule the server used. It is
 * NOT, on its own, protection against a cheap-but-consistent forgery (pick a rate at the
 * top of the band and the arithmetic still closes) — that is what comparing against a
 * freshly-issued quote is for, and the checkout route does exactly that. This predicate
 * answers "is this object a live quote", never "is this the right price".
 *
 * Written defensively because the value may have come off the wire as JSON.
 */
export function isQuoteChargeable(quote: VisaQuote, now: Date): boolean {
  if (!quote || typeof quote !== 'object') return false
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false
  if (typeof quote.listingId !== 'string' || !quote.listingId.trim()) return false

  const priceVnd = usablePriceVnd(quote.priceVnd)
  if (priceVnd === null) return false
  const { vndPerUsd, amountUsdCents, serviceUsdCents, processingUsdCents, feePercent, feeFixedCents } = quote
  if (typeof vndPerUsd !== 'number' || !Number.isFinite(vndPerUsd)) return false
  if (vndPerUsd < MIN_VND_PER_USD || vndPerUsd > MAX_VND_PER_USD) return false
  if (!Number.isSafeInteger(amountUsdCents) || amountUsdCents <= 0 || amountUsdCents > MAX_QUOTE_CENTS) return false
  if (!Number.isSafeInteger(serviceUsdCents) || serviceUsdCents <= 0) return false
  if (!Number.isSafeInteger(processingUsdCents) || processingUsdCents < 0) return false

  // ⚠️ THE WHOLE CHAIN MUST RE-DERIVE, NOT JUST THE FIRST LINK. Before the processing
  // surcharge existed this was one check — rate produces amount. Now a forged quote could
  // otherwise keep an honest priceVnd and rate, quote a real serviceUsdCents, and simply
  // declare processingUsdCents = 0 to knock the fee off. So: the rate must produce the
  // SERVICE, the gross-up must produce the TOTAL, and the parts must sum to it.
  if (usdCentsForVnd(priceVnd, vndPerUsd) !== serviceUsdCents) return false
  if (serviceUsdCents + processingUsdCents !== amountUsdCents) return false
  // ⚠️ THE QUOTE'S OWN TERMS, NOT feeConfig(). See the note on feePercent in VisaQuote.
  const grossed = grossUpForProcessing(serviceUsdCents, { percent: feePercent, fixedCents: feeFixedCents })
  if (grossed === null || grossed.totalCents !== amountUsdCents) return false

  const quotedMs = isoMs(quote.quotedAt)
  const expiresMs = isoMs(quote.expiresAt)
  if (quotedMs === null || expiresMs === null) return false
  // A forged quote must not be able to claim a year of validity, and a quote cannot
  // expire before it was issued.
  if (expiresMs <= quotedMs || expiresMs - quotedMs > QUOTE_TTL_MS) return false
  return now.getTime() < expiresMs
}

/**
 * Structural parse of an UNTRUSTED quote echo (a request body). Shape only — liveness and
 * self-consistency are isQuoteChargeable's job, and the split keeps "this is not a quote
 * at all" separable from "this quote has expired", which are different words in the UI.
 */
export function parseVisaQuote(value: unknown): VisaQuote | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const blob = value as Record<string, unknown>
  const { listingId, priceVnd, amountUsdCents, serviceUsdCents, processingUsdCents, feePercent, feeFixedCents, vndPerUsd, quotedAt, expiresAt } = blob
  if (typeof listingId !== 'string' || !listingId.trim()) return null
  if (typeof priceVnd !== 'number' || typeof amountUsdCents !== 'number' || typeof vndPerUsd !== 'number') return null
  // ⚠️ THE TWO NEW PARTS ARE REQUIRED, NOT OPTIONAL. Defaulting a missing processing fee to 0
  // would let a client omit the field and have the surcharge silently vanish — a discount
  // available by deleting a line of JSON. An echo without them is not a quote this server issued.
  // ⚠️ INTEGER CENTS, NOT MERELY `typeof number` — that admits NaN, Infinity and fractional cents,
  // and left the whole guarantee resting on every caller remembering to call isQuoteChargeable.
  // typeof FIRST so TypeScript narrows `unknown`; Number.isSafeInteger alone does not.
  if (typeof serviceUsdCents !== 'number' || !Number.isSafeInteger(serviceUsdCents) || serviceUsdCents <= 0) return null
  if (typeof processingUsdCents !== 'number' || !Number.isSafeInteger(processingUsdCents) || processingUsdCents < 0) return null
  if (typeof feePercent !== 'number' || !Number.isFinite(feePercent)) return null
  if (typeof feeFixedCents !== 'number' || !Number.isSafeInteger(feeFixedCents)) return null
  if (typeof quotedAt !== 'string' || typeof expiresAt !== 'string') return null
  return { listingId: listingId.trim(), priceVnd, serviceUsdCents, processingUsdCents, amountUsdCents, feePercent, feeFixedCents, vndPerUsd, quotedAt, expiresAt }
}

/**
 * Has the price moved since the buyer was shown `shown`?
 *
 * True on ANY of: a different product, a different ĐỒNG price (the admin re-priced the
 * listing mid-checkout), or a USD amount more than the tolerance away. The VND comparison
 * is not redundant with the USD one — a rate move and a price edit can cancel out to the
 * same dollar figure, and a buyer who is about to be charged for a re-priced listing is
 * owed the new number regardless of whether the dollars happen to match.
 */
export function visaQuoteDrifted(shown: VisaQuote, fresh: VisaQuote): boolean {
  if (shown.listingId !== fresh.listingId) return true
  if (shown.priceVnd !== fresh.priceVnd) return true
  return Math.abs(shown.amountUsdCents - fresh.amountUsdCents) > VISA_QUOTE_DRIFT_TOLERANCE_CENTS
}
