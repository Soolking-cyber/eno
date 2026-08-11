// ── THE OFFER STATE MACHINE ──────────────────────────────────────────────────────
//
// Pure. No Prisma, no `server-only`, no `Date.now()` inside a decision — every function
// takes its facts (and `now`) as arguments, so the same module runs in the route handler,
// in the card, and in a unit test with a frozen clock. Importing this from a client
// component must stay free; do not add a `server-only` import or a db call here.
//
// ── WHAT ALREADY EXISTED, BEFORE THIS FILE ──────────────────────────────────────
// `Message.offerStatus` is a nullable TEXT column (never a DB enum) and four values are
// written to it today:
//   · 'pending'   — insertMessage() on every kind='offer' write (messages.ts)
//   · 'countered' — the SUPERSEDE clause in insertMessage(): sending a new offer flips
//                   every still-pending offer in the thread to 'countered', from either
//                   side. Nothing "performs" a counter; it is a side effect of sending.
//   · 'accepted' / 'declined' — actOnOffer(), claimed atomically with
//                   `updateMany where offerStatus:'pending'` so a double-tap can only win once.
// There is no 'expired', no sweeper, no expiry column and no reason column. An offer sent
// on Monday is still a live, acceptable card on Friday — which is the hole this closes.
//
// ── EXPIRY NEEDS NO SCHEMA CHANGE, AND THAT IS DELIBERATE ───────────────────────
// The deadline is DERIVED: createdAt + OFFER.TTL_MS. `Message.createdAt` already exists and
// is already on the wire, so the 24h window works against today's database with zero DDL.
// `expiresAt` is accepted as an optional OVERRIDE for the day a real column lands (a seller
// extending a window, a per-category TTL); until then it is simply absent everywhere.
//
// ⚠️ THE DERIVED EXPIRY IS A UI TRUTH THE SERVER DOES NOT YET ENFORCE. The DB still says
// 'pending' 48h later because nothing sweeps it. `effectiveOfferStatus` is therefore the
// ONLY correct read of an offer — and `actOnOffer` needs the same clock guard before this
// can be called closed, or a seller will still be able to accept a three-day-old offer that
// the buyer was told had expired. That guard lives in src/lib/messages.ts (not this stream's
// allowlist); it is reported as an integration note.
//
// ── THE STANDING RULE THIS FILE ENCODES ─────────────────────────────────────────
// NEVER RENDER A CONTROL THE SERVER WILL REFUSE. A counter on a fixed-price listing is a
// 409 `not_negotiable` AND a trust dock for the buyer (offer-guard.ts) — for a button we
// showed them. So every refusal below is named after the server response it predicts, and
// the check ORDER mirrors the routes, so the code the machine returns is the code the wire
// would return.

/** The five states an offer can be in. 'expired' is DERIVED from the clock — it is never a
 *  persisted value today, so anything reading the column must go through
 *  `effectiveOfferStatus` rather than trusting the raw string. */
export type OfferStatus = 'pending' | 'accepted' | 'countered' | 'declined' | 'expired'

/** The three things a recipient can do, in three taps and no typing. */
export type OfferAction = 'accept' | 'decline' | 'counter'

/** Who is looking at the offer. Deliberately a ROLE, not an id: the machine has no business
 *  knowing about profiles, and both call sites already know which side they are on (the route
 *  compares ids, the card has `mine`). Participancy itself is the caller's gate — the route
 *  403s a stranger long before this runs. */
export type OfferRole = 'sender' | 'recipient'

/** Why the buyer is asking for this number. A bare number reads as a haggle and gets ignored;
 *  a reason is what makes it answerable. Codes, not prose — the labels are bilingual and live
 *  at the render site (offer-card.tsx) where tr() can reach them. */
export type OfferReason = 'cash' | 'timing' | 'bundle' | 'condition' | 'budget'

