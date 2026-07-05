import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { FLAG_REASONS } from '@/lib/enforcement'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/enforcement/appeal — the ONE-SHOT appeal against the caller's ACTIVE
// enforcement action (DSA due process: every action is appealable, once). Owner-gated:
// the appeal attaches only to the authenticated profile's own action — no ids are
// accepted from the client. Surfaces in GET /api/admin/enforcement (pending appeals).
export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('enforcement-appeal', meId, 5, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const text = String(body.text || '').trim().slice(0, 2000)
  if (text.length < 5) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  // Silent review flags EXCLUDED (Phase 3): a flag row is invisible to the seller,
  // so it can be neither the target of their appeal nor allowed to shadow the real
  // action they're appealing against.
  const action = await db.enforcementAction.findFirst({
    where: { profileId: meId, status: 'active', reason: { notIn: [...FLAG_REASONS] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, appealedAt: true },
  })
  if (!action) return NextResponse.json({ error: 'no_active_action' }, { status: 404 })
  // One-shot: a second submission while (or after) the first is pending is refused —
  // the appeal is the seller's single considered statement, not a chat channel.
  if (action.appealedAt) return NextResponse.json({ error: 'already_appealed' }, { status: 409 })
  await db.enforcementAction.update({ where: { id: action.id }, data: { appealText: text, appealedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
