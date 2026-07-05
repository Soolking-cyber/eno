import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/enforcement/respond — the reported seller replies to a report from their
// notice (buyer-king SLA: an unanswered report goes "buyer waiting" in the admin queue
// after 72h; this is how the seller answers). Participant-gated: only the report's
// target (the reported profile, or the owner of the reported storefront) may respond,
// and only ONCE — the response is their considered statement for the case file.
export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('enforcement-respond', meId, 10, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { reportId?: string; text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const reportId = String(body.reportId || '').trim()
  const text = String(body.text || '').trim().slice(0, 600)
  if (!reportId || text.length < 2) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, targetProfileId: true, targetSellerId: true },
  })
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Only the reported party: the target profile, or the owner of the target storefront.
  let allowed = report.targetProfileId === meId
  if (!allowed && report.targetSellerId) {
    const seller = await db.seller.findUnique({ where: { id: report.targetSellerId }, select: { ownerId: true } })
    allowed = seller?.ownerId === meId
  }
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Typed one-shot write (the Phase 2 columns are live) — the sellerRespondedAt:null
  // predicate keeps it one-shot AND race-safe (two tabs → exactly one lands).
  const n = await db.report.updateMany({
    where: { id: reportId, sellerRespondedAt: null },
    data: { sellerResponse: text, sellerRespondedAt: new Date() },
  })
  if (n.count === 0) return NextResponse.json({ error: 'already_responded' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
