import 'server-only'
import { randomUUID } from 'node:crypto'
// Relative specifiers throughout (the crypto.ts / schema.ts / dm-thread.ts idiom): every
// branch below is unit-tested in dm-flow.test.ts, and the sibling modules are mocked by
// the same specifier the source uses. Same modules either way.
import { db } from '../db'
import { parseMessageMeta, setVisaStepState, type VisaCheckoutMeta, type VisaStepMeta } from '../messages'
import {
  getVisaShopListings,
  getVisaShopSeller,
  resolveVisaProduct,
  visaPrefillForProduct,
  type VisaShopProduct,
} from '../visa-shop'
import { decryptVisaPayload, encryptVisaPayload, visaCryptoReady } from './crypto'
import { getVisaDb, visaTableMissing } from './db'
import { firstIncompleteVisaDmStep, VISA_DM_STEP_FIELDS, type VisaDmStep } from './dm-steps'
import { bindVisaThread, findVisaThread, getVisaThreadMode, sendVisaCheckoutCard, sendVisaStepCard } from './dm-thread'
import { quoteVisaUsd } from './fx'
import { visaPaymentsConfig } from './payments'
import { recordVisaEvent, type VisaApplicationRow, type VisaDocumentRow } from './records'
import { emptyVisaPayload, visaPayloadSchema, type VisaPayload } from './schema'

// ── THE IN-DM e-VISA WIZARD LOOP ───────────────────────────────────────────────────
//
// The owner's ask, verbatim: "user click chat then selects available product from admin
// shop and continues uploading images and filling up the form lastly checks out inside
// chat and if needed admin can take over chat but mostly ai should guide … shouldnt be
// more than 5 pages since inside the message".
//
// dm-steps.ts froze the 5-step PARTITION and dm-thread.ts owns the one CARD-AUTHORING
// surface. Neither of them decides WHEN a card is emitted, and neither of them knows who
// is asking. This module is the loop between the two, and the routes above it are the
// entitlement layer:
//
//   route  →  authenticate + prove ownership  →  dm-flow  →  dm-thread  →  messages.ts
//
// ⚠️ WHAT THIS MODULE DOES **NOT** DO — the same warning dm-thread.ts carries, because it
// inherits the hole rather than closing it. NOTHING HERE ASKS "WHO IS THE SESSION?". Every
// entry point takes a `userId` and treats it as an ALREADY-AUTHENTICATED actor: it is
// compared against visa_applications.user_id and against Conversation.buyerProfileId, so a
// caller that passes the wrong id gets a refusal — but a route that passes an id it never
// verified has already lost. Authentication belongs to the route; this module does
// authorization on top of it and nothing below it.
//
// ⚠️ NO PII LEAVES THIS MODULE. It decrypts (it must — the step a case is on is a function
// of the answers), and every value it reads dies inside a boolean:
//   · a card's metaJson carries a step number, an application id and FIELD NAMES;
//   · visa_events metadata carries listing ids and step numbers, both public facts;
//   · nothing applicant-typed is ever logged, echoed in an error, or written to a
//     plaintext column. Error bodies name KEYS, never values.
//
// ⚠️ MONEY IS SERVER TRUTH, TWICE OVER. The client names a PRODUCT at /start; the đồng
// price is re-read from the listing on every pass (resolveVisaProduct) and converted by a
// SERVER-ISSUED quote (quoteVisaUsd). No number from a request body reaches
// sendVisaCheckoutCard, and no rate is ever guessed — FX down means no card and an honest
// 503, never a card with a made-up price on it.

/** Statuses in which the applicant still owns the case and the wizard may write. */
const EDITABLE_STATUSES: ReadonlySet<string> = new Set(['draft', 'needs_changes'])

/**
 * The visa_events row that records WHICH product the applicant picked in chat.
 *
 * Derived state, not a column — exactly the trick getVisaThreadMode uses for the thread
 * mode: visa_events already has a free-text `event` and a jsonb `metadata`, so recording
 * the choice needs no DDL and no migration to coordinate with the forum's copy of these
 * tables. Newest wins, so re-entering /start with a different product simply re-points the
 * checkout at the new one.
 *
 * Deliberately NOT Conversation.listingId: that column is under `@@unique([listingId,
 * buyerProfileId])`, so retargeting a reused thread onto the picked product can collide
 * with the buyer's own existing thread for that listing — a create-time constraint failure
 * in the middle of a wizard, to store a fact that fits fine in the audit log.
 */
