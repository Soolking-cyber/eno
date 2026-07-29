import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { rateLimit } from '@/lib/ratelimit'
import { requestAssistance } from '@/lib/trips/assistance'
import { bindTripThread, getTripAssistanceListingId, getTripDesk } from '@/lib/trips/dm-thread'

/**
 * REQUEST A PERSON, on a trip thread.
 *
 * ⚠️ THE CHIP IS ALWAYS AVAILABLE, AND THAT IS THE WHOLE DESIGN (owner, 2026-07-29). The obvious
 * implementation — only offer it once an itinerary exists, because requestAssistance needs an
 * itineraryId — hides the "get a human" button exactly when a lost traveller most wants it, and
 * repeats the mistake already recorded for the trip launcher: an entry point must not disappear
 * because of what does or does not exist yet.
 *
 * So this route always succeeds in the way that matters, and does the strongest thing available:
 *   · a saved trip → a real TripAssistanceRequest, which reaches the operator queue and can be
 *     quoted, and the thread gets the case's own cards;
 *   · no trip yet → no case is invented, but a `trip_help` message is posted so the desk sees the
 *     ask in the thread and can simply reply.
 * Either way a `trip_help` message lands, because that message IS the "a person was asked for"
 * state — src/lib/trips/concierge.ts reads it to stop the bot answering over a human.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ conversationId: z.string().min(1).max(64) }).strict()

export async function POST(request: Request) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  // Fails OPEN (the requestAssistance precedent): asking for a human is an ordinary write, not a
  // billing or PII vector, so a limiter outage must not stand between a traveller and a person.
  const limit = await rateLimit('trip-dm-help', `${userId}:${parsed.data.conversationId}`, 6, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  // OWNERSHIP, exactly as the concierge does it — one query, no branch that could write into
  // somebody else's thread.
  const convo = await db.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (convo.buyerProfileId !== userId) return NextResponse.json({ error: 'thread_conflict' }, { status: 409 })

  const desk = await getTripDesk()
  if (!desk?.ownerId || desk.ownerId !== convo.sellerProfileId) {
    return NextResponse.json({ error: 'shop_unavailable' }, { status: 503 })
  }

  // ⚠️ THE ANCHOR LISTING, NOT JUST THE SELLER. `Seller.ownerId` is @unique, so the e-Visa desk and
  // the trip desk are ONE storefront with one sellerProfileId — a visa thread passes the check
  // above unchanged, and without this an applicant could post a trip-assistance request into their
  // government-form thread and silence that desk's own assistant. The listingId is the only thing
  // telling the two desks apart. Caught by codex on review.
  const anchorListingId = await getTripAssistanceListingId()
  if (!anchorListingId) return NextResponse.json({ error: 'shop_unavailable' }, { status: 503 })
  if (convo.listingId !== anchorListingId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ⚠️ IDEMPOTENT ON THE MESSAGE ONLY — NOT AN EARLY RETURN. Tapping twice must not stack two
  // identical asks in the thread, but returning here also meant that if the message had landed and
  // the CASE had failed transiently, no later tap would ever retry the case: the traveller would
  // be permanently marked as having asked for a person, with nothing in the operator queue.
  // Caught by codex. The message is skipped, the case is still attempted.
  const alreadyRequested = !!(await db.message.findFirst({
    where: { conversationId: convo.id, kind: 'trip_help' },
    select: { id: true },
  }))

  // The newest trip they own — the one they are almost certainly asking about. `requestAssistance`
  // re-proves ownership itself, so passing an id here grants nothing.
  const itinerary = await db.itinerary.findFirst({
    where: { profileId: userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })

  // ⚠️ THE MESSAGE GOES FIRST, AND THE ORDER IS THE SAFETY PROPERTY. The `trip_help` message IS
  // the "a person was asked for" state that silences the concierge, so if the case were opened
  // first and this write then failed, the thread would hold an open assistance case with a bot
  // still cheerfully answering over the operator. Reversed, the worst case is a message with no
  // formal case — the desk still sees the ask, still replies, and the bot is already quiet.
  // Raised by a reviewer as a desynchronisation; the fix is ordering, not a transaction.
  //
  // Bilingual in one string because this is a STORED message, not rendered copy — nothing
  // translates it at read time.
  if (!alreadyRequested) {
    try {
      await insertMessage(
        convo,
        userId,
        'I would like a person to help with my trip. / Tôi muốn nhân viên hỗ trợ chuyến đi của mình.',
        { kind: 'trip_help' },
      )
    } catch (e) {
      console.error('[trip-help] message not posted', e)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  }

  // BEST EFFORT, AND DELIBERATELY NOT FATAL. If the case cannot be opened — no trip yet, or the
  // assistance flow is degraded — the traveller has still reached a person, because the message
  // above is already in the desk's thread. Turning "we could not open a formal case" into a failed
  // request would be the product refusing to fetch a human on a technicality.
  let caseOpened = false
  if (itinerary) {
    try {
      const opened = await requestAssistance({ itineraryId: itinerary.id })
      caseOpened = opened.ok
      // ⚠️ requestAssistance DOES NOT BIND THE THREAD — the assistance route calls bindTripThread
      // separately, and omitting it here left the case with a null conversationId, so the
      // concierge's grounding lookup (which finds the case BY conversationId) could never see it
      // and the operator queue could not open the thread. Caught by agy on review; verified
      // against src/lib/trips/assistance.ts, which never writes that column.
      if (opened.ok) {
        const bound = await bindTripThread({ requestId: opened.requestId, buyerProfileId: userId })
        // Not fatal either: 'listing_unavailable' just means the anchor listing is not seeded, and
        // the ask has already landed in the thread regardless.
        if (!bound.ok) console.error('[trip-help] case not bound to thread', bound.error)
      }
    } catch (e) {
      console.error('[trip-help] case not opened', e instanceof Error ? e.name : 'Error')
    }
  }

  return NextResponse.json({ ok: true, caseOpened, alreadyRequested })
}
