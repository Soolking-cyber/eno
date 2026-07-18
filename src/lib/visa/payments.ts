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
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) providers.push('paypal')
  if (!providers.length) return null
  return { providers, feeCents, currency: 'USD' }
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
    paid: session.payment_status === 'paid',
    amountCents: typeof session.amount_total === 'number' ? session.amount_total : 0,
    currency: typeof session.currency === 'string' ? session.currency.toUpperCase() : 'USD',
    applicationId: metadata.application_id || null,
  }
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
  return process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
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

/** Capture an approved order. An already-captured order (double confirm, refresh of
 *  the return URL) is NOT an error — re-read it and report its real state. */
export async function paypalCaptureOrder(orderId: string): Promise<PaypalCaptureState> {
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
  | { ok: false; error: 'not_found' }

/** Record a verified payment and, when the applicant's checkout-time consent still
 *  matches the payload, complete the send_for_review handoff SERVER-side — so a paid
 *  case reaches the admin even if the buyer never returns from the provider.
 *
 *  Idempotent at two layers: the visa_payments (provider, provider_ref) unique index
 *  makes replayed webhooks/confirms record nothing new, and the application update is
 *  guarded on paid_at IS NULL. Consent integrity: the handoff only auto-fires when
 *  visaApplicantSnapshotHash(current payload) equals the hash stamped at checkout —
 *  an edit made between checkout and payment voids the recorded consent, the case
 *  stays editable (still paid), and the applicant re-submits manually (the submit
 *  route's payment gate passes because paid_at is set). */
export async function markVisaPaidAndHandoff(input: {
  applicationId: string
  provider: VisaPaymentProvider
  providerRef: string
  amountCents: number
  currency: string
  actorRef: string
}): Promise<MarkPaidResult> {
  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', input.applicationId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', input.applicationId),
  ])
  if (!application) return { ok: false, error: 'not_found' }
  let app = application as VisaApplicationRow
  const docs = (documents || []) as VisaDocumentRow[]
  const now = new Date().toISOString()

  // Payment row — flip the checkout-time 'created' row to paid; the unique
  // (provider, provider_ref) index means a replay updates the same row again (no-op).
  await db.from('visa_payments')
    .update({ status: 'paid', paid_at: now, amount_cents: input.amountCents, currency: input.currency })
    .eq('provider', input.provider).eq('provider_ref', input.providerRef)

  const alreadyPaid = !!app.paid_at
  if (!alreadyPaid) {
    const { data: stamped } = await db.from('visa_applications')
      .update({ paid_at: now, payment_provider: input.provider, payment_ref: input.providerRef, updated_at: now })
      .eq('id', input.applicationId).is('paid_at', null)
      .select('*').maybeSingle()
    if (stamped) {
      app = stamped as VisaApplicationRow
      await recordVisaEvent(input.applicationId, 'system', 'payment_recorded', input.actorRef, {
        provider: input.provider, amountCents: input.amountCents, currency: input.currency,
      })
    } else {
      // Lost the race to a concurrent webhook/confirm — re-read; the winner handles handoff.
      const { data: fresh } = await db.from('visa_applications').select('*').eq('id', input.applicationId).maybeSingle()
      if (fresh) app = fresh as VisaApplicationRow
      return { ok: true, application: app, documents: docs, handedOff: app.status === 'ready_for_review', alreadyPaid: true }
    }
  }

  // Handoff — only from an applicant-editable state, only with intact checkout consent.
  let handedOff = false
  if (['draft', 'needs_changes'].includes(app.status)) {
    const { data: paymentRow } = await db.from('visa_payments')
      .select('consent_snapshot_hash, consent_at')
      .eq('provider', input.provider).eq('provider_ref', input.providerRef).maybeSingle()
    const consentHash = (paymentRow as { consent_snapshot_hash?: string | null } | null)?.consent_snapshot_hash || null
    const payload = decryptVisaPayload(app.encrypted_payload)
    const snapshotHash = visaApplicantSnapshotHash(payload)
    const issues = validateVisaForReview(payload, docs)
    if (consentHash && consentHash === snapshotHash && issues.length === 0) {
      const { data: transitioned } = await db.from('visa_applications').update({
        status: 'ready_for_review',
        checklist: [],
        applicant_confirmed_at: now,
        applicant_confirmation_version: VISA_DECLARATION_VERSION,
        applicant_snapshot_hash: snapshotHash,
        authorized_at: now,
        authorization_version: VISA_AUTHORIZATION_VERSION,
        authorization_snapshot_hash: snapshotHash,
        last_applicant_action_at: now,
        updated_at: now,
      }).eq('id', input.applicationId).eq('status', app.status).select('*').maybeSingle()
      if (transitioned) {
        app = transitioned as VisaApplicationRow
        handedOff = true
        await recordVisaEvent(input.applicationId, 'applicant', 'sent_for_review', input.actorRef, {
          declarationVersion: VISA_DECLARATION_VERSION,
          authorizationVersion: VISA_AUTHORIZATION_VERSION,
          officialPrefillAuthorized: true,
          paidVia: input.provider,
        })
      }
    }
  }

  return { ok: true, application: app, documents: docs, handedOff, alreadyPaid }
}
