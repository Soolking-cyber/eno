import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendPushToProfile } from '@/lib/push'
import { STALE_DAYS } from '@/lib/stale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily reminder job (Vercel Cron → see vercel.json). Guarded by CRON_SECRET:
// Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled invocations.
// For every seller with ≥1 stale LIVE listing who hasn't opted out, drops one
// in-app notification (type 'reminder' → deep-links to /dashboard) and sends a
// Web Push to their devices. One notification per seller per run (collapsed).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000)

  // Stale = verified + active, owned by a real account, not confirmed since cutoff.
  const staleListings = await db.listing.findMany({
    where: {
      verified: true,
      status: 'active',
      seller: { ownerId: { not: null } },
      OR: [{ availabilityConfirmedAt: { lt: cutoff } }, { availabilityConfirmedAt: null, postedAt: { lt: cutoff } }],
    },
    select: { seller: { select: { ownerId: true } } },
  })

  // Tally stale count per owning profile.
  const countByOwner = new Map<string, number>()
  for (const l of staleListings) {
    const owner = l.seller.ownerId
    if (owner) countByOwner.set(owner, (countByOwner.get(owner) ?? 0) + 1)
  }
  if (countByOwner.size === 0) return NextResponse.json({ ok: true, notified: 0 })

  // Respect the opt-out.
  const optedIn = await db.profile.findMany({
    where: { id: { in: [...countByOwner.keys()] }, dailyReminderOptIn: true },
    select: { id: true, displayName: true },
  })

  let notified = 0
  let pushed = 0
  for (const p of optedIn) {
    const n = countByOwner.get(p.id) ?? 0
    if (n === 0) continue
    const title = '⏰ ' + (n === 1 ? 'Confirm your listing is still available' : `Confirm ${n} listings are still available`)
    const body = 'Tap to refresh availability — fresh listings rise back to the top.'
    try {
      await db.notification.create({
        data: { recipientId: p.id, type: 'reminder', title, body, actorName: null },
      })
      notified++
      pushed += await sendPushToProfile(p.id, { title, body, url: '/dashboard', tag: 'eno-availability' })
    } catch (e) {
      console.error('[cron] reminder failed for', p.id, e)
    }
  }

  return NextResponse.json({ ok: true, sellersWithStale: countByOwner.size, notified, pushed })
}
