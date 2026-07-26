import 'server-only'
import { db } from '../db'
import { getCurrentProfile } from '../admin'
import { insertMessage, parseMessageMeta, type TripStepMeta } from '../messages'
import { getTripDesk } from './dm-thread'
import {
  LAST_TRIP_WIZARD_STEP, TRIP_WIZARD_STEPS, tripWizardStepSchema,
  type TripWizardStep,
} from './itinerary-wizard'

/**
 * Driving the in-chat itinerary wizard.
 *
 * ⚠️ ONE LIVE CARD PER THREAD, UPDATED IN PLACE — not one card per step. Five inserts would mean
 * five rewrites of Conversation.lastMessageText and five increments of the traveller's OWN unread
 * counter, in the thread they are actively looking at, plus a timeline of five near-identical
 * bubbles they have to scroll past to reach the live one. The visa desk hit the same shape and
 * reuses its newest active card for the same reason. So `advance` moves the existing card's step;
 * only `start` ever inserts.
 *
 * ⚠️ THE STEP IS DERIVED, NEVER TRUSTED FROM A BODY. The live step is read off the newest
 * trip_step card in the thread; the caller's `step` is only a claim about what they are answering,
 * and it must match the card or the request is refused. That makes a replayed or reordered request
 * a no-op instead of a jump.
 *
 * ⚠️ NO ANSWERS ARE STORED. The values live in the traveller's own client until they are spent on
 * one /api/itineraries/generate call. This layer validates them (so a bad answer is caught on the
 * step that asked) and then FORGETS them. Nothing here writes a city, a date or the notes field to
 * any column.
 *
 * ⚠️ IT NEVER GENERATES. Generation is the most expensive path in the app and has exactly one
 * entrance — the client posts to /api/itineraries/generate itself, so aiGuard('itinerary', 8), the
 * global daily cap and the Gemini cap all apply unchanged. Adding a server-side generate here
 * would be a second entrance with its own budget, which is the one thing the task forbids.
 */

export type WizardResult =
  | { ok: true; step: TripWizardStep | null; messageId: string }
  | { ok: false; error: WizardError }
export type WizardError =
  | 'not_signed_in'
  | 'forbidden'
  | 'thread_not_found'
  | 'desk_unavailable'
  | 'no_active_wizard'
  | 'step_mismatch'
  | 'invalid_answers'
  | 'itinerary_not_found'
  | 'update_failed'

type ThreadContext = {
  convo: { id: string; buyerProfileId: string; sellerProfileId: string | null; listingId: string; visaApplicationId: string | null }
  profileId: string
}

/**
 * Resolve the thread and prove the caller is its traveller.
 *
 * The wizard is driven BY the traveller (they tap Next), while the cards are authored by the desk.
 * So this is the one place that checks the buyer, and dm-flow's rule still holds elsewhere: no
 * function takes a sender.
 */
async function requireTraveller(conversationId: string): Promise<ThreadContext | WizardError> {
  const profile = await getCurrentProfile()
  if (!profile) return 'not_signed_in'
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, visaApplicationId: true },
  })
  // Missing and not-yours collapse to ONE answer, so a signed-in stranger cannot use this to learn
  // which conversation ids exist — the same rule the assistance lifecycle follows.
  if (!convo || convo.buyerProfileId !== profile.id) return 'forbidden'
  return { convo, profileId: profile.id }
}

/** The newest wizard card in a thread, with its parsed meta. */
async function activeWizardCard(conversationId: string): Promise<{ id: string; meta: TripStepMeta } | null> {
  const row = await db.message.findFirst({
    // ⚠️ THE LITERAL. Message.kind defaults to 'text', so a falsy check matches nothing and a
    // missing predicate here would pick up an ordinary chat message.
    where: { conversationId, kind: 'trip_step' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, metaJson: true },
  })
  if (!row) return null
  // Re-validated on read, so a row written by anything other than the card gate is inert.
  const meta = parseMessageMeta('trip_step', row.metaJson)
  return meta ? { id: row.id, meta } : null
}

/** Open the wizard in a thread, or hand back the one already running. */
export async function startTripWizard(input: { conversationId: string }): Promise<WizardResult> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { ok: false, error: context }

  const existing = await activeWizardCard(input.conversationId)
  // Idempotent by design: a double tap, or a reopened thread, resumes rather than restarting —
  // and restarting would silently discard the steps already answered.
  if (existing && existing.meta.state === 'active') {
    return { ok: true, step: existing.meta.step, messageId: existing.id }
  }

  const desk = await getTripDesk()
  if (!desk) return { ok: false, error: 'desk_unavailable' }
  if (!context.convo.sellerProfileId || context.convo.sellerProfileId !== desk.ownerId) {
    // The card is authored BY the desk, so a thread the current desk does not answer cannot host
    // a wizard — the authorship gate would refuse the write anyway; this is the honest error.
    return { ok: false, error: 'desk_unavailable' }
  }

  try {
    const message = await insertMessage(context.convo, desk.ownerId, '', {
      kind: 'trip_step',
      meta: { v: 1, step: TRIP_WIZARD_STEPS[0], state: 'active' },
      preview: WIZARD_PREVIEW,
    })
    return { ok: true, step: TRIP_WIZARD_STEPS[0], messageId: message.id }
  } catch (e) {
    console.error('[trips-wizard] start refused', { error: (e as Error)?.message })
    return { ok: false, error: 'update_failed' }
  }
}

