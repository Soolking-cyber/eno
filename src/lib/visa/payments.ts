import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { formatMoneyFull } from '@/lib/vnd'
import { decryptVisaPayload, visaApplicantSnapshotHash } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

// ── eno e-Visa assistance charges — Stripe + PayPal, env-gated dormant ────────────
//
// The pay-before-admin gate (owner 2026-07-18): a visa application stays the
// applicant's private draft until the service is PAID; only then does the case
// hand off to ready_for_review, where the admin queue first sees it. Both providers
// are called over plain REST (no SDK dependencies — the Stripe/PayPal HTTP APIs are
// stable and this is the app's only payment surface), and every confirmation path is
// SERVER-verified: the client never gets to assert "paid".
//
// ⚠️ THIS FILE KNOWS HOW TO CHARGE, NEVER WHAT TO CHARGE (owner, 2026-07-21).
// A visa service is an ORDINARY MARKETPLACE LISTING that the admin uploads — one
// listing per (entry type × processing speed), each carrying its own price on
// Listing.price. The authoritative amount is therefore resolveVisaProduct() in
// src/lib/visa-shop.ts and nothing else: there is no price table here, no default, no
// fallback. Every function below takes the amount it is given, asserts that it is
// money (assertChargeableUsdCents), and refuses anything else — including 0, which an
// earlier flat-fee shape could produce and which would have opened a $0 checkout.
//
// ⚠️ AND THE PRICE IS IN ĐỒNG WHILE THE CHARGE IS IN DOLLARS (owner, 2026-07-22).
// Listing.price is VND; the USD figure the providers below capture is a SERVER-ISSUED
// QUOTE of it (src/lib/visa/fx.ts), the very same quote the buyer was shown. This module
// still never derives an amount — but it now insists on being handed the quote's evidence
// alongside it (priceVnd, vndPerUsd, quotedAt) and writes that evidence into the
// PROVIDER'S OWN immutable record of the payment, so "why was this card charged $114.89?"
// is answerable months later from Stripe's or PayPal's copy alone. A charge whose evidence
// is missing or malformed is refused rather than sent: an unevidenced currency conversion
// is exactly the charge nobody can defend in a dispute.
//
// Dormant until env (the Turnstile pattern): with no provider keys or no fee env set,
// visaPaymentsConfig() is null and submit behaves exactly as before this feature.
// Owner activation = set VISA_SERVICE_FEE_USD + STRIPE_SECRET_KEY (and/or
// PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET) in env; STRIPE_WEBHOOK_SECRET makes
// the webhook path live (confirm-on-return works without it).

export type VisaPaymentProvider = 'stripe' | 'paypal'

export type VisaPaymentsConfig = {
  providers: VisaPaymentProvider[]
  /**
   * ⚠️ NOT A PRICE — the DORMANT/LIVE SWITCH ONLY.
   *
   * VISA_SERVICE_FEE_USD used to be the one flat fee this feature charged. Pricing is
   * per product now (see the file header), so this number prices nothing: it survives
   * as the env flag that says "the owner has turned payments on", parsed as cents only
   * because the predicate that decides dormancy — "a positive amount was configured" —
   * is unchanged from the flat-fee era, and changing it would silently arm payments on
   * a host that has a Stripe key set for some other reason.
   *
   * Nothing in the charging path reads this value. If you find yourself reaching for it
   * to price something, the amount you want is the USD cents of a SERVER-ISSUED QUOTE:
   * quoteVisaUsd({ listingId, priceVnd: resolveVisaProduct(listingId).priceVnd }) in
   * src/lib/visa/fx.ts. The listing's own number is đồng and is never a cent figure.
   */
  feeCents: number
  currency: 'USD'
}

/** Null while dormant. Configured = the fee env set to a positive amount AND at least
 *  one provider. Deliberately byte-identical to the flat-fee version: an unconfigured
 *  host must behave EXACTLY as it did before per-product pricing. */
export function visaPaymentsConfig(): VisaPaymentsConfig | null {
  const fee = process.env.VISA_SERVICE_FEE_USD
  if (!fee) return null
  const feeCents = Math.round(Number.parseFloat(fee) * 100)
  if (!Number.isFinite(feeCents) || feeCents <= 0) return null
  const providers: VisaPaymentProvider[] = []
  if (process.env.STRIPE_SECRET_KEY) providers.push('stripe')
  // PayPal requires an EXPLICIT mode — a typo'd PAYPAL_ENV ("prod", "production")
  // must fail closed as unconfigured, never silently fall back to sandbox where
  // play-money orders would satisfy real payment state (review #2).
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
    && ['live', 'sandbox'].includes(process.env.PAYPAL_ENV || '')) providers.push('paypal')
  if (!providers.length) return null
  return { providers, feeCents, currency: 'USD' }
}

/** True when the Stripe key is a live-mode key. Every Stripe object we accept must
 *  carry a matching livemode flag — a test-mode session/event can never satisfy a
 *  live deployment (and vice versa; review #2). */
function stripeLiveMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live')
}

/** The canonical public origin — checkout return URLs must land on the real site,
 *  never a *.vercel.app preview host (the OAuth-callback lesson: cookies live on
 *  the canonical origin only). */
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.eno.vn').replace(/\/$/, '')
}

const FEE_LABEL = 'eno e-Visa assistance — service fee'

class PaymentProviderError extends Error {
  constructor(provider: VisaPaymentProvider, detail: string) {
    super(`${provider}_request_failed:${detail.slice(0, 200)}`)
  }
}

// ── The charge boundary ───────────────────────────────────────────────────────────

/**
 * A sanity ceiling on any single charge, mirroring MAX_PRICE_USD in src/lib/visa-shop.ts
 * ($1,000,000). Deliberately NOT imported from there: this module must not depend on the
 * catalogue (that is the whole point of "knows how to charge, not what to charge"), and a
 * ceiling is a property of the charge boundary, not of the shop.
 */
const MAX_CHARGE_CENTS = 1_000_000_00

/**
 * THE MONEY GATE. Every amount that reaches a provider passes through here first.
 *
 * The caller is supposed to hand over VisaQuote.amountUsdCents — an integer number of USD
 * cents that src/lib/visa/fx.ts derived from the listing's đồng price at a rate it recorded.
 * This function assumes none of that: it re-asserts the shape at the boundary where the
 * money actually leaves,
 * so a future caller that forwards a number from somewhere looser (a request body, a
 * float multiply, a nullable column) throws instead of opening a $0 — or a $0.005 —
 * checkout. Throws rather than clamps: silently charging a "corrected" amount is the one
 * outcome worse than failing.
 */
function assertChargeableUsdCents(provider: VisaPaymentProvider, amountCents: number, currency: string): number {
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CHARGE_CENTS) {
    throw new PaymentProviderError(provider, 'amount_not_chargeable')
  }
  // USD is hard-coded into both provider payloads below; a foreign currency here would be
  // charged as dollars (a 25 000× bug for ₫), so it fails instead of being converted.
  //
  // ⚠️ `currency` is the CHARGE currency and it is always USD. It is NOT the listing's
  // currency — a visa product is priced in đồng, and the ĐỒNG figure travels separately as
  // quote evidence (VisaQuoteEvidence below). Do not "fix" this to '₫' when reading the
  // listing side of the flow: that would ask a provider to capture 3 000 000 dollars.
  if ((currency || '').trim().toUpperCase() !== 'USD') throw new PaymentProviderError(provider, 'currency_not_supported')
  return amountCents
}

/**
 * The quote a charge is the dollar face of: the admin's ĐỒNG price, the rate that turned
 * it into cents, and when that rate was read. Comes straight off the VisaQuote the route
 * issued (src/lib/visa/fx.ts) — this module neither derives it nor recomputes the amount
 * from it, it only records it.
 */
export type VisaQuoteEvidence = {
  /** Whole đồng, the admin's authoritative price. */
  priceVnd: number
  /** ĐỒNG per one dollar (≈ 26 000) — never the reciprocal. */
  vndPerUsd: number
  /** ISO instant the rate was read. */
  quotedAt: string
}

/**
 * THE EVIDENCE GATE, and it throws for the same reason the money gate does.
 *
 * A dollar amount converted from đồng is only defensible next to the two numbers that
 * produced it. Sending the charge and losing the evidence would leave a capture nobody can
 * reconstruct — so a malformed quote stops the checkout instead of quietly becoming an
 * undocumented one. The band check is deliberately the same shape as fx.ts's (a VND/USD
 * rate is in the tens of thousands): a caller that hands over an INVERTED rate has almost
 * certainly computed the amount from it too, and refusing here is the last chance to catch
 * that before a stranger's card is touched.
 */
function assertQuoteEvidence(provider: VisaPaymentProvider, evidence: VisaQuoteEvidence): VisaQuoteEvidence {
  const priceVnd = evidence?.priceVnd
  const vndPerUsd = evidence?.vndPerUsd
  const quotedAt = evidence?.quotedAt
  if (!Number.isSafeInteger(priceVnd) || priceVnd <= 0) throw new PaymentProviderError(provider, 'quote_price_not_recordable')
  if (typeof vndPerUsd !== 'number' || !Number.isFinite(vndPerUsd) || vndPerUsd < 5_000 || vndPerUsd > 100_000) {
    throw new PaymentProviderError(provider, 'quote_rate_not_recordable')
  }
  if (typeof quotedAt !== 'string' || !Number.isFinite(Date.parse(quotedAt))) {
    throw new PaymentProviderError(provider, 'quote_time_not_recordable')
  }
  return { priceVnd, vndPerUsd, quotedAt }
}

