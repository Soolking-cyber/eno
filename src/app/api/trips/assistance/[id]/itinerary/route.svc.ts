import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { viewTripRequest } from '@/lib/trips/request-view'

/**
 * The itinerary behind a booking request — read by the request card in the thread.
 *
 * ⚠️ SEPARATE FROM THE CASE ROUTE ONE LEVEL UP, for the reason request-view.ts gives: the quote
 * card re-reads its case on every render and must not drag a day-by-day itinerary with it.
 *
 * ⚠️ AUTHORISATION LIVES IN THE DOMAIN, NOT HERE. viewTripRequest resolves the session itself and
 * collapses missing-vs-forbidden into one answer; a second check in this route would be a second
 * thing to drift, and the one in the domain is the one guarding the read. Same division the
 * sibling route documents.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  /**
   * ⛔ KEYED ON THE CALLER, NEVER ON THE CASE ID. The first cut used the request id as the key,
   * which turns a rate limit into a weapon: the id is visible to anyone in the thread, and 120
   * GETs would then make the card read "could not be loaded" for BOTH the traveller and the desk
   * for an hour — a booking request nobody can see, which is precisely the bug this whole feature
   * exists to fix. Reviewer-caught. A per-caller bucket means a flooder can only exhaust their own.
   *
   * ⚠️ Keyed by IP because it runs BEFORE the session is resolved; the domain call below does its
   * own authorisation, so this is only the anonymous-flood ceiling in front of it.
   */
  const limited = await rateLimit('trip-request-view', clientIp(req), 240, '1 h')
  if (!limited.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const result = await viewTripRequest({ requestId: id })
  if (!result.ok) {
    // 401 only for "no session at all"; everything else is one indistinguishable 403 — see the
    // oracle note in request-view.ts before splitting these.
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_signed_in' ? 401 : 403 })
  }
  return NextResponse.json(result.data)
}
