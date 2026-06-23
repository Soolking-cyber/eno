import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { checkListingOwner } from '@/lib/listing-owner'
import { recordEngagement } from '@/lib/trust'
import { canBump } from '@/lib/stale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Still available?" → confirm. Carousell-style BUMP: refreshes feed recency
// (postedAt) so the listing rises back up, marks it active, and stamps
// availabilityConfirmedAt. Owner-scoped. The bump is rate-limited (canBump) so a
// seller can't re-confirm daily to camp at the top — a confirm inside the cooldown
// still records availability (stops the reminder) but does NOT re-bump recency.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  const now = new Date()
  const current = await db.listing.findUnique({ where: { id }, select: { postedAt: true } })
  const bump = current ? canBump(current.postedAt, now.getTime()) : true
  await db.listing.update({
    where: { id },
    data: { status: 'active', availabilityConfirmedAt: now, ...(bump ? { postedAt: now } : {}) },
  })
  revalidatePath(`/listings/${id}`)
  // Reward the day's activity (daily-capped) — keeping listings fresh earns trust.
  after(() => recordEngagement(auth.profileId).catch(() => {}))
  return NextResponse.json({ ok: true })
}