/**
 * Integer cents → the "12.34" decimal string PayPal's Orders API wants.
 *
 * NO FLOAT ARITHMETIC ON THE MONEY (the usdToCentsExact rule, mirrored): the dollars come
 * from an integer floor and the remainder from an integer multiply/subtract, so the string
 * is a transcription of the integer rather than a rounding of a double. `(cents / 100)
 * .toFixed(2)` happens to be right for every value in range, but "happens to be right" is
 * not a property a payment call should rest on.
 */
function usdCentsToDecimalString(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const remainder = cents - dollars * 100
  return `${dollars}.${String(remainder).padStart(2, '0')}`
}

/**
 * PayPal's "12.34" money string → integer cents, by DIGITS rather than by arithmetic.
 * The inverse of usdCentsToDecimalString and the same rule: `parseFloat(v) * 100` is a
 * float multiply on an amount we are about to compare against the price we charged, and
 * the comparison is what stops a short capture from being recorded as payment.
 *
 * 0 for anything that is not a plain non-negative decimal with at most two places. That is
 * FAIL-CLOSED by construction: markVisaPaidAndHandoff requires the reported amount to
 * cover the checkout row, so an unreadable amount is rejected as a mismatch, never waved
 * through. (Same value the old parseFloat path produced for garbage, deliberately.)
 */
function usdDecimalStringToCents(value: unknown): number {
  const match = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(typeof value === 'string' ? value : '')
  if (!match) return 0
  const dollars = Number.parseInt(match[1], 10)
  // padEnd, not padStart: ".5" is fifty cents, not five. (PayPal sends two places for USD;
  // this only matters if it ever trims a trailing zero.)
  const fraction = Number.parseInt((match[2] || '').padEnd(2, '0'), 10)
  return dollars * 100 + fraction
}

/**
 * The product name shown on the provider's own hosted page and stored in its record —
 * the buyer must see WHICH product they are paying for, and a dispute needs the provider's
 * copy of it. Collapsed, trimmed, length-capped (Stripe's product name and PayPal's
 * purchase-unit description are both bounded), and falling back to the generic label so an
 * untitled listing can never produce an empty required field.
 *
 * A listing title is public marketplace copy — it carries no applicant data, and nothing
 * about the applicant is ever sent to a provider from this module.
 */
function providerProductLabel(title: string | null | undefined, max: number): string {
  const clean = (title || '').replace(/\s+/g, ' ').trim()
  if (!clean) return FEE_LABEL.slice(0, max)
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/**
 * The product name WITH the đồng price it is the dollar equivalent of — "Vietnam e-visa —
 * 1 hour, single entry — 3,000,000 VND".
 *
 * This is the owner's rule reaching the last screen of the flow: the provider's hosted page
 * shows the USD it is about to take, and the line beside it names the VND price the admin
 * actually set, so the buyer never has to take the conversion on trust. It is also the
 * cheapest dispute evidence there is — it lands in the provider's own record with no
 * schema, no metadata lookup and no access to anything of ours.
 *
 * ⚠️ THE ĐỒNG NOTE IS BUDGETED FIRST and the TITLE is what gets truncated. Both providers
 * hard-cap these fields (Stripe 120-ish for a product name, PayPal 127 for a purchase-unit
 * description), and a long product title must not be allowed to push the price out of the
 * string — a truncated title is cosmetic, a missing price is the evidence gone.
 *
 * 'en' grouping on purpose: "3,000,000 VND" is the internationally legible rendering, and
 * this string is read by a dispute analyst as often as by the buyer. (formatMoneyFull's
 * 'vi' form, "3.000.000 đ", reads as three thousand to anyone outside the market.)
 */
function providerLineLabel(title: string | null | undefined, priceVnd: number, max: number): string {
  const note = ` — ${formatMoneyFull(priceVnd, '₫', 'en')}`
  return `${providerProductLabel(title, Math.max(1, max - note.length))}${note}`
}

// ── Stripe (REST; form-encoded) ────────────────────────────────────────────────────

async function stripeApi(path: string, body?: URLSearchParams): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new PaymentProviderError('stripe', 'not_configured')
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message || String(res.status)
    throw new PaymentProviderError('stripe', err)
  }
  return json
}

/**
 * Open a Stripe Checkout session for ONE resolved visa product.
 *
 * `amountCents` is the server-issued QUOTE's amount — the dollar face of the listing's
 * đồng price. This function never derives, defaults or adjusts an amount, and
 * assertChargeableUsdCents refuses anything that is not a positive whole-cent USD figure
 * before a single byte goes to Stripe.
 *
 * `listingId`, `productTitle` and the quote evidence are DISPUTE EVIDENCE, not inputs to
 * the price: they are written into Stripe's own immutable record of the payment (metadata
 * + the line item the buyer sees), so "which product was this $114.89 for, and at what
 * rate?" is answerable from the provider's side alone, months later, without opening
 * anything of ours. Every value is a public commercial fact — a listing id, a public
 * title, a price, an FX rate, a timestamp. NO APPLICANT DATA reaches a provider from here.
 */
