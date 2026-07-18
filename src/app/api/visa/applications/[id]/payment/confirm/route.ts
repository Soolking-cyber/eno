import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  if (!visaPaymentsConfig()) return NextResponse.json({ error: 'payments_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-pay-confirm', userId, 30, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Ownership first — a foreign application id must 404 before any provider call.
  const db = getVisaDb()
  const { data: owned } = await db.from('visa_applications').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    const state = parsed.data.provider === 'stripe'
      ? await stripeRetrieveSession(parsed.data.ref)
      : await paypalCaptureOrder(parsed.data.ref)
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
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
    return NextResponse.json({
      application: serializeVisa(result.application as VisaApplicationRow, result.documents as VisaDocumentRow[]),
      handedOff: result.handedOff,
    })
  } catch (error) {
    console.error('[visa/payment/confirm]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'confirm_failed' }, { status: 502 })
  }
}
