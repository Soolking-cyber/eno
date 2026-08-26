import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { getCurrentProfile } from '../admin'
import { insertMessage, parseMessageMeta, type TripStepMeta } from '../messages'
import { threadKind } from '../thread-kind'
import { kv } from '../ratelimit'
import { getTripDesk } from './dm-thread'

import {
  LAST_TRIP_WIZARD_STEP, TRIP_WIZARD_STEPS, tripWizardStepSchema,
  type TripWizardStep,
} from './itinerary-wizard'

/** Whatever getTripDesk resolves — named here so the gate can hand it back without restating it. */
type TripDesk = NonNullable<Awaited<ReturnType<typeof getTripDesk>>>

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
 * ⚠️ NO ANSWERS REACH A DATABASE COLUMN. The values live in the traveller's own client until they
 * are spent on one /api/itineraries/generate call. This layer validates them (so a bad answer is
 * caught on the step that asked) and then FORGETS them: no city, no date, no notes field is written
 * anywhere. Scope that precisely (Gemini) — the answers DO travel in a request body, so they are as
 * exposed as any HTTPS payload is to infrastructure that logs bodies. What is guaranteed here is
 * that nothing in this application persists them.
 *
 * ⚠️ START IS THE ONE PLACE A TRAVELLER'S REQUEST CAUSES A DESK-AUTHORED CARD, and that deserves
 * saying out loud rather than hiding behind "the desk authors cards". A traveller calling start
 * makes the server post as the desk. What keeps it sound is that the card's ENTIRE content is
 * server-chosen — step 1, state active, a constant preview — so no caller value reaches it, and
 * start is idempotent while a wizard is running, so the button cannot be used to spray cards. It is
 * the same shape as the visa desk, where an applicant's action causes the next step card.
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
  | 'case_changed_reload'
  | 'update_failed'

type ThreadContext = {
  convo: { id: string; buyerProfileId: string; sellerProfileId: string | null; listingId: string | null; visaApplicationId: string | null }
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
async function activeWizardCard(conversationId: string): Promise<{ id: string; meta: TripStepMeta; raw: string } | null> {
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
  // `raw` is the exact stored string, kept so the update below can compare-and-set on it.
  return meta && row.metaJson ? { id: row.id, meta, raw: row.metaJson } : null
}

/**
 * How long one thread's start may hold the section. Generous next to the SELECT+INSERT it covers
 * (single-digit milliseconds), small enough that a process dying mid-start cannot keep a traveller
 * from opening the wizard for long.
 */
const START_SLOT_TTL_SECONDS = 20

/** Re-read the card a few times, for the loser of the start race. */
async function awaitWizardCard(conversationId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    const card = await activeWizardCard(conversationId)
    if (card && card.meta.state === 'active') return card
  }
  return null
}

/**
 * Open the wizard in a thread, or hand back the one already running.
 *
 * ⚠️ THE CHECK AND THE INSERT ARE ONE SECTION, because on their own they are read-then-write. The
 * function was already idempotent against a DOUBLE TAP — the second tap re-reads and resumes — but
 * two genuinely concurrent starts (a second tab, a retried request) both read "no card" and both
 * insert, and the thread ends up with two live wizard cards. `activeWizardCard` then picks the
 * newest deterministically, so the state does not split; what the traveller gets is a duplicate
 * bubble and a step counter that appears to jump backwards in the older one.
 *
 * ⚠️ A KV SLOT, NOT AN ADVISORY LOCK, and that is not the first instinct. `pg_advisory_xact_lock`
 * is the pattern this repo already uses (assistance.ts:100) — but it only serialises statements
 * that run on the LOCKING transaction's connection, and the insert here goes through
 * `insertMessage`, which owns its own writes on the global client and takes no transaction. Wrapping
 * this in `db.$transaction` would produce a lock that looks right and guards nothing. Reviewers
 * caught that; the honest fix at this layer is a slot both racers can see.
 *
 * Fails OPEN: if the KV backend is unreachable the start proceeds unserialised, which is exactly
 * today's behaviour. A traveller cannot be told "you may not start planning" because a cache is down.
 */