export async function stripeCreateCheckout(input: {
  applicationId: string
  userId: string
  listingId: string
  productTitle: string
  amountCents: number
  currency: string
  quote: VisaQuoteEvidence
}): Promise<{ ref: string; url: string }> {
  const origin = appOrigin()
  const amountCents = assertChargeableUsdCents('stripe', input.amountCents, input.currency)
  const quote = assertQuoteEvidence('stripe', input.quote)
  const body = new URLSearchParams({
    mode: 'payment',
    client_reference_id: input.applicationId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    // The buyer sees the product they picked AND the đồng price it converts from, not a
    // generic "service fee" — the dollars on the Stripe page and the đồng beside them come
    // from the same listing and the same quote.
    'line_items[0][price_data][product_data][name]': providerLineLabel(input.productTitle, quote.priceVnd, 120),
    'line_items[0][price_data][product_data][description]': FEE_LABEL,
    'metadata[application_id]': input.applicationId,
    'metadata[user_id]': input.userId,
    'metadata[listing_id]': input.listingId,
    // The conversion, recorded where a chargeback investigation can reach it without us.
    'metadata[price_vnd]': String(quote.priceVnd),
    'metadata[vnd_per_usd]': String(quote.vndPerUsd),
    'metadata[quoted_at]': quote.quotedAt,
    // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect; aid lets the client
    // post the confirm without waiting for its application list to load.
    success_url: `${origin}/dashboard/visa?paid=stripe&aid=${input.applicationId}&sid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/visa?pay=cancelled`,
  })
  const session = await stripeApi('/v1/checkout/sessions', body)
  if (typeof session.id !== 'string' || typeof session.url !== 'string') throw new PaymentProviderError('stripe', 'malformed_session')
  return { ref: session.id, url: session.url }
}

export type StripeSessionState = {
  id: string
  paid: boolean
  amountCents: number
  currency: string
  applicationId: string | null
}

