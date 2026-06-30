import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Records a "Skip for now" on the daily availability review. Increments the consecutive
// skip counter; once it reaches 2, the next review hides the Skip option so the seller has
// to confirm. Confirming (POST /api/listings/availability) resets it to 0.
export async function POST() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const updated = await db.profile.update({
    where: { id: meId },
    data: { availabilitySkips: { increment: 1 } },
    select: { availabilitySkips: true },
  }).catch(() => null)
  return NextResponse.json({ ok: true, skips: updated?.availabilitySkips ?? 0 })
}
