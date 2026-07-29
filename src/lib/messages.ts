import 'server-only'
import { after } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { sendPushToProfile } from './push'
import { formatMoneyFull } from './vnd'
import { maskEmailHandle } from '@/lib/utils'
// Field-NAME allowlist for visa card metadata (see buildCardMeta). Read-only import
// of the shared payload schema — this file never touches a decrypted payload.
import { visaPayloadSchema } from '@/lib/visa/schema'
// Pure format module (no server-only, no IO) — the ONE definition of what a case reference
// may look like, reused here so the card's `reference` field cannot hold anything else.
import { normalizeVisaReference } from '@/lib/visa/reference'
// The ONE trip status machine. Imported for its NODE set only (see tripStatusMetaSchema) so
// the card contract and the workflow cannot drift into two different ideas of a valid status.
import { TRIP_TRANSITIONS } from '@/lib/trips/status'
// The ONE wizard step machine — imported for its step list so the card contract and the wizard
// cannot disagree about what a step is.
import { TRIP_WIZARD_STEPS, type TripWizardStep } from '@/lib/trips/itinerary-wizard'

// ---------------------------------------------------------------------------
// Structured message kinds
// ---------------------------------------------------------------------------
// Message.kind is a plain TEXT column (never a DB enum), so a new card type is an
// additive code change. Everything the timeline can render must be listed here —
// insertMessage refuses any other value.
//   'text'          — a normal chat message
//   'offer'         — offerAmount + offerStatus, accept/decline/counter
//   'visa_step'     — one step of the in-thread e-Visa wizard      (metaJson)
//   'visa_checkout' — the in-thread pay card                        (metaJson)
//   'visa_result'   — the finished visa PDF, downloadable in chat   (metaJson)
//   'visa_picker'   — the step-0 product picker for generic starts  (metaJson)
//   'trip_quote'    — the trip desk's live quote, accept/decline     (metaJson)
//   'trip_status'   — a trip case moved to a new status              (metaJson)
//   'trip_step'     — one step of the in-thread itinerary wizard     (metaJson)
export const MESSAGE_KINDS = [
  'text', 'offer',
  'visa_step', 'visa_checkout', 'visa_result', 'visa_picker',
  'trip_quote', 'trip_status', 'trip_step',
  // ⚠️ `trip_help` IS DELIBERATELY NOT A CARD — it is absent from TRIP_CARD_KINDS below, so it
  // carries no metaJson and renders as ordinary text. It exists so "the traveller asked for a
  // person" is a FACT IN THE TIMELINE rather than a column: the trip concierge refuses to speak
  // after one (the visa rule, "ife person requested ai doesnt answer"), and both the desk and the
  // chip derive that from the same array the thread already renders. A mode column would be a
  // second source of truth that drifts the moment one write lands and the other doesn't — the
  // reasoning tripDeskMode already spells out for takeovers.
  'trip_help',
] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]
export type VisaCardKind = 'visa_step' | 'visa_checkout' | 'visa_result' | 'visa_picker'
const VISA_CARD_KINDS = new Set<string>(['visa_step', 'visa_checkout', 'visa_result', 'visa_picker'])
export const isVisaCardKind = (kind: string): kind is VisaCardKind => VISA_CARD_KINDS.has(kind)

export type TripCardKind = 'trip_quote' | 'trip_status' | 'trip_step'
const TRIP_CARD_KINDS = new Set<string>(['trip_quote', 'trip_status', 'trip_step'])
export const isTripCardKind = (kind: string): kind is TripCardKind => TRIP_CARD_KINDS.has(kind)

/**
 * Every kind that carries metaJson. The two families are gated SEPARATELY — a visa card is
 * bound to a visa case, a trip card to an assistance request — so nothing here merges their
 * authorship checks; this union exists only so the shared plumbing (schema lookup, read-side
 * parse, "may this kind carry meta at all?") has one list to consult instead of two.
 */
export type CardKind = VisaCardKind | TripCardKind
export const isCardKind = (kind: string): kind is CardKind => isVisaCardKind(kind) || isTripCardKind(kind)

// Versioned card payloads, persisted as a JSON string in Message.metaJson.
// ⚠️ NO VISA PII EVER LIVES HERE. metaJson carries ids, a step number, a money
// amount and payload FIELD NAMES — nothing else. The applicant's answers stay in the
// encrypted visa_applications payload and are fetched per-render by the card
// renderer. Bumping `v` means: add a new schema below and keep parsing the old one.
export const VISA_META_VERSION = 1

export type VisaStepMeta = {
  v: 1
  step: 1 | 2 | 3 | 4 | 5
  applicationId: string
  state: 'active' | 'done' | 'skipped'
  /** Field NAMES the AI extraction flagged for human acknowledgement (never values). */
  needsReview?: string[]
}
export type VisaCheckoutMeta = {
  v: 1
  applicationId: string
  amountUsd: number
  status: 'unpaid' | 'paid' | 'failed'
}
/**
 * The finished visa, announced in the thread.
 *
 * ⚠️ IT NAMES A DOCUMENT, NOT A PERSON. Two ids and a case number, and that is the whole
 * contract: no name, no passport number, no email, no filename, no URL. The bytes live in
 * the private bucket and are streamed by an authenticated route that re-proves ownership,
 * so this blob is a HANDLE and confers nothing on whoever reads it.
 */
export type VisaResultMeta = {
  v: 1
  applicationId: string
  /** visa_documents.id of the kind='result' row. */
  documentId: string
  /** The human case number (`EV-1042`), canonical form only — see the schema below. */
  reference?: string
}
/**
 * The step-0 product picker (generic starts pick their e-Visa service IN the thread).
 * Carries NO products and NO prices — the card fetches the live catalogue at render
 * time, so a message row is never a price authority and never goes stale.
 * `selectedListingId` is display-only history: which product a 'done' picker recorded.
 */
