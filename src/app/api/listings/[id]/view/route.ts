import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { getCurrentProfileId } from '@/lib/admin'
import { bumpListingCounter } from '@/lib/listing-counters'
import { isBotRequest } from '@/lib/bot-ua'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best-effort, deduped listing-view counter. Fired once per device per ~6h from
// <TrackView> (a client localStorage guard is the primary dedup); the server adds a
// per-(IP, listing) sliding-window dedup as a backstop for cleared storage, plus a
// coarse per-IP cap so one client can't inflate many listings. Seller self-views are
// excluded. Never blocks the page — always returns ok, `counted` says whether it bumped.
//
// NOTE: dedup rides on the rate limiter (Postgres-backed). On a limiter backend error
// it fails OPEN, so the client localStorage guard is what keeps refreshes from
// over-counting there.
//
// ⚠️ WS6 — NOT MIGRATED: THE LIMITER HERE IS A DEDUP KEY, NOT A RATE LIMIT, and `rateLimit:` cannot
// express it. Three separate mismatches, any one of which is disqualifying:
//   · THE KEY. `listing-view` is keyed `${ip}:${id}` — the ROUTE PARAM is part of the key, which is
//     the entire point (1 count per device per listing per 6h). The wrapper's key is fixed at
//     `userId ?? clientIp(req)`, so every listing a device viewed would share one 6h window and only
//     the first view in the app would ever be counted.
//   · THERE ARE TWO. The per-(ip,listing) dedup and the coarse per-IP cap run in parallel and BOTH
//     must pass; `rateLimit:` takes one bucket.
//   · THE ANSWER IS NOT 429. Over-limit returns 200 `{"ok":true,"counted":false}` — a normal, very
//     common response that the client reads to decide nothing. The wrapper returns
//     `{"error":"rate_limited"}` 429, so migrating would turn the ordinary second page-view of a
//     listing into an error for <TrackView>.
// Auth is likewise not `auth: 'userId'`: this endpoint is PUBLIC and a guest must get a 200 and be
// counted. `getCurrentProfileId()` is called late and only to EXCLUDE a seller's self-view, so a
// null caller is the normal case — `auth: 'userId'` would 401 every guest, i.e. every real view.
// (It is already the cheap local-JWT call, so there is nothing to gain here anyway; never upgrade
// this hot counter to 'profile'.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  /**
   * ⛔ A CRAWLER IS NOT A VIEWER, AND THIS WAS THE ONE COUNTER STILL COUNTING THEM. Measured
   * 2026-10-02 on Cloudflare: `meta-externalagent` (Meta's AI crawler, from EWR) was 58% of all
   * visitor traffic and fired ~6.9k POSTs a day at this route, /api/site-stats and /api/csp-report —
   * it renders the listing page, so <TrackView>'s effect runs for it exactly as for a person. The
   * limiters below do not hold it either: they are per ADDRESS, and its crawl is spread thin. Measured
   * 2026-10-03 on this route's own dedup rows (rl_window 'listing-view', 06:00–16:17 UTC): 1,883 of
   * the 1,912 keys that landed on a live listing — 98.5% — came from Meta's 2a03:2880::/32, 130
   * addresses across 1,574 listings, ~15 per address, nowhere near the 200/h cap. 29 came from
   * anyone else. The footer counters had been guarded since 2026-09-17 (bot-ua.ts); `Listing.views`
   * — the number a seller actually reads — had not.
   * ⚠️ FIRST, before the limiter: rl_check INSERTs a row per call, so checking after it would still
   * write twice per crawl. And the same 200 `counted:false` a deduped human gets — never a 4xx.
   */
  if (isBotRequest(req)) return NextResponse.json({ ok: true, counted: false })

  const { id } = await params
  const ip = clientIp(req)

  // Shared limiter NAMES with the id in the KEY — one limiter per listing id would leak
  // a limiter instance per listing into the in-memory map.
  const [byPair, byIp] = await Promise.all([
    // ⛔ strict: FAIL CLOSED FOR THE WRITE, NEVER FOR THE PAGE. On a limiter backend
    // error the non-strict form returns success:true, so the dedup silently vanishes
    // and every refresh increments — the counter inflates precisely when the database
    // is already struggling. strict makes that error skip the increment instead.
    // ⚠️ THIS DOES NOT BLOCK ANYTHING. Both branches below already answer
    // 200 {"ok":true,"counted":false}; the visitor still gets the listing, they just
    // do not get counted. An undercounted view is a rounding error, an overcounted one
    // is a number a seller makes decisions on.
    rateLimit('listing-view', `${ip}:${id}`, 1, '6 h', { strict: true }), // 1 count / (ip,listing) / 6h
    rateLimit('listing-view-ip', ip, 200, '1 h', { strict: true }),       // coarse anti-inflation per IP
  ])
  if (!byPair.success || !byIp.success) return NextResponse.json({ ok: true, counted: false })

  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, verified: true, status: true, seller: { select: { ownerId: true } } },
  })
  // Only count views on live (public) listings — never pending/hidden/sold.
  if (!listing || !listing.verified || listing.status !== 'active') {
    return NextResponse.json({ ok: true, counted: false })
  }

  // Don't let a seller inflate their own listing's view count.
  const profileId = await getCurrentProfileId()
  if (profileId && listing.seller.ownerId === profileId) {
    return NextResponse.json({ ok: true, counted: false })
  }

  // Raw, not db.listing.update: a view is not an edit, so it must not restamp updatedAt (I3a).
  // `counted` is the row count: a listing deleted since the read above updates 0 rows (the Prisma
  // update threw P2025 there), and that view was not counted.
  const moved = await bumpListingCounter(id, 'views')
  return NextResponse.json({ ok: true, counted: moved > 0 })
}
