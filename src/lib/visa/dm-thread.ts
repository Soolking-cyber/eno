import 'server-only'
// Relative specifiers throughout (the crypto.ts / schema.ts idiom, sanctioned by
// src/lib/sync-pairs.test.ts): `@/…` does not resolve under vitest, and every branch in
// this file is unit-tested. Same modules either way.
import { db } from '../db'
import {
  insertMessage,
  isVisaPayloadFieldName,
  parseMessageMeta,
  setVisaCheckoutStatus,
  type VisaCheckoutMeta,
  type VisaPickerMeta,
  type VisaStepMeta,
} from '../messages'
import { getVisaShopListings, getVisaShopProductsForSale, getVisaShopSeller } from '../visa-shop'
import { visaDmStepPreview, type VisaDmStep } from './dm-steps'
import { getVisaDb } from './db'
import { visaPaymentsConfig } from './payments'
import { recordVisaEvent } from './records'

// ── The buyer ↔ visa-shop THREAD ──────────────────────────────────────────────────
//
// One module owns the relationship between a visa case (a row in Supabase's
// visa_applications, outside Prisma's datamodel) and the marketplace conversation that
// case is lived out in. Everything that writes a card, binds a thread, or asks who is
// driving the conversation goes through here, so the four spoofing gates documented in
// src/lib/messages.ts have exactly one authoring surface above them.
//
// THREE RULES THIS FILE EXISTS TO KEEP:
//  1. THE SENDER IS NEVER AN ARGUMENT. Cards are authored as the visa shop's own
//     account, resolved server-side from getVisaShopSeller().ownerId. There is no
//     parameter a caller could pass to author as somebody else.
//  2. OWNERSHIP BEFORE BINDING. Conversation.visaApplicationId is written only after
//     visa_applications.user_id has been confirmed to equal the buyer — the binding is
//     what every later card is validated against, so a wrong binding is a cross-tenant
//     PII leak, not a cosmetic bug.
//  3. MONEY IS SERVER TRUTH. The checkout card's amount is written from the value the
//     CALLING ROUTE resolved server-side (see sendVisaCheckoutCard — pricing is
//     per-product now, so this layer cannot re-derive it), and 'paid' is never authored
//     at all: it is only ever stamped against provider evidence.
//
// ⚠️ WHAT THIS FILE DOES **NOT** GUARANTEE — read before calling it.
// These functions take NO ACTOR. They gate on (a) a sender identity they resolve
// themselves and (b) the thread↔case binding; none of them ever asks "who is asking?".
// So an ENTITLED CALLER IS A PRECONDITION, not something enforced here: the route must
// authenticate the request and prove the actor is that case's applicant (or a visa
// admin) before calling sendVisaStepCard / sendVisaCheckoutCard / setVisaThreadMode /
// markVisaThreadPaid. A route that skipped that check could mint a real, shop-authored
// card in somebody else's thread, and nothing below would stop it.
// What IS guaranteed here, exactly:
//   · every card is authored AS THE VISA SHOP — never as the applicant, never as
//     another seller (rule 1: there is no sender parameter to abuse);
//   · a card can only name the case its thread is CURRENTLY bound to (re-checked and
//     row-locked at insert time by src/lib/messages.ts);
//   · a binding is only written after visa_applications.user_id == the buyer (rule 2),
//     so bindVisaThread is the one function that IS self-gating and may be called with
//     a buyerProfileId straight off the session;
//   · 'paid' is only stamped once visa_applications.paid_at exists (rule 3).
//
// ⚠️ NO PII. Nothing in this file decrypts a payload or copies applicant data into a
// Message body, a metaJson blob, or Conversation.lastMessageText.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Columns insertMessage needs (ConvoForSend) plus the binding it validates cards against. */
const THREAD_SELECT = {
  id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, visaApplicationId: true,
} as const

export type VisaThreadMode = 'ai' | 'human_requested' | 'admin'
export type VisaThreadRef = { conversationId: string; buyerProfileId: string; sellerProfileId: string }

// Mode is DERIVED, never stored: no DDL, no new column, no migration to coordinate with
// the forum copy of the visa tables. The three events already fit visa_events' free-text
// `event` column, and the newest one wins.
const MODE_EVENT: Record<VisaThreadMode, string> = {
  ai: 'admin_takeover_ended',
  human_requested: 'human_help_requested',
  admin: 'admin_takeover_started',
}
const MODE_FOR_EVENT: Record<string, VisaThreadMode> = {
  admin_takeover_ended: 'ai',
  human_help_requested: 'human_requested',
  admin_takeover_started: 'admin',
}
const MODE_EVENT_NAMES = Object.keys(MODE_FOR_EVENT)

