import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { paypalCreateOrder, stripeCreateCheckout, visaPaymentsConfig } from '@/lib/visa/payments'
import type { VisaApplicationRow, VisaDocumentRow } from '@/lib/visa/records'
import { validateVisaForReview } from '@/lib/visa/schema'

// Start a service-fee checkout for a COMPLETE application. The declaration +
// prefill-authorization consents are required here (the same literals the submit
// route demands) and are stamped onto the payment row together with the payload
// snapshot hash — after the provider confirms payment, markVisaPaidAndHandoff
// re-checks that hash and completes the send_for_review handoff server-side.
// 503 while payments are dormant (no fee/provider env), so the client can fall
// back to the direct submit flow.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  provider: z.enum(['stripe', 'paypal']),
  declarationAccepted: z.literal(true),
  prefillAuthorized: z.literal(true),
})
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const config = visaPaymentsConfig()
  if (!config) return NextResponse.json({ error: 'payments_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-checkout', userId, 10, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  if (!config.providers.includes(parsed.data.provider)) return NextResponse.json({ error: 'provider_not_configured' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id),
  ])
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const app = application as VisaApplicationRow & { paid_at?: string | null }
  if (app.paid_at) return NextResponse.json({ error: 'already_paid' }, { status: 409 })
  if (!['draft', 'needs_changes'].includes(app.status)) return NextResponse.json({ error: 'invalid_status_transition' }, { status: 409 })

  // Never charge for an incomplete application — same validation + checklist
  // write-back the submit route performs, so the client jumps to the failing step.
  const payload = decryptVisaPayload(app.encrypted_payload)
  const issues = validateVisaForReview(payload, (documents || []) as VisaDocumentRow[])
  if (issues.length) {
    await db.from('visa_applications').update({ checklist: issues, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ error: 'application_incomplete', issues }, { status: 400 })
  }
  const snapshotHash = visaApplicantSnapshotHash(payload)

  try {
    const session = parsed.data.provider === 'stripe'
      ? await stripeCreateCheckout({ applicationId: id, userId, feeCents: config.feeCents })
      : await paypalCreateOrder({ applicationId: id, feeCents: config.feeCents })

    const { error } = await db.from('visa_payments').insert({
      application_id: id,
      user_id: userId,
      provider: parsed.data.provider,
      provider_ref: session.ref,
      amount_cents: config.feeCents,
      currency: config.currency,
      status: 'created',
      consent_snapshot_hash: snapshotHash,
      consent_at: new Date().toISOString(),
    })
    if (error) throw new Error(`visa_payment_insert_failed:${error.message}`)

    return NextResponse.json({ url: session.url, provider: parsed.data.provider })
  } catch (error) {
    console.error('[visa/checkout]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 })
  }
}
