import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { confirmCore } from '@/lib/core/listings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Still available?" → confirm. Carousell-style BUMP: refreshes feed recency
// (postedAt) so the listing rises back up, marks it active, and stamps
// availabilityConfirmedAt. Owner-scoped. The bump is rate-limited (canBump) so a
// seller can't re-confirm daily to camp at the top — a confirm inside the cooldown
// still records availability (stops the reminder) but does NOT re-bump recency.
// auth → core → respond (the bump/confirm logic is shared with the future /api/v1).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  await confirmCore(id, auth.profileId)
  return NextResponse.json({ ok: true })
}
