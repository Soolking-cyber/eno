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