/** Why an action is refused. Each name is the response the server would give, so a caller can
 *  map one to the other without a translation table:
 *   · 'not_pending'         → actOnOffer's `where offerStatus:'pending'` misses → 409 not_actionable
 *   · 'expired'             → the 24h window closed (UI truth; see the server note above)
 *   · 'own_offer'           → actOnOffer refuses `senderProfileId === actorId` → 409 not_actionable
 *   · 'listing_unavailable' → 409 listing_unavailable (both the accept route and the send route)
 *   · 'not_negotiable'      → 409 not_negotiable, plus recordFixedPriceOfferAttempt() for a buyer
 *   · 'thread_closed'       → one accepted offer per thread → 409 not_actionable
 *   · 'unknown_action'      → not an action at all → 400 bad_request (what the route already
 *                             answers when `body.action` is neither accept nor decline) */
export type OfferRefusal =
  | 'not_pending'
  | 'expired'
  | 'own_offer'
  | 'listing_unavailable'
  | 'not_negotiable'
  | 'thread_closed'
  | 'unknown_action'

export type OfferDecision = { ok: true } | { ok: false; refusal: OfferRefusal }

/** Everything a decision depends on, passed in. Note the three world facts are REQUIRED
 *  booleans rather than optionals with friendly defaults: a missing `negotiable` quietly
 *  defaulting to `true` is precisely how a Counter button appears on a fixed-price listing
 *  and docks a buyer's trust. Call sites that genuinely have an unknown fold it themselves,
 *  visibly, at the seam (offer-card.tsx does exactly that and says so). */
export type OfferFacts = {
  /** The RAW persisted `Message.offerStatus` — pass it through untouched, including null. */
  status: string | null | undefined
  /** `Message.createdAt`. Anchors the 24h window. */
  createdAt: string | number | Date
  /** Optional explicit deadline; overrides createdAt + TTL when present and parseable. */
  expiresAt?: string | number | Date | null
  /** `Listing.status === 'active'`. */
  listingActive: boolean
  /** `Listing.negotiable`. */
  negotiable: boolean
  /** Does the thread already hold an accepted offer? One deal per thread. */
  threadHasAcceptedOffer: boolean
}

const HOUR = 60 * 60 * 1000

export const OFFER = {
  /** 24h. The window is the whole mechanism: it is what turns "I will think about it" into
   *  a reason to answer today. Long enough to survive a night's sleep across one timezone,
   *  short enough that tomorrow is too late. */
  TTL_MS: 24 * HOUR,
  /** Below this the countdown earns the warning tint. Three hours is late enough to be true
   *  and early enough to still be actionable in a working day. */
  EXPIRING_SOON_MS: 3 * HOUR,
} as const

export const OFFER_STATUSES: readonly OfferStatus[] = ['pending', 'accepted', 'countered', 'declined', 'expired'] as const
export const OFFER_ACTIONS: readonly OfferAction[] = ['accept', 'decline', 'counter'] as const
export const OFFER_REASONS: readonly OfferReason[] = ['cash', 'timing', 'bundle', 'condition', 'budget'] as const

/** The transition each action performs. 'counter' lands on 'countered' because that is what
 *  the SEND path already does to the superseded offer (insertMessage's supersede clause) —
 *  the action and the side effect agree, rather than inventing a second vocabulary. */
export const OFFER_TRANSITIONS: Readonly<Record<OfferAction, OfferStatus>> = {
  accept: 'accepted',
  decline: 'declined',
  counter: 'countered',
} as const

/** The whole graph, as data, so it can be asserted rather than described. 'pending' is the
 *  only state with edges; 'expired' is reached by the clock, not by an actor, which is why it
 *  has no corresponding OfferAction. Everything else is terminal — an accepted offer does not
 *  later become expired just because time passed. */
export const LEGAL_OFFER_TRANSITIONS: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  pending: ['accepted', 'declined', 'countered', 'expired'],
  accepted: [],
  declined: [],
  countered: [],
  expired: [],
} as const

export function isOfferStatus(v: unknown): v is OfferStatus {
  return typeof v === 'string' && (OFFER_STATUSES as readonly string[]).includes(v)
}

