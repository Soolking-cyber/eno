import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import {
  DISPUTE_BODY_MAX, DISPUTE_IMAGES_MAX,
  addPartyStatementOnce, isEvidencePath, loadDisputeForParty, partyCanPost, partyHasSubmitted,
} from '@/lib/dispute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A party posts a statement (and/or evidence) into their case room. Gated on being
// a party, the case being open, and the evidence window not having expired — the
// window is what keeps cases decidable (Binance-style respondent discipline).
// Evidence images arrive as PRIVATE-bucket paths from /api/disputes/[id]/evidence,
// pinned to this case's folder so a message can never reference foreign files.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { report, role } = loaded

  if (!partyCanPost(report)) return NextResponse.json({ error: 'window_closed' }, { status: 409 })
  // One-shot: each side gets exactly ONE statement (text + photos). A cheap pre-check
  // rejects the common repeat; the atomic addPartyStatementOnce below is the real
  // guard against a concurrent double-submit.
  if (await partyHasSubmitted(report.id, meId)) return NextResponse.json({ error: 'already_submitted' }, { status: 409 })

  const rl = await rateLimit('dispute-message', meId, 30, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { body?: string; images?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const text = String(body.body || '').trim().slice(0, DISPUTE_BODY_MAX)
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((p): p is string => typeof p === 'string' && isEvidencePath(p, report.id))
    .slice(0, DISPUTE_IMAGES_MAX)
  if (!text && images.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 })

  // Atomic: an advisory lock serializes concurrent same-party posts so exactly one lands.
  const row = await addPartyStatementOnce(report, { senderProfileId: meId, senderRole: role, body: text, images })
  if (!row) return NextResponse.json({ error: 'already_submitted' }, { status: 409 })
  // A respondent's one statement clears the buyer-king SLA flag (the admin
  // "buyer-waiting" queue filters on sellerRespondedAt: null) so they leave that
  // queue. We set ONLY the timestamp, never sellerResponse — the statement lives as
  // the DisputeMessage (which the timeline + AI review already read); mirroring the
  // text would render it twice (legacy sellerResponse item + the real thread row).
  if (role === 'respondent' && !report.sellerRespondedAt) {
    await db.report.update({ where: { id: report.id }, data: { sellerRespondedAt: new Date() } }).catch((e) => logError(e, { op: 'dispute.markSellerResponded' }))
  }
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 })
}
