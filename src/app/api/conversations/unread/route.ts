import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Total unread messages across the current user's conversations — drives the
// header/mobile-nav badge. Sums the denormalized per-side counters (no N+1).
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ unread: 0 })

  const [asBuyer, asSeller] = await Promise.all([
    db.conversation.aggregate({ where: { buyerProfileId: profile.id }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: profile.id }, _sum: { sellerUnread: true } }),
  ])
  const unread = (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0)
  return NextResponse.json({ unread })
}