/**
 * The IMMUTABLE conversation this case is linked to (visa_applications.conversation_id),
 * or null. Written ONCE at bind time (stampVisaConversationId) and never rebound, so —
 * unlike Conversation.visaApplicationId, which a later case takes over — it still resolves
 * for a case a subsequent case took the live pointer away from. Null for a case that
 * predates the column (backfill could not resolve it) or has never bound to a thread.
 *
 * FAIL-SOFT to null: a Supabase hiccup must let a caller degrade to its live-binding
 * fallback, never throw in the middle of delivering a result.
 */
export async function visaConversationIdFor(applicationId: string): Promise<string | null> {
  if (!UUID_RE.test(applicationId)) return null
  // ⚠️ null MEANS "no link", and NOTHING ELSE. A genuine null (unstamped case) and a lookup
  // ERROR must not collapse into the same value (external review, GPT-5.6 2026-07-23): callers
  // decide real behaviour off this — the card guard treats non-null as authoritative, and result
  // delivery falls back to the live binding only on a TRUE null. If a Supabase hiccup returned
  // null-on-error, a transient failure would silently refuse a legitimate card, or misroute a
  // finished visa to the wrong thread and undo the upload. So an error THROWS; the caller may
  // fail loud (retryable) but never acts on a wrong answer.
  const { data, error } = await getVisaDb()
    .from('visa_applications').select('conversation_id').eq('id', applicationId).maybeSingle()
  if (error) { console.error('[visa-dm] conversation_id lookup failed', error.code); throw new Error('visa_conversation_lookup_failed') }
  const value = (data as { conversation_id?: string | null } | null)?.conversation_id
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * Stamp visa_applications.conversation_id ONCE, so this case keeps a stable handle to the
 * thread its cards live in even after a later case rebinds Conversation.visaApplicationId.
 *
 * ⚠️ WRITE-ONCE THROUGH THIS HELPER (not a DB-level immutability trigger — external review was
 * right to flag the earlier "the database enforces it" as overstated). The `is('conversation_id',
 * null)` predicate means a row that already carries a link is matched by NOTHING here, so the
 * FIRST thread a case binds to is the one it keeps, and a concurrent second bind through this
 * path can only no-op. A different service-role query COULD still overwrite it — there is no FK
 * or trigger — so treat the column as append-only by convention and never write it elsewhere.
 * FAIL-SOFT by contract: the bind has already succeeded and every live-binding path still works,
 * so a failed stamp is logged and swallowed — it must never fail the bind. (The residual: a bind
 * whose stamp failed leaves the case on the live-binding fallback until the next stamp attempt.)
 */
async function stampVisaConversationId(applicationId: string, conversationId: string): Promise<void> {
  try {
    const { error } = await getVisaDb()
      .from('visa_applications')
      .update({ conversation_id: conversationId })
      .eq('id', applicationId)
      .is('conversation_id', null)
    if (error) throw error
  } catch (e) {
    console.error('[visa-dm] conversation_id stamp failed (bind unaffected)', e)
  }
}

/**
 * Create-or-reuse the buyer↔visa-shop thread and bind it to this case.
 *
 * `created` describes the CONVERSATION, not the binding: a repeat applicant reuses the
 * thread they already have with the visa desk (the one-thread-per-buyer↔seller rule from
 * /api/conversations) and gets created:false while their new case is bound to it.
 *
 * SIDE EFFECT: on every success path it stamps visa_applications.conversation_id with the
 * resolved conversation (once — see stampVisaConversationId), so the case retains an
 * immutable handle to its thread. That stamp is fail-soft and never changes the bind result.
 */
export async function bindVisaThread(input: {
  applicationId: string
  buyerProfileId: string
  /** Listing to anchor a NEWLY-CREATED conversation on (the generic start passes the
   *  hidden $0 anchor so a product-less case never opens on a sellable product's price).
   *  Ignored when the buyer already has a desk thread. Absent → the catalogue floor. */
  anchorListingId?: string
}): Promise<
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; error: 'shop_unavailable' | 'not_owner' | 'listing_unavailable' | 'thread_conflict' }
> {
  const { applicationId, buyerProfileId } = input
  if (!UUID_RE.test(applicationId) || !buyerProfileId) return { ok: false, error: 'not_owner' }

  const shop = await getVisaShopSeller()
  // Not seeded yet (scripts/seed-visa-shop.mjs), or the support account has no profile.
  if (!shop?.ownerId) return { ok: false, error: 'shop_unavailable' }
  // The desk cannot serve itself: a conversation needs two distinct parties, and the
  // author gate in messages.ts compares buyer against seller.
  if (shop.ownerId === buyerProfileId) return { ok: false, error: 'shop_unavailable' }

  // ── OWNERSHIP FIRST ──────────────────────────────────────────────────────────────
  // Nothing above this point wrote, and nothing below writes until it passes. The check
  // FAILS CLOSED: a Supabase error is 'not_owner', never "probably fine".
  let owns = false
  try {
    const { data, error } = await getVisaDb()
      .from('visa_applications').select('user_id').eq('id', applicationId).maybeSingle()
    if (error) throw error
    owns = !!buyerProfileId && (data as { user_id?: string } | null)?.user_id === buyerProfileId
  } catch (e) {
    console.error('[visa-dm] ownership check failed', e)
    return { ok: false, error: 'not_owner' }
  }
  if (!owns) return { ok: false, error: 'not_owner' }

  // Already bound? visaApplicationId is @unique, so at most one thread can name this case.
  const bound = await db.conversation.findUnique({
    where: { visaApplicationId: applicationId },
    select: { id: true, buyerProfileId: true },
  })
  if (bound) {
    // The case belongs to this buyer (checked above) but its thread does not — corrupt
    // state we must not "repair" by moving the binding under another user's messages.
    if (bound.buyerProfileId !== buyerProfileId) return { ok: false, error: 'thread_conflict' }
    // Heal the immutable link if this case predates the column (no-op once set).
    await stampVisaConversationId(applicationId, bound.id)
    return { ok: true, conversationId: bound.id, created: false }
  }

  // ⚠️ SCOPED TO THE VISA CATALOGUE, not merely to the seller — and it was not, which is how a
  // visa case ended up living inside a TRIP-PLANNING thread on prod (owner report 2026-07-25,
  // root-caused 2026-07-26: one thread carrying 18 visa_step + 4 visa_checkout + 3 visa_picker
  // cards alongside 2 trip_step). The old predicate was `{ sellerId, buyerProfileId }` with no
  // listing filter, which was correct only while this desk sold nothing but visas.
  //
  // It no longer does. `Seller.ownerId` is @unique, so ONE Profile owns at most one storefront,
  // and the trip-assistance anchor therefore sits on the very same Seller as the visa products.
  // "The buyer's most recent thread with this seller" then resolves to whatever they last talked
  // about — and for a traveller who came in through the trip listing, that is the trip thread.
  // The visa flow bound its case there and started posting government-form cards into a
  // conversation about an itinerary.
  //
  // Restricting the reuse to threads already anchored on a visa listing keeps the intended
  // behaviour (a repeat applicant reuses their visa thread; the Phase-2 picker still retargets
  // Conversation.listingId within the catalogue) while refusing to adopt a thread about a
  // different product. Worst case it CREATES a visa thread instead of reusing one — a separate
  // thread is the correct outcome for a separate product, and far better than the merge.
  const visaListingIds = (await getVisaShopListings()).map((l) => l.id)
  const existing = visaListingIds.length
    ? await db.conversation.findFirst({
        where: { sellerId: shop.id, buyerProfileId, listingId: { in: visaListingIds } },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      })
    : null
  let conversationId = existing?.id ?? ''
  let created = false
  if (!existing) {
    // A conversation needs a listing; the visa desk's listings ARE its products, so the
    // thread opens on the caller's anchor when given (the generic start's hidden $0
    // anchor), else the catalogue's first for-sale product as the floor. (The Phase-2
    // picker retargets Conversation.listingId once a product is actually chosen.)
    const listingId = input.anchorListingId ?? (await getVisaShopProductsForSale())[0]?.id
    if (!listingId) return { ok: false, error: 'listing_unavailable' }
    try {
      const convo = await db.conversation.create({
        data: { listingId, buyerProfileId, sellerId: shop.id, sellerProfileId: shop.ownerId },
        select: { id: true },
      })
      conversationId = convo.id
      created = true
    } catch (e) {
      // Double-tap loser on @@unique([listingId, buyerProfileId]) — reuse the winner's.
      // ⚠️ SAME CATALOGUE SCOPE as the lookup above. The P2002 proves a conversation now exists
      // on THIS listing, so the winner is by definition a visa thread — but an unscoped re-read
      // ordered by lastMessageAt could hand back the buyer's trip thread instead, which is the
      // very merge this function was just fixed to prevent. Scoping it means the recovery path
      // cannot reintroduce the bug through the back door.
      if ((e as { code?: string })?.code !== 'P2002') throw e
      const raced = await db.conversation.findFirst({
        where: { sellerId: shop.id, buyerProfileId, listingId: { in: visaListingIds } },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      })
      if (!raced) return { ok: false, error: 'thread_conflict' }
      conversationId = raced.id
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // REBIND = UNBIND FIRST, IN THE SAME TRANSACTION. visaApplicationId is @unique and
      // holds exactly one case, so a repeat applicant's second case is only bindable once
      // the previous one is released — and both statements must sit under the same row
      // lock, or a concurrent card write could land against a half-moved binding. The old
      // case's cards STAY in the timeline as inert history: every renderer treats a card
      // whose meta.applicationId ≠ this column as history, never as actionable
      // (prisma/schema.prisma, Conversation.visaApplicationId).
      await tx.conversation.updateMany({
        where: { id: conversationId, NOT: { visaApplicationId: null } },
        data: { visaApplicationId: null },
      })
      const claim = await tx.conversation.updateMany({
        where: { id: conversationId, visaApplicationId: null },
        data: { visaApplicationId: applicationId },
      })
      if (claim.count !== 1) throw new Error('visa_thread_bind_conflict')
    })
  } catch (e) {
    // Includes P2002 on the @unique column: another thread claimed this case between our
    // findUnique and the write.
    console.error('[visa-dm] bind failed', e)
    return { ok: false, error: 'thread_conflict' }
  }
  // ── THE IMMUTABLE LINK ────────────────────────────────────────────────────────────
  // The binding is committed; now record the case's permanent handle to this thread. Set
  // once, never overwritten, so once a later case rebinds the live pointer this column is
  // still how case A finds the thread its cards (result PDF included) live in.
  await stampVisaConversationId(applicationId, conversationId)
  return { ok: true, conversationId, created }
}