export function isOfferAction(v: unknown): v is OfferAction {
  return typeof v === 'string' && (OFFER_ACTIONS as readonly string[]).includes(v)
}

export function isOfferReason(v: unknown): v is OfferReason {
  return typeof v === 'string' && (OFFER_REASONS as readonly string[]).includes(v)
}

/**
 * The raw column value as a state this machine understands — or `null` when it does not.
 *
 * ⚠️ NULL DOES NOT FOLD TO 'pending', AND THAT IS THE WHOLE POINT OF RETURNING NULL. It is
 * the friendly-looking default and it would be a live bug: actOnOffer matches
 * `where offerStatus:'pending'`, which does NOT match a NULL row, so an offer rendered as
 * answerable off a null would 409 `not_actionable` on the first tap. Every offer the app
 * writes carries 'pending' explicitly (insertMessage), so null here means a legacy or
 * hand-written row, and the honest render for one of those is an inert card — which is
 * exactly what the thread does today.
 */
export function normalizeOfferStatus(raw: string | null | undefined): OfferStatus | null {
  return isOfferStatus(raw) ? raw : null
}

/** Map a pair of ids to the role this machine speaks. One line, at the seam, so no call site
 *  has to remember which way round the comparison goes. */
export function offerRole(senderProfileId: string, actorProfileId: string): OfferRole {
  return senderProfileId === actorProfileId ? 'sender' : 'recipient'
}

