import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  DISPUTE_BODY_MAX, DISPUTE_IMAGES_MAX,
  addDisputeMessage, isEvidencePath, loadDisputeForParty, partyCanPost,
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

  const rl = await rateLimit('dispute-message', meId, 30, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { body?: string; images?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const text = String(body.body || '').trim().slice(0, DISPUTE_BODY_MAX)
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((p): p is string => typeof p === 'string' && isEvidencePath(p, report.id))
    .slice(0, DISPUTE_IMAGES_MAX)
  if (!text && images.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 })

  const row = await addDisputeMessage(report, { senderProfileId: meId, senderRole: role, body: text, images })
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 })
}