export async function startTripWizard(input: { conversationId: string }): Promise<WizardResult> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { ok: false, error: context }

  // Idempotent by design: a double tap, or a reopened thread, resumes rather than restarting —
  // and restarting would silently discard the steps already answered. Kept OUTSIDE the section so
  // the overwhelmingly common case (the wizard is already open) costs one read and no slot.
  const running = await activeWizardCard(input.conversationId)
  if (running && running.meta.state === 'active') {
    return { ok: true, step: running.meta.step, messageId: running.id }
  }

  const desk = await threadHostsWizard(context.convo)
  if (!desk) return { ok: false, error: 'desk_unavailable' }

  const key = `trip-wizard-start:${input.conversationId}`
  const token = randomUUID()
  let held: 'OK' | null = 'OK'
  try {
    held = await kv.set(key, token, { nx: true, ex: START_SLOT_TTL_SECONDS })
  } catch (e) {
    console.error('[trips-wizard] start slot unavailable', { error: (e as Error)?.message })
  }

  if (!held) {
    // Another start for this thread is inside the section right now. Its insert is one row write,
    // so waiting briefly and re-reading yields ITS card — which is the same answer a double tap
    // gets, and the reason this is idempotency rather than a refusal.
    const settled = await awaitWizardCard(input.conversationId)
    if (settled) return { ok: true, step: settled.meta.step, messageId: settled.id }
    return { ok: false, error: 'update_failed' }
  }

  try {
    // ⚠️ RE-READ INSIDE THE SECTION. The check above ran before the slot was held, so it proves
    // nothing about the moment of insert — without this, the loser of the race would insert a
    // second card as soon as the winner released.
    const existing = await activeWizardCard(input.conversationId)
    if (existing && existing.meta.state === 'active') {
      return { ok: true, step: existing.meta.step, messageId: existing.id }
    }
    const message = await insertMessage(context.convo, desk.ownerId, '', {
      kind: 'trip_step',
      meta: { v: 1, step: TRIP_WIZARD_STEPS[0], state: 'active' },
      preview: WIZARD_PREVIEW,
    })
    return { ok: true, step: TRIP_WIZARD_STEPS[0], messageId: message.id }
  } catch (e) {
    console.error('[trips-wizard] start refused', { error: (e as Error)?.message })
    return { ok: false, error: 'update_failed' }
  } finally {
    // ⚠️ COMPARE BEFORE DELETING. If this start ever outlived its own TTL, another one would hold
    // the slot by now and an unconditional delete would release SOMEONE ELSE'S section.
    try {
      if ((await kv.get<string>(key)) === token) await kv.del(key)
    } catch {
      // The TTL is the backstop. Throwing here would turn a started wizard into a failed one.
    }
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

  // ⚠️ A WIZARD MAY NOT BE DRIVEN INSIDE AN e-VISA THREAD, even one that is already running. Cards
  // authored before the anchor fix are still out there (the owner's thread cmrvk2xnl holds an
  // active one), and `advance` used to check only "is there a card and are you its traveller".
  //
  // ⚠️ THE TEST IS `=== 'visa'`, NOT `!== 'itinerary'`, and that is what keeps this from adding a
  // new way to strand somebody. threadKind fails CLOSED to 'listing' on a desk-lookup outage, so an
  // allow-list would turn a transient outage into a wizard nobody can finish — while `start`, which
  // does use the allow-list, only refuses to BEGIN. Denying the one kind we can positively identify
  // closes the crossover without inventing a mid-flow failure.
  if ((await threadKind(context.convo)) === 'visa') return { ok: false, error: 'no_active_wizard' }

  const card = await activeWizardCard(input.conversationId)
  if (!card || card.meta.state !== 'active') return { ok: false, error: 'no_active_wizard' }
  // The claim in the body must match the card — a jump forward cannot skip a step's validation.
  //
  // EXCEPT for the immediately-previous step, which is a RETRY of an advance that already landed
  // (a flaky network, a double tap). Gemini was right that returning 409 there was wrong: I had
  // described a replay as "a no-op" and it was actually a hard error the client had to recover
  // from by hand. Answering with the current step is both honest and idempotent — the answers were
  // validated when the advance first succeeded, so nothing is being waved through.
  if (card.meta.step === input.step + 1) return { ok: true, step: card.meta.step, messageId: card.id }
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
  return writeCardMeta(card.id, card.raw, { v: 1, step: next, state: 'active' }, next)
}