/** The thread a case is bound to, or null. findUnique on the @unique binding column. */
export async function findVisaThread(applicationId: string): Promise<VisaThreadRef | null> {
  if (!UUID_RE.test(applicationId)) return null
  const convo = await db.conversation.findUnique({
    where: { visaApplicationId: applicationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true },
  })
  // An unclaimed seller (sellerProfileId null) means nobody can author cards in it, so
  // it is not a usable visa thread.
  if (!convo?.sellerProfileId) return null
  return { conversationId: convo.id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId }
}

export type VisaThreadResolution = VisaThreadRef & {
  /** Which handle answered — 'immutable' via conversation_id, 'live' via the binding fallback. */
  source: 'immutable' | 'live'
}

/**
 * The thread a case's cards live in, resolved through the IMMUTABLE conversation_id first
 * and through Conversation.visaApplicationId (the live binding) only when that column is
 * NULL. This is the read that survives a rebind: findVisaThread answers null for a case a
 * later case took the live pointer from, but its conversation_id still names the thread.
 *
 * `source` reports which handle answered so a caller can log the fallback ("resolved by the
 * live binding" is the pre-immutable-link path and cannot reach a rebound case).
 *
 * ⚠️ A NON-NULL LINK IS AUTHORITATIVE. When conversation_id is set but resolves to no usable
 * desk thread (a vanished conversation, or one whose seller is unclaimed) this returns null
 * rather than falling through to the live binding — a link that points nowhere is corrupt
 * state, not a signal to try the very pointer the link exists to replace. The fallback is
 * reserved strictly for a NULL link. Tolerates a null link everywhere: a case may genuinely
 * have no thread, and the answer is simply null.
 */
