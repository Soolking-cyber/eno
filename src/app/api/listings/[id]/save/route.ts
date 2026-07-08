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
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ip = clientIp(req)

  const body = await req.json().catch(() => null)
  const saved = body?.saved
  if (typeof saved !== 'boolean') return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })

  // Generous cap (shared/CGNAT IPs are common in VN); over-limit just skips the count
  // move, never the device-local favorite itself. Fails open without UPSTASH_*.
  const { success } = await rateLimit('listing-save-ip', ip, 300, '1 h')
  if (!success) return NextResponse.json({ ok: true, counted: false })

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
