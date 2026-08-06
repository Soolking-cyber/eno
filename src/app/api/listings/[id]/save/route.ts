import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real "saved" (favorite) counter. Favorites are anonymous + device-local (localStorage),
// so this is intentionally NOT per-user: the client fires { saved: true } on save and
// { saved: false } on unsave, and we move the aggregate savedCount accordingly. The
// display reconciles the double-count (a device's own save shows via a session delta on
// top of the SSR base) so a saver never sees their own save twice — see favorites-context.
//
// Best-effort — always returns ok; `counted` says whether it moved the number. Coarse
// per-IP cap stops a script from inflating; a real user toggles a handful of hearts.
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
//     `invalidBodyCode` cannot reproduce it byte-for-byte.
// Auth stays 'public' by design: favorites are anonymous and device-local (localStorage), so a
// guest MUST get a 200 here — any authed mode would 401 the majority of callers.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ip = clientIp(req)

  const body = await req.json().catch(() => null)
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

  if (saved) {
    await db.listing.update({ where: { id }, data: { savedCount: { increment: 1 } } })
  } else {
    // GREATEST clamps at 0 so a decrement can't underflow (a reseed/reset could otherwise
    // push a real save-count negative). Prisma has no atomic clamped-decrement, so raw.
    await db.$executeRaw`UPDATE "Listing" SET "savedCount" = GREATEST("savedCount" - 1, 0) WHERE "id" = ${id}`
  }
  return NextResponse.json({ ok: true, counted: true })
}