export async function findVisaThreadByCase(applicationId: string): Promise<VisaThreadResolution | null> {
  if (!UUID_RE.test(applicationId)) return null
  const conversationId = await visaConversationIdFor(applicationId)
  if (conversationId) {
    const convo = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerProfileId: true, sellerProfileId: true },
    })
    if (!convo?.sellerProfileId) return null
    return {
      conversationId: convo.id,
      buyerProfileId: convo.buyerProfileId,
      sellerProfileId: convo.sellerProfileId,
      source: 'immutable',
    }
  }
  const live = await findVisaThread(applicationId)
  return live ? { ...live, source: 'live' } : null
}

/**
 * Emit a visa_step card. Returns null — never throws — when the shop, the binding, or
 * the thread's mode makes emission illegal, so a stalled wizard degrades to "no card"
 * instead of a 500 in the middle of a chat.
 */
export async function sendVisaStepCard(input: {
  conversationId: string; applicationId: string; step: VisaDmStep; needsReview?: string[]
  /** Set ONLY by an admin-initiated resend, after the caller is proven to be the desk.
   *  Lets the human who took the thread over re-post the form; see the mode gate below. */
  byAdmin?: boolean
}): Promise<{ messageId: string } | null> {
  const { conversationId, applicationId, step } = input
  if (!UUID_RE.test(applicationId)) return null

  // ⚠️ THE SENDER IS RESOLVED HERE, FROM THE STOREFRONT ROW — there is no sender
  // parameter on this function and there must never be one, so a card authored through
  // this path always speaks as the visa shop. That is NOT an entitlement check: this
  // function has no actor to check (see the caller contract at the top of the file). It
  // bounds the DAMAGE of a mis-authorized call (a shop-authored card in a thread the
  // shop owns) rather than preventing one.
  const shop = await getVisaShopSeller()
  if (!shop?.ownerId) return null
  const senderId = shop.ownerId

  const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: THREAD_SELECT })
  if (!convo) return null
  // The card must speak for the case THIS thread is bound to…
  if (convo.visaApplicationId !== applicationId) return null
  // …and the thread must be one of the visa desk's own.
  if (convo.sellerProfileId !== senderId) return null

  // A human has taken the thread over → the WIZARD stops talking over them.
  // 'human_requested' deliberately does NOT silence it: that mode means the applicant is
  // queued for help, and they can keep filling the form while they wait.
  //
  // ⚠️ byAdmin is the ONE exception, and it does not weaken the invariant — it names it
  // precisely. What must never happen is the AUTOMATED flow posting over a human. An admin
  // who has taken the thread over and taps "send the form" IS that human, and the owner
  // asked for exactly this ("admin can send visa application form from chip"). Without it,
  // the takeover silently disabled the feature for the only actor they named.
  // Only the resend path sets it, and only after proving the caller is the desk.
  if (!input.byAdmin && (await getVisaThreadMode(applicationId)) === 'admin') return null

  // needsReview carries payload FIELD NAMES only. Filtering here (rather than letting the
  // strict parse throw) means one stray key costs that key, not the whole card.
  const needsReview = [...new Set(input.needsReview ?? [])].filter(isVisaPayloadFieldName).slice(0, 80)
  const meta: VisaStepMeta = {
    v: 1, step, applicationId, state: 'active',
    ...(needsReview.length ? { needsReview } : {}),
  }
  try {
    // Body EMPTY on purpose (the realtime-broadcast note in insertMessage) — the inbox
    // line comes from the constant, PII-free preview.
    const message = await insertMessage(convo, senderId, '', { kind: 'visa_step', meta, preview: visaDmStepPreview(step) })
    return { messageId: message.id }
  } catch (e) {
    console.error('[visa-dm] step card refused', e)
    return null
  }
}