function toMs(v: string | number | Date | null | undefined): number | null {
  if (v == null) return null
  const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/**
 * When this offer stops being answerable, in epoch ms — or `null` if it cannot be worked out.
 *
 * ⚠️ NULL FAILS OPEN (treated as "not expired" everywhere below), deliberately. A date that
 * failed to parse is our bug, and the cost of the two directions is not symmetric: failing
 * closed would silently strip Accept from a live offer and strand a real deal with no error
 * anywhere, while failing open leaves the offer exactly as answerable as it was before this
 * file existed. The server's own gates still apply either way.
 */
export function offerDeadline(facts: Pick<OfferFacts, 'createdAt' | 'expiresAt'>): number | null {
  const explicit = toMs(facts.expiresAt)
  if (explicit != null) return explicit
  const created = toMs(facts.createdAt)
  return created == null ? null : created + OFFER.TTL_MS
}

/** Milliseconds left on the window, clamped at 0. `Infinity` when there is no usable deadline
 *  (see offerDeadline) — callers render no countdown for a window they cannot measure. */
export function offerTimeLeftMs(facts: Pick<OfferFacts, 'createdAt' | 'expiresAt'>, now: number): number {
  const deadline = offerDeadline(facts)
  if (deadline == null) return Infinity
  return Math.max(0, deadline - now)
}

/** Has the window closed? Only ever asked of a pending offer — a resolved one keeps its
 *  outcome forever (see LEGAL_OFFER_TRANSITIONS). */
export function isOfferExpired(facts: Pick<OfferFacts, 'createdAt' | 'expiresAt'>, now: number): boolean {
  return offerTimeLeftMs(facts, now) <= 0
}

/** True in the last stretch of the window — the moment the countdown is worth emphasising. */
export function isOfferExpiringSoon(facts: Pick<OfferFacts, 'createdAt' | 'expiresAt'>, now: number): boolean {
  const left = offerTimeLeftMs(facts, now)
  return left > 0 && left <= OFFER.EXPIRING_SOON_MS
}

/**
 * The state to REASON and RENDER from: the persisted status, with a lapsed 'pending' promoted
 * to 'expired'. `null` when the raw value is not a status we know (see normalizeOfferStatus).
 *
 * ⚠️ ONLY 'pending' IS RE-EVALUATED. An offer accepted at hour 23 is still 'accepted' at hour
 * 30 — a deal does not un-happen because a clock ran on. Reading this the other way would
 * retract the safety line and the mark-as-sold hand-off from a thread that had closed properly.
 */
export function effectiveOfferStatus(facts: OfferFacts, now: number): OfferStatus | null {
  const status = normalizeOfferStatus(facts.status)
  if (status !== 'pending') return status
  return isOfferExpired(facts, now) ? 'expired' : 'pending'
}

/** A state nobody can act on any more. */
export function isTerminalOfferStatus(status: OfferStatus | null): boolean {
  return status !== 'pending'
}

/**
 * May `role` perform `action` on this offer, as of `now`?
 *
 * ⚠️ THE CHECK ORDER MIRRORS THE SERVER, ON PURPOSE, so the refusal returned here is the
 * status code the wire would actually produce:
 *   · accept  → the route tests `listing.status !== 'active'` (409 listing_unavailable) BEFORE
 *               actOnOffer gets to the one-accepted-offer-per-thread count (409 not_actionable).
 *   · counter → sending an offer tests `!listing.negotiable` (409 not_negotiable + a buyer trust
 *               dock) BEFORE `listing.status !== 'active'` (409 listing_unavailable).
 *   · decline → NOTHING beyond pending + recipient. This asymmetry is load-bearing and is
 *               copied from the route's own comment: gating decline on the listing being active
 *               would strand a pending offer card forever on every sold listing, with no way for
 *               either side to clear it.
 *
 * ⚠️ BUT EXPIRY OUTRANKS DECLINE TOO, AND THAT IS NOT THE SAME QUESTION — a reviewer read the two
 * rules as contradictory, so the distinction is written down rather than left to be re-derived.
 * "Clearable" is about a card that still DEMANDS an answer and offers no way to give one: a live
 * pending offer on a listing that went away keeps asking, forever, which is why decline survives
 * `listingActive: false`. An EXPIRED offer asks nothing — it renders as its own outcome, the way
 * declined and countered do. Re-opening it for a decline would let a tap overturn a decision time
 * already made, and 'expired' is a terminal state in LEGAL_OFFER_TRANSITIONS precisely because
 * the window closing IS the resolution.
 *   ⚠️ THE COST, STATED PLAINLY: nothing sweeps the column, so a lapsed row stays 'pending' in the
 * database and any surface reading it RAW (the conversation-list preview) still says Pending while
 * the card says expired. That divergence is not fixed here and cannot be — it needs the same
 * server-side clock guard named in the header. Do not paper over it by re-enabling decline.
 *
 * ⚠️ 'thread_closed' ON COUNTER IS STRICTER THAN THE SERVER, and that direction is the safe one.
 * The send path only supersedes PENDING offers, so it would happily accept a counter into a
 * thread that already closed at a different price. Hiding a control the server would allow costs
 * a tap; showing one it refuses costs the buyer trust points. It is checked LAST so it can never
 * mask a refusal that IS a real server response.
 */
export function canActOnOffer(action: OfferAction, facts: OfferFacts, role: OfferRole, now: number): OfferDecision {
  /**
   * ⚠️ THE ACTION IS VALIDATED EVEN THOUGH IT IS TYPED, BECAUSE THE INTENDED CALLER READS IT OFF
   * THE WIRE. This function is built to be called from a route handler with `body.action`, and a
   * cast is all it takes to arrive here with garbage. Until this line existed the accept and
   * counter branches simply did not match and execution FELL THROUGH to the trailing decline
   * return: measured, `applyOfferAction('bogus' as OfferAction, …)` answered `{ ok: true, status:
   * undefined }`, which a server would then have written into Message.offerStatus — a row in no
   * state at all, on the column the whole machine reasons about. A permissive catch-all is the
   * wrong default for a function whose entire job is refusing things.
   */
  if (!isOfferAction(action)) return { ok: false, refusal: 'unknown_action' }
  const status = effectiveOfferStatus(facts, now)
  if (status === 'expired') return { ok: false, refusal: 'expired' }
  if (status !== 'pending') return { ok: false, refusal: 'not_pending' }
  // Only the OTHER party answers an offer — never your own. Same rule as actOnOffer.
  if (role === 'sender') return { ok: false, refusal: 'own_offer' }

  if (action === 'accept') {
    if (!facts.listingActive) return { ok: false, refusal: 'listing_unavailable' }
    if (facts.threadHasAcceptedOffer) return { ok: false, refusal: 'thread_closed' }
    return { ok: true }
  }

  if (action === 'counter') {
    if (!facts.negotiable) return { ok: false, refusal: 'not_negotiable' }
    if (!facts.listingActive) return { ok: false, refusal: 'listing_unavailable' }
    if (facts.threadHasAcceptedOffer) return { ok: false, refusal: 'thread_closed' }
    return { ok: true }
  }

  // decline — always available to the recipient of a LIVE offer. Spelled as its own branch rather
  // than left as the fall-through, so adding a fourth action can never inherit a silent yes.
  if (action === 'decline') return { ok: true }
  return { ok: false, refusal: 'unknown_action' }
}

/** The actions to RENDER, in the order they are read: the affirmative one first. Anything not
 *  in this list must not appear as a control. */
export function offerActions(facts: OfferFacts, role: OfferRole, now: number): OfferAction[] {
  return OFFER_ACTIONS.filter((a) => canActOnOffer(a, facts, role, now).ok)
}

/** Decide AND resolve: the status to persist, or why not. The server writes the returned status
 *  under its own atomic `where offerStatus:'pending'` claim — this function decides, it does not
 *  serialise (the EvalPlanQual lesson: a check is not a lock). */
export function applyOfferAction(
  action: OfferAction,
  facts: OfferFacts,
  role: OfferRole,
  now: number,
): { ok: true; status: OfferStatus } | { ok: false; refusal: OfferRefusal } {
  const decision = canActOnOffer(action, facts, role, now)
  if (!decision.ok) return decision
  return { ok: true, status: OFFER_TRANSITIONS[action] }
}

/**
 * "23h 45m" / "23 giờ 45 phút" — the remaining window, in the app's existing duration idiom
 * (formatTravel in src/lib/travel.ts: unit suffixes by language, no catalogue entry needed, so
 * the machine-translated languages cannot drift a number).
 *
 * ⚠️ BOTH UNITS ARE SHOWN WHENEVER THERE ARE BOTH, RATHER THAN ROUNDING TO ONE. A countdown
 * that floors 1h59m to "1h" understates the time left by an hour — that is manufactured
 * urgency, and manufactured urgency is a blacklisted dark pattern (UCPD Annex I, the same rule
 * urgent.ts is built around). Showing the minutes costs four characters and the claim is true.
 *
 * ⚠️ RETURNS null FOR AN UNMEASURABLE WINDOW (the Infinity that offerTimeLeftMs yields when the
 * deadline could not be parsed) rather than a zero. "0m" would be a countdown claiming the offer
 * is about to lapse when in fact we do not know — the one thing a countdown must never do.
 *
 * ⚠️ THE LAST MINUTE IS WORDS, NOT "0m". Flooring a live window to zero puts "Expires in 0m"
 * beside three enabled controls — a card contradicting itself for up to 59 seconds, which reads
 * as a bug rather than as urgency. Under a minute the honest rendering is the phrase.
 *
 * Only 'en' and 'vi' are rendered, matching formatTravel's idiom: every other language folds to
 * 'en' through moneyLocale(), the same way the rest of the app's units already behave.
 */
export function formatOfferTimeLeft(ms: number, lang: 'en' | 'vi'): string | null {
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return lang === 'vi' ? '0 phút' : '0m'
  const totalMinutes = Math.floor(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h <= 0 && m <= 0) return lang === 'vi' ? 'chưa đầy một phút' : 'under a minute'
  const hUnit = lang === 'vi' ? ' giờ' : 'h'
  const mUnit = lang === 'vi' ? ' phút' : 'm'
  if (h <= 0) return `${m}${mUnit}`
  return m ? `${h}${hUnit} ${m}${mUnit}` : `${h}${hUnit}`
}
