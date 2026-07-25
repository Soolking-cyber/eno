import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { requestAssistance } from '@/lib/trips/assistance'
import { bindTripThread } from '@/lib/trips/dm-thread'
import { assistanceHttpStatus } from '@/lib/trips/http'

/**
 * Open a trip-assistance case and put it in a thread with the desk.
 *
 * ⚠️ THE BODY NAMES AN ITINERARY AND NOTHING ELSE. .strict() so an extra key is a 400 rather than
 * a silently ignored field — the shape a caller might try is `{ itineraryId, feeVnd }`, and it
 * must fail loudly rather than look accepted. Ownership of that itinerary is proven inside
 * requestAssistance against the session, never here.
 */
const bodySchema = z.object({ itineraryId: z.string().min(1).max(64) }).strict()

export async function POST(req: Request) {
  // Identity first, so an unauthenticated caller cannot even consume rate-limit budget keyed to
  // somebody else's address.
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  // Fails OPEN by default (see ratelimit.ts): this is an ordinary write, not a billing or PII
  // vector, so a limiter outage must not block a traveller asking for help.
  const limit = await rateLimit('trip-assist-create', profile.id, 10, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const result = await requestAssistance({ itineraryId: parsed.data.itineraryId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: assistanceHttpStatus(result.error) })

  // Bind a thread so the traveller has somewhere to be sent. A binding failure is NOT fatal: the
  // case exists and an operator can still work it, so the client gets the case back with a null
  // thread rather than an error that would make the traveller retry a request already recorded.
  // This is also the path that reports the feature dormant — with no anchor listing seeded,
  // bindTripThread answers 'listing_unavailable' and conversationId stays null.
  const bound = await bindTripThread({ requestId: result.requestId, buyerProfileId: profile.id })
  return NextResponse.json({
    requestId: result.requestId,
    conversationId: bound.ok ? bound.conversationId : null,
    threadError: bound.ok ? null : bound.error,
  })
}