/**
 * Emit the step-0 product picker (a generic start has no product yet — the applicant
 * chooses IN the thread). Same refusal contract as the step card: null, never a throw.
 * The card carries NO products and NO prices (the client fetches the live catalogue),
 * so nothing here can go stale or become a price authority.
 */
export async function sendVisaPickerCard(input: {
  conversationId: string; applicationId: string
  /** Same admin-resend exception as sendVisaStepCard — set only after the caller is proven to be the desk. */
  byAdmin?: boolean
}): Promise<{ messageId: string } | null> {
  const { conversationId, applicationId } = input
  if (!UUID_RE.test(applicationId)) return null

  const shop = await getVisaShopSeller()
  if (!shop?.ownerId) return null
  const senderId = shop.ownerId

  const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: THREAD_SELECT })
  if (!convo) return null
  if (convo.visaApplicationId !== applicationId) return null
  if (convo.sellerProfileId !== senderId) return null

  // Same mode gate as the step card: the automated flow never talks over a human.
  if (!input.byAdmin && (await getVisaThreadMode(applicationId)) === 'admin') return null

  const meta: VisaPickerMeta = { v: 1, applicationId, state: 'active' }
  try {
    const message = await insertMessage(convo, senderId, '', {
      kind: 'visa_picker',
      meta,
      // Constant bilingual preview — no applicant data, no prices.
      preview: 'Chọn dịch vụ e-Visa · Choose your e-Visa service',
    })
    return { messageId: message.id }
  } catch (e) {
    console.error('[visa-dm] picker card refused', e)
    return null
  }
}