/**
 * Move a running wizard BACK to an earlier step.
 *
 * ⚠️ WHY THIS HAS TO EXIST SERVER-SIDE. The step lives on the card row; the answers live in the
 * client's sessionStorage. Those have different lifetimes, so a new tab restores "step 5" over an
 * empty draft — and generate then rejects `cityIds: []`. My first fix moved only the CLIENT back to
 * the first unanswered step, which swapped one dead end for another: `Next` then answered step 1
 * while the card still said 5, and advance correctly refused it as a step_mismatch (409, seen in
 * production). The card is the authority on the step, so recovering means telling the card.
 *
 * ⚠️ BACKWARDS ONLY. Moving forward here would skip a step's validation entirely — the one thing
 * advance's step check exists to prevent — so a forward jump is refused rather than clamped, and
 * asking for the step it is already on is a no-op rather than an error (a double tap must not
 * become a failure the traveller has to understand).
 */
export async function gotoTripWizardStep(input: {
  conversationId: string
  step: number
  /** The step the caller believes the card is on. Makes this a compare-and-set — see below. */
  expectedStep?: number
}): Promise<WizardResult> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { ok: false, error: context }
  // Same crossover guard as advance, and the same deny-list reasoning: a wizard may not be driven
  // inside an e-Visa thread, but a desk-lookup outage must not strand a live one.
  if ((await threadKind(context.convo)) === 'visa') return { ok: false, error: 'no_active_wizard' }

  const card = await activeWizardCard(input.conversationId)
  if (!card || card.meta.state !== 'active') return { ok: false, error: 'no_active_wizard' }
  // ⚠️ COMPARE-AND-SET. Two tabs on one wizard: one is repairing a stale draft backwards while the
  // other answers a question forwards. Without this the rewind lands on a card that has already
  // moved and silently discards the other tab's progress. Refusing on a changed card makes the
  // loser a no-op the client already handles (it leaves the view where the card is), rather than a
  // write nobody asked for. Raised by codex.
  if (typeof input.expectedStep === 'number' && input.expectedStep !== card.meta.step) {
    return { ok: false, error: 'step_mismatch' }
  }
  if (input.step === card.meta.step) return { ok: true, step: card.meta.step, messageId: card.id }
  if (input.step > card.meta.step) return { ok: false, error: 'step_mismatch' }

  return writeCardMeta(card.id, card.raw, { v: 1, step: input.step as TripWizardStep, state: 'active' }, input.step as TripWizardStep)
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
  // ACTIVE, not merely present. Without this a finished card could be re-completed against a
  // different itinerary, silently repointing the link the traveller taps (codex).
  if (!card || card.meta.state !== 'active') return { ok: false, error: 'no_active_wizard' }
  return writeCardMeta(card.id, card.raw, { v: 1, step: card.meta.step, state: 'done', itineraryId: itinerary.id }, null)
}

/**
 * Can this thread run a wizard, and is one already running?
 *
 * Exists because the messages page has no other way to know a thread belongs to the trip desk —
 * the conversation payload carries no trip flag, and that route is not this task's to change. So
 * the page asks here, and the answer is scoped to the caller: a stranger learns nothing, because
 * this returns the same "not eligible" for a thread that is not theirs as for one that does not
 * exist.
 */
