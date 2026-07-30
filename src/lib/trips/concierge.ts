import 'server-only'
import { db } from '@/lib/db'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { insertMessage } from '@/lib/messages'
import { getTripAssistanceListingId, getTripDesk } from '@/lib/trips/dm-thread'

/**
 * ENO CONCIERGE FOR TRIP THREADS — the trips half of the pair the visa desk already has
 * (src/lib/visa/concierge.ts), built to the same shape on purpose: a thin route that only
 * authenticates and throttles, with ownership, the mode gate, the grounding, the model call and
 * the two message writes all living here where they are unit-tested.
 *
 * ⚠️ WHY THIS IS NOT THE AI SHOPPING CONCIERGE. That one (/messages/ai) answers about LISTINGS and
 * knows nothing about a trip. Sending a traveller there would have taken them out of the thread
 * their itinerary lives in, to an assistant that cannot see it. This one is grounded in exactly one
 * trip and says so when it does not know.
 */

export const TRIP_CONCIERGE_LABEL = '✨ Eno concierge'
export const TRIP_CONCIERGE_QUESTION_MAX = 500

export type TripConciergeErrorCode =
  | 'question_required'
  | 'not_found'
  | 'thread_conflict'
  | 'shop_unavailable'
  | 'human_help_pending'
  | 'concierge_unavailable'
  | 'internal_error'

export type TripConciergeResult =
  | { ok: true; messageId: string }
  | { ok: false; error: TripConciergeErrorCode; status: number; questionPosted?: boolean }

const fail = (
  error: TripConciergeErrorCode,
  status: number,
  extra?: { questionPosted?: boolean },
): TripConciergeResult => ({ ok: false, error, status, ...extra })

/**
 * ⚠️ THE MODEL NEVER SEES A NUMBER THAT COULD IDENTIFY ANYONE. A trip thread carries far less PII
 * than a visa case, but travellers paste passport numbers, phone numbers and booking references
 * into chat anyway — usually while asking whether they need to. Long digit runs, emails and
 * anything shaped like a phone number are replaced before the question leaves our server.
 *
 * The traveller's OWN message keeps the original text: it is their thread and the desk should see
 * what they actually asked. The scrubbed copy exists only for the model.
 */
export function scrubTripConciergeQuestion(raw: string): string {
  return raw
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .replace(/\b[A-Z0-9]{6,}\b/g, '[ref]')
    .slice(0, TRIP_CONCIERGE_QUESTION_MAX)
}

export type TripConciergeGrounding = {
  hasTrip: boolean
  title: string | null
  days: number | null
  destination: string | null
  status: string | null
  stops: string[]
  caseStatus: string | null
}

/**
 * What the assistant is allowed to know. Deliberately small and entirely derived from rows the
 * traveller owns — there is no free-text passthrough from anywhere else in the app.
 */
export function tripConciergePrompt(
  grounding: TripConciergeGrounding,
  question: string,
  language: 'en' | 'vi',
): string {
  const facts = grounding.hasTrip
    ? [
        `Trip title: ${grounding.title ?? 'untitled'}`,
        grounding.destination ? `Destination: ${grounding.destination}` : null,
        grounding.days ? `Length: ${grounding.days} days` : null,
        grounding.stops.length ? `Stops in order: ${grounding.stops.join(' → ')}` : null,
        grounding.status ? `Itinerary status: ${grounding.status}` : null,
        grounding.caseStatus ? `Assistance case status: ${grounding.caseStatus}` : null,
      ].filter(Boolean).join('\n')
    : 'The traveller has not built or saved a trip yet.'

  return [
    'You are Eno concierge, the trip-planning assistant on eno.vn, a Vietnam marketplace.',
    'Answer ONLY from the facts below plus general, widely-known travel knowledge about Vietnam.',
    '',
    'RULES, and they are absolute:',
    '- NEVER invent a price, a fee, an opening time, a visa rule or a booking detail. If the facts',
    '  below do not settle it, say you do not know and suggest asking a person.',
    '- NEVER claim to have booked, paid for, changed or cancelled anything. You cannot act.',
    '- You are not a visa adviser. If asked about e-Visa eligibility, fees or documents, say the',
    '  e-Visa desk handles that and it is a separate conversation.',
    '- Keep it under 120 words. Be concrete and practical, not brochure copy.',
    language === 'vi'
      ? '- Answer in Vietnamese.'
      : '- Answer in English.',
    '',
    'FACTS ABOUT THIS TRAVELLER\'S TRIP:',
    facts,
    '',
    'QUESTION:',
    question,
  ].join('\n')
}