/**
 * Emit the in-thread pay card. Null while payments are dormant (no provider keys),
 * exactly like the rest of the payment surface.
 *
 * ⚠️ THE PRICE IS THE CALLING ROUTE'S RESPONSIBILITY, AND IT MUST BE SERVER-RESOLVED.
 * e-Visa pricing is PER PRODUCT (owner, 2026-07-21): a 2 × 7 grid of
 * (entry type: single | multiple, 90-day) × (speed: 1H, 2H, 4H, 1D, 2D, 3D, normal),
 * each cell carrying its own USD price. There is no single flat fee to compare against
 * any more — visaPaymentsConfig() survives here only as the dormant/live switch for the
 * payment providers, and its feeCents is NOT the price of anything this card sells. This
 * function therefore cannot re-derive the amount and deliberately does not try: the ROUTE
 * that mints the card reads the authoritative grid server-side and passes that number.
 * (The grid itself is a later task — do not invent it here.)
 *
 * ⚠️ A CLIENT-SUPPLIED AMOUNT MUST NEVER REACH THIS FUNCTION. Nothing here can tell a
 * resolved price from a number lifted out of a request body, so a route that forwards
 * `body.amountUsd` is a price-tampering hole this layer cannot close for it.
 *
 * What IS enforced here: the amount is a finite, positive, whole-cent USD value, and the
 * card is written from the NORMALIZED value rather than the raw input. The strict
 * metaJson parse in src/lib/messages.ts (min 0, max 10 000, multipleOf 0.01) is the
 * backstop, and it throws — i.e. no card — rather than persisting a malformed amount.
 */
export async function sendVisaCheckoutCard(input: {
  conversationId: string; applicationId: string; amountUsd: number
}): Promise<{ messageId: string } | null> {
  const { conversationId, applicationId } = input
  if (!UUID_RE.test(applicationId)) return null

  const config = visaPaymentsConfig()
  if (!config) return null
  // SHAPE, not value: with per-product pricing the only thing this layer can honestly
  // assert about the amount is that it is money. Math.round() absorbs float noise
  // (79.99 * 100 === 7998.999999999999) while the epsilon comparison still refuses a
  // sub-cent amount like 25.999, which would be a caller computing a price wrong.
  const cents = Math.round(input.amountUsd * 100)
  if (!Number.isFinite(input.amountUsd) || cents <= 0 || Math.abs(input.amountUsd * 100 - cents) > 1e-6) {
    console.error('[visa-dm] checkout amount is not a positive whole-cent USD value')
    return null
  }
  const amountUsd = cents / 100

  const shop = await getVisaShopSeller()
  if (!shop?.ownerId) return null
  const senderId = shop.ownerId

  const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: THREAD_SELECT })
  if (!convo || convo.visaApplicationId !== applicationId || convo.sellerProfileId !== senderId) return null

  // Always minted 'unpaid'. 'paid' is a provider fact, never authorable: both stamping
  // paths (setVisaCheckoutStatus and stampReleasedVisaCheckoutCard below) refuse until
  // visa_applications.paid_at exists (src/lib/messages.ts gate 3).
  // No mode gate here, unlike the step card: an admin who took the thread over still
  // needs the applicant to pay, and this card is the only way to ask.
  const meta: VisaCheckoutMeta = { v: 1, applicationId, amountUsd, status: 'unpaid' }
  try {
    const message = await insertMessage(convo, senderId, '', {
      kind: 'visa_checkout',
      meta,
      // Bilingual composite, no applicant data — the price is public.
      preview: `Phí dịch vụ e-Visa · e-Visa service fee — $${amountUsd.toFixed(2)}`,
    })
    return { messageId: message.id }
  } catch (e) {
    console.error('[visa-dm] checkout card refused', e)
    return null
  }
}

/** A checkout card resolved by APPLICATION rather than by the thread's live binding. */
type VisaCheckoutCardRow = { id: string; conversationId: string; meta: VisaCheckoutMeta }

/**
 * The newest checkout card that speaks for this case, found through the APPLICANT'S OWN
 * visa-desk threads — not through Conversation.visaApplicationId, which a later case may
 * already have taken over (see markVisaThreadPaid).
 *
 * Scoped, not scanned: the case's owner + the visa shop's sellerId narrow it to that
 * buyer's handful of conversations (indexed), and the cards are then read off the
 * [conversationId, createdAt] index. That scoping is also the cross-tenant guard — a card
 * living in anyone else's thread is invisible here, whatever its metaJson claims.
 *
 * FAILS CLOSED ON AMBIGUITY: cards for one case spread over more than one thread is
 * corrupt state (the binding is @unique, so it cannot be produced through this module),
 * and money must not be stamped onto a guess.
 */
