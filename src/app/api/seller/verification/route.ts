import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { VERIFICATION_CONSENT_VERSION } from '@/lib/business-verification'
import { loadOwnVerification, ownVerificationView, submitVerification } from '@/lib/core/business-verification-service'

// The applicant's own verification surface.
//   GET  → their current case status + which documents are present (no signed URLs — the
//          applicant sees only that a doc exists, never re-downloads it).
//   POST → submit the draft for review (freezes evidence + the identity hash; requires the
//          consent flag, logged for PDPL).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownSellerId(userId: string): Promise<string | null> {
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  return seller?.id ?? null
}

export async function GET() {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const sellerId = await ownSellerId(userId)
  if (!sellerId) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })
  const [caseRow, view] = await Promise.all([loadOwnVerification(sellerId), ownVerificationView(sellerId)])
  return NextResponse.json({
    // The LIVE badge state (verified/expired/pending/rejected/…) — NOT the raw case status,
    // so a badge dropped by an identity edit or expiry shows "re-verify", never stale "verified".
    view,
    case: caseRow
      ? {
        status: caseRow.status,
        // Kinds present, never the paths — the applicant never re-fetches their own docs.
        documentKinds: [...new Set(caseRow.documents.map((d) => d.kind))],
        submittedAt: caseRow.submittedAt,
        reviewedAt: caseRow.reviewedAt,
        note: caseRow.status === 'rejected' ? caseRow.note : null,
      }
      : null,
  })
}

export async function POST(request: Request) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const limit = await rateLimit('business-verif-submit', userId, 10, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const sellerId = await ownSellerId(userId)
  if (!sellerId) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  // Explicit consent to processing the sensitive documents (PDPL Decree 13/2023) — logged.
  let body: { consent?: unknown }
  try { body = (await request.json()) as { consent?: unknown } } catch { body = {} }
  if (body.consent !== true) return NextResponse.json({ error: 'consent_required' }, { status: 400 })

  const res = await submitVerification(sellerId, VERIFICATION_CONSENT_VERSION)
  if (!res.ok) {
    const status = res.error === 'duplicate_tax' ? 409 : res.error === 'no_seller' ? 403 : 400
    return NextResponse.json({ error: res.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