export const VISA_DM_PRODUCT_EVENT = 'dm_product_selected'

/**
 * Exactly the payload keys src/app/api/visa/applications/[id]/extract can suggest — the
 * Gemini `fields` block plus everything parsePassportMrz returns except nationalityCode
 * (which is an ICAO 3-letter code, not the payload's `nationality`).
 *
 * ⚠️ FIELD NAMES ONLY, and that is the entire point (requirement 3): the step-2 card asks
 * the applicant to ACKNOWLEDGE what was read off their passport, so the card must name the
 * fields and never carry their values. dm-flow.test.ts proves every entry is a real payload
 * key and that the list is a subset of the step-2 partition, so a card can never nominate a
 * field the step does not own.
 *
 * ⚠️ NOT re-derived from the extraction: the extract route persists only the COUNT of
 * suggested fields (visa_events.metadata.fieldsSuggested) and never the names, so there is
 * nothing to read back. This list is therefore a MIRROR of that route's suggestion keys and
 * must be kept equal to them; being wrong in the safe direction (naming a field the AI did
 * not fill) costs one extra glance, being wrong the other way costs an unreviewed field.
 */
export const VISA_DM_EXTRACTABLE_FIELDS: readonly string[] = [
  'surname', 'givenNames', 'dateOfBirth', 'sex', 'nationality', 'identityNumber', 'placeOfBirth',
  'passportNumber', 'passportType', 'passportIssuingAuthority', 'passportIssueDate', 'passportExpiryDate',
]

/**
 * The card kinds this loop reads back when deciding whether it has already asked. Bounded
 * scans: a visa thread holds a handful of cards, and the [conversationId, createdAt] index
 * serves both queries.
 */
const CARD_SCAN_LIMIT = 30

export type VisaDmErrorCode =
  | 'application_cancelled'
  | 'application_changed_retry'
  | 'application_locked'
  | 'checkout_card_refused'
  | 'field_not_in_step'
  | 'fx_unavailable'
  | 'internal_error'
  | 'invalid_fields'
  | 'listing_not_found'
  | 'not_found'
  | 'payments_not_configured'
  | 'product_not_configured'
  | 'product_not_for_sale'
  | 'product_not_selected'
  | 'product_price_unavailable'
  | 'rate_limited'
  | 'shop_unavailable'
  | 'step_card_refused'
  | 'thread_conflict'
  | 'thread_not_bound'
  | 'visa_encryption_not_configured'
  | 'visa_schema_not_ready'

export type VisaDmFailure = {
  ok: false
  error: VisaDmErrorCode
  status: number
  /** Present when the failure happened with a known step — the UI keeps its place. */
  step?: VisaDmStep
  complete?: boolean
  /** Payload KEYS an edit was refused for. Never values. */
  fields?: string[]
}

export type VisaDmAdvance =
  | { ok: true; step: VisaDmStep; messageId: string | null; complete: boolean }
  | VisaDmFailure

export type VisaDmStart =
  | { ok: true; applicationId: string; conversationId: string; step: VisaDmStep }
  | VisaDmFailure

const fail = (error: VisaDmErrorCode, status: number, extra?: Omit<VisaDmFailure, 'ok' | 'error' | 'status'>): VisaDmFailure =>
  ({ ok: false, error, status, ...extra })

/**
 * Turn a thrown Supabase/driver error into a failure the UI can render.
 *
 * ⚠️ NEVER echoes the driver's message: these queries carry passport ciphertext and user
 * ids, and a PostgREST error string can quote the statement. The class of failure is
 * enough for the client; the detail goes to the server log.
 */
export function visaDmFailureFor(error: unknown): VisaDmFailure {
  const code = (error as { code?: string })?.code
  const message = (error as Error)?.message ?? ''
  if (visaTableMissing({ code })) return fail('visa_schema_not_ready', 503)
  if (message.includes('not_configured')) return fail('visa_schema_not_ready', 503)
  console.error('[visa-dm] flow failed', error)
  return fail('internal_error', 500)
}

