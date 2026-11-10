import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { bodyTooLarge, readJsonCapped } from '@/lib/api/body'
import { bumpListingCounter, dropListingSave } from '@/lib/listing-counters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real "saved" (favorite) counter — the public, anonymous AGGREGATE only. A guest's saves live on the
// device and a signed-in person's on the account (SavedListing via /api/saved-listings, 2026-11-09), and
// neither list is written here, so this is intentionally NOT per-user: the client fires { saved: true } on save and
// { saved: false } on unsave, and we move the aggregate savedCount accordingly. The
// display reconciles the double-count (a device's own save shows via a session delta on
// top of the SSR base) so a saver never sees their own save twice — see favorites-context.
//
// Best-effort — always returns ok; `counted` says whether it moved the number. Coarse
// per-IP cap stops a script from inflating; a real user toggles a handful of hearts.
// Two exceptions, neither reachable by the real client (`{ saved }` is a dozen bytes): a bad body
// (400, below) and a body over 64 KB, a bare 413 `{"error":"payload_too_large"}` refused before it
// is parsed and before both limiters. favorites-context's keepalive beacon never reads the answer.
//
// ⚠️ WS6 — NOT MIGRATED. Four independent blockers; the first is the interesting one:
//   · THE LIMITER KEY IS COMPUTED FROM THE PARSED BODY. `listing-save` is keyed
//     `${ip}:${id}:${saved}` — it mixes the route param AND `body.saved`, so save and unsave get
//     their own 6h windows and a heart can be toggled back off. `rateLimit:` is static config
//     applied BEFORE the body is read, so the wrapper cannot see `saved` at the moment it keys.
//   · THERE ARE TWO LIMITERS, both of which must pass; `rateLimit:` takes one bucket.
//   · OVER-LIMIT IS A 200, not a 429: `{"ok":true,"counted":false}` is the ordinary answer for the
//     second toggle of the same heart. The wrapper would answer `{"error":"rate_limited"}` 429.
//   · THE ERROR ENVELOPE IS DIFFERENT. A bad body answers `{"ok":false,"error":"bad_request"}` —
//     it carries an `ok` key, so it is not the wrapper's bare `{error}` shape and `body:` /
//     `invalidBodyCode` cannot reproduce it byte-for-byte. (The one bare `{error}` here is the
//     oversized body's 413 `{"error":"payload_too_large"}`, the shape every capped route shares.)
// Auth stays 'public' by design: guests save too (on their device), so a guest MUST get a 200
// here — any authed mode would 401 the majority of callers.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ip = clientIp(req)

  // Capped (64 KB) before it is parsed: this runs before both limiters.
  let body: { saved?: unknown } | null = null
  try { body = await readJsonCapped<{ saved?: unknown } | null>(req) } catch (e) { const tooLarge = bodyTooLarge(e); if (tooLarge) return tooLarge }
  const saved = body?.saved
  if (typeof saved !== 'boolean') return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })

  // Generous coarse cap (shared/CGNAT IPs are common in VN) + per-(ip,listing,direction)
  // dedup (mirrors the view counter) so one device can't pump a single listing's count by
  // toggling; over-limit just skips the count move, never the device-local favorite
  // itself. Fails open on a limiter backend error.
  const [byPair, byIp] = await Promise.all([
    rateLimit('listing-save', `${ip}:${id}:${saved}`, 1, '6 h'), // 1 move / (ip,listing,direction) / 6h
    rateLimit('listing-save-ip', ip, 300, '1 h'),
  ])
  if (!byPair.success || !byIp.success) return NextResponse.json({ ok: true, counted: false })

  // Only move counts on live (public) listings.
  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, verified: true, status: true },
  })
  if (!listing || !listing.verified || listing.status !== 'active') {
    return NextResponse.json({ ok: true, counted: false })
  }

  // Both directions raw (listing-counters.ts): a save is not an edit, so it must not restamp
  // updatedAt (I3a); the unsave clamps at 0.
  // `counted` is the row count: 0 when the listing was deleted since the read above.
  const moved = await (saved ? bumpListingCounter(id, 'savedCount') : dropListingSave(id))
  return NextResponse.json({ ok: true, counted: moved > 0 })
}
