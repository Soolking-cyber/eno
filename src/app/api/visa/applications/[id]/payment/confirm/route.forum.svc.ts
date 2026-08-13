import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { markVisaPaidAndHandoff, paypalCaptureOrder, stripeRetrieveSession, visaPaymentsConfig } from '@/lib/visa/payments'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'

// Verify-on-return: the applicant lands back on /dashboard/visa with the provider's
// reference and the client posts it here. The PROVIDER is the source of truth —
// Stripe sessions are re-read, PayPal orders are captured (both server-side) — and
// only a provider-confirmed payment reaches markVisaPaidAndHandoff. Idempotent with
// the Stripe webhook: whichever lands first wins, the other records nothing new.
// This path also makes local/dev and PayPal work with no webhook configured.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  provider: z.enum(['stripe', 'paypal']),
  ref: z.string().trim().min(4).max(200),
})
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ⚠️ WS6 MIGRATION (.svc surface), AUTH ONLY — same shape and same blockers as the checkout route
// this one completes.
//
// `auth: 'userId'` is byte-identical: the preamble WAS getCurrentProfileId() answering 401
// `auth_required`. Nothing else moves; the ownership + local-payment-row proof that must precede
// any provider call (review #5) keeps its exact position.
//
// ⚠️ THE LIMITER CANNOT HOIST: two env-only 503 guards run in front of it — visaCryptoReady()
// (`VISA_DATA_ENCRYPTION_KEY`) and visaPaymentsConfig() — and route()'s order is fixed at
// auth → rateLimit → body. Both are process-CONSTANT, and payments are DORMANT until the fee and
// provider keys land, so on today's deployments every call answers 503 `payments_not_configured`
// without spending a token; with the limiter in front, the 31st call in an hour would answer 429
// `rate_limited` instead. ⚠️ AND THE BODY FOLLOWS THE LIMITER, so `body:` would likewise turn a
// throttled malformed request from 429 into 400 `invalid_request`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL, AND IT IS THE ACCEPTED ONE. The ownership + payment-row
// reads sit OUTSIDE the try/catch (which starts at the provider call), so any unhandled throw in
// that region used to reach Next's default 500 page; route() now catches it, logs it with an `op`
// and answers `{"error":"internal_error"}` 500. Stated as a shape, not an inventory.
//
// Every deliberate branch is unchanged: 401 `auth_required` · 503 `visa_encryption_not_configured`
// · 503 `payments_not_configured` · 429 `rate_limited` · 400 `invalid_request` · 404 `not_found`
// (non-uuid id, or a case that is not the caller's) · 400 `reference_mismatch` (no local checkout
// row for this provider+ref, or the provider's own applicationId disagreeing) · 402 `not_paid` ·
// markVisaPaidAndHandoff's own code at 404/400 · 502 `confirm_failed` · 200
// `{application, handedOff}`.
export const POST = route({ auth: 'userId' }, async ({ req: request, params, userId }) => {
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  if (!visaPaymentsConfig()) return NextResponse.json({ error: 'payments_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-pay-confirm', userId, 30, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Ownership + local checkout row FIRST — before any provider call (review #5: a
  // leaked foreign PayPal order id must never even reach capture). The row proves OUR
  // checkout minted this exact (provider, ref) for THIS application and THIS user.
  const db = getVisaDb()
  const [{ data: owned }, { data: paymentRow }] = await Promise.all([
    db.from('visa_applications').select('id').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_payments').select('application_id, user_id').eq('provider', parsed.data.provider).eq('provider_ref', parsed.data.ref).maybeSingle(),
  ])
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = paymentRow as { application_id?: string; user_id?: string } | null
  if (!row || row.application_id !== id || row.user_id !== userId) {
    return NextResponse.json({ error: 'reference_mismatch' }, { status: 400 })
  }

  try {
    const state = parsed.data.provider === 'stripe'
      ? await stripeRetrieveSession(parsed.data.ref)
      : await paypalCaptureOrder(parsed.data.ref, id)
    // The provider reference must belong to THIS application (metadata/custom_id was
    // set at checkout) — a mismatched ref is an attack or a stale link, never a pay.
    if (state.applicationId !== id) return NextResponse.json({ error: 'reference_mismatch' }, { status: 400 })
    if (!state.paid) return NextResponse.json({ error: 'not_paid' }, { status: 402 })

    const result = await markVisaPaidAndHandoff({
      applicationId: id,
      provider: parsed.data.provider,
      providerRef: state.id,
      amountCents: state.amountCents,
      currency: state.currency,
      actorRef: userId,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 400 })
    }
    return NextResponse.json({
      application: serializeVisa(result.application as VisaApplicationRow, result.documents as VisaDocumentRow[]),
      handedOff: result.handedOff,
    })
  } catch (error) {
    console.error('[visa/payment/confirm]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'confirm_failed' }, { status: 502 })
  }
})