export type VisaPickerMeta = {
  v: 1
  applicationId: string
  state: 'active' | 'done'
  selectedListingId?: string
}
/**
 * The trip desk's quote, as a LIVE HANDLE — `requestId` and nothing else.
 *
 * ⚠️ IT CARRIES NO MONEY, DELIBERATELY, and that is the whole design. The amounts live in
 * TripAssistanceRequest.supplierTotalVnd / feeVnd and are read at render time, so:
 *
 *   · a message row is NEVER a price authority and can never go stale — the same reason
 *     visa_picker carries no prices (see its note above). An operator who re-quotes does not
 *     leave a contradicting number sitting in the traveller's timeline.
 *   · THE CARD CHANNEL cannot carry an amount at all: there is no money key, .strict() rejects
 *     one, and there is nowhere to put it. Scope that precisely (codex): this closes the
 *     message path, it does NOT make "no amount from a request body" true system-wide. A route
 *     that reads body.feeVnd and writes the row directly would bypass all of this. That rule
 *     still has to be enforced where money is WRITTEN — it is simply unreachable from here.
 *
 * The card renders accept/decline only while the case is actually `quoted`, which it also
 * reads live — so a quote that was accepted, withdrawn, or cancelled in another tab stops
 * being actionable without any message having to be rewritten.
 */
export type TripQuoteMeta = {
  v: 1
  /** TripAssistanceRequest.id — a cuid, NOT a uuid (see TRIP_ID_RE). */
  requestId: string
}
/**
 * A status announcement in the thread.
 *
 * Unlike the quote, this one DOES carry its status, and the asymmetry is the point: an
 * announcement is a historical FACT ("this case moved to arranging"), so re-reading it live
 * would rewrite the past — a card posted on Tuesday would silently start claiming today's
 * status. A quote is a live OFFER, so it must re-read. Fact → store it; offer → fetch it.
 */
export type TripStatusMeta = {
  v: 1
  requestId: string
  /** One of the nodes in TRIP_TRANSITIONS — validated against that map, never a second list. */
  status: string
}
/**
 * One step of the in-thread itinerary wizard.
 *
 * ⚠️ IT NAMES NO CASE, AND THAT IS THE DESIGN. trip_quote and trip_status carry a requestId
 * because they are ABOUT a TripAssistanceRequest. A wizard step is about a CONVERSATION: the
 * traveller has no itinerary yet — producing one is the entire point — and a case cannot exist
 * before an itinerary does, because TripAssistanceRequest.itineraryId is a required FK. Binding a
 * step card to a case would therefore make the wizard able to run only for travellers who already
 * had a plan, which is the opposite of what it is for.
 *
 * What proves a step card instead: the thread. The desk authors it, the thread's buyer is the
 * traveller, and the card carries no case data to leak. See buildTripCardMeta's `bind` switch.
 *
 * ⚠️ NO ANSWERS LIVE HERE. A step number and a state — never a city, a date, a traveller count,
 * and above all never the notes field. The values stay on the traveller's device until they are
 * spent on one generate request; `itineraryId` appears only on the closing card, and an id is not
 * an answer.
 */
export type TripStepMeta = {
  v: 1
  step: TripWizardStep
  state: 'active' | 'done'
  /** Set ONLY on the final card — the Itinerary the wizard produced. */
  itineraryId?: string
}
export type VisaMeta = VisaStepMeta | VisaCheckoutMeta | VisaResultMeta | VisaPickerMeta
export type TripMeta = TripQuoteMeta | TripStatusMeta | TripStepMeta
export type MessageMeta = VisaMeta | TripMeta

/**
 * kind → the exact payload that kind stores. Lets parseMessageMeta hand a caller the precise
 * type for a LITERAL kind instead of the whole union.
 *
 * ⚠️ This replaced a structural narrowing that had been silently load-bearing. Callers used to
 * write `if (!('status' in meta)) continue` to pick VisaCheckoutMeta out of the union — which
 * worked only because it was the sole member with a `status` key. TripStatusMeta has one too,
 * so the check now narrows to `VisaCheckoutMeta | TripStatusMeta`.
 *
 * Be precise about what broke (codex): the `in` test itself did NOT become an error — it is
 * still valid narrowing, just weaker. The errors appeared one line later, where those sites read
 * `.applicationId`, a field TripStatusMeta lacks. That is a lucky failure, not a safety net: a
 * site touching only fields the two share would have compiled and quietly widened its meaning.
 * The `in` check never expressed "this is a checkout card", it expressed "no other card happens
 * to look like this" — not an invariant anyone can maintain. Indexing by kind says the thing
 * that was actually meant, and it is why the sites now pass a LITERAL kind.
 */
