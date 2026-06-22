import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkListingOwner } from '@/lib/listing-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Still available?" → confirm. This is the Carousell-style BUMP: it refreshes
// the listing's feed recency (postedAt = now) so it rises back to the top, marks
// it active, and stamps availabilityConfirmedAt (so the daily reminder stops
// nagging about it). Owner-scoped.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  const now = new Date()
  await db.listing.update({
    where: { id },
    data: { status: 'active', availabilityConfirmedAt: now, postedAt: now },
  })
  return NextResponse.json({ ok: true })
}
