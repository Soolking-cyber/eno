import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { claimHandle } from '@/lib/handle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Claim / change a public @handle for the CALLER's own identity:
//   { handle, target: 'profile' }  → their user handle
//   { handle, target: 'seller' }   → their storefront's handle (must own one)
// Owner-scoped (no target id is ever accepted from the client). Strict limit —
// fail CLOSED: renames churn a public namespace, and a scripted claim/release
// loop could squat names; 6/h is plenty for a human.
export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('handle-claim', profile.id, 6, '1 h', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { handle?: string; target?: string } = {}
  try { body = await req.json() } catch {}
  const raw = String(body.handle || '')
  const target = body.target === 'seller' ? 'seller' : 'profile'

  let owner: { profileId: string } | { sellerId: string }
  if (target === 'seller') {
    const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
    if (!seller) return NextResponse.json({ error: 'no_shop' }, { status: 400 })
    owner = { sellerId: seller.id }
  } else {
    owner = { profileId: profile.id }
  }

  try {
    const handle = await claimHandle(owner, raw)
    return NextResponse.json({ handle })
  } catch (e) {
    const code = (e as Error).message
    if (code === 'taken') return NextResponse.json({ error: 'taken' }, { status: 409 })
    if (code === 'invalid' || code === 'reserved') return NextResponse.json({ error: code }, { status: 400 })
    console.error('[handle] claim failed', code)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