// ── The case ──────────────────────────────────────────────────────────────────────

export type VisaDmCase = {
  application: VisaApplicationRow
  documents: VisaDocumentRow[]
  payload: VisaPayload
}

/**
 * The case + its documents + its DECRYPTED payload, scoped to its owner.
 *
 * `.eq('user_id', userId)` is the whole authorization story for the application half: a
 * case that is not this user's simply does not exist here, so every caller below inherits
 * the same 404 and none of them can opt out of it.
 */
export async function loadVisaDmCase(applicationId: string, userId: string): Promise<VisaDmCase | null> {
  if (!applicationId || !userId) return null
  const supabase = getVisaDb()
  const [applicationResult, documentsResult] = await Promise.all([
    supabase.from('visa_applications').select('*').eq('id', applicationId).eq('user_id', userId).maybeSingle(),
    supabase.from('visa_documents').select('*').eq('application_id', applicationId),
  ])
  if (applicationResult.error) throw applicationResult.error
  const application = applicationResult.data as VisaApplicationRow | null
  if (!application) return null
  return {
    application,
    documents: (documentsResult.data || []) as VisaDocumentRow[],
    payload: decryptVisaPayload(application.encrypted_payload),
  }
}

/**
 * Did the passport extraction actually run on this case?
 *
 * TWO fingerprints, because the obvious one is erasable: the extract route stamps
 * `ai_extraction_needs_review` into visa_applications.checklist, but every payload save
 * (PATCH, and this module's own edit path) clears the checklist — so after the applicant's
 * first correction the marker is gone while the extraction plainly happened. The durable
 * fingerprint is `mrzChecks` in the passport document's validation_report, which ONLY the
 * successful passport branch of the extract route writes and which no payload write
 * touches. Either is proof; neither is required to survive the other.
 */
function passportExtractionRan(application: VisaApplicationRow, documents: VisaDocumentRow[]): boolean {
  const checklist = Array.isArray(application.checklist) ? application.checklist : []
  if (checklist.includes('ai_extraction_needs_review')) return true
  return documents.some((document) => {
    if (document.kind !== 'passport') return false
    const report = document.validation_report
    return !!report && typeof report === 'object' && 'mrzChecks' in report
  })
}

/**
 * The step-2 card's `needsReview`: the payload FIELD NAMES the passport read filled in, so
 * the card can say "confirm these" with a SKIP instead of asking the applicant to retype a
 * passport they already photographed.
 *
 * Empty until an extraction has run — a card that says "acknowledge what we read" when
 * nothing was read is a lie, and dm-thread drops the key entirely when the array is empty.
 *
 * ⚠️ THE VALUES ARE READ AND THROWN AWAY. `payload[name]` decides membership; only `name`
 * is returned. That is the one honest way to answer "which fields do we hold?" without the
 * answer becoming "…and here they are", and it is why this function returns string[] and
 * not a record.
 */
export function visaDmStep2NeedsReview(kase: VisaDmCase): string[] {
  if (!passportExtractionRan(kase.application, kase.documents)) return []
  const payload = kase.payload as unknown as Record<string, unknown>
  return VISA_DM_EXTRACTABLE_FIELDS.filter((name) => {
    const value = payload[name]
    return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null && value !== ''
  })
}

// ── The picked product ────────────────────────────────────────────────────────────

/** Newest `dm_product_selected` event's listingId, or null. Fails CLOSED (null on error). */
export async function selectedVisaDmListingId(applicationId: string): Promise<string | null> {
  try {
    const { data, error } = await getVisaDb()
      .from('visa_events')
      .select('metadata,created_at,id')
      .eq('application_id', applicationId)
      .eq('event', VISA_DM_PRODUCT_EVENT)
      // id as the tiebreak, exactly like getVisaThreadMode: two events written in one
      // transaction can share created_at and "newest wins" must be deterministic.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
    if (error) throw error
    const metadata = (data as Array<{ metadata?: unknown }> | null)?.[0]?.metadata
    if (!metadata || typeof metadata !== 'object') return null
    const listingId = (metadata as { listingId?: unknown }).listingId
    return typeof listingId === 'string' && listingId.trim() ? listingId.trim() : null
  } catch (e) {
    console.error('[visa-dm] product selection lookup failed', e)
    return null
  }
}