/**
 * Record that a step was answered and move the live card forward.
 *
 * `answers` are validated and then dropped. They are accepted at all so the traveller learns about
 * a bad answer on the step that asked for it, rather than at the end when the generate call
 * rejects the whole body — and a rejected generate still costs a rate-limit token on the most
 * expensive path in the app.
 */
export async function advanceTripWizard(input: {
  conversationId: string
  step: number
  answers: unknown
}): Promise<WizardResult> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { ok: false, error: context }

  const card = await activeWizardCard(input.conversationId)
  if (!card || card.meta.state !== 'active') return { ok: false, error: 'no_active_wizard' }
  // The claim in the body must match the card. A replay of an older step is refused rather than
  // rewinding the wizard, and a jump forward cannot skip a step's validation.
  if (card.meta.step !== input.step) return { ok: false, error: 'step_mismatch' }

  const parsed = tripWizardStepSchema(card.meta.step).safeParse(input.answers)
  if (!parsed.success) return { ok: false, error: 'invalid_answers' }
  // parsed.data is deliberately DISCARDED. Validating is the only thing this layer wants from the
  // answers; keeping them would put a traveller's plan in a column nothing here governs.

  const next = card.meta.step < LAST_TRIP_WIZARD_STEP
    ? ((card.meta.step + 1) as TripWizardStep)
    : card.meta.step
  if (next === card.meta.step) {
    // The last step is answered by GENERATING, not by advancing — the client fires the generate
    // request and then calls completeTripWizard with what it got back.
    return { ok: true, step: card.meta.step, messageId: card.id }
  }
  return writeCardMeta(card.id, { v: 1, step: next, state: 'active' }, next)
}

/**
 * Close the wizard against the itinerary it produced.
 *
 * ⚠️ THE ITINERARY IS PROVEN TO BE THE CALLER'S. Without this check the body could name any
 * itinerary id, and the closing card — which the traveller taps through to — would link one
 * person's thread to another person's trip. Ownership is checked against the SESSION profile, and
 * a missing itinerary answers the same as somebody else's.
 */
export async function completeTripWizard(input: { conversationId: string; itineraryId: string }): Promise<WizardResult> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { ok: false, error: context }

  const itinerary = await db.itinerary.findUnique({
    where: { id: input.itineraryId },
    select: { id: true, profileId: true },
  })
  if (!itinerary || itinerary.profileId !== context.profileId) return { ok: false, error: 'itinerary_not_found' }

  const card = await activeWizardCard(input.conversationId)
  if (!card) return { ok: false, error: 'no_active_wizard' }
  return writeCardMeta(card.id, { v: 1, step: card.meta.step, state: 'done', itineraryId: itinerary.id }, null)
}

/** The current step in a thread, for rendering. null when no wizard is running. */
export async function currentTripWizardStep(conversationId: string): Promise<TripStepMeta | null> {
  const card = await activeWizardCard(conversationId)
  return card?.meta ?? null
}

// ── internals ───────────────────────────────────────────────────────────────────────────

/**
 * Bilingual, PII-FREE inbox line. Constant literal, never interpolated — Conversation.
 * lastMessageText is plaintext and both parties read it, so no city, date or note may reach it.
 * One line for the whole wizard: the card is updated in place, so the preview does not change per
 * step and the traveller's inbox does not churn.
 */
const WIZARD_PREVIEW = 'Lên kế hoạch chuyến đi · Planning your trip'

/**
 * Update a card's metaJson in place, RE-VALIDATING through the same schema the write gate uses.
 *
 * Every metaJson write in this codebase passes a strict parse, insert or update, so no caller
 * value reaches the column unchecked (the setVisaCheckoutStatus precedent). Going through
 * parseMessageMeta here means a shape this build cannot read is refused rather than stored.
 */
async function writeCardMeta(messageId: string, meta: TripStepMeta, step: TripWizardStep | null): Promise<WizardResult> {
  const json = JSON.stringify(meta)
  if (!parseMessageMeta('trip_step', json)) return { ok: false, error: 'update_failed' }
  try {
    // Scoped by kind as well as id: a mistargeted id must not be able to write a trip_step blob
    // onto an ordinary message, where nothing would ever parse it and the bubble would go blank.
    const updated = await db.message.updateMany({
      where: { id: messageId, kind: 'trip_step' },
      data: { metaJson: json },
    })
    if (updated.count !== 1) return { ok: false, error: 'update_failed' }
  } catch (e) {
    console.error('[trips-wizard] card update failed', { messageId, error: (e as Error)?.message })
    return { ok: false, error: 'update_failed' }
  }
  return { ok: true, step, messageId }
}
