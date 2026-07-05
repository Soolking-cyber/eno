import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { sendPushToProfile } from '@/lib/push'
import { STALE_DAYS } from '@/lib/stale'
import { runTrustMaintenance } from '@/lib/trust'
import { recomputeRankScoreAllActive } from '@/lib/ranking'
import { rollupListingDailyStats } from '@/lib/listing-analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// At most one reminder per recipient per ~day — skips anyone reminded within this
// window so a never-confirming seller gets one nudge/day, not a backlog, and a
// duplicate cron fire on the same day is idempotent.
const REMIND_EVERY_MS = 20 * 60 * 60 * 1000
const MAX_SELLERS = 1000 // safety cap per run
const CONCURRENCY = 20   // bounded fan-out so we don't serialize hundreds of pushes

function bearerOk(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Daily reminder job (Vercel Cron → see vercel.json). Guarded by CRON_SECRET:
// Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled invocations.
// For every seller with ≥1 stale LIVE listing who hasn't opted out, drops one
// in-app notification (type 'reminder' → deep-links to /dashboard) and sends a
// Web Push to their devices. One notification per seller per run (collapsed).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !bearerOk(req.headers.get('authorization'), secret)) {
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
    take: MAX_SELLERS * 50, // bounded scan; tally collapses to ≤ owners
  })

  // Tally stale count per owning profile.
  const countByOwner = new Map<string, number>()
  for (const l of staleListings) {
    const owner = l.seller.ownerId
    if (owner) countByOwner.set(owner, (countByOwner.get(owner) ?? 0) + 1)
  }
  if (countByOwner.size === 0) return NextResponse.json({ ok: true, notified: 0 })

  // Respect the opt-out AND skip anyone already reminded within the window
  // (cross-run dedupe → one nudge/day, idempotent on a duplicate cron fire).
  const since = new Date(Date.now() - REMIND_EVERY_MS)
  const ownerIds = [...countByOwner.keys()].slice(0, MAX_SELLERS)
  const [optedIn, recent] = await Promise.all([
    db.profile.findMany({ where: { id: { in: ownerIds }, dailyReminderOptIn: true }, select: { id: true } }),
    db.notification.findMany({ where: { recipientId: { in: ownerIds }, type: 'reminder', createdAt: { gt: since } }, select: { recipientId: true } }),
  ])
  const remindedRecently = new Set(recent.map((r) => r.recipientId))
  const targets = optedIn.filter((p) => !remindedRecently.has(p.id))

  let notified = 0
  let pushed = 0
  // Bounded-concurrency fan-out so a few thousand sellers don't serialize past
  // maxDuration; each owner's work (1 notif insert + push) runs independently.
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    const res = await Promise.all(
      batch.map(async (p) => {
        const n = countByOwner.get(p.id) ?? 0
        if (n === 0) return { notified: 0, pushed: 0 }
        const title = '⏰ ' + (n === 1 ? 'Confirm your listing is still available' : `Confirm ${n} listings are still available`)
        const body = 'Tap to refresh availability — fresh listings rise back to the top.'
        try {
          await db.notification.create({ data: { recipientId: p.id, type: 'reminder', title, body, actorName: null } })
          const sent = await sendPushToProfile(p.id, { title, body, url: '/dashboard', tag: 'eno-availability' })
          return { notified: 1, pushed: sent }
        } catch (e) {
          console.error('[cron] reminder failed for', p.id, e)
          return { notified: 0, pushed: 0 }
        }
      }),
    )
    for (const r of res) { notified += r.notified; pushed += r.pushed }
  }

  // Trust maintenance v2: recompute-all-active. NO calendar drift (the old +1/day
  // recovery and inactivity dock are gone) — the daily pass re-evaluates the
  // windowed/decayed composite so penalties fade on their half-lives, the 365d/90d
  // windows slide, and freshness stays honest. Bounded (count + soft deadline).
  let trust = { recomputed: 0, scanned: 0 }
  try { trust = await runTrustMaintenance() } catch (e) { console.error('[cron] trust maintenance', e) }

  // Re-decay the feed rankScore for every live listing — recency drops a little each day,
  // so without this sweep the blended order would freeze at post-time freshness.
  let reranked = 0
  try { reranked = await recomputeRankScoreAllActive() } catch (e) { console.error('[cron] rank re-decay', e) }

  // Snapshot per-listing cumulative views/leads for the day (partner analytics time series).
  let statRows = 0
  try { statRows = await rollupListingDailyStats() } catch (e) { console.error('[cron] daily stat rollup', e) }

  return NextResponse.json({ ok: true, sellersWithStale: countByOwner.size, skipped: optedIn.length - targets.length, notified, pushed, trust, reranked, statRows })
}