/**
 * Why this listing cannot start (or finish) a visa thread. resolveVisaProduct answers one
 * honest null for every reason, which is right for a money lookup and useless for a buyer.
 *
 * Only ever runs on the failure path. A listing that is not on the visa storefront at all
 * is `listing_not_found` rather than "not a visa product": the chat only ever offers the
 * desk's own catalogue, so from this surface a foreign listing genuinely does not exist.
 */
export async function explainUnsellableVisaListing(listingId: string): Promise<VisaDmFailure> {
  const row = (await getVisaShopListings()).find((listing) => listing.id === listingId)
  if (!row) return fail('listing_not_found', 404)
  if (!row.verified || row.status !== 'active') return fail('product_not_for_sale', 409)
  // On the storefront and for sale, yet unresolvable ⇒ the price itself is unusable (not
  // whole đồng, non-positive, or still carrying '$' — see sellablePriceVnd in visa-shop).
  return fail('product_price_unavailable', 409)
}

/** A product that may actually be sold: on the catalogue AND finished being set up. */
async function chargeableVisaProduct(listingId: string): Promise<VisaShopProduct | VisaDmFailure> {
  const product = await resolveVisaProduct(listingId)
  if (!product) return await explainUnsellableVisaListing(listingId)
  // Entry type and speed ARE the service (a government form needs single/multiple, and the
  // speed is the premium being paid for). The admin can see a half-built row; nobody can
  // buy it — the checkout route refuses it with the same code.
  if (!product.entryType || !product.speed) return fail('product_not_configured', 409)
  return product
}

const isFailure = (value: unknown): value is VisaDmFailure =>
  !!value && typeof value === 'object' && (value as VisaDmFailure).ok === false

// ── Cards already in the thread ───────────────────────────────────────────────────

type StepCardRow = { id: string; meta: VisaStepMeta }
type CheckoutCardRow = { id: string; meta: VisaCheckoutMeta }

/**
 * This case's step cards in the thread, newest first.
 *
 * Scoped by conversation AND by the card's own applicationId: a rebound thread (a repeat
 * applicant's second case) keeps the previous case's cards in the timeline as inert
 * history, and history must never be mistaken for "we already asked this".
 */
async function visaStepCards(conversationId: string, applicationId: string): Promise<StepCardRow[]> {
  const rows = await db.message.findMany({
    where: { conversationId, kind: 'visa_step' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metaJson: true },
    take: CARD_SCAN_LIMIT,
  })
  const cards: StepCardRow[] = []
  for (const row of rows) {
    const meta = parseMessageMeta('visa_step', row.metaJson)
    if (!meta || !('step' in meta) || meta.applicationId !== applicationId) continue
    cards.push({ id: row.id, meta })
  }
  return cards
}

/** The newest checkout card that speaks for this case in this thread, or null. */
async function newestVisaCheckoutCard(conversationId: string, applicationId: string): Promise<CheckoutCardRow | null> {
  const rows = await db.message.findMany({
    where: { conversationId, kind: 'visa_checkout' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metaJson: true },
    take: CARD_SCAN_LIMIT,
  })
  for (const row of rows) {
    const meta = parseMessageMeta('visa_checkout', row.metaJson)
    if (!meta || !('status' in meta) || meta.applicationId !== applicationId) continue
    return { id: row.id, meta }
  }
  return null
}

/**
 * Close the cards the flow has provably moved past.
 *
 * Only steps STRICTLY BELOW the new one, and only cards still 'active': those steps'
 * issues are satisfied, so 'done' is a fact. A card for a HIGHER step is left alone — the
 * flow going backwards (a replaced photo that failed the quality check) does not mean the
 * later step was answered, and the state enum has no word for "superseded".
 */
async function closeSupersededStepCards(conversationId: string, cards: StepCardRow[], step: VisaDmStep): Promise<void> {
  for (const card of cards) {
    if (card.meta.state !== 'active' || card.meta.step >= step) continue
    try {
      await setVisaStepState(conversationId, card.id, 'done')
    } catch (e) {
      // Cosmetic bookkeeping — never worth failing an advance over.
      console.error('[visa-dm] could not close superseded card', e)
    }
  }
}

// ── The encrypted write ───────────────────────────────────────────────────────────

