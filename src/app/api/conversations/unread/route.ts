import { IS_MARKETPLACE } from '@/lib/edition'
import { deskSellerIds } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Total unread messages across the current user's conversations — drives the
// header/mobile-nav badge. Sums the denormalized per-side counters (no N+1).
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ unread: 0 })

  // ⚠️ BOTH aggregates, or the badge counts threads the inbox refuses to show — a permanent phantom
  // that somebody eventually "fixes" by un-hiding the thread.
  const hiddenSellerIds = IS_MARKETPLACE ? await deskSellerIds() : []
  const notDesk = hiddenSellerIds.length ? { sellerId: { notIn: hiddenSellerIds } } : {}
  const [asBuyer, asSeller] = await Promise.all([
    db.conversation.aggregate({ where: { buyerProfileId: meId, ...notDesk }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: meId, ...notDesk }, _sum: { sellerUnread: true } }),
  ])
  const unread = (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0)
  return NextResponse.json({ unread })
}