async function findVisaCheckoutCardByApplication(applicationId: string, ownerProfileId: string): Promise<VisaCheckoutCardRow | null> {
  const shop = await getVisaShopSeller()
  if (!shop?.id || !ownerProfileId) return null
  const threads = await db.conversation.findMany({
    where: { sellerId: shop.id, buyerProfileId: ownerProfileId },
    select: { id: true },
    take: 20,
  })
  if (!threads.length) return null
  const rows = await db.message.findMany({
    where: { conversationId: { in: threads.map((t) => t.id) }, kind: 'visa_checkout' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, conversationId: true, metaJson: true },
    take: 50,
  })
  const cards: VisaCheckoutCardRow[] = []
  for (const row of rows) {
    // parseMessageMeta re-validates on read (strict zod) and is tolerant — a hand-written
    // or future-version blob is null here, never a throw.
    const meta = parseMessageMeta('visa_checkout', row.metaJson)
    if (!meta || !('status' in meta) || meta.applicationId !== applicationId) continue
    cards.push({ id: row.id, conversationId: row.conversationId, meta })
  }
  if (!cards.length) return null
  if (new Set(cards.map((card) => card.conversationId)).size > 1) {
    console.error('[visa-dm] checkout cards for one case in multiple threads — refusing to stamp')
    return null
  }
  return cards[0]
}

/**
 * Stamp the checkout card of a case whose thread NO LONGER NAMES IT.
 *
 * ⚠️ SECOND WRITER OF status:'paid'. The canonical one is setVisaCheckoutStatus
 * (src/lib/messages.ts), and it is used for every live-binding case — but it requires
 * Conversation.visaApplicationId to still equal the case, which a rebound thread makes
 * permanently false. Without this path a repeat applicant's FIRST case keeps an 'unpaid'
 * card forever, for a capture that really completed.
 *
 * It re-asserts the same money gate rather than inheriting it: 'paid' is written only
 * once visa_applications.paid_at exists — i.e. only once markVisaPaidAndHandoff has
 * verified the capture with Stripe/PayPal. A Supabase error propagates to
 * markVisaThreadPaid's catch and answers false, so this fails CLOSED.
 * The blob written is the STORED meta with nothing changed but `status`, and the stored
 * meta came back through parseMessageMeta's strict parse, so the result is provably still
 * a valid VisaCheckoutMeta.
 */
async function stampReleasedVisaCheckoutCard(applicationId: string): Promise<boolean> {
  const { data, error } = await getVisaDb()
    .from('visa_applications').select('user_id,paid_at').eq('id', applicationId).maybeSingle()
  if (error) throw error
  const row = data as { user_id?: string | null; paid_at?: string | null } | null
  // EVIDENCE GATE — the provider fact, not the caller's word.
  if (!row?.paid_at || !row.user_id) return false
  const card = await findVisaCheckoutCardByApplication(applicationId, row.user_id)
  if (!card) return false
  // Idempotent: a webhook and a confirm-on-return both firing is the normal case.
  if (card.meta.status === 'paid') return true
  // RE-VALIDATE THE RESULT BEFORE WRITING. messages.ts states the invariant plainly: every
  // metaJson write, insert or update, passes a strict parse, so no value reaches the column
  // unchecked (setVisaCheckoutStatus and setVisaStepState both safeParse the merged object).
  // This function was the only writer that skipped it — an external review caught it. Round-
  // tripping through parseMessageMeta reuses the SAME strict schema without widening
  // messages.ts's API to export it, and it fails closed: an unparseable result writes nothing.
  const next: VisaCheckoutMeta = { ...card.meta, status: 'paid' }
  const validated = parseMessageMeta('visa_checkout', JSON.stringify(next))
  if (!validated) return false
  await db.message.update({ where: { id: card.id }, data: { metaJson: JSON.stringify(validated) } })
  return true
}

/**
 * Stamp this case's checkout card paid. Called from the payment completion paths
 * (webhook + confirm-on-return), which run after the provider capture is verified.
 *
 * RESOLVED BY THE APPLICATION, NOT ONLY BY THE LIVE BINDING. Conversation.visaApplicationId
 * is @unique and holds exactly one case, so a repeat applicant starting a second case
 * RELEASES the first (bindVisaThread's unbind-then-claim). Looking the thread up by that
 * column alone therefore returns null forever for the released case, and a capture that
 * really completed would leave its card 'unpaid' for good — a money bug, not a cosmetic
 * one. So: the live binding is the fast path, and a case that has been released is
 * resolved through its own card instead.
 *
 * NEVER THROWS: a payment is already recorded by the time this runs, so a failure here
 * must degrade to a stale card, never to a 500 that makes Stripe retry a completed
 * capture. false = no card for this case anywhere, or the evidence gate refused.
 */