/**
 * THE ONE PAYLOAD WRITER in this module, and it is the same write PATCH
 * /api/visa/applications/[id] performs: encryptVisaPayload into `encrypted_payload`, with
 * the consent stamps nulled because the payload the applicant consented to no longer
 * exists. There is no plaintext column anywhere in this path and there must never be one.
 *
 * CAS ON status **AND** updated_at (the extract route's discipline, stricter than PATCH's):
 * a chat wizard has several writers pointed at one row — the applicant's card action, the
 * passport extraction merging suggestions, an admin transition — and a lost update here is
 * a government form quietly carrying somebody's earlier answer. A 0-row miss is reported as
 * `application_changed_retry`, never swallowed.
 */
async function writeVisaPayload(input: {
  applicationId: string
  userId: string
  expectedUpdatedAt: string
  payload: VisaPayload
}): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await getVisaDb()
    .from('visa_applications')
    .update({
      encrypted_payload: encryptVisaPayload(input.payload),
      checklist: [],
      updated_at: now,
      applicant_confirmed_at: null, applicant_confirmation_version: null,
      authorized_at: null, authorization_version: null,
      applicant_snapshot_hash: null, authorization_snapshot_hash: null,
      last_applicant_action_at: now,
    })
    .eq('id', input.applicationId)
    .eq('user_id', input.userId)
    .in('status', [...EDITABLE_STATUSES])
    .eq('updated_at', input.expectedUpdatedAt)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return !!data
}

/**
 * A `Record<string,string>` from a chat form → the payload's own types.
 *
 * The shape is derived from the LIVE payload rather than a hand-kept list of "the numeric
 * ones": every key of a decrypted payload has already been through visaPayloadSchema, so
 * `typeof current` IS the schema's type for that key and cannot drift from it. An
 * uncoercible value is passed through untouched so the schema — not this function — is what
 * rejects it, with the field name and no value.
 */
function coerceVisaFieldValue(current: unknown, raw: string): unknown {
  if (typeof current === 'number') {
    const parsed = Number(raw.trim())
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw
  }
  if (typeof current === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return raw
  }
  return raw
}

/**
 * Write the fields a chat step collected into the encrypted payload.
 *
 * ⚠️ THE STEP IS THE ALLOWLIST. Only keys in VISA_DM_STEP_FIELDS[step] are writable, so a
 * card cannot be used to reach a field it does not own — in particular the four
 * system/admin-owned keys (schemaVersion, adminMessage, governmentRegistrationCode,
 * governmentApplicationStatus) are in no step's list and are therefore unreachable from
 * chat entirely. Refusals name the KEY and never the value.
 */
export async function applyVisaDmFieldEdit(input: {
  applicationId: string
  userId: string
  step: VisaDmStep
  fields: Record<string, string>
}): Promise<{ ok: true } | VisaDmFailure> {
  const allowed = new Set(VISA_DM_STEP_FIELDS[input.step] ?? [])
  const offered = Object.keys(input.fields || {})
  const rejected = offered.filter((key) => !allowed.has(key))
  if (rejected.length) return fail('field_not_in_step', 400, { fields: rejected.slice(0, 20), step: input.step })
  if (!offered.length) return { ok: true }

  const kase = await loadVisaDmCase(input.applicationId, input.userId)
  if (!kase) return fail('not_found', 404)
  if (!EDITABLE_STATUSES.has(kase.application.status)) {
    return fail(kase.application.status === 'cancelled' ? 'application_cancelled' : 'application_locked', 409)
  }

  const current = kase.payload as unknown as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current }
  for (const key of offered) merged[key] = coerceVisaFieldValue(current[key], String(input.fields[key] ?? ''))

  const parsed = visaPayloadSchema.safeParse(merged)
  // ⚠️ PATHS ONLY. zod issues carry the offending INPUT in some branches, and the input
  // here is passport data — so the response is built from `issue.path`, never from
  // `issue.message` or the parsed value, and the whole error object is never logged.
  if (!parsed.success) {
    const bad = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')).filter(Boolean))]
    return fail('invalid_fields', 400, { fields: bad.slice(0, 20), step: input.step })
  }

  const wrote = await writeVisaPayload({
    applicationId: input.applicationId,
    userId: input.userId,
    expectedUpdatedAt: kase.application.updated_at,
    payload: parsed.data,
  })
  if (!wrote) return fail('application_changed_retry', 409, { step: input.step })
  // The KEYS that changed, as an audit trail. Names are already public vocabulary (they
  // are in the card's own metaJson); the values stay in the ciphertext.
  await recordVisaEvent(input.applicationId, 'applicant', 'dm_step_fields_saved', input.userId, {
    step: input.step, fields: offered.slice(0, 40),
  })
  return { ok: true }
}

