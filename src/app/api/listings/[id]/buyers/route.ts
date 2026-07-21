import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The buyers who've messaged this seller — powers the native "Who did you sell to?"
// picker in the Mark-sold sheet. SELLER-scoped, not listing-scoped: threads are one-
// per-buyer-per-seller and get retargeted to the buyer's latest listing, so filtering
// by listingId would drop legitimate buyers who since asked about another item. Most
// recent conversation first (the buyer for this item is typically near the top).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  const convos = await db.conversation.findMany({
    where: { sellerId: auth.sellerId },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: {
      id: true,
      buyerProfileId: true,
      lastMessageAt: true,
      buyer: { select: { displayName: true, avatarUrl: true, avatarColor: true } },
    },
  })
  const buyers = convos.map((c) => ({
    conversationId: c.id,
    profileId: c.buyerProfileId,
    name: c.buyer?.displayName ?? null,
    avatarUrl: c.buyer?.avatarUrl ?? null,
    avatarColor: c.buyer?.avatarColor ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
  }))
  return NextResponse.json({ buyers })
}