export async function stripeRetrieveSession(sessionId: string): Promise<StripeSessionState> {
  const session = await stripeApi(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`)
  const metadata = (session.metadata || {}) as Record<string, string>
  return {
    id: String(session.id),
    // livemode must match the key's mode — a test session can never read as paid here.
    paid: session.payment_status === 'paid' && session.livemode === stripeLiveMode(),
    amountCents: typeof session.amount_total === 'number' ? session.amount_total : 0,
    currency: typeof session.currency === 'string' ? session.currency.toUpperCase() : 'USD',
    applicationId: metadata.application_id || null,
  }
}

/** Webhook-side mode check: the event's livemode must match the configured key. */
export function stripeEventModeOk(livemode: unknown): boolean {
  return livemode === stripeLiveMode()
}

/** Stripe webhook signature (their `t=...,v1=...` scheme): HMAC-SHA256 of
 *  `${t}.${rawBody}` with the endpoint secret, constant-time compared against every
 *  v1 candidate, with a replay-tolerance window. Hand-rolled on node:crypto — the
 *  same posture as the app's Standard-Webhooks verification (send-sms hook). */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300): boolean {
  if (!signatureHeader) return false
  const parts = new Map<string, string[]>()
  for (const piece of signatureHeader.split(',')) {
    const idx = piece.indexOf('=')
    if (idx < 1) continue
    const k = piece.slice(0, idx).trim()
    const v = piece.slice(idx + 1).trim()
    parts.set(k, [...(parts.get(k) || []), v])
  }
  const t = Number.parseInt(parts.get('t')?.[0] || '', 10)
  const candidates = parts.get('v1') || []
  if (!Number.isFinite(t) || !candidates.length) return false
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  return candidates.some((candidate) => {
    const buf = Buffer.from(candidate, 'utf8')
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf)
  })
}

// ── PayPal (REST; Orders v2) ───────────────────────────────────────────────────────

function paypalBase(): string {
  // visaPaymentsConfig() already refuses to enable PayPal without an explicit valid
  // mode; this second check makes a direct caller with a typo'd env fail closed too.
  const env = process.env.PAYPAL_ENV
  if (env !== 'live' && env !== 'sandbox') throw new PaymentProviderError('paypal', 'env_not_configured')
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

async function paypalToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) throw new PaymentProviderError('paypal', 'not_configured')
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string }
  if (!res.ok || !json.access_token) throw new PaymentProviderError('paypal', `oauth_${res.status}`)
  return json.access_token
}

async function paypalApi(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = await paypalToken()
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

/**
 * Open a PayPal order for ONE resolved visa product. Same money rule as the Stripe path:
 * the amount is the caller's server-issued quote, gated by assertChargeableUsdCents, and
 * its evidence by assertQuoteEvidence.
 *
 * ⚠️ custom_id STAYS THE APPLICATION ID. paypalOrderState() reads the paid case back out
 * of it and the confirm route refuses any order whose custom_id is not this application —
 * that is the cross-application guard, so the field is not free real estate for a listing
 * id. PayPal's per-unit evidence is therefore the DESCRIPTION, which now carries the
 * product's title AND the đồng price the dollars convert from; the listing id, the rate
 * and the quote instant live in our visa_events audit row, which the checkout route
 * writes. (invoice_id would be the other slot and is deliberately unused: it is unique per
 * merchant account, so a retried checkout would be rejected by PayPal outright.)
 *
 * PayPal therefore records LESS of the conversion than Stripe's metadata map does — the
 * asymmetry is the API's, not a choice: Orders v2 has no free-form key/value bag on a
 * purchase unit, and the two fields that could hold one are both load-bearing here.
 */
export async function paypalCreateOrder(input: {
  applicationId: string
  listingId: string
  productTitle: string
  amountCents: number
  currency: string
  quote: VisaQuoteEvidence
}): Promise<{ ref: string; url: string }> {
  const origin = appOrigin()
  const amountCents = assertChargeableUsdCents('paypal', input.amountCents, input.currency)
  const quote = assertQuoteEvidence('paypal', input.quote)
  const { status, json } = await paypalApi('/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: input.applicationId,
      custom_id: input.applicationId,
      // 127 is PayPal's documented maximum for a purchase-unit description. The đồng price
      // rides in here because custom_id is spoken for (see the note above) — and it is the
      // one line the buyer reads on the PayPal approval page next to the dollar total, so
      // "you are paying US$114.89 for a 3,000,000 VND service" is stated before they click.
      description: providerLineLabel(input.productTitle, quote.priceVnd, 127),
      amount: { currency_code: 'USD', value: usdCentsToDecimalString(amountCents) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          // PayPal appends ?token=<orderId> to the return URL; aid as above.
          return_url: `${origin}/dashboard/visa?paid=paypal&aid=${input.applicationId}`,
          cancel_url: `${origin}/dashboard/visa?pay=cancelled`,
        },
      },
    },
  })
  if (status >= 400 || typeof json.id !== 'string') throw new PaymentProviderError('paypal', String((json as { name?: string }).name || status))
  const links = (json.links || []) as Array<{ rel?: string; href?: string }>
  const approval = links.find((l) => l.rel === 'payer-action') || links.find((l) => l.rel === 'approve')
  if (!approval?.href) throw new PaymentProviderError('paypal', 'no_approval_link')
  return { ref: json.id, url: approval.href }
}

export type PaypalCaptureState = {
  id: string
  paid: boolean
  amountCents: number
  currency: string
  applicationId: string | null
}

function paypalOrderState(order: Record<string, unknown>): PaypalCaptureState {
  const unit = ((order.purchase_units || []) as Array<Record<string, unknown>>)[0] || {}
  const amount = (unit.amount || {}) as { currency_code?: string; value?: string }
  const capture = (((unit.payments || {}) as { captures?: Array<Record<string, unknown>> }).captures || [])[0]
  const captureAmount = (capture?.amount || amount) as { currency_code?: string; value?: string }
  return {
    id: String(order.id || ''),
    paid: order.status === 'COMPLETED',
    amountCents: usdDecimalStringToCents(captureAmount.value),
    currency: (captureAmount.currency_code || 'USD').toUpperCase(),
    applicationId: typeof unit.custom_id === 'string' ? unit.custom_id : typeof unit.reference_id === 'string' ? unit.reference_id : null,
  }
}

/** Capture an approved order — but VERIFY FIRST: the order is read and its custom_id
 *  checked against the expected application BEFORE any capture (review #5: capturing
 *  a leaked foreign order id and only then noticing the mismatch would still take the
 *  money). An already-captured order (double confirm, return-URL refresh) is NOT an
 *  error — re-read it and report its real state. */
export async function paypalCaptureOrder(orderId: string, expectedApplicationId: string): Promise<PaypalCaptureState> {
  const pre = await paypalApi(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET')
  if (pre.status >= 400) throw new PaymentProviderError('paypal', `order_read_${pre.status}`)
  const preState = paypalOrderState(pre.json)
  if (preState.applicationId !== expectedApplicationId) {
    // Never capture an order that was not minted for this application.
    return { ...preState, paid: false }
  }
  if (preState.paid) return preState // already captured — idempotent
  const capture = await paypalApi(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', {})
  if (capture.status < 400) return paypalOrderState(capture.json)
  const already = ((capture.json.details || []) as Array<{ issue?: string }>).some((d) => d.issue === 'ORDER_ALREADY_CAPTURED')
  if (!already) throw new PaymentProviderError('paypal', String((capture.json as { name?: string }).name || capture.status))
  const order = await paypalApi(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET')
  if (order.status >= 400) throw new PaymentProviderError('paypal', `order_read_${order.status}`)
  return paypalOrderState(order.json)
}

// ── Paid → handoff (the one transition the whole feature exists for) ───────────────

export type MarkPaidResult =
  | { ok: true; application: VisaApplicationRow; documents: VisaDocumentRow[]; handedOff: boolean; alreadyPaid: boolean }
  | { ok: false; error: 'not_found' | 'payment_row_missing' | 'amount_mismatch' }

type VisaPaymentRow = {
  application_id: string
  user_id: string
  status: string
  amount_cents: number
  currency: string
  paid_at: string | null
  consent_snapshot_hash: string | null
  consent_declaration_version: string | null
  consent_authorization_version: string | null
}

/** Record a verified payment and, when the applicant's checkout-time consent still
 *  matches the payload, complete the send_for_review handoff SERVER-side — so a paid
 *  case reaches the admin even if the buyer never returns from the provider.
 *
 *  Hardened per the 2026-07-18 external review (codex + gemini, cross-confirmed):
 *  · a CHECKOUT-TIME visa_payments row for exactly this (provider, ref, application)
 *    is REQUIRED — a provider object that our checkout never minted records nothing;
 *  · the provider-verified amount/currency must cover that row's immutable
 *    amount_cents/currency (local truth, set from config at checkout) — a cheaper or
 *    foreign-currency payment is rejected before any write;
 *  · every Supabase write is error-checked (a failed query THROWS so the webhook 500s
 *    and Stripe retries — a zero-row compare-and-set is the only benign "miss");
 *  · the paid-stamp race loser CONTINUES into the idempotent handoff instead of
 *    returning (if the winner crashed post-stamp, the loser completes the transition);
 *  · the transition is additionally guarded on updated_at (the extract-route idiom),
 *    so a payload PATCH racing the handoff voids it rather than shipping consent
 *    stamps for a payload the applicant never confirmed;
 *  · the consent versions stamped are the ones RECORDED AT CHECKOUT, not whatever
 *    constants are current at payment time;
 *  · the payment row flips created→paid at most once (replays never move paid_at). */
export async function markVisaPaidAndHandoff(input: {
  applicationId: string
  provider: VisaPaymentProvider
  providerRef: string
  amountCents: number
  currency: string
  actorRef: string
}): Promise<MarkPaidResult> {
  const db = getVisaDb()
  const [appRes, docsRes, payRes] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', input.applicationId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', input.applicationId),
    db.from('visa_payments').select('*').eq('provider', input.provider).eq('provider_ref', input.providerRef).maybeSingle(),
  ])
  if (appRes.error) throw new Error(`visa_paid_read_failed:${appRes.error.message}`)
  if (docsRes.error) throw new Error(`visa_paid_read_failed:${docsRes.error.message}`)
  if (payRes.error) throw new Error(`visa_paid_read_failed:${payRes.error.message}`)
  if (!appRes.data) return { ok: false, error: 'not_found' }
  let app = appRes.data as VisaApplicationRow
  const docs = (docsRes.data || []) as VisaDocumentRow[]
  const paymentRow = payRes.data as VisaPaymentRow | null

  // Local checkout row is the authorization to record anything at all — and it must
  // belong to THIS application (a leaked ref for another case must not cross-credit).
  if (!paymentRow || paymentRow.application_id !== input.applicationId) {
    return { ok: false, error: 'payment_row_missing' }
  }
  // Provider truth must cover the checkout-time local truth. (A session minted before
  // a fee raise still honors its own amount — bounded by provider session expiry.)
  if (input.amountCents < paymentRow.amount_cents || input.currency.toUpperCase() !== paymentRow.currency.toUpperCase()) {
    return { ok: false, error: 'amount_mismatch' }
  }

  const now = new Date().toISOString()

  // ── ATOMIC MONEY CORE: flip the payment created→paid AND stamp the application, in ONE
  // transaction, with the application row locked FIRST. This is the deadlock-free half of the
  // capture-vs-delete race (the follow-up scripts/visa-delete-guard-trigger.mjs documents).
  //
  // Supabase JS calls are each their own transaction, so a SELECT..FOR UPDATE cannot be held
  // across the flip and the stamp — hence a Postgres RPC. Locking visa_applications FIRST matches
  // the DELETE path's app→payments order (no deadlock), and MODIFYING the app row (not merely
  // locking it) is what forces a concurrent delete — blocked on our lock — to re-evaluate the
  // changed row via EvalPlanQual and re-fire its BEFORE trigger against the now-committed 'paid'
  // (codex, 2026-07-24). The RPC is service_role-only (visa-capture-payment-fn.mjs) — never
  // end-user callable — and binds application_id so a leaked ref can't pay against the wrong case.
  // p_actor_ref: the RPC also writes the `payment_recorded` dispute-trail event inside this
  // same transaction (see below), so it needs the actor the event is attributed to.
  const cap = await db.rpc('visa_capture_payment', {
    p_app_id: input.applicationId,
    p_provider: input.provider,
    p_provider_ref: input.providerRef,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_now: now,
    p_actor_ref: input.actorRef ?? null,
    // ⚠️ THIS caller no longer writes its own payment_recorded row, so it asks the function to.
    // The flag defaults to FALSE in the DDL precisely so the still-deployed OLD caller — which
    // does write its own — keeps working unchanged during the window between applying the
    // migration and shipping this code, instead of producing two rows for one payment (codex).
    p_write_event: true,
  })
  // A shaky payment (missing / wrong status / cross-case) RAISES inside the RPC, so the whole
  // transaction — including any app stamp — rolls back and surfaces here as cap.error. Refuse.
  if (cap.error) throw new Error(`visa_capture_failed:${cap.error.message}`)
  const outcome = cap.data as 'flipped' | 'already_paid' | 'app_gone' | null

  if (outcome === 'app_gone') {
    // The draft was deleted out from under a provider capture. The money may already be captured
    // at the provider with no local case to record it against — surface it LOUD for reconciliation
    // (a refund is an ops call) and fail safe: never fabricate a paid record for a ghost.
    console.error('[visa-payments][MONEY] captured payment has no application to record against — refund/reconcile', {
      provider: input.provider, providerRef: input.providerRef, amountCents: input.amountCents, currency: input.currency,
    })
    return { ok: false, error: 'not_found' }
  }
  if (outcome !== 'flipped' && outcome !== 'already_paid') {
    // Defensive: the RPC only ever returns flipped | already_paid | app_gone (unexpected RAISES).
    // A null/unknown here means the contract drifted — refuse rather than proceed on a guess.
    throw new Error(`visa_capture_unexpected:${String(outcome)}`)
  }
  // `flipped` = THIS call recorded the money (payment created→paid). `already_paid` = a replay of
  // an already-paid row (a second webhook/confirm) — the RPC re-verified it is paid for THIS case.
  const stampedNow = outcome === 'flipped'

  // The RPC stamped paid_at + provider/ref inside its transaction; re-read the current row so the
  // handoff below runs against the stamped state. The row MUST be present — the payment is now
  // 'paid', so the delete trigger protects it — a null read means something is badly wrong; fail
  // rather than hand off a stale pre-capture snapshot (codex, 2026-07-24).
  const freshRes = await db.from('visa_applications').select('*').eq('id', input.applicationId).maybeSingle()
  if (freshRes.error) throw new Error(`visa_paid_read_failed:${freshRes.error.message}`)
  if (!freshRes.data) throw new Error('visa_paid_read_failed:application_vanished_after_capture')
  app = freshRes.data as VisaApplicationRow

  // ── THE `payment_recorded` DISPUTE-TRAIL EVENT NOW COMMITS WITH THE MONEY ────────────
  // It used to be written HERE, right after the RPC returned, guarded by `stampedNow`. That
  // left a real hole: a crash in the ~ms between the RPC commit and this write lost the audit
  // row permanently, because the retry returns 'already_paid' and skipped the write. The money
  // was never at risk — visa_payments.status='paid' commits atomically inside the RPC — but the
  // row that answers "what was this charge for" could simply be absent from a dispute.
  //
  // The obvious patch (self-heal on the replay) was put to codex and Gemini, and BOTH refused
  // it for the same reason: recovery would depend on a replay that may never arrive, so the
  // window is narrowed, not closed — and it invites duplicate/inconsistent audit rows. So the
  // insert moved INSIDE `visa_capture_payment` (scripts/visa-capture-payment-fn.mjs step 5),
  // under the same `v_flipped > 0 or v_app_was_unstamped` condition `stampedNow` reflects here.
  // It now either commits with the capture or rolls back with it, and a replay writes nothing,
  // so there is no duplicate to dedupe. `checkoutAmountCents` is read in-transaction BEFORE the
  // flip overwrites amount_cents, so the trail keeps BOTH the quoted and the captured figure.
  //
  // `stampedNow` is still the handoff's signal below — it just no longer gates an event write.

  // ── THE CAPTURE-TIME SELECTION GUARD (Phase 2) ────────────────────────────────────
  // What was CHARGED is the listing in this ref's own `checkout_started` event; what the
  // case SELECTS is the canonical column (event fallback for legacy rows). A stale-tab
  // capture — the applicant re-selected a product, then paid a provider session minted
  // for the OLD one — must not silently hand a mismatched case to review. The payment
  // stamps regardless (money is provider truth); only the HANDOFF is withheld, and the
  // desk sees a named event instead of a bare consent-hash miss.
  //
  // ⚠️ THIS GUARD IS THE ONLY GATE FOR A SAME-ENTRY-TYPE SWAP (external review): the
  // consent hash is a PAYLOAD hash, and swapping 1H→1D single leaves the payload — and
  // so the hash — untouched. It therefore FAILS CLOSED, twice over: an UNREADABLE trail
  // withholds the handoff (a paid draft is desk-visible via the queue's paid-row rule,
  // and the other capture path retries the read), and a charge whose case has NO
  // canonical selection at all is treated as a mismatch, not waved through.
  let withholdHandoff = false
  if (['draft', 'needs_changes'].includes(app.status)) {
    try {
      const eventRes = await db.from('visa_events')
        .select('metadata')
        .eq('application_id', input.applicationId)
        .eq('event', 'checkout_started')
        .eq('metadata->>providerRef', input.providerRef)
        .order('created_at', { ascending: false })
        .limit(1)
      if (eventRes.error) throw eventRes.error
      const charged = (eventRes.data?.[0]?.metadata as { listingId?: unknown } | undefined)?.listingId
      const stored = typeof app.selected_listing_id === 'string' ? app.selected_listing_id.trim() : ''
      let canonical = stored || null
      if (!canonical) {
        const sel = await db.from('visa_events')
          .select('metadata,created_at,id')
          .eq('application_id', input.applicationId)
          .eq('event', 'dm_product_selected')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
        if (sel.error) throw sel.error
        const listingId = (sel.data?.[0]?.metadata as { listingId?: unknown } | undefined)?.listingId
        canonical = typeof listingId === 'string' && listingId.trim() ? listingId.trim() : null
      }
      if (typeof charged === 'string' && charged && charged !== canonical) {
        withholdHandoff = true
        if (stampedNow) {
          await recordVisaEvent(input.applicationId, 'system', 'payment_selection_mismatch', input.actorRef, {
            provider: input.provider, providerRef: input.providerRef,
            chargedListingId: charged, selectedListingId: canonical,
          })
        }
        console.error(`[visa-payments] capture for ${charged} but case selects ${canonical ?? 'nothing'} — handoff withheld (${input.applicationId})`)
      }
    } catch (e) {
      // FAIL CLOSED: an unverifiable charge/selection pairing is not handed to review.
      // The payment stamps below regardless; the desk sees a paid draft in the queue.
      withholdHandoff = true
      console.error('[visa-payments] selection guard unreadable — handoff withheld until it can be verified', e)
    }
  }

  // Handoff — only from an applicant-editable state, only with intact checkout consent.
  let handedOff = false
  if (!withholdHandoff && ['draft', 'needs_changes'].includes(app.status)) {
    const consentHash = paymentRow.consent_snapshot_hash
    const payload = decryptVisaPayload(app.encrypted_payload)
    const snapshotHash = visaApplicantSnapshotHash(payload)
    const issues = validateVisaForReview(payload, docs)
    if (consentHash && consentHash === snapshotHash && issues.length === 0) {
      const declarationVersion = paymentRow.consent_declaration_version || VISA_DECLARATION_VERSION
      const authorizationVersion = paymentRow.consent_authorization_version || VISA_AUTHORIZATION_VERSION
      const transitionRes = await db.from('visa_applications').update({
        status: 'ready_for_review',
        checklist: [],
        applicant_confirmed_at: now,
        applicant_confirmation_version: declarationVersion,
        applicant_snapshot_hash: snapshotHash,
        authorized_at: now,
        authorization_version: authorizationVersion,
        authorization_snapshot_hash: snapshotHash,
        last_applicant_action_at: now,
        updated_at: now,
      // updated_at guard (the extract-route optimistic idiom): a payload PATCH racing
      // this handoff bumps updated_at, the compare-and-set misses, and the case stays
      // an editable paid draft — never a review case whose consent stamp is for a
      // different payload than the one it carries.
      }).eq('id', input.applicationId).eq('status', app.status).eq('updated_at', app.updated_at).select('*').maybeSingle()
      if (transitionRes.error) throw new Error(`visa_handoff_failed:${transitionRes.error.message}`)
      if (transitionRes.data) {
        app = transitionRes.data as VisaApplicationRow
        handedOff = true
        await recordVisaEvent(input.applicationId, 'applicant', 'sent_for_review', input.actorRef, {
          declarationVersion,
          authorizationVersion,
          officialPrefillAuthorized: true,
          paidVia: input.provider,
        })
      }
    }
  }

  // FLIP THE IN-CHAT CHECKOUT CARD TO PAID. Without this the buyer pays and the card in
  // their thread still reads "Pay" — the single most alarming thing a payment flow can do.
  // Both completion paths (the Stripe webhook and confirm-on-return) land here, so this is
  // the one place that covers both.
  //
  // ⚠️ LAZY IMPORT, and not for speed: dm-thread.ts imports visaPaymentsConfig from THIS
  // module, so a top-level import would be a require cycle. Same idiom the thread route uses.
  //
  // markVisaThreadPaid re-reads visa_applications.paid_at itself and never throws — it is
  // evidence-gated, not caller-trusted — so a failure here cannot undo a real capture. It is
  // deliberately OUTSIDE the alreadyPaid guard: a webhook and a confirm-on-return both firing
  // is the normal case, and the stamp is idempotent. A case with no thread returns false.
  try {
    const { markVisaThreadPaid } = await import('./dm-thread')
    await markVisaThreadPaid(input.applicationId)
  } catch (e) {
    // Never fail a captured payment because a card could not be restamped.
    console.error('[visa-payments] card stamp after capture', e)
  }

  // alreadyPaid = the money was recorded by an EARLIER call, not this one (a replay). It is the
  // inverse of stampedNow (this call being the one that flipped created→paid).
  return { ok: true, application: app, documents: docs, handedOff, alreadyPaid: !stampedNow }
}