// ── The loop ──────────────────────────────────────────────────────────────────────

/**
 * Recompute the current step from the payload + documents and emit the card for it.
 *
 * IDEMPOTENT, which is the property the whole surface leans on: the client calls this after
 * every upload, every card action and every reconnect, so "post the card for the current
 * step" must mean "make sure the card for the current step exists", not "post one". The
 * newest step card for this case is compared against the recomputed step; an identical,
 * still-active card is REUSED and its id returned, and nothing is written.
 *
 * FIVE PAGES, NEVER SIX: the step comes from firstIncompleteVisaDmStep over the frozen
 * partition, and `null` (all five satisfied) is not a sixth step — it is the checkout card,
 * which IS step 5 ("Review & pay").
 *
 * ADMIN MODE STOPS THE WIZARD (requirement 5). A human who took the thread over is not
 * talked over: nothing is emitted, and `messageId: null` says so honestly. sendVisaStepCard
 * enforces the same rule one layer down; the checkout card is exempt THERE (an admin still
 * needs the applicant to pay) but not HERE, because an automatic loop posting a pay card
 * mid-conversation is exactly the interruption the rule exists to prevent. The admin ending
 * their takeover returns the thread to 'ai' and the next call resumes.
 */
export async function advanceVisaDmFlow(input: { applicationId: string; userId: string }): Promise<VisaDmAdvance> {
  if (!visaCryptoReady()) return fail('visa_encryption_not_configured', 503)
  const kase = await loadVisaDmCase(input.applicationId, input.userId)
  if (!kase) return fail('not_found', 404)

  // ── THE THREAD MUST BE THIS BUYER'S ──────────────────────────────────────────────
  // The application is theirs (scoped read above); this proves the CONVERSATION is too,
  // which is the other half of the binding every card is validated against.
  const thread = await findVisaThread(input.applicationId)
  if (!thread) return fail('thread_not_bound', 409)
  if (thread.buyerProfileId !== input.userId) return fail('thread_conflict', 409)
  const { conversationId } = thread

  if (kase.application.status === 'cancelled') return fail('application_cancelled', 409)
  // The case has left the applicant's hands (paid, under review, submitted…). The wizard
  // is finished rather than broken: report it complete, hand back whatever pay card exists,
  // and write nothing.
  if (!EDITABLE_STATUSES.has(kase.application.status)) {
    const existing = await newestVisaCheckoutCard(conversationId, input.applicationId)
    return { ok: true, step: 5, messageId: existing?.id ?? null, complete: true }
  }

  const step = firstIncompleteVisaDmStep(kase.payload, kase.documents)
  const mode = await getVisaThreadMode(input.applicationId)
  if (mode === 'admin') {
    return { ok: true, step: step ?? 5, messageId: null, complete: step === null }
  }

  if (step === null) return await emitVisaCheckoutCard(kase, conversationId)

  const cards = await visaStepCards(conversationId, input.applicationId)
  const newest = cards[0]
  // Already asking exactly this → REUSE. (A change in `needsReview` alone does not
  // re-post: the applicant is looking at a live form for this step, and a second identical
  // card under it is the double-post this gate exists to prevent.)
  if (newest && newest.meta.step === step && newest.meta.state === 'active') {
    return { ok: true, step, messageId: newest.id, complete: false }
  }
  await closeSupersededStepCards(conversationId, cards, step)
  const needsReview = step === 2 ? visaDmStep2NeedsReview(kase) : []
  const card = await sendVisaStepCard({ conversationId, applicationId: input.applicationId, step, needsReview })
  // Null means the shop, the binding or the mode refused between our checks and the write.
  // Never a silent success: no card, and a code the UI can render.
  if (!card) return fail('step_card_refused', 503, { step, complete: false })
  return { ok: true, step, messageId: card.messageId, complete: false }
}

