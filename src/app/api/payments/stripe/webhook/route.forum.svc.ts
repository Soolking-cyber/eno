import { NextResponse } from 'next/server'
import { markVisaPaidAndHandoff, stripeEventModeOk, verifyStripeSignature } from '@/lib/visa/payments'

// Stripe → eno. The HMAC signature over the RAW body is the auth (same posture as
// the Supabase send-sms Standard-Webhooks hook); there is no cookie session here.
// checkout.session.completed with our visa metadata records the payment and lets
// markVisaPaidAndHandoff finish the send_for_review handoff — so a paid case reaches
// the admin even when the applicant never returns from Stripe. Everything is
// idempotent with the confirm-on-return path; replays and unrelated events are
// acknowledged with 200 so Stripe stops retrying. Lives under /api/payments (not
// /api/webhooks, which is the partner webhook-endpoint CRUD namespace).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED. Four independent blockers; the first alone is disqualifying.
//
// 1. THE AUTH IS AN HMAC OVER THE RAW BODY BYTES, so the body may never be parsed for it.
//    verifyStripeSignature (src/lib/visa/payments.ts:382) computes
//    `createHmac('sha256', secret).update(`${t}.${rawBody}`)` against the exact string
//    `request.text()` returned. route()'s `body:` option consumes the stream with `req.json()`,
//    which both leaves the stream unreadable for `text()` and discards the byte sequence the MAC
//    covers — key order, whitespace and number formatting all of it. There is no schema this
//    route could hoist.
// 2. NO CALLER TO RESOLVE, AND A GUARD THAT MUST PRECEDE EVERYTHING. Stripe sends no cookie and
//    no bearer, so the mode would be 'public'; and the first line is a 503 `not_configured` when
//    `STRIPE_WEBHOOK_SECRET` is unset, which has to run before the signature check, not after an
//    auth step.
// 3. THE LIMITER WOULD BE WRONG HERE ANYWAY. Throttling a payment webhook by client IP would drop
//    capture notifications during a burst; Stripe's own retry is the backpressure, which is why
//    this route has no limiter to hoist.
// 4. THE ANSWERS ARE STRIPE'S PROTOCOL, NOT THIS API'S ERROR ENVELOPE. A handled event, a replay,
//    an unrelated type and a wrong-mode event all answer 200 `{"received":true}` — a domain
//    payload `apiFail()` cannot emit — because anything else makes Stripe retry forever; 400 stops
//    the retries (bad signature/payload) and 500 asks for one.
// So all four options are empty and the wrapper would be pure churn on a money path. Left alone.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const rawBody = await request.text()
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  if (!verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let event: { type?: string; livemode?: unknown; data?: { object?: Record<string, unknown> } }
  try { event = JSON.parse(rawBody) as typeof event } catch { return NextResponse.json({ error: 'invalid_payload' }, { status: 400 }) }
  if (event.type !== 'checkout.session.completed') return NextResponse.json({ received: true })
  // Mode pin: a test-mode event can never satisfy a live deployment (or vice versa).
  if (!stripeEventModeOk(event.livemode)) return NextResponse.json({ received: true })

  const session = event.data?.object || {}
  const metadata = (session.metadata || {}) as Record<string, string>
  const applicationId = metadata.application_id
  if (!applicationId || session.payment_status !== 'paid' || typeof session.id !== 'string') {
    return NextResponse.json({ received: true })
  }

  try {
    const result = await markVisaPaidAndHandoff({
      applicationId,
      provider: 'stripe',
      providerRef: session.id,
      amountCents: typeof session.amount_total === 'number' ? session.amount_total : 0,
      currency: typeof session.currency === 'string' ? session.currency.toUpperCase() : 'USD',
      actorRef: 'stripe-webhook',
    })
    // Non-retryable rejections (no checkout row for this ref, amount below the row's)
    // are acknowledged — retrying an invalid payment can never make it valid. They are
    // logged for the audit trail; genuine persistence failures THROW below instead.
    if (!result.ok) console.error('[payments/stripe/webhook] rejected', result.error, session.id)
  } catch (error) {
    // 500 → Stripe retries with backoff; the operation is idempotent so that's safe.
    console.error('[payments/stripe/webhook]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