export async function tripWizardEligibility(input: { conversationId: string }): Promise<{ eligible: boolean; step: TripWizardStep | null }> {
  const context = await requireTraveller(input.conversationId)
  if (typeof context === 'string') return { eligible: false, step: null }
  // ⚠️ THE SAME PREDICATE `start` USES, not a second opinion about it. An eligibility read that
  // says no while `start` still says yes is the bug with extra steps: the chip hides and the
  // route stays open. One function, both callers.
  if (!(await threadHostsWizard(context.convo))) return { eligible: false, step: null }
  const card = await activeWizardCard(input.conversationId)
  return { eligible: true, step: card && card.meta.state === 'active' ? card.meta.step : null }
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
 * Can this thread host a wizard? BOTH the desk AND its trip listing must match.
 *
 * ⚠️ THE LISTING HALF IS NOT REDUNDANT, AND OMITTING IT WAS A SHIP BLOCKER. codex refuted the
 * claim that desk-authorship alone was sufficient, and the database agreed: the trip desk and the
 * e-Visa shop are the SAME Seller — one Profile owns at most one storefront (`Seller.ownerId` is
 * @unique), so the desk owns 15 active listings, 14 of them visa products. Gating on the desk
 * alone therefore offered the trip wizard inside every e-Visa thread, and `start` would have
 * authored a trip card into one. That is precisely the visa/trip crossover the owner reported on
 * 2026-07-25, running the other way, and it got MORE likely the day the storefront was shared.
 *
 * So the thread must be about the trip ANCHOR listing specifically — resolved server-side from
 * (seller, externalId), never from the title or the category, which any seller could imitate.
 *
 * Fails CLOSED: no desk, or no seeded anchor, and no thread hosts a wizard.
 *
 * ⚠️ The refusal deliberately collapses into the caller's existing answer ('desk_unavailable' /
 * "not eligible"). A distinct "wrong listing" code would re-open the oracle this module closed:
 * it would let a signed-in stranger tell a desk thread from a non-desk one.
 */
async function threadHostsWizard(convo: ThreadContext['convo']): Promise<TripDesk | null> {
  // ⚠️ THE ANCHOR TEST NOW COMES FROM threadKind, which is the ONE answer to "what kind of thread
  // is this" and is shared with the visa side, the customer thread list and the admin queue. This
  // function used to compare convo.listingId to the trip anchor itself — a second copy of the
  // discriminator, and the surfaces that render the label had a third. They cannot disagree now.
  if ((await threadKind(convo)) !== 'itinerary') return null
  // Still resolved here, and still checked against the thread's seller: `start` needs THIS desk as
  // the card's author, so the gate must approve the same desk that signs the card. threadKind
  // answers what the thread is about; it deliberately says nothing about who may write to it.
  const desk = await getTripDesk()
  if (!desk) return null
  if (!convo.sellerProfileId || convo.sellerProfileId !== desk.ownerId) return null
  // Returned rather than re-fetched: `start` needs this exact desk as the card's author, and a
  // second lookup could resolve a DIFFERENT one — the gate would then have approved a desk that
  // is not the one that signs the card.
  return desk
}

/**
 * Update a card's metaJson in place, RE-VALIDATING through the same schema the write gate uses.
 *
 * Every metaJson write in this codebase passes a strict parse, insert or update, so no caller
 * value reaches the column unchecked (the setVisaCheckoutStatus precedent). Going through
 * parseMessageMeta here means a shape this build cannot read is refused rather than stored.
 */
async function writeCardMeta(messageId: string, expected: string, meta: TripStepMeta, step: TripWizardStep | null): Promise<WizardResult> {
  const json = JSON.stringify(meta)
  if (!parseMessageMeta('trip_step', json)) return { ok: false, error: 'update_failed' }
  try {
    // ⚠️ A COMPARE-AND-SET, and it was not one until codex refuted the claim that it was safe.
    // Matching on `id` alone let a STALE advance overwrite a card that had since been completed —
    // resetting state:'done' to 'active' and dropping the itineraryId, so the traveller's finished
    // plan lost the link to itself. `metaJson: expected` is the whole guard: the row must still
    // hold exactly the blob this request read, or zero rows match and nothing is written.
    //
    // Comparing the serialised blob works because metaJson is written from ONE place (here and
    // insertMessage) and always through JSON.stringify of a parsed object, so the string is
    // canonical rather than incidental.
    //
    // Scoped by kind too: a mistargeted id must not be able to write a trip_step blob onto an
    // ordinary message, where nothing would parse it and the bubble would go blank.
    const updated = await db.message.updateMany({
      where: { id: messageId, kind: 'trip_step', metaJson: expected },
      data: { metaJson: json },
    })
    if (updated.count !== 1) return { ok: false, error: 'case_changed_reload' }
  } catch (e) {
    console.error('[trips-wizard] card update failed', { messageId, error: (e as Error)?.message })
    return { ok: false, error: 'update_failed' }
  }
  return { ok: true, step, messageId }
}