export async function markVisaThreadPaid(applicationId: string): Promise<boolean> {
  if (!UUID_RE.test(applicationId)) return false
  try {
    // FAST PATH — the thread still names this case. Delegates the money claim to the
    // canonical stamper: setVisaCheckoutStatus re-reads visa_applications.paid_at and
    // fails closed, so this function's word is not enough.
    const thread = await findVisaThread(applicationId)
    if (thread && (await setVisaCheckoutStatus(thread.conversationId, applicationId, 'paid'))) return true
    // Released (or the delegate refused for a binding reason): resolve by application.
    // Re-running the evidence gate makes this fallback no weaker than the fast path — it
    // can only ever stamp a capture Supabase already recorded.
    return await stampReleasedVisaCheckoutCard(applicationId)
  } catch (e) {
    console.error('[visa-dm] markVisaThreadPaid', e)
    return false
  }
}

/**
 * Who is driving this thread. Derived from the NEWEST of the three mode events in
 * visa_events — no DDL, no extra column. Fails soft to 'ai' (the pre-takeover default)
 * so a Supabase hiccup cannot wedge the wizard shut.
 */
export async function getVisaThreadMode(applicationId: string): Promise<VisaThreadMode> {
  if (!UUID_RE.test(applicationId)) return 'ai'
  try {
    const { data, error } = await getVisaDb()
      .from('visa_events')
      .select('event,created_at,id')
      .eq('application_id', applicationId)
      .in('event', MODE_EVENT_NAMES)
      // id as the tiebreak: two events written in the same transaction can share
      // created_at, and "newest wins" must be deterministic.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
    if (error) throw error
    const newest = (data as Array<{ event?: string }> | null)?.[0]?.event
    return (newest && MODE_FOR_EVENT[newest]) || 'ai'
  } catch (e) {
    console.error('[visa-dm] thread mode lookup failed', e)
    return 'ai'
  }
}

/**
 * The same read, FAIL CLOSED — for callers where "I could not tell" must not become "carry on".
 *
 * ⚠️ Why two functions rather than a flag: the soft default above is CORRECT for the step
 * cards. They are furniture; a transient Supabase error must not wedge the wizard shut, and a
 * card posted during a takeover is inert anyway. It is WRONG for the Eno concierge, which is a
 * VOICE: the owner's rule is "ife person requested ai doesnt answer", and a mode read that
 * quietly answers 'ai' on failure turns an outage into the bot talking over the human someone
 * just asked for. An adversarial review caught the concierge consuming the soft value and being
 * unable to distinguish 'ai' from 'the read failed'.
 *
 * Every other refusal on the concierge path already fails closed (crypto not ready, rate limit,
 * no-answer-beats-a-wrong-answer). This makes the one gate the owner stated twice match them.
 */
export async function readVisaThreadModeStrict(
  applicationId: string,
): Promise<{ ok: true; mode: VisaThreadMode } | { ok: false }> {
  if (!UUID_RE.test(applicationId)) return { ok: false }
  try {
    const { data, error } = await getVisaDb()
      .from('visa_events')
      .select('event,created_at,id')
      .eq('application_id', applicationId)
      .in('event', MODE_EVENT_NAMES)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
    if (error) throw error
    const newest = (data as Array<{ event?: string }> | null)?.[0]?.event
    return { ok: true, mode: (newest && MODE_FOR_EVENT[newest]) || 'ai' }
  } catch (e) {
    console.error('[visa-dm] strict thread mode lookup failed', e)
    return { ok: false }
  }
}

/**
 * Record a mode transition. Deliberately the ONE loud path in this file: the read above
 * fails soft, but a takeover the caller believes landed and didn't would leave the wizard
 * posting over a human, so a failed write THROWS and the route surfaces it.
 */
export async function setVisaThreadMode(input: {
  applicationId: string; mode: VisaThreadMode; actorType: 'applicant' | 'admin'; actorRef?: string
}): Promise<void> {
  await recordVisaEvent(input.applicationId, input.actorType, MODE_EVENT[input.mode], input.actorRef, { mode: input.mode })
}
