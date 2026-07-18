import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { decryptVisaPayload, visaApplicantSnapshotHash } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

// ── eno e-Visa assistance service fee — Stripe + PayPal, env-gated dormant ─────────
//
// The pay-before-admin gate (owner 2026-07-18): a visa application stays the
// applicant's private draft until the service fee is PAID; only then does the case
// hand off to ready_for_review, where the admin queue first sees it. Both providers
// are called over plain REST (no SDK dependencies — the Stripe/PayPal HTTP APIs are
// stable and this is the app's only payment surface), and every confirmation path is
// SERVER-verified: the client never gets to assert "paid".
//
// Dormant until env (the Turnstile pattern): with no provider keys or no fee set,
// visaPaymentsConfig() is null and submit behaves exactly as before this feature.
// Owner activation = set VISA_SERVICE_FEE_USD + STRIPE_SECRET_KEY (and/or
// PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET) in Vercel env; STRIPE_WEBHOOK_SECRET makes
// the webhook path live (confirm-on-return works without it).

export type VisaPaymentProvider = 'stripe' | 'paypal'

export type VisaPaymentsConfig = {
  providers: VisaPaymentProvider[]
  feeCents: number
  currency: 'USD'
}

/** Null while dormant. Configured = a positive fee AND at least one provider. */
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

export async function stripeCreateCheckout(input: { applicationId: string; userId: string; feeCents: number }): Promise<{ ref: string; url: string }> {
  const origin = appOrigin()
  const body = new URLSearchParams({
    mode: 'payment',
    client_reference_id: input.applicationId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(input.feeCents),
    'line_items[0][price_data][product_data][name]': FEE_LABEL,
    'metadata[application_id]': input.applicationId,
    'metadata[user_id]': input.userId,
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

export async function paypalCreateOrder(input: { applicationId: string; feeCents: number }): Promise<{ ref: string; url: string }> {
  const origin = appOrigin()
  const { status, json } = await paypalApi('/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: input.applicationId,
      custom_id: input.applicationId,
      description: FEE_LABEL,
      amount: { currency_code: 'USD', value: (input.feeCents / 100).toFixed(2) },
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
    amountCents: Math.round(Number.parseFloat(captureAmount.value || '0') * 100) || 0,
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

  // Flip the checkout row created→paid AT MOST ONCE (replays keep the original audit
  // timestamps; the amounts written are the provider-verified ones from that first flip).
  const payFlip = await db.from('visa_payments')
    .update({ status: 'paid', paid_at: now, amount_cents: input.amountCents, currency: input.currency })
    .eq('provider', input.provider).eq('provider_ref', input.providerRef).eq('status', 'created')
  if (payFlip.error) throw new Error(`visa_payment_update_failed:${payFlip.error.message}`)

  const alreadyPaid = !!app.paid_at
  if (!alreadyPaid) {
    const stampRes = await db.from('visa_applications')
      .update({ paid_at: now, payment_provider: input.provider, payment_ref: input.providerRef, updated_at: now })
      .eq('id', input.applicationId).is('paid_at', null)
      .select('*').maybeSingle()
    if (stampRes.error) throw new Error(`visa_paid_stamp_failed:${stampRes.error.message}`)
    if (stampRes.data) {
      app = stampRes.data as VisaApplicationRow
      await recordVisaEvent(input.applicationId, 'system', 'payment_recorded', input.actorRef, {
        provider: input.provider, amountCents: input.amountCents, currency: input.currency,
      })
    } else {
      // Lost the paid-stamp race to a concurrent webhook/confirm. Re-read and FALL
      // THROUGH to the handoff — if the winner crashed after stamping, this request
      // completes the transition; if the winner finished, the status guard no-ops.
      const freshRes = await db.from('visa_applications').select('*').eq('id', input.applicationId).maybeSingle()
      if (freshRes.error) throw new Error(`visa_paid_read_failed:${freshRes.error.message}`)
      if (freshRes.data) app = freshRes.data as VisaApplicationRow
    }
  }

  // Handoff — only from an applicant-editable state, only with intact checkout consent.
  let handedOff = false
  if (['draft', 'needs_changes'].includes(app.status)) {
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

  return { ok: true, application: app, documents: docs, handedOff, alreadyPaid }
}