/**
 * All five steps satisfied → the pay card, priced by the server.
 *
 * THE PRICE CHAIN, end to end, with no client value anywhere in it:
 *   the applicant's PRODUCT CHOICE (a listing id, from visa_events)
 *     → Listing.price in ĐỒNG (resolveVisaProduct, re-read every pass)
 *       → a SERVER-ISSUED USD quote (quoteVisaUsd)
 *         → sendVisaCheckoutCard
 * Every link fails closed with its own code, because "the desk cannot price this right now"
 * and "you have not picked a product" are different sentences in the UI.
 *
 * IDEMPOTENT WITH ONE DELIBERATE EXCEPTION: an existing unpaid card at the SAME amount is
 * reused, but a card whose amount no longer matches a fresh quote is superseded by a new
 * one — the buyer must be looking at the number they will actually be charged (the checkout
 * route re-quotes and refuses a drifted echo, so a stale card would otherwise dead-end).
 */
async function emitVisaCheckoutCard(kase: VisaDmCase, conversationId: string): Promise<VisaDmAdvance> {
  const applicationId = kase.application.id
  const existing = await newestVisaCheckoutCard(conversationId, applicationId)
  // Already paid: never mint a second pay card for a captured service.
  if (kase.application.paid_at) {
    return { ok: true, step: 5, messageId: existing?.id ?? null, complete: true }
  }

  const listingId = await selectedVisaDmListingId(applicationId)
  if (!listingId) return fail('product_not_selected', 409, { step: 5, complete: true })
  const product = await chargeableVisaProduct(listingId)
  if (isFailure(product)) return { ...product, step: 5, complete: true }

  // Dormant deployment (no fee/provider env): sendVisaCheckoutCard would answer null and
  // the applicant would sit on a finished form with no way to pay and no reason given.
  if (!visaPaymentsConfig()) return fail('payments_not_configured', 503, { step: 5, complete: true })

  const quote = await quoteVisaUsd({ listingId: product.listingId, priceVnd: product.priceVnd })
  if (!quote) {
    // Public facts only (a listing id and a đồng price), so this line is safe to log.
    console.error(`[visa-dm] no FX quote for listing ${product.listingId} at ${product.priceVnd}₫`)
    return fail('fx_unavailable', 503, { step: 5, complete: true })
  }
  const amountUsd = quote.amountUsdCents / 100

  if (existing && existing.meta.status === 'unpaid' && existing.meta.amountUsd === amountUsd) {
    return { ok: true, step: 5, messageId: existing.id, complete: true }
  }

  const card = await sendVisaCheckoutCard({ conversationId, applicationId, amountUsd })
  if (!card) return fail('checkout_card_refused', 503, { step: 5, complete: true })
  await recordVisaEvent(applicationId, 'applicant', 'dm_checkout_card_sent', kase.application.user_id, {
    listingId: product.listingId, priceVnd: quote.priceVnd, amountUsdCents: quote.amountUsdCents,
    vndPerUsd: quote.vndPerUsd, quotedAt: quote.quotedAt,
  })
  return { ok: true, step: 5, messageId: card.messageId, complete: true }
}

// ── Starting the flow ─────────────────────────────────────────────────────────────

/** Newest case this applicant may still edit, or null. */
async function reusableVisaApplication(userId: string): Promise<VisaApplicationRow | null> {
  const { data, error } = await getVisaDb()
    .from('visa_applications')
    .select('*')
    .eq('user_id', userId)
    .in('status', [...EDITABLE_STATUSES])
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data as VisaApplicationRow[] | null) || [])[0] ?? null
}

/**
 * One tap in a chat → a case, a thread, a binding and the first card.
 *
 * CREATES OR REUSES, in that order of preference: an applicant who already has an editable
 * draft continues it rather than accumulating half-filled government forms (and the
 * `visa-create` quota that guards POST /api/visa/applications is charged by the ROUTE only
 * on the create branch, so the two entry points share one budget).
 *
 * The picked product PREFILLS what the choice itself determines (entry type, and with it
 * the 90-day stay) — the "auto filled parts" of the owner's ask. It is applied to a reused
 * draft too, and that is deliberate: the checkout route refuses a charge whose product
 * entry type disagrees with the application's, so leaving a stale answer behind would build
 * a case that cannot be paid for. Written only when it actually differs.
 *
 * The submission WINDOW is deliberately not checked here: cutoffs decide when a batch can
 * still be lodged, and an applicant filling a form at midnight for tomorrow's batch is
 * normal. The checkout route is where a closed desk refuses money.
 */
