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
//
// ⚠️ WS6 — NOT MIGRATED, and the reason is a measured regression rather than a preference.
// All four route() options would be empty here (public / no limiter / no schema), which is the
// pure-churn shape the migration declines — but `auth:` is worse than empty, it is a DOUBLE
// RESOLVE. checkListingOwner (src/lib/listing-owner.ts:15) opens with getCurrentProfile(), and
// neither it, getCurrentProfile nor createSupabaseServer is wrapped in React cache() (verified
// 2026-08-06 — no `cache(` in any of the three), so `auth: 'profile'` would run getUser() over
// the network TWICE and read the Profile row twice on every open of the Mark-sold sheet, purely
// to satisfy the wrapper. `auth: 'public'` with the helper left in place buys nothing at all.
//
// Branches, all unchanged: guest → 401 auth_required · no storefront → 403 no_storefront ·
// unknown listing → 404 not_found · someone else's listing → 403 forbidden · success → 200
// {"buyers":[…]}. Revisit if checkListingOwner ever grows a variant taking an already-resolved
// caller — at that point auth becomes a real option and this is a one-line migration.
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