async function generateTripConciergeAnswer(prompt: string): Promise<string | null> {
  const ai = getGemini()
  if (!ai) return null
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 600,
        httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } },
      },
    })
    const text = (res.text || '').trim()
    return text || null
  } catch (e) {
    // Class of failure only — never the prompt, which contains the traveller's question.
    console.error('[trip-concierge] generate failed', e instanceof Error ? e.name : 'Error')
    return null
  }
}

/**
 * ⚠️ HAS A PERSON BEEN ASKED FOR? DERIVED FROM THE TIMELINE, NEVER A COLUMN.
 *
 * A `trip_help` message is written by /api/trips/help. Once one exists, the concierge stops
 * answering in this thread — the owner's rule for the visa desk, applied here for the same reason:
 * a traveller who has just asked for a human should not be answered by a bot instead.
 *
 * The desk replying does NOT re-arm it. Coming back to the assistant is a deliberate act (tap the
 * chip again), not something that happens because an operator said "one moment".
 */
export async function tripHumanRequested(conversationId: string): Promise<boolean> {
  const newest = await db.message.findFirst({
    where: { conversationId, kind: { in: ['trip_help', 'trip_ai'] } },
    // id as the tiebreak: two markers written in the same millisecond must resolve
    // deterministically, the same rule getVisaThreadMode applies to its events.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { kind: true },
  })
  return newest?.kind === 'trip_help'
}