export async function startVisaDmFlow(input: {
  userId: string
  email: string
  listingId: string
  /**
   * The route's create quota, asked ONLY on the branch that actually mints a case.
   *
   * A callback rather than a check inside the route, because the route cannot know which
   * branch it is on without repeating this function's lookup — and a limiter charged on
   * every /start would lock a returning applicant out of their own draft for re-opening
   * the chat. false ⇒ 429, and nothing is written.
   */
  allowCreate?: () => Promise<boolean>
}): Promise<VisaDmStart> {
  if (!visaCryptoReady()) return fail('visa_encryption_not_configured', 503)
  const product = await chargeableVisaProduct(input.listingId)
  if (isFailure(product)) return product
  // Fail BEFORE creating a case: an application minted against a desk that cannot answer
  // is an orphan the applicant then has to be told about.
  const shop = await getVisaShopSeller()
  if (!shop?.ownerId) return fail('shop_unavailable', 503)

  const existing = await reusableVisaApplication(input.userId)
  const prefill = visaPrefillForProduct(product) ?? {}
  let applicationId: string

  if (existing) {
    applicationId = existing.id
    const payload = decryptVisaPayload(existing.encrypted_payload)
    const changed = Object.entries(prefill).some(([key, value]) => (payload as unknown as Record<string, unknown>)[key] !== value)
    if (changed) {
      const parsed = visaPayloadSchema.safeParse({ ...payload, ...prefill })
      if (!parsed.success) return fail('invalid_fields', 400)
      const wrote = await writeVisaPayload({
        applicationId, userId: input.userId, expectedUpdatedAt: existing.updated_at, payload: parsed.data,
      })
      if (!wrote) return fail('application_changed_retry', 409)
    }
  } else {
    if (input.allowCreate && !(await input.allowCreate())) return fail('rate_limited', 429)
    const parsed = visaPayloadSchema.safeParse({ ...emptyVisaPayload(input.email), ...prefill })
    if (!parsed.success) return fail('invalid_fields', 400)
    applicationId = randomUUID()
    const now = new Date().toISOString()
    const { error } = await getVisaDb().from('visa_applications').insert({
      id: applicationId, user_id: input.userId, status: 'draft',
      encrypted_payload: encryptVisaPayload(parsed.data),
      payload_version: 1, checklist: [], last_applicant_action_at: now, created_at: now, updated_at: now,
    })
    if (error) throw error
    await recordVisaEvent(applicationId, 'applicant', 'application_created', input.userId, { surface: 'dm' })
  }

  // ── THE BINDING ──────────────────────────────────────────────────────────────────
  // bindVisaThread is the one self-gating function in dm-thread: it re-proves
  // visa_applications.user_id == this buyer before it writes Conversation.visaApplicationId,
  // so passing a session's profile id straight in is the documented, safe usage.
  const bound = await bindVisaThread({ applicationId, buyerProfileId: input.userId })
  if (!bound.ok) {
    if (bound.error === 'thread_conflict') return fail('thread_conflict', 409)
    if (bound.error === 'not_owner') return fail('not_found', 404)
    // shop_unavailable | listing_unavailable — the desk has no answerable storefront.
    return fail('shop_unavailable', 503)
  }

  await recordVisaEvent(applicationId, 'applicant', VISA_DM_PRODUCT_EVENT, input.userId, {
    listingId: product.listingId, conversationId: bound.conversationId,
    entryType: product.entryType, speed: product.speed, priceVnd: product.priceVnd,
  })

  // The first card is the first INCOMPLETE step, which for a fresh draft is step 1 — a
  // returning applicant is put back where they stopped rather than made to re-do Documents.
  const advanced = await advanceVisaDmFlow({ applicationId, userId: input.userId })
  if (!advanced.ok) return advanced
  return { ok: true, applicationId, conversationId: bound.conversationId, step: advanced.step }
}