type MetaForKind = {
  visa_step: VisaStepMeta
  visa_checkout: VisaCheckoutMeta
  visa_result: VisaResultMeta
  visa_picker: VisaPickerMeta
  trip_quote: TripQuoteMeta
  trip_status: TripStatusMeta
  trip_step: TripStepMeta
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The ONLY strings allowed in needsReview. Anything not a key of the visa payload
// schema is rejected, which makes it structurally impossible to smuggle free text
// (a passport number, a name) through the one array field the contract exposes.
const VISA_FIELD_NAMES = new Set(Object.keys(visaPayloadSchema.shape))
/**
 * The same allowlist, for card AUTHORS. A caller assembling `needsReview` filters through
 * this instead of copying the key set (one definition, here, next to the gate that
 * enforces it) — an unroutable entry is dropped before the write rather than throwing
 * `visa_card_meta_invalid` and losing the whole card. Purely additive: the write path
 * still re-checks every entry in visaStepMetaSchema, so this is a convenience, never a
 * substitute for the gate.
 */
export const isVisaPayloadFieldName = (name: string): boolean => VISA_FIELD_NAMES.has(name)
// A well-formed card is ~120–2500 bytes (needsReview dominates). The cap is a
// belt-and-braces stop on a fat row reaching every inbox poll, not a real limit.
const MAX_META_JSON = 4096

const applicationId = z.string().regex(UUID_RE)
// .strict(): an unknown key is a REJECT, not a silent pass-through — the persisted
// blob must contain exactly the documented contract and nothing a caller improvised.
const visaStepMetaSchema = z
  .object({
    v: z.literal(1),
    step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    applicationId,
    state: z.enum(['active', 'done', 'skipped']),
    needsReview: z.array(z.string().refine((name) => VISA_FIELD_NAMES.has(name))).max(80).optional(),
  })
  .strict()
const visaCheckoutMetaSchema = z
  .object({
    v: z.literal(1),
    applicationId,
    // A real service fee: whole cents, no e-Visa fee approaches $10k. Bounding it to
    // the money domain also shuts the only numeric channel wide enough to carry data
    // (external review flagged an unbounded-ish number as a theoretical smuggle path).
    amountUsd: z.number().finite().min(0).max(10_000).multipleOf(0.01),
    status: z.enum(['unpaid', 'paid', 'failed']),
  })
  .strict()
const visaResultMetaSchema = z
  .object({
    v: z.literal(1),
    applicationId,
    documentId: z.string().regex(UUID_RE),
    // CANONICAL FORM ONLY. normalizeVisaReference re-emits nothing it did not parse, so a
    // value that survives this refine is provably `EV` + `-` + digits — which is what makes
    // it safe to render into a filename and a Content-Disposition header downstream, and
    // makes the field structurally unable to carry an applicant value.
    reference: z.string().refine((value) => normalizeVisaReference(value) === value).optional(),
  })
  .strict()

// One row per card kind, so adding a kind is a line here rather than a ternary that grows
// a wrong default. Typed to VisaCardKind: every caller has already narrowed through
// isVisaCardKind, so there is no "unknown kind" branch to get wrong.
const visaPickerMetaSchema = z
  .object({
    v: z.literal(1),
    applicationId,
    state: z.enum(['active', 'done']),
    // A Listing id (cuid or seed id like `visa-evisa-90-single-1h`) — bounded and
    // shape-checked so the one free-ish string here cannot carry applicant data.
    selectedListingId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict()

// TRIP IDS ARE CUIDS, NOT UUIDS (TripAssistanceRequest.id is @default(cuid())), so UUID_RE
// would reject every real id. Bounded charset rather than an exact cuid grammar, on purpose:
// pinning the generator's shape here would mean a cuid version bump silently invalidates rows
// that are already stored. `[A-Za-z0-9_-]{1,64}` is the same bound visa_picker already accepts
// for a Listing id, and it is what actually matters — no spaces, no punctuation, so the field
// structurally cannot carry a traveller's name, address, or note.
const TRIP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const tripRequestId = z.string().regex(TRIP_ID_RE)

const tripQuoteMetaSchema = z
  .object({ v: z.literal(1), requestId: tripRequestId })
  .strict()
const tripStatusMetaSchema = z
  .object({
    v: z.literal(1),
    requestId: tripRequestId,
    // Validated against the ONE transition map rather than a copy of its key list — a status
    // added there is accepted here with no second edit, and one deleted stops parsing.
    //
    // ⚠️ An OWN-PROPERTY check is required. `status in TRIP_TRANSITIONS` and a truthiness check
    // on the lookup both accept inherited Object.prototype keys, so a card claiming
    // status:'toString', 'constructor' or '__proto__' would validate (all four are pinned in
    // messages.trip-cards.test.ts, verified to fail if this reverts to `in`). Object.hasOwn is
    // one way to say it, not the only one — hasOwnProperty.call or a Set would do as well.
    status: z.string().refine((value) => Object.hasOwn(TRIP_TRANSITIONS, value)),
  })
  .strict()

// ⚠️ TYPED PER KEY, not `Record<CardKind, z.ZodType>` — but be exact about how far that goes,
// because I overstated it once already and then measured it.
//
// codex refuted the original "MetaForKind and this table agree by construction" claim: with the
// loose Record, any kind could be mapped to any other kind's schema with no error, making
// parseMessageMeta's return type silently wrong. `z.ZodType<MetaForKind[K]>` fixes that only
// PARTLY, and the asymmetry is worth knowing:
//
//   · mapping trip_status → tripQuoteMetaSchema IS a type error (the output would be missing
//     `status`, which TripStatusMeta requires). Verified.
//   · mapping trip_quote → tripStatusMetaSchema COMPILES CLEAN. TripQuoteMeta is a structural
//     SUBSET of TripStatusMeta, so ZodType accepts it covariantly. Also verified — by making the
//     swap and watching tsc pass.
//
// So the type catches a schema that is too NARROW and misses one that is too WIDE. What closes
// the remaining half is runtime, not types: every schema here is .strict(), so it rejects any
// other kind's payload on the unknown key. That is pinned as a cross-product test
// ('the registry maps each kind to ITS OWN schema' in messages.trip-cards.test.ts) rather than
// left to a comment — the test fails on exactly the swap tsc lets through.
const tripStepMetaSchema = z
  .object({
    v: z.literal(1),
    // Derived from the ONE step machine, so a wizard that grows a step cannot post a card the
    // reader refuses — and a step removed there stops parsing here.
    step: z.number().int().refine((n): n is TripWizardStep => (TRIP_WIZARD_STEPS as readonly number[]).includes(n)),
    state: z.enum(['active', 'done']),
    itineraryId: z.string().regex(TRIP_ID_RE).optional(),
  })
  .strict()

const META_SCHEMAS: { [K in CardKind]: z.ZodType<MetaForKind[K]> } = {
  visa_step: visaStepMetaSchema,
  visa_checkout: visaCheckoutMetaSchema,
  visa_result: visaResultMetaSchema,
  visa_picker: visaPickerMetaSchema,
  trip_quote: tripQuoteMetaSchema,
  trip_status: tripStatusMetaSchema,
  trip_step: tripStepMetaSchema,
}
const metaSchemaFor = (kind: CardKind): z.ZodType => META_SCHEMAS[kind]

/**
 * READ side. Turn a stored metaJson into a typed card payload, or null.
 * TOLERANT BY DESIGN — never throws: a row that predates the column, was written by
 * hand, or holds a version this build doesn't understand must degrade to an inert
 * bubble, never 500 the whole thread. Re-validates on read so nothing that bypassed
 * insertMessage (raw SQL, a future migration) can reach the client as a live card.
 */
export function parseMessageMeta<K extends string>(
  kind: K,
  metaJson: string | null | undefined,
): (K extends CardKind ? MetaForKind[K] : MessageMeta) | null {
  type Result = (K extends CardKind ? MetaForKind[K] : MessageMeta) | null
  if (!metaJson || !isCardKind(kind)) return null
  try {
    const parsed = metaSchemaFor(kind).safeParse(JSON.parse(metaJson))
    // The cast is the boundary between a runtime lookup and the compile-time index: zod has
    // just re-validated against META_SCHEMAS[kind], which is the same mapping MetaForKind
    // describes, so the two agree by construction. Keep them edited together.
    return parsed.success ? (parsed.data as Result) : null
  } catch {
    return null
  }
}

/** Columns every message read needs, so the card fields can't be forgotten at a call site. */
export const MESSAGE_ROW_SELECT = {
  id: true, senderProfileId: true, body: true, createdAt: true,
  kind: true, offerAmount: true, offerStatus: true, metaJson: true,
} as const

export type SerializedMessage = {
  id: string; mine: true; body: string; createdAt: string; kind: string
  offerAmount: number | null; offerStatus: string | null
  meta: MessageMeta | null
}

type ConvoForSend = {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  listingId: string
  /**
   * The visa case this thread is bound to, when it is a visa thread. REQUIRED to send
   * a visa card — see buildCardMeta. Callers that don't select it simply cannot
   * author cards, which is why the ordinary send routes are safe untouched.
   */
  visaApplicationId?: string | null
}

export type SendOpts = {
  kind?: MessageKind
  /** kind='offer' only. */
  offerAmount?: number
  /** Visa card kinds only (see VisaCardKind) — REQUIRED there, rejected elsewhere. */
  meta?: MessageMeta
  /**
   * Inbox preview line for a card sent with an EMPTY body (see the body note in
   * insertMessage). Bilingual composite, supplied by the caller so copy ownership
   * stays with the surface. ⚠️ Never put applicant data in it — it lands in the
   * plaintext Conversation.lastMessageText column that both parties' inboxes read.
   */
  preview?: string
}

// ---------------------------------------------------------------------------
// WHO MAY AUTHOR A VISA CARD  (the spoofing surface of the whole feature)
// ---------------------------------------------------------------------------
// Four independent gates, all enforced here, in the single write path:
//
//  1. SHOP-SIDE AUTHORSHIP. A card may only be authored by the thread's
//     sellerProfileId — the visa shop admin (support@eno.vn). The buyer's own
//     contributions are 'text'; they act on cards, they never mint them. So even a
//     future route that forwarded a client-chosen kind could not let an applicant
//     fabricate a step or a pay card in their own thread.
//  2. THREAD BINDING. metaJson.applicationId must equal the CONVERSATION's
//     visaApplicationId (set server-side only, after verifying
//     visa_applications.user_id == buyerProfileId). A card therefore cannot name a
//     case that this thread is not bound to — cross-tenant reference is impossible
//     even for the shop admin, and impossible to reach at all from a caller that
//     didn't select the binding column. Re-checked and row-LOCKED at insert time
//     (see the atomic binding guard in insertMessage), so a concurrent rebind can't
//     slip a card into a thread that has moved on.
//  3. 'paid' IS NOT AUTHORABLE. A visa_checkout card is always minted 'unpaid'.
//     Paid is a PROVIDER FACT: only setVisaCheckoutStatus() may stamp it, and it
//     refuses unless visa_applications.paid_at is ALREADY set — i.e. unless the
//     payments layer (markVisaPaidAndHandoff) has verified the capture with
//     PayPal/Stripe and persisted it. The caller's word is never enough.
//  4. SHAPE + SIZE. .strict() zod parse, uuid-shaped ids, and needsReview entries
//     restricted to real visa payload FIELD NAMES, so the blob can carry no free
//     text at all. Anything else throws BEFORE the insert.
//
// Note what is deliberately NOT relied on: the two client-facing send routes
// (/api/conversations and /api/conversations/[id]/messages) never forward a
// client-supplied `kind` or `meta` — they construct `{kind:'offer'}` or `undefined`
// literally. That is gate zero, but it is an *absence*, so it is not trusted here;
// gates 1–4 hold even if a future route starts passing the body straight through.
async function buildCardMeta(kind: VisaCardKind, convo: ConvoForSend, senderId: string, meta: MessageMeta | undefined): Promise<{ json: string; applicationId: string; proof: 'immutable' | 'live' }> {
  // (1) shop-side authorship
  if (!convo.sellerProfileId || convo.sellerProfileId !== senderId) throw new Error('visa_card_author_forbidden')
  // (4) shape — parse first so the binding check below has the card's applicationId.
  const parsed = metaSchemaFor(kind).safeParse(meta)
  if (!parsed.success) throw new Error('visa_card_meta_invalid')
  const data = parsed.data as VisaMeta

  // (2) THREAD BINDING. The card must belong to THIS thread. Two eras coexist, and their
  // precedence is not symmetric (external review, GPT-5.6, 2026-07-23):
  //
  //   · THE IMMUTABLE LINK IS AUTHORITATIVE WHEN IT EXISTS. visa_applications.conversation_id
  //     is the permanent home of a case's cards. If a case HAS one, it decides — and the live
  //     Conversation.visaApplicationId pointer (which names only the currently-active case, and
  //     could be stale or wrong) MUST NOT override it. Checking the live binding first would let
  //     a card land in a thread that is not the case's home whenever the live pointer happens to
  //     match. So: if the immutable link is non-null, the card is accepted iff it equals convo.id.
  //     This is also the STRANDING fix — a finished visa for an earlier case is delivered to the
  //     thread it actually lives in, even after a newer case rebound the live pointer.
  //
  //   · THE LIVE BINDING IS THE FALLBACK, only for a case with NO immutable link (legacy rows,
  //     or a bind whose stamp failed). There a concurrent rebind IS possible between here and the
  //     insert, so the caller re-asserts the live binding inside the transaction (see `proof`).
  //
  // visaConversationIdFor THROWS on a lookup error (it no longer collapses error into null), so a
  // transient Supabase failure fails the write loudly rather than silently refusing a real case.
  // Lazy import breaks the dm-thread↔messages cycle and only loads on a visa-card write.
  const { visaConversationIdFor } = await import('@/lib/visa/dm-thread')
  const immutableHome = await visaConversationIdFor(data.applicationId)
  let proof: 'immutable' | 'live'
  if (immutableHome !== null) {
    if (immutableHome !== convo.id) throw new Error('visa_card_application_mismatch')
    proof = 'immutable'
  } else {
    if (!convo.visaApplicationId || convo.visaApplicationId !== data.applicationId) throw new Error('visa_card_application_mismatch')
    proof = 'live'
  }

  // (3) money claim
  if (kind === 'visa_checkout' && (data as VisaCheckoutMeta).status === 'paid') throw new Error('visa_checkout_paid_not_authorable')
  const json = JSON.stringify(data)
  if (json.length > MAX_META_JSON) throw new Error('visa_card_meta_too_large')
  return { json, applicationId: data.applicationId, proof }
}

// ---------------------------------------------------------------------------
// WHO MAY AUTHOR A TRIP CARD
// ---------------------------------------------------------------------------
// Same shape as the visa gate above, one gate heavier, because the binding lives on the
// OTHER side of the relation and is weaker:
//
//   · visa   — Conversation.visaApplicationId is @unique, so a case has at most one thread
//              and "is this card's case bound here?" has exactly one answer.
//   · trip   — the pointer is TripAssistanceRequest.conversationId, and it is NOT unique
//              (prisma/schema.prisma). Two assistance cases may therefore name the same
//              thread. That does not make the binding check unsound — `request.conversationId
//              === convo.id` still proves THIS case belongs to THIS thread — but it does mean
//              the thread→case direction is ambiguous, so nothing here may ask it.
//
// ⚠️ FLAGGED FOR ALEX, NOT CHANGED: making that column @unique would make the two families
// structurally identical and turn a double-bind into a database error instead of a silent
// second case in the same thread. It is a one-line schema addition + a guarded CREATE UNIQUE
// INDEX, but prisma/schema.prisma and the DDL are NOT in T307's Owned paths, so it is raised
// rather than taken. Nothing below depends on it: gate (3) proves the traveller directly.
//
// ⚠️ WHAT THESE GATES DO NOT COVER — state it plainly, because the two external reviewers
// disagreed about it and one of them was wrong. `convo` and `senderId` are ARGUMENTS, not
// database facts re-proven here. Gate (1) compares convo.sellerProfileId to senderId, so a
// caller that fabricated BOTH would satisfy it. What the gates defend is the CARD channel: a
// forged `kind` or `meta` cannot mint a card, name another case, or carry money. They do not
// authenticate the speaker.
//
// So the contract on every caller, inherited from insertMessage itself ("Caller is responsible
// for the participant check"): load `convo` from the database and take `senderId` from the
// session — never from a request body. Routes do this today; it is written down because the
// gates below read like they prove more than they do.
//
//  1. DESK-SIDE AUTHORSHIP. Only the thread's sellerProfileId — the trip desk — may mint a
//     trip card. The traveller's own messages are 'text'; they ACT on cards, never author
//     them, so a forwarded request body cannot fabricate a quote in the traveller's own thread.
//  2. THREAD BINDING. The named case must point at THIS conversation.
//  3. TRAVELLER MATCH. The case's profileId must be the thread's buyer. Redundant while
//     bindings are written correctly, and deliberately kept anyway: it is the check that
//     would stop a mis-bound case from surfacing one traveller's itinerary to another, and
//     it costs one column on a row already being read.
//  4. SHAPE + SIZE. .strict() zod, bounded id charset, status drawn from TRIP_TRANSITIONS.
//     Note what the shape ALSO excludes: there is no money key in either trip schema, so
//     "no amount from a request body" is enforced by the absence of a channel, not by a rule.
/**
 * What a built trip card needs from the write path. DISCRIMINATED, because the two families of
 * trip card are bound to different things and must not share a code path:
 *
 *   · 'case'   — trip_quote / trip_status. Bound to a TripAssistanceRequest, so the insert
 *                re-asserts that binding (and the traveller, and the announced status) in a
 *                compare-and-set.
 *   · 'thread' — trip_step. Bound to the CONVERSATION, which the desk-authorship gate has already
 *                proven. There is no case row to compare against and none is invented.
 *
 * ⚠️ THIS REPLACED A GUARD COMPUTED AS `'status' in data ? {...} : {}`. That worked only while
 * every kind was a case card: a third kind fell into the else and got an EMPTY predicate — a
 * transactional guard that asserts nothing, silently. It is the exact structural-narrowing trap
 * this file warns about at the MetaForKind comment, written sixty lines above the code that then
 * committed it. The switch below is exhaustive on the kind, so a NEW card kind cannot be added
 * without declaring how it binds; the compiler refuses to build until it does.
 */
type TripCardBuild =
  | { bind: 'case'; json: string; requestId: string; guard: { status?: string } }
  | { bind: 'thread'; json: string }

async function buildTripCardMeta(kind: TripCardKind, convo: ConvoForSend, senderId: string, meta: MessageMeta | undefined): Promise<TripCardBuild> {
  // (1) desk-side authorship — every trip card, whatever it binds to.
  if (!convo.sellerProfileId || convo.sellerProfileId !== senderId) throw new Error('trip_card_author_forbidden')
  // (4) shape — first, so any binding check below has trusted values.
  const parsed = metaSchemaFor(kind).safeParse(meta)
  if (!parsed.success) throw new Error('trip_card_meta_invalid')
  const data = parsed.data as TripMeta

  const json = JSON.stringify(data)
  if (json.length > MAX_META_JSON) throw new Error('trip_card_meta_too_large')

  switch (kind) {
    case 'trip_step': {
      // THREAD-BOUND. Gate (1) is the whole proof: the desk is speaking in a thread whose buyer is
      // the traveller, and the card carries a step number and a state — nothing that could belong
      // to another traveller, and nothing to cross-reference. An itineraryId, when present, names a
      // row the traveller is about to be sent to; it is not read back as an authorisation.
      return { bind: 'thread', json }
    }
    case 'trip_quote':
    case 'trip_status': {
      const caseMeta = data as TripQuoteMeta | TripStatusMeta
      // (2)+(3). One read, both gates. `select` is narrow on purpose: this function must never
      // pull a money column or an itinerary field into a code path that serialises to metaJson.
      const request = await db.tripAssistanceRequest.findUnique({
        where: { id: caseMeta.requestId },
        select: { id: true, conversationId: true, profileId: true },
      })
      if (!request) throw new Error('trip_card_request_not_found')
      if (request.conversationId !== convo.id) throw new Error('trip_card_conversation_mismatch')
      if (request.profileId !== convo.buyerProfileId) throw new Error('trip_card_traveller_mismatch')

      // (5) AN ANNOUNCEMENT MUST BE TRUE WHEN IT IS POSTED. A trip_status card names a status, and
      // the extra predicate makes the row prove it: the transaction's compare-and-set matches only
      // while the case is ACTUALLY at that status, atomically with the insert.
      //
      // I first shipped this ungated, arguing the desk is the only author so a wrong status would
      // merely be our own bug. codex refuted that: the card carried no event id and checked
      // nothing, so "historical fact" was a claim the data could not support. The fix is one
      // predicate. Accepted cost: an operator moving a case twice quickly can lose the first
      // announcement — better than publishing a superseded one as fact.
      const guard = kind === 'trip_status' ? { status: (caseMeta as TripStatusMeta).status } : {}
      return { bind: 'case', json, requestId: caseMeta.requestId, guard }
    }
  }
}

/**
 * Insert a message into a conversation and keep the denormalized state consistent
 * (last-message + the other party's unread), then best-effort notify the
 * recipient. The AFTER-INSERT trigger on Message broadcasts realtime. Shared by
 * the send endpoint and the conversation-create endpoint (initial message) so the
 * side effects live in ONE place. Caller is responsible for the participant check.
 *
 * ⚠️ VISA CARDS: `text` should be EMPTY. The realtime broadcast payload carries only
 * (id, senderProfileId, body, createdAt) — no kind/meta — and the thread client
 * refetches when the broadcast body is empty, which is exactly how offer cards
 * already hydrate. A non-empty card body would be appended as a plain text bubble
 * until the next 15s backstop poll. Pass `opts.preview` for the inbox line instead.
 */
export async function insertMessage(convo: ConvoForSend, senderId: string, text: string, opts?: SendOpts): Promise<SerializedMessage> {
  const iAmBuyer = convo.buyerProfileId === senderId
  const kind = opts?.kind ?? 'text'
  // Runtime guard for JS callers / a value widened past the union somewhere.
  if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) throw new Error('message_kind_invalid')
  const isOffer = kind === 'offer'
  // The two card families are built by SEPARATE gates and never share one — a visa card is
  // bound to a visa case, a trip card to an assistance request, and collapsing them into one
  // "isCard" build step is exactly how a future kind would inherit the wrong ownership check.
  const isVisaCard = isVisaCardKind(kind)
  const isTripCard = isTripCardKind(kind)
  const isCard = isVisaCard || isTripCard
  // metaJson belongs to cards ONLY — a 'text'/'offer' message carrying one would be
  // a card the renderers don't gate on, so refuse rather than silently drop it.
  if (opts?.meta && !isCard) throw new Error('message_meta_not_allowed')
  const card = isVisaCard ? await buildCardMeta(kind, convo, senderId, opts?.meta) : null
  const tripCard = isTripCard ? await buildTripCardMeta(kind, convo, senderId, opts?.meta) : null

  // Cards are sent with an empty body (see the note above) — fall back to the
  // caller-supplied bilingual preview so the inbox row isn't blank. Unchanged for
  // 'text'/'offer': preview is ignored there.
  const previewText = isCard && !text ? (opts?.preview ?? '') : text
  const createArgs = {
    data: {
      conversationId: convo.id,
      senderProfileId: senderId,
      body: text,
      kind,
      offerAmount: isOffer ? opts?.offerAmount ?? null : null,
      offerStatus: isOffer ? 'pending' : null,
      metaJson: card?.json ?? tripCard?.json ?? null,
    },
    // `as const` (not a plain literal): Prisma derives the row type from `true`
    // literals — a widened `boolean` here collapses the inferred payload.
    select: { id: true, body: true, createdAt: true, kind: true, offerAmount: true, offerStatus: true, metaJson: true } as const,
  }
  const convoUpdate = {
    lastMessageAt: new Date(),
    lastMessageText: previewText.slice(0, 140),
    ...(iAmBuyer ? { sellerUnread: { increment: 1 } } : { buyerUnread: { increment: 1 } }),
  }

  type MessageRow = { id: string; body: string; createdAt: Date; kind: string; offerAmount: number | null; offerStatus: string | null; metaJson: string | null }
  let message: MessageRow
  if (card) {
    // ATOMIC GUARD — the WHERE depends on HOW buildCardMeta proved the binding (external
    // review, GPT-5.6 2026-07-23):
    //   · IMMUTABLE proof → lock by { id } alone. The visa_applications.conversation_id link
    //     is permanent and cannot move, so re-asserting the LIVE pointer here would be the very
    //     stranding bug (a rebound thread makes it match 0 rows and refuses a legitimate card
    //     for an earlier case). count!==1 then means only the conversation itself is gone.
    //   · LIVE fallback → keep the { id, visaApplicationId } predicate. That proof rested on a
    //     mutable pointer, so a concurrent rebind between buildCardMeta and here IS possible;
    //     the predicate rejects the insert if the binding moved under us.
    const guardWhere = card.proof === 'immutable'
      ? { id: convo.id }
      : { id: convo.id, visaApplicationId: card.applicationId }
    message = (await db.$transaction(async (tx) => {
      const guard = await tx.conversation.updateMany({ where: guardWhere, data: convoUpdate })
      if (guard.count !== 1) throw new Error(card.proof === 'immutable' ? 'visa_card_conversation_gone' : 'visa_card_application_mismatch')
      return tx.message.create(createArgs)
    })) as MessageRow
  } else if (tripCard) {
    // ATOMIC GUARD for a trip card. buildTripCardMeta proved the binding a moment ago against
    // a MUTABLE column, so a concurrent rebind between that read and this insert is possible;
    // the guard re-asserts it inside the transaction.
    //
    // ⚠️ IT IS AN UPDATE, NOT A READ, AND THAT IS THE POINT. A plain findFirst inside the
    // transaction would not lock the row under READ COMMITTED — it would just re-read the same
    // pre-rebind snapshot and prove nothing. Writing `conversationId` back to the value it
    // already holds is a real row write, so it takes a genuine lock and the WHERE clause
    // becomes a compare-and-set: if the case was rebound, this matches zero rows and the whole
    // transaction (message included) rolls back. This repo learned the read-does-not-lock
    // lesson the expensive way in the visa capture race — locking a row is not enough, the
    // statement has to MODIFY it.
    //
    // Consequence, deliberate: @updatedAt bumps, so the operator queue (@@index([status,
    // updatedAt])) orders by last desk activity rather than last state change. That is the
    // ordering a support queue wants; noting it because it is a behaviour change, not a no-op.
    const caseBinding = tripCard.bind === 'case' ? tripCard : null
    message = (await db.$transaction(async (tx) => {
      // A THREAD-BOUND card (trip_step) has no case row to compare against, so this step is
      // skipped rather than faked. Its proof is desk authorship, established in buildTripCardMeta;
      // inventing a predicate here would only look like a guard.
      if (caseBinding) {
        const bound = await tx.tripAssistanceRequest.updateMany({
          // EVERY gate that can be re-asserted cheaply IS re-asserted here, not just the binding.
          // codex's refutation was right: proving the traveller in buildTripCardMeta and then
          // only re-checking conversationId in the transaction left gate (3) resting on a read
          // that a concurrent write could have invalidated. Both predicates cost nothing — they
          // are columns on a row this statement already touches.
          where: { id: caseBinding.requestId, conversationId: convo.id, profileId: convo.buyerProfileId, ...caseBinding.guard },
          data: { conversationId: convo.id },
        })
        if (bound.count !== 1) throw new Error('trip_card_conversation_mismatch')
      }
      const guard = await tx.conversation.updateMany({ where: { id: convo.id }, data: convoUpdate })
      if (guard.count !== 1) throw new Error('trip_card_conversation_gone')
      return tx.message.create(createArgs)
    })) as MessageRow
  } else {
    // A new offer supersedes any still-pending offer in the thread (from either side)
    // so only the latest is actionable — that's the "counter" flow.
    const ops: Prisma.PrismaPromise<unknown>[] = []
    if (isOffer) {
      ops.push(db.message.updateMany({
        where: { conversationId: convo.id, kind: 'offer', offerStatus: 'pending' },
        data: { offerStatus: 'countered' },
      }))
    }
    ops.push(
      db.message.create(createArgs),
      db.conversation.update({ where: { id: convo.id }, data: convoUpdate }),
    )
    const result = (await db.$transaction(ops)) as unknown[]
    message = result[isOffer ? 1 : 0] as MessageRow
  }

  // Plain chat messages do NOT create a bell notification or push — they already
  // surface on the Messages-icon unread badge (the conversation unread counter,
  // incremented above). Only OFFERS (and future notification types) notify, to
  // keep the bell + push meaningful instead of noisy. Visa cards deliberately stay
  // in the quiet class: they are emitted WHILE the applicant is in the thread
  // driving the wizard, so a bell + push per step would be pure noise (and would
  // need persisted copy this layer has no business inventing).
  const recipientId = iAmBuyer ? convo.sellerProfileId : convo.buyerProfileId
  if (recipientId && isOffer) {
    try {
      const sender = await db.profile.findUnique({ where: { id: senderId }, select: { displayName: true, email: true } })
      const senderName = sender?.displayName || maskEmailHandle(sender?.email) || 'Someone'
      // Offer bodies are empty (the offer line is derived from offerAmount at render
      // time) — build the notification text from the structured amount + any note.
      // Persisted copy is BILINGUAL-composite (the price-drop.ts idiom): notification
      // and push bodies are stored server-side, where tr() can't run at render time —
      // an EN-only string violated the i18n invariant on a money surface (audit P1 #6).
      const notifText = opts?.offerAmount != null
        ? `Trả giá · Offered ${formatMoneyFull(opts.offerAmount, '₫')}${text ? ` — ${text}` : ''}`
        : text
      await db.notification.create({
        data: {
          recipientId,
          type: 'offer',
          title: senderName,
          body: notifText.slice(0, 140),
          actorName: senderName,
          conversationId: convo.id,
          listingId: convo.listingId,
        },
      })
      // Web push so the recipient sees the offer even with eno.vn closed. Best-effort,
      // after the response flushes — never delays the send.
      after(() => sendPushToProfile(recipientId, {
        title: senderName,
        body: notifText.slice(0, 140),
        url: `/messages/${convo.id}`,
        tag: `convo-${convo.id}`,
      }))
    } catch (e) {
      console.error('[messages] notify', e)
    }
  }

  return {
    id: message.id, mine: true, body: message.body, createdAt: message.createdAt.toISOString(),
    kind: message.kind, offerAmount: message.offerAmount, offerStatus: message.offerStatus,
    meta: parseMessageMeta(message.kind, message.metaJson),
  }
}

/**
 * Advance a visa_step card's lifecycle (the "acknowledge / skip" tap). Rewrites ONLY
 * `state` — step, applicationId and needsReview are re-emitted from the stored blob,
 * so a caller can never repoint a card at another case or re-open a paid flow.
 * Returns the new meta, or null when the card isn't updatable.
 *
 * Caller MUST have verified the actor is a participant of this conversation (same
 * discipline as insertMessage). No realtime broadcast fires for an UPDATE — the
 * thread's backstop poll / refetch picks it up, and the acting client already knows.
 */
export async function setVisaStepState(conversationId: string, messageId: string, state: VisaStepMeta['state']): Promise<VisaStepMeta | null> {
  const row = await db.message.findFirst({
    where: { id: messageId, conversationId, kind: 'visa_step' },
    select: { id: true, metaJson: true },
  })
  const meta = row ? parseMessageMeta('visa_step', row.metaJson) : null
  if (!row || !meta || !('step' in meta)) return null
  // Re-validate the RESULT, don't trust the argument (external review, 2026-07-22).
  // `meta` came back through parseMessageMeta so it is already clean, but `state` is
  // a caller value — a route that piped free text in through the un-typed boundary
  // would otherwise persist it. Every write of metaJson goes through a strict parse.
  const candidate = visaStepMetaSchema.safeParse({ ...meta, state })
  if (!candidate.success) return null
  const next = candidate.data as VisaStepMeta
  await db.message.update({ where: { id: row.id }, data: { metaJson: JSON.stringify(next) } })
  return next
}

/**
 * Close (or re-stamp) a picker card. Same contract as setVisaStepState: applicationId is
 * re-emitted from the stored blob, the result is re-validated through the strict schema,
 * and the caller must already have verified thread participation. `selectedListingId` is
 * display-only history ("you chose X") — never a price or charge authority.
 */
export async function setVisaPickerState(
  conversationId: string,
  messageId: string,
  state: VisaPickerMeta['state'],
  selectedListingId?: string,
): Promise<VisaPickerMeta | null> {
  const row = await db.message.findFirst({
    where: { id: messageId, conversationId, kind: 'visa_picker' },
    select: { id: true, metaJson: true },
  })
  const meta = row ? parseMessageMeta('visa_picker', row.metaJson) : null
  if (!row || !meta || !('state' in meta) || 'step' in meta || 'amountUsd' in meta) return null
  const candidate = visaPickerMetaSchema.safeParse({
    ...meta,
    state,
    ...(selectedListingId ? { selectedListingId } : {}),
  })
  if (!candidate.success) return null
  const next = candidate.data as VisaPickerMeta
  await db.message.update({ where: { id: row.id }, data: { metaJson: JSON.stringify(next) } })
  return next
}

/**
 * Stamp the thread's checkout card paid/failed.
 *
 * ⚠️ SERVER-ONLY, PROVIDER-CONFIRMED. 'paid' can be written ONLY here — and this
 * function does NOT take the caller's word for it: it re-reads
 * visa_applications.paid_at and refuses unless the payments layer has ALREADY
 * stamped the row after verifying the capture with PayPal/Stripe
 * (markVisaPaidAndHandoff, src/lib/visa/payments.ts). So even a route that piped a
 * client-supplied status straight in cannot mark a card paid; the worst it can do is
 * re-assert a payment that really happened. Fails CLOSED if that lookup errors.
 * Cross-checks the conversation's binding AND the card's own applicationId too, so a
 * mismatched thread/case pair is a no-op.
 */
export async function setVisaCheckoutStatus(conversationId: string, applicationIdValue: string, status: 'paid' | 'failed'): Promise<boolean> {
  if (status === 'paid') {
    // Evidence gate. Lazy import so the service-role Supabase client never loads on
    // the ordinary messaging path (the records.ts idiom).
    try {
      const { getVisaDb } = await import('@/lib/visa/db')
      const { data, error } = await getVisaDb().from('visa_applications').select('paid_at').eq('id', applicationIdValue).maybeSingle()
      if (error) throw error
      if (!(data as { paid_at?: string | null } | null)?.paid_at) return false
    } catch (e) {
      console.error('[messages] visa paid-evidence lookup failed', e)
      return false
    }
  }
  const convo = await db.conversation.findUnique({ where: { id: conversationId }, select: { visaApplicationId: true } })
  if (!convo?.visaApplicationId || convo.visaApplicationId !== applicationIdValue) return false
  const row = await db.message.findFirst({
    where: { conversationId, kind: 'visa_checkout' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metaJson: true },
  })
  const meta = row ? parseMessageMeta('visa_checkout', row.metaJson) : null
  if (!row || !meta || meta.applicationId !== applicationIdValue) return false
  // Re-validate the RESULT (see setVisaStepState) — every metaJson write, insert or
  // update, passes a strict parse, so no caller value reaches the column unchecked.
  const candidate = visaCheckoutMetaSchema.safeParse({ ...(meta as VisaCheckoutMeta), status })
  if (!candidate.success) return false
  await db.message.update({ where: { id: row.id }, data: { metaJson: JSON.stringify(candidate.data) } })
  return true
}

/**
 * Accept or decline a pending offer. The actor must be the RECIPIENT of that offer
 * (not the one who made it). Updates the offer's status, drops a confirmation
 * message into the thread (broadcasts via the Message trigger), and notifies +
 * pushes the offerer. Returns false if the offer isn't actionable by this user.
 */
export async function actOnOffer(
  convo: ConvoForSend,
  actorId: string,
  messageId: string,
  action: 'accept' | 'decline',
): Promise<boolean> {
  const offer = await db.message.findFirst({
    where: { id: messageId, conversationId: convo.id, kind: 'offer', offerStatus: 'pending' },
    select: { id: true, senderProfileId: true, offerAmount: true },
  })
  // Only the OTHER party can accept/decline — never your own offer.
  if (!offer || offer.senderProfileId === actorId) return false

  const status = action === 'accept' ? 'accepted' : 'declined'
  // Atomic claim: only transition while STILL pending, so two concurrent
  // accept/decline (or double-clicks) can't both emit the confirmation message +
  // notification/push (TOCTOU). count===0 means another request already won.
  const claim = await db.message.updateMany({ where: { id: offer.id, offerStatus: 'pending' }, data: { offerStatus: status } })
  if (claim.count === 0) return false

  // Confirmation line in the timeline (plain text → broadcasts to both sides).
  const amt = offer.offerAmount != null ? formatMoneyFull(offer.offerAmount, '₫') : ''
  // Bilingual composite — this line PERSISTS into Message.body (and the bell/push
  // below), so it can't be tr()'d at display time (audit P1 #6).
  const text = action === 'accept'
    ? `✅ Đã chấp nhận · Offer accepted${amt ? ` — ${amt}` : ''}`
    : `❌ Đã từ chối · Offer declined${amt ? ` — ${amt}` : ''}`
  await insertMessage(convo, actorId, text)

  // Notify the offerer of the outcome (offers are high-signal → bell + push).
  try {
    const actor = await db.profile.findUnique({ where: { id: actorId }, select: { displayName: true, email: true } })
    const actorName = actor?.displayName || maskEmailHandle(actor?.email) || 'Someone'
    await db.notification.create({
      data: { recipientId: offer.senderProfileId, type: 'offer', title: actorName, body: text, actorName, conversationId: convo.id, listingId: convo.listingId },
    })
    after(() => sendPushToProfile(offer.senderProfileId, { title: actorName, body: text, url: `/messages/${convo.id}`, tag: `convo-${convo.id}` }))
  } catch (e) {
    console.error('[messages] offer-action notify', e)
  }
  return true
}