export async function askTripConcierge(input: {
  conversationId: string
  userId: string
  question: string
  language: 'en' | 'vi'
}): Promise<TripConciergeResult> {
  const question = (input.question || '').trim().slice(0, TRIP_CONCIERGE_QUESTION_MAX)
  if (!question) return fail('question_required', 400)

  // OWNERSHIP: the thread must be this traveller's. Selecting by id and comparing is one query and
  // leaves no branch that could answer inside somebody else's conversation.
  const convo = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true },
  })
  if (!convo) return fail('not_found', 404)
  if (convo.buyerProfileId !== input.userId) return fail('thread_conflict', 409)

  // The seat that will speak must really BE the trip desk. The answer is authored as the
  // conversation's seller, so a thread whose seller is anyone else would put an eno-branded
  // message in a stranger's mouth — the check resendVisaDmCard makes, for the same reason.
  const desk = await getTripDesk()
  if (!desk?.ownerId || desk.ownerId !== convo.sellerProfileId) return fail('shop_unavailable', 503)

  // ⚠️ THE SELLER CHECK ALONE IS NOT ENOUGH, AND THAT IS THE WHOLE POINT OF THE ANCHOR LISTING.
  // `Seller.ownerId` is @unique, so the e-Visa desk and the trip desk are THE SAME STOREFRONT and
  // the same sellerProfileId — a visa thread passes the test above unchanged. Without this second
  // predicate a traveller could point /api/trips/concierge at their own VISA conversation and get
  // a trip assistant answering, as the desk, inside a government-form thread. The listingId is the
  // only thing that distinguishes the two desks, which is why the shared-desk rule is "gate on the
  // ANCHOR listingId, one predicate everywhere". Caught by codex on review.
  const anchorListingId = await getTripAssistanceListingId()
  if (!anchorListingId) return fail('shop_unavailable', 503)
  if (convo.listingId !== anchorListingId) return fail('not_found', 404)

  // ── THE GATE, BEFORE ANY WRITE AND BEFORE ANY AI SPEND ────────────────────────────
  if (await tripHumanRequested(convo.id)) return fail('human_help_pending', 409)

  // GROUNDING. The case bound to this thread if there is one, else the traveller's newest trip —
  // a traveller who has planned something and then opened the desk thread is asking about it.
  // ⚠️ BOUND TO THIS THREAD *OR* SIMPLY THEIRS. Keying only on conversationId looked tighter and
  // was wrong: `requestAssistance` does not write that column — the binding is a separate step —
  // so a case can legitimately exist with conversationId still null (the anchor listing not being
  // seeded is enough), and the assistant would then answer with no idea a human was already
  // working the case. profileId is what makes the fallback safe: it is scoped to the traveller
  // either way, so the widening cannot reach anyone else's case.
  const kase = await db.tripAssistanceRequest.findFirst({
    where: { profileId: input.userId, OR: [{ conversationId: convo.id }, { conversationId: null }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true, itineraryId: true },
  })
  const itinerary = await db.itinerary.findFirst({
    where: kase ? { id: kase.itineraryId, profileId: input.userId } : { profileId: input.userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      title: true, days: true, destinationId: true, status: true,
      dayPlans: { select: { area: true }, orderBy: { dayNumber: 'asc' }, take: 30 },
    },
  })

  const grounding: TripConciergeGrounding = {
    hasTrip: !!itinerary,
    title: itinerary?.title ?? null,
    days: itinerary?.days ?? null,
    destination: itinerary?.destinationId ?? null,
    status: itinerary?.status ?? null,
    // De-duplicated in order: a 5-day Hanoi stay is "Hanoi", not "Hanoi → Hanoi → Hanoi".
    stops: [...new Set((itinerary?.dayPlans ?? []).map((d) => d.area).filter((a): a is string => !!a))],
    caseStatus: kase?.status ?? null,
  }

  // The traveller's own words, in their own thread, stored verbatim.
  await insertMessage(convo, input.userId, question)

  const answer = await generateTripConciergeAnswer(
    tripConciergePrompt(grounding, scrubTripConciergeQuestion(question), input.language),
  )
  // FAIL CLOSED — no canned reply, no guess about somebody's trip.
  if (!answer) return fail('concierge_unavailable', 503, { questionPosted: true })

  // ── THE GATE, AGAIN ───────────────────────────────────────────────────────────────
  // ⚠️ RE-READ AFTER THE MODEL CALL. The chips have independent busy flags, so the traveller can
  // ask a question and tap "Request a person" while the model is still thinking. Without this the
  // bot's answer lands in a thread where a human was already asked for. The QUESTION stays — it is
  // theirs and the desk should see it; only the reply is dropped.
  //
  // ⚠️ THIS NARROWS THE RACE, IT DOES NOT CLOSE IT, and the file should not pretend otherwise. A
  // /help write that lands between this read and the insert below still gets a bot answer after
  // it. Closing it properly needs the check and the insert in one transaction, which insertMessage
  // is not built for. The residual window is milliseconds against a multi-second model call, and
  // the worst outcome is one assistant message arriving just after a human was asked for — the
  // desk sees both and answers anyway. Accepted, and stated plainly because a reviewer was right
  // that the earlier wording implied the race was handled.
  if (await tripHumanRequested(convo.id)) return fail('human_help_pending', 409, { questionPosted: true })

  try {
    const posted = await insertMessage(convo, desk.ownerId, `${TRIP_CONCIERGE_LABEL}\n${answer}`)
    return { ok: true, messageId: posted.id }
  } catch (e) {
    console.error('[trip-concierge] answer not posted', e)
    return fail('internal_error', 500, { questionPosted: true })
  }
}
