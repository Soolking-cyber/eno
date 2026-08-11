// ── SELLER RESPONSE SIGNAL — relative time in, a chip label and a rank delta out ────────────────
//
// A buyer who messages and gets no reply does not message a second seller. They leave. The app has
// measured reply behaviour since 2026-07-23 (recomputeResponseRates(), src/lib/response-rate.ts)
// and until now did exactly two things with it: a coarse sentence on the PDP, and one term inside
// the trust composite. This module is the third thing — the buyer-facing ANSWER TO "will anyone
// answer me", expressed the way a buyer thinks about it (how long will I wait) rather than as a
// number out of 100 — plus the ranking input that makes the answer matter.
//
// PURE ON PURPOSE. No Prisma, no `server-only`, no bare Date.now(). `now` is an argument because
// one of the four gates below (receipt freshness) is TIME-dependent and this file is consumed on
// both sides of the wire: the PDP is ISR with revalidate=30d, so a server-baked time decision
// would freeze for a month (the same trap src/lib/last-seen.ts documents for presence). See
// <ResponseChip>, which mount-gates and passes the CLIENT clock.
//
// ── THE HONESTY GATE, RESTATED BECAUSE IT IS THE WHOLE FEATURE ──────────────────────────────────
// Seller.responseRate DEFAULTS TO 100. That default is a lie about a seller with no history, and
// it is the single most dangerous value in this feature: "Replies fast" printed under a shop that
// has never answered anyone is worse than printing nothing, because a buyer acts on it.
// Seller.responseMetricAt — the nightly job's write receipt, stamped only for sellers with >= 5
// scored conversations — is what separates a MEASURED rate from that default. Its schema comment
// says display and trust both gate on it and it must never be written anywhere else. This module
// gates on it too, and adds a freshness bound (see RECEIPT_MAX_AGE_DAYS).
//
// A seller with no receipt has NO SIGNAL. Not a neutral one, not an optimistic one, not a
// placeholder: `measured: false`, an empty label, and rankDelta 0. Every downstream decision in
// this file is written so that the unmeasured case is indistinguishable from the BEST case in
// ranking and from silence in display. That asymmetry is deliberate and is argued at each site.
//
// ⚠️ CONSTANTS BELOW ARE MIRRORS OF src/lib/seller-metrics.ts AND src/lib/response-rate.ts, NOT
// IMPORTS, AND THAT IS FORCED. seller-metrics.ts imports 'server-only' and @/lib/db at its top;
// importing one number out of it would drag Prisma into every card that renders this chip. Two of
// the four values (RESPONSE_FAST_RATE, RESPONSE_DAY_FLOOR) are module-PRIVATE over there and could
// not be imported even if the dependency were free.
//
// The mirror is pinned by response-signal.test.ts, which READS THE SOURCE TEXT of both files and
// regexes the numbers back out. ⚠️ An earlier version of that test compared these constants with
// hardcoded literals and claimed to be a drift gate; an external reviewer pointed out it would
// keep passing while seller-metrics.ts moved underneath it, which is the one failure a mirror-pin
// must not have. Reading the other files is what makes the claim true.

/** An already-localised pair. The `tr()` call lives at the render site: `tr(label.en, label.vi)`,
 *  the same shape ResponseBucket/LastSeenBucket already use across this app. */
export type Bilingual = { en: string; vi: string }

/** Minimum 90d buyer-opened conversations before ANY responsiveness claim is made.
 *  MIRROR of RESPONSE_MIN_CONVOS in src/lib/seller-metrics.ts (5) and of the `a.n >= 5` floor in
 *  the nightly UPDATE in src/lib/response-rate.ts. Three copies of the same 5; the test pins it. */
export const RESPONSE_MIN_CONVOS = 5

/** replied-within-24h rate at/above which a seller may be called fast.
 *  MIRROR of the (module-private) RESPONSE_FAST_RATE in src/lib/seller-metrics.ts (80). */
export const RESPONSE_FAST_RATE = 80

/** Below this replied-within-24h rate the seller is `slow` however quick their median looks.
 *  MIRROR of the (module-private) RESPONSE_DAY_FLOOR in src/lib/seller-metrics.ts (50).
 *  Rate and median measure DIFFERENT failures and neither substitutes for the other: a seller who
 *  answers 1 thread in 10 instantly has a sub-hour median and is not fast, they are absent. */
export const RESPONSE_DAY_FLOOR = 50

/**
 * A receipt older than this is treated as NO receipt.
 *
 * MIRROR of the `interval '8 days'` sweep at the end of recomputeResponseRates(): an eligible
 * seller is re-stamped every night, so an old receipt means the seller FELL OUT of the >=5-convo
 * cohort — or the cron broke.
 *
 * ⚠️ THIS IS NOT REDUNDANT WITH THAT SWEEP, IT IS THE BACKSTOP FOR IT. The sweep runs INSIDE the
 * same nightly job it is meant to protect against (both live in recomputeResponseRates(), hung off
 * the daily-reminders cron). If that cron stops, the sweep stops with it and every measured seller
 * keeps their last bucket forever. Re-deciding staleness here, against the caller's clock, is what
 * makes the expiry survive the failure it exists for. Both directions of the gate are safe: a
 * seller who is genuinely still fast merely loses their chip until the job runs again.
 */
export const RECEIPT_MAX_AGE_DAYS = 8

/** How coarse the measurement actually is, tier by tier. Named by CEILING so a tier can never
 *  claim more precision than the underlying fact: `under_1h` means "the median first reply landed
 *  inside an hour", not "in ten minutes". Maps 1:1 onto the three canonical strings the nightly
 *  job writes into Seller.responseTime. */
export type ResponseSpeed = 'under_1h' | 'under_1d' | 'over_1d'

/** What the speed MEANS once the reply RATE is folded in — the thing tone, ranking and the facet
 *  all key off. `slow` is a real, measured seller who is worth messaging late rather than not at
 *  all; it is never a reason to hide a listing. */
export type ResponseTier = 'fast' | 'ok' | 'slow'

const HOUR_MIN = 60
const DAY_MIN = 1440
const DAY_MS = 86_400_000

/** The three strings recomputeResponseRates() can write into Seller.responseTime, and the median
 *  CEILING each one stands for. Read straight off the CASE expression in response-rate.ts.
 *  ⚠️ Matching is exact-after-trim-and-lowercase, NOT substring. The older seller-metrics.ts test
 *  (`time.includes('hour')`) also matches 'within a few hours' and 'over an hour' — strings the job
 *  does not write today but that a future CASE arm easily could, and both would be read as
 *  sub-hour. An unrecognised string falls through to `null` and suppresses, which is the only safe
 *  direction: a label we cannot justify is a label we do not print. */
const COARSE_CEILING_MIN: Record<string, number> = {
  'within an hour': HOUR_MIN,
  'within a day': DAY_MIN,
  // No true ceiling exists for this arm — the job writes it for any median above 24h. DAY_MIN + 1
  // is the smallest value that lands in `over_1d`, and it is never shown as a number: the coarse
  // label for this tier is the wordy "a few days" precisely because we do not know which few.
  'within a few days': DAY_MIN + 1,
}

/**
 * The measured facts, in exactly the shape a serializer can carry to a card.
 *
 * ⚠️ `responseRate` IS AN INPUT AND MUST NEVER BE AN OUTPUT. It is a percentage with a fabricated
 * default; src/lib/serialize.ts already carries it to the client for the server-side bucket helper
 * and warns in place that the number itself must not be surfaced. Nothing in ResponseSignal
 * contains it, and nothing here should be changed to expose it.
 */
export type ResponseFacts = {
  /** Seller.responseRate — replied-within-24h percentage over the 90d window. 0..100. */
  responseRate: number | null
  /** Seller.responseTime — one of the three canonical strings in COARSE_CEILING_MIN. */
  responseTime: string | null
  /**
   * Seller.responseMetricAt — the nightly job's write receipt, and the honesty gate.
   * Accepts a Date, a full ISO string, or the DAY-COARSE 'YYYY-MM-DD' that a cacheable route
   * should serialize instead (a bare date parses as UTC midnight, which errs OLD — toward
   * suppression — in Vietnam's UTC+7, the same under-claiming asymmetry as last-seen.ts).
   */
  measuredAt: Date | string | null | undefined
  /**
   * The seller's 90d buyer-opened conversation count, or the literal 'receipt-only'.
   *
   * ⚠️ THE STRING IS NOT A CONVENIENCE DEFAULT, IT IS A REQUIRED ADMISSION, and it is a union
   * rather than an optional field so a caller cannot skip the tighter gate by forgetting a prop.
   * `LISTING_CARD_SELECT` (src/lib/serialize.ts) carries no conversation count and cannot cheaply
   * grow one — it would be a grouped count per distinct seller on every feed page — so the card
   * surface genuinely cannot supply this, while the PDP and the storefront (which already compute
   * `conversations90` for the trust engine) can.
   *
   * WHAT 'receipt-only' COSTS, EXACTLY: the live re-check that the seller is STILL above the
   * 5-conversation floor is skipped, so a seller whose 90d window has slid below 5 keeps showing
   * their last measured bucket for up to RECEIPT_MAX_AGE_DAYS. It is bounded, and — this is the
   * part that matters — it is bounded ON A REAL MEASUREMENT. The receipt only ever exists because
   * the job wrote a number it computed from >= 5 conversations; the fabricated =100 default has no
   * receipt and cannot reach the display through this path no matter which gate is chosen.
   */
  convoCount: number | 'receipt-only'
  /**
   * OPTIONAL exact median first-reply gap in minutes. When present it WINS over the coarse string
   * and unlocks the precise labels ("~10 min", "~3 days").
   *
   * ⚠️ NOTHING WRITES THIS TODAY AND THE PRECISE PATH IS THEREFORE UNREACHABLE IN PRODUCTION —
   * stated rather than discovered later. The nightly SQL computes `median_gap` with
   * percentile_cont and then throws the number away into a three-arm CASE; there is no numeric
   * column on Seller to put it in, and adding one is a migration this stream is not allowed to
   * make. Measured 2026-08-12 on prod: all 11 Seller rows carry one of the three canonical
   * strings. The field exists so that the day someone adds `responseMedianMinutes`, the display
   * gets finer WITHOUT a second labelling scheme growing beside this one — and so the boundary
   * arithmetic is unit-tested before it ever has live input.
   */
  medianReplyMinutes?: number | null
}

/**
 * Bounded rank contribution, per tier. NEGATIVE-ONLY BY CONSTRUCTION — read the next paragraph
 * before changing any of these three numbers.
 *
 * ⚠️ THE FAST TIER IS 0, NOT A BOOST, AND THAT IS THE LOAD-BEARING CHOICE. If fast sellers were
 * boosted instead of slow ones penalised, the arithmetic would be identical for the two measured
 * tiers and CATASTROPHICALLY different for everyone else: an unmeasured seller — every new shop,
 * and 10 of the 11 sellers on prod as of 2026-08-12 — would sit below every fast seller on a
 * metric they have had no opportunity to earn. New sellers are exactly who a marketplace cannot
 * afford to bury. With 0 as the neutral-and-best value, the unmeasured seller is treated as
 * generously as the fastest measured one, and the only way to move is down, by being measured and
 * slow. It also removes the incentive to farm the metric UPWARD.
 *
 * ⚠️ IT DOES CREATE THE MIRROR-IMAGE QUESTION, RAISED BY A REVIEWER: if 0 is both "fast" and
 * "unmeasured", is a slow seller better off never being measured? MEASURED ANSWER: NO, AND THE
 * REASON IS STRUCTURAL — THE SELLER DOES NOT OWN THE DENOMINATOR. The count that crosses the
 * threshold is `Conversation` rows, and a Conversation is BUYER-OPENED by construction (stated in
 * the header of response-rate.ts and relied on by its whole reply definition). A seller cannot
 * stop buyers from opening threads; the only levers they have are delisting — which costs them
 * every listing rather than 0.05 of one — or replying LESS, which drives responseRate down and
 * lands them deeper in `slow`. The gradient a seller can actually act on points one way: reply.
 *
 * ⚠️ WHAT IS REAL IS THE CLIFF AT THE 5TH CONVERSATION, and it is accepted rather than solved. A
 * slow seller sits at 0 with four scored conversations and takes the full penalty the night the
 * fifth lands — a step, not a ramp. The alternative is penalising sellers on fewer than five
 * observations, i.e. acting on a number the nightly job itself refuses to write, which is a worse
 * trade than a visible edge. Softening it would need a confidence-weighted delta (the Wilson bound
 * trust.ts already computes for the same rate would be the natural input) and a reason to believe
 * the extra machinery pays; on a catalogue with one measured seller, it does not yet.
 *
 * ⚠️ AND IT MEANS THE SIGNAL CAN ONLY EVER DEMOTE, WHICH IS THE SPEC: slow sellers rank LOWER,
 * never hidden. Nothing here filters, and `slow` still returns a finite score — the listing is
 * real, the seller is real, and a buyer who is willing to wait must still be able to find it.
 *
 * ── WHAT THE WORST CASE ACTUALLY DOES, MEASURED AGAINST THE LIVE WEIGHTS ────────────────────────
 * Read out of RANK in src/lib/ranking-formula.ts on 2026-08-12 (BROWSE_TRUST_W 0.6,
 * BROWSE_RELEVANCE_W 0.25, BROWSE_RECENCY_W 0.15, FEATURED_BOOST 0.15, TRUST_SPAN 70,
 * DECAY_DAYS 14, DEMAND_REF 2000, DEMAND_CONTACT_W 30). browseRankScore lands in [0, 1.15].
 * The worst case is `slow` = -0.05, and against each term it is worth:
 *   · TRUST     -0.05 / 0.6 * 70 = 5.83 trust points. Trusted (85) -> 79.2: still Trusted. The
 *               penalty cannot move a seller across a trust TIER (Building->Trusted->Exceptional
 *               are ~25 points apart), so it re-orders within a band and never re-labels anyone.
 *   · RECENCY   14 * ln(0.15 / (0.15 - 0.05)) = 5.68 days. A slow seller's brand-new listing sits
 *               where an otherwise identical listing from a fast seller sits after ~5.7 days.
 *   · DEMAND    2000 * ln(0.25 / (0.25 - 0.05)) = 446 demand units = 446 views, or 14.9 buyer
 *               contacts. Half a fortnight of ordinary interest cancels it.
 *   · FEATURED  33% of FEATURED_BOOST, so a featured listing can never fall below an unfeatured
 *               one because of this.
 * MEASURED ON THE LIVE FEED, not reasoned: all 48 verified+active listings, real rankScore column,
 * each listing penalised in turn and its new position counted. -0.05 moves a listing a mean of
 * 5.85 places out of 48 (worst 15); -0.02 moves it 5.25 (worst 15). The two barely differ because
 * the live feed is one enormous tie — the median gap between adjacent listings is 0.0006 — so
 * almost all of the movement is falling through that cluster and almost none of it is the size of
 * the delta. ⚠️ READ THAT AS THE REAL WARNING: on a tied feed, ANY delta of this magnitude is a
 * full traversal of the tie group, and the tie group today is 48 listings deep. Raising these
 * numbers to "make the signal matter" would buy nothing and risk everything.
 */
// ⚠️ Object.freeze, NOT ONLY `Readonly<>`. The type disappears at compile time, so a consumer
// assigning RESPONSE_RANK_DELTA.slow would silently re-tune ranking for every subsequent request
// in that Node process. A reviewer pointed out this file freezes NO_SIGNAL and every label pair
// against exactly this argument and then left the exported constants open — the same back door,
// one layer up.
export const RESPONSE_RANK_DELTA: Readonly<Record<ResponseTier, number>> = Object.freeze({
  fast: 0,
  ok: -0.02,
  slow: -0.05,
})

/** The most any listing can lose to this signal. Callers that clamp or log a composite should use
 *  this rather than restating -0.05. */
export const RESPONSE_RANK_DELTA_FLOOR = RESPONSE_RANK_DELTA.slow

export type ResponseSignal = {
  /** False = there is no honest signal. Render nothing; rank as if nothing happened. */
  measured: boolean
  /** Coarse measured tier, or null when unmeasured. */
  speed: ResponseSpeed | null
  /** Speed folded together with the reply rate — the thing tone/ranking/facet key off. */
  tier: ResponseTier | null
  /** Relative-time sentence for display. Empty strings when unmeasured. */
  label: Bilingual
  /**
   * Accessible name. Identical to `label` except that "~" is spelled out.
   * ⚠️ NOT COSMETIC. Screen readers announce U+007E inconsistently — VoiceOver says "tilde" in
   * verbose punctuation modes and silently drops it in others, so the chip is heard either as
   * "replies in tilde ten min" or as a promise of exactly ten minutes. Neither is what it says.
   */
  aria: Bilingual
  /** Bounded, <= 0, >= RESPONSE_RANK_DELTA_FLOOR. Add to browseRankScore/searchScore. */
  rankDelta: number
  /** Whether this seller qualifies for the "Replies fast" facet. See repliesFastOutcome(). */
  repliesFast: boolean
}

/**
 * The single shape of "no honest signal". Returned BY REFERENCE from every suppression, which is
 * what makes "never measured" and "measurement expired" indistinguishable downstream.
 *
 * ⚠️ FROZEN, INCLUDING THE NESTED PAIRS, BECAUSE A SHARED SINGLETON IS A SHARED MUTABLE SINGLETON.
 * An external reviewer found this: one consumer writing `signal.label.en = …` on an unmeasured
 * seller would poison every OTHER unmeasured seller for the life of the process — a
 * fabricated-claim bug of exactly the kind this module exists to prevent, arriving through the
 * back door. Modules are strict mode, so the write now throws where it happens instead of
 * corrupting silently three screens away.
 */
const NO_SIGNAL: ResponseSignal = Object.freeze({
  measured: false,
  speed: null,
  tier: null,
  label: Object.freeze({ en: '', vi: '' }),
  aria: Object.freeze({ en: '', vi: '' }),
  rankDelta: 0,
  repliesFast: false,
})

/** Receipt -> epoch ms, or null for absent/garbage. A bare 'YYYY-MM-DD' parses as UTC midnight. */
function receiptMs(at: Date | string | null | undefined): number | null {
  if (!at) return null
  const d = at instanceof Date ? at : new Date(at)
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The exact median, or null when the caller did not supply a usable one.
 * ⚠️ ONE SOURCE FOR "IS THE PRECISE PATH LIVE". responseSignal() has to ask the same question a
 * second time (to choose between exactLabels and coarseLabels), and an inlined copy of this
 * predicate is how the two would eventually disagree — picking the precise LABEL off a value the
 * median resolver had already rejected, i.e. printing "~-3 min".
 *
 * A negative or non-finite median is a caller bug, not a fast seller, so it falls through to the
 * coarse string. 0 is legitimate (an instant reply) and is kept.
 */
function exactMinutes(facts: ResponseFacts): number | null {
  const m = facts.medianReplyMinutes
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : null
}

/** Median in minutes from the best fact available, or null when neither is usable. */
function medianMinutes(facts: ResponseFacts): number | null {
  const exact = exactMinutes(facts)
  if (exact !== null) return exact
  const key = (facts.responseTime ?? '').trim().toLowerCase()
  return Object.hasOwn(COARSE_CEILING_MIN, key) ? COARSE_CEILING_MIN[key] : null
}

function speedFor(minutes: number): ResponseSpeed {
  if (minutes <= HOUR_MIN) return 'under_1h'
  if (minutes <= DAY_MIN) return 'under_1d'
  return 'over_1d'
}

function tierFor(speed: ResponseSpeed, rate: number): ResponseTier {
  // Rate first: it answers "did anyone get an answer at all", which outranks "how fast was the
  // answer that did arrive". A sub-hour median over a 33% rate describes a seller who replies to a
  // third of buyers quickly and ignores the rest, and the two thirds are the ones being advised.
  if (rate < RESPONSE_DAY_FLOOR) return 'slow'
  if (speed === 'over_1d') return 'slow'
  if (speed === 'under_1h' && rate >= RESPONSE_FAST_RATE) return 'fast'
  return 'ok'
}

/**
 * Freeze a label pair before it leaves. ⚠️ ON THE COARSE PATHS `label` AND `aria` ARE THE SAME
 * OBJECT (there is no "~" to spell out, so the words are identical), which a reviewer spotted:
 * without this, writing to `signal.label.en` silently rewrites `signal.aria.en` too. The pairs are
 * built per call so nothing leaks between sellers, but a shape that aliases two public fields
 * should not also be writable. Same argument as NO_SIGNAL, one layer down.
 */
function pair(p: Bilingual): { label: Bilingual; aria: Bilingual } {
  const frozen = Object.freeze(p)
  return { label: frozen, aria: frozen }
}

/** Nearest 5 minutes, never below 5 — "~13 min" implies a precision the median does not have, and
 *  "~0 min" is not a duration. Only reachable on the exact-median path. */
function round5(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5)
}

/** The precise labels, used only when medianReplyMinutes was supplied. */
function exactLabels(minutes: number, speed: ResponseSpeed): { label: Bilingual; aria: Bilingual } {
  // ⚠️ THE MINUTES BRANCH IS GUARDED ON THE ROUNDED VALUE, NOT THE RAW ONE. A 59-minute median
  // rounds to 60, and "Replies in ~60 min" is a sentence no human writes — the reader has to do
  // the division themselves to learn it means an hour. Testing the rounded number here lets 58 and
  // 59 fall through to the hour branch and read "~1 hour", which is the same fact in the unit the
  // buyer is actually thinking in.
  const rounded = round5(minutes)
  if (speed === 'under_1h' && rounded < HOUR_MIN) {
    return {
      label: Object.freeze({ en: `Replies in ~${rounded} min`, vi: `Phản hồi trong ~${rounded} phút` }),
      aria: Object.freeze({ en: `Replies in about ${rounded} minutes`, vi: `Phản hồi trong khoảng ${rounded} phút` }),
    }
  }
  if (speed === 'over_1d') {
    // ⚠️ `Math.max(1, …)`, NOT `Math.max(2, …)`. The tempting floor is 2 — this tier is by
    // definition above 24 hours, so "at least two days" reads tidier. It is also a lie in the
    // wrong direction: a 24h01m median rounds to 1 day, and calling it "~2 days" makes a seller
    // look worse than they were measured to be. This signal is allowed to under-claim (that is
    // what every suppression here does); it is not allowed to over-state a fault.
    const n = Math.max(1, Math.round(minutes / DAY_MIN))
    const one = n === 1
    return {
      label: Object.freeze({
        en: one ? 'Replies in ~1 day' : `Replies in ~${n} days`,
        vi: `Phản hồi trong ~${n} ngày`,
      }),
      aria: Object.freeze({
        en: one ? 'Replies in about 1 day' : `Replies in about ${n} days`,
        vi: `Phản hồi trong khoảng ${n} ngày`,
      }),
    }
  }
  // Everything from exactly 60 minutes up to 24 hours reads in whole hours. `Math.max(1, …)` keeps
  // the 60-minute boundary itself at "~1 hour" rather than rounding to a bare hour count of 1 that
  // an off-by-one could turn into 0.
  const n = Math.max(1, Math.round(minutes / HOUR_MIN))
  const one = n === 1
  return {
    label: Object.freeze({
      en: one ? 'Replies in ~1 hour' : `Replies in ~${n} hours`,
      vi: `Phản hồi trong ~${n} giờ`,
    }),
    aria: Object.freeze({
      en: one ? 'Replies in about 1 hour' : `Replies in about ${n} hours`,
      vi: `Phản hồi trong khoảng ${n} giờ`,
    }),
  }
}

/**
 * The coarse labels — the only ones reachable on production today.
 *
 * ⚠️ THE `over_1d` LABEL SAYS "a few days" AND NOT "~3 days", AND THE DIFFERENCE IS THE POINT.
 * The stored string 'within a few days' is written for ANY median above 24 hours, with no upper
 * bound: it covers a 25-hour seller and a three-week seller identically. Printing "~3 days" there
 * would invent a number nobody measured, on the one tier where a buyer is deciding whether to
 * bother waiting. The precise form is available and correct on the exact-median path above, which
 * is where a real number exists to round.
 */
/**
 * ⛔ THE LABEL FOR A SELLER WHOSE **RATE** IS WHAT MAKES THEM SLOW. It does not mention the median
 * at all, and that is the single most important branch in this file.
 *
 * ⚠️ IT EXISTS BECAUSE THIS MODULE SHIPPED THE EXACT LIE IT WAS WRITTEN TO PREVENT, and an
 * external reviewer caught it. A seller with `responseRate: 33` and `responseTime: 'within an
 * hour'` was tiered `slow` and correctly penalised in ranking — and then rendered the chip
 * "Replies within an hour". MEASURED, not argued: that is the LIVE state of the one seller on prod
 * with a receipt. Two thirds of the buyers who message that shop get no answer inside a day; the
 * sub-hour median describes only the third who did. A median is a statement about the replies that
 * ARRIVED, and quoting it to a buyer who is deciding whether to write at all answers a question
 * they did not ask with a number that excludes them.
 *
 * seller-metrics.ts reached the same conclusion by a different route and SUPPRESSES the label
 * entirely below RESPONSE_DAY_FLOOR ("Show nothing, never a fake"). This module states the fact
 * instead, because suppression makes a measured 33% seller look identical to a brand-new shop —
 * which is the one comparison a buyer most needs to be able to make, and the entire premise of
 * this feature is that a buyer who gets no reply leaves rather than trying again.
 *
 * The words are chosen to be a plain reading of the measurement and nothing more: below the floor
 * means fewer than half of buyers got any reply within 24h. Tone stays neutral in <ResponseChip>;
 * the sentence carries the fact, the colour must not carry a verdict.
 *
 * ⚠️ THE 50-79% BAND STILL QUOTES ITS MEDIAN, AND THAT IS A JUDGEMENT CALL, NOT AN OVERSIGHT. A
 * reviewer argued the argument above applies verbatim at 60% — a median describes only the buyers
 * who got a reply, whatever the rate. True in kind, and the reason the line sits at
 * RESPONSE_DAY_FLOOR anyway is that the number is not this feature's to choose: it is the floor
 * seller-metrics.ts already uses to decide the same question for the same seller, and inventing a
 * second one here recreates precisely the chip-disagrees-with-the-badge failure the whole mirror
 * section of this file is built to avoid. Moving it is a one-line change IN BOTH FILES.
 */
function unreliableLabels(): { label: Bilingual; aria: Bilingual } {
  // ⚠️ "WITHIN A DAY" IS LOAD-BEARING AND WAS ADDED AFTER A REVIEWER CALLED THE FIRST WORDING.
  // It read "Often does not reply", which asserts that no reply ever arrives. The measurement does
  // not say that: responseRate counts replies inside 24 HOURS, so below the floor the honest claim
  // is that most buyers are still waiting a day later. Under-claiming a fault is this module's
  // standing rule and it applies to the seller as much as to the buyer.
  return pair({ en: 'Often no reply within a day', vi: 'Thường không phản hồi trong ngày' })
}

function coarseLabels(speed: ResponseSpeed): { label: Bilingual; aria: Bilingual } {
  if (speed === 'under_1h') return pair({ en: 'Replies within an hour', vi: 'Phản hồi trong vòng 1 giờ' })
  if (speed === 'under_1d') return pair({ en: 'Replies within a day', vi: 'Phản hồi trong vòng 1 ngày' })
  return pair({ en: 'Replies in a few days', vi: 'Phản hồi sau vài ngày' })
}

/**
 * The whole feature, as one pure function.
 *
 * `now` is epoch ms and is REQUIRED — see the module header for why this file may not read the
 * clock itself. Every suppression below returns the identical NO_SIGNAL object, so "unmeasured"
 * has exactly one shape and a caller cannot accidentally distinguish "never measured" from
 * "measurement expired" and leak the difference into the UI.
 */
export function responseSignal(facts: ResponseFacts, now: number): ResponseSignal {
  // GATE 1 — the receipt. Without it the row still holds the fabricated =100 default.
  const stamped = receiptMs(facts.measuredAt)
  if (stamped === null) return NO_SIGNAL

  // GATE 2 — receipt freshness, re-decided against the CALLER's clock. See RECEIPT_MAX_AGE_DAYS.
  //
  // ⚠️ THE LOWER BOUND IS NOT PADDING. A receipt dated in the FUTURE gives a NEGATIVE age, which
  // sails through the only test anyone writes here (`ageDays <= MAX`) — and future receipts are
  // reachable two ways: clock skew between the machine that baked a page and the phone reading it,
  // and a seeded or hand-fixed row. `!(ageDays >= 0)` rejects both those and NaN, which a bare
  // `ageDays < 0` would not (every comparison with NaN is false).
  const ageDays = (now - stamped) / DAY_MS
  if (!(ageDays >= 0) || ageDays > RECEIPT_MAX_AGE_DAYS) return NO_SIGNAL

  // GATE 3 — live conversation floor, when the caller is able to assert one. See ResponseFacts.
  if (facts.convoCount !== 'receipt-only' && !(facts.convoCount >= RESPONSE_MIN_CONVOS)) return NO_SIGNAL

  // GATE 4 — a median we can actually name. An unrecognised responseTime string suppresses.
  const minutes = medianMinutes(facts)
  if (minutes === null) return NO_SIGNAL

  const speed = speedFor(minutes)

  // GATE 5 — a rate we actually have. A receipt without a rate should not exist (the nightly job
  // writes both columns in one UPDATE), so this is a data anomaly or an unselected column.
  //
  // ⚠️ IT SUPPRESSES; IT USED TO READ THE MISSING VALUE AS 0. That was defensible while `slow`
  // still rendered the median sentence — 0 is below the floor, so the seller merely lost their
  // chip. It stopped being defensible the moment the sub-floor label started STATING the rate:
  // a reviewer pointed out that a NULL column then produces "often no reply within a day" about a
  // seller nobody measured, which is the same fabrication as the =100 default pointed the other
  // way. Absent evidence is not evidence, in either direction.
  //
  // ⚠️ OUT-OF-RANGE COUNTS AS ABSENT TOO, AND THAT IS NOT PEDANTRY. This checked only for a finite
  // number until a reviewer walked the domain: `responseRate: -1` published "often no reply within
  // a day" and took the FULL ranking penalty, and `responseRate: 101` was tiered `fast`. Both are
  // impossible values that the type (`number | null`) cannot exclude, and both turn a corrupt
  // column into a confident public claim in one direction or the other. The doc comment on the
  // field says 0..100; this is the line that makes that a guarantee rather than a hope.
  const rate = facts.responseRate
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) return NO_SIGNAL

  const tier = tierFor(speed, rate)
  // ⚠️ THE RATE GATE COMES BEFORE EITHER MEDIAN LABEL, AND THE ORDER IS THE WHOLE POINT — see
  // unreliableLabels(). Below the day floor the median describes a minority of buyers, so no
  // version of it may be printed, precise or coarse.
  const { label, aria } =
    rate < RESPONSE_DAY_FLOOR
      ? unreliableLabels()
      : exactMinutes(facts) !== null
        ? exactLabels(minutes, speed)
        : coarseLabels(speed)

  return {
    measured: true,
    speed,
    tier,
    label,
    aria,
    rankDelta: RESPONSE_RANK_DELTA[tier],
    repliesFast: tier === 'fast',
  }
}

/**
 * The ranking input on its own, for a scorer that wants the number and none of the strings.
 * ADD it to browseRankScore()/searchScore(); do not multiply. The composite is a weighted SUM of
 * bounded terms, so an additive delta is the only form whose worst case is knowable without
 * knowing the other terms — which is what makes the paragraph in RESPONSE_RANK_DELTA quotable.
 *
 * ⚠️ NO CLAMP AT ZERO, DELIBERATELY. A floor-scoring listing can end up at -0.05, and that is
 * correct: browse orders by rankScore DESC, so a negative value sorts exactly where it belongs.
 * Clamping would silently re-tie the slowest sellers with the ones just above them, which is the
 * one group this signal exists to separate.
 *
 * ⚠️ IF YOU BAKE THIS INTO THE PERSISTED `Listing.rankScore`, THE TIME GATE FREEZES UNTIL THE NEXT
 * RECOMPUTE — raised by an external reviewer and worth stating rather than discovering. rankScore
 * is a stored column, so a delta written into it stops re-deciding receipt freshness the moment it
 * lands. The staleness is bounded and small: recomputeRankScoreAllActive() sweeps every live
 * listing daily (src/lib/ranking.ts), against a receipt window of RECEIPT_MAX_AGE_DAYS, so a
 * seller whose measurement expires carries the penalty at most one day too long. It errs toward
 * keeping a penalty rather than keeping a claim, which is the safe direction. What is NOT safe is
 * mirroring this into rankScoreExprSql() without a Seller join — the expression runs over Listing
 * alone today, and a delta that cannot see the receipt cannot expire at all.
 */
export function responseRankDelta(facts: ResponseFacts, now: number): number {
  return responseSignal(facts, now).rankDelta
}

// ── THE "REPLIES FAST" FACET ────────────────────────────────────────────────────────────────────
//
// DEFINITION, stated exactly: a seller qualifies iff `tier === 'fast'`, which is
//   (a) a receipt that exists and is younger than RECEIPT_MAX_AGE_DAYS, AND
//   (b) >= RESPONSE_MIN_CONVOS scored conversations behind the number, AND
//   (c) a median first reply inside ONE HOUR, AND
//   (d) a replied-within-24h rate of at least RESPONSE_FAST_RATE (80).
//
// WHY (c) AND (d) TOGETHER: they fail in opposite directions and a facet built on either alone
// mis-sells the seller. Rate alone admits a seller who answers everyone reliably at hour 23 —
// true, useful, and not what a buyer tapping "Replies fast" is asking for. Median alone admits a
// seller who answers one buyer in five instantly and the rest never; their median is four minutes.
// The pair means: most buyers get an answer, and the typical one arrives within the hour.
//
// WHY 80 AND NOT SOME NEW NUMBER: it is RESPONSE_FAST_RATE, the threshold seller-metrics.ts
// already uses for its "Responds quickly" bucket. A facet with its own threshold would produce the
// state where a seller's own card says one thing and the filter that claims to select for it says
// another. One number, two surfaces.
//
// ── HOW IT DEGRADES FOR SELLERS WITH NO MEASUREMENT ─────────────────────────────────────────────
// They are excluded from the facet — there is no honest alternative, since including them would
// mean asserting speed nobody measured. What must NOT follow is the thing that makes exclusion
// dangerous:
//
// ⛔ THE COMPLEMENT MUST NEVER BE OFFERED AS A FILTER. No "Replies slowly", no inverted toggle, no
// "hide slow sellers". `repliesFast=0` would sweep every unmeasured seller — 10 of 11 on prod as
// of 2026-08-12, i.e. essentially every new shop — into a bucket labelled with a failure they were
// never measured for. This module deliberately exposes NO predicate for the negative case; the
// three-valued outcome below is for EXPLAINING an exclusion, never for selecting on it.
//
// ⚠️ AND THE FACET MUST BE OPT-IN, NEVER A DEFAULT OR A PRE-APPLIED SORT. Measured 2026-08-12 on
// prod: exactly one Seller row of eleven carries a receipt, and its rate is 33 — below the day
// floor — so the number of sellers who qualify for this facet TODAY IS ZERO. Wired as a default it
// would empty the catalogue. Wired as a chip a buyer taps, it is honest and currently useless,
// which is the correct state for a signal that has not accumulated yet.
//
// The zero-results copy is the caller's, but it has to say WHY, and REPLIES_FAST_NOTE is that
// sentence: a buyer who filters to nothing must learn that the filter is thin, not that the
// marketplace is empty.

/** URL/query key for the facet. One spelling, so the chip, the API and the analytics agree. */
export const REPLIES_FAST_FACET_KEY = 'repliesFast'

/** The facet chip's own words. `Phản hồi nhanh` is deliberately the SAME Vietnamese phrase
 *  seller-metrics.ts already ships for the 'fast' bucket — the filter and the badge it filters on
 *  must not read as two different claims. */
export const REPLIES_FAST_LABEL: Bilingual = Object.freeze({ en: 'Replies fast', vi: 'Phản hồi nhanh' })

/** The honest caveat to show beside the facet whenever it is active, and in its empty state. */
export const REPLIES_FAST_NOTE: Bilingual = Object.freeze({
  en: 'Only sellers with a measured reply time can appear here. New sellers are not slow, just unmeasured.',
  vi: 'Chỉ những người bán đã có thời gian phản hồi được đo mới xuất hiện ở đây. Người bán mới không chậm, chỉ là chưa được đo.',
})

/** Why a seller is or is not in the facet. `unmeasured` and `too_slow` are BOTH exclusions and are
 *  reported separately for one reason only: so a zero-results state can say how many sellers are
 *  missing because nobody has measured them yet. Do not build a filter out of the distinction. */
export type RepliesFastOutcome = 'qualifies' | 'too_slow' | 'unmeasured'

export function repliesFastOutcome(facts: ResponseFacts, now: number): RepliesFastOutcome {
  const signal = responseSignal(facts, now)
  if (!signal.measured) return 'unmeasured'
  return signal.repliesFast ? 'qualifies' : 'too_slow'
}

/**
 * The same definition as a SQL predicate, so the query that FILTERS and the chip that LABELS
 * describe the same set of sellers as closely as two different runtimes can.
 *
 * ⚠️ "CANNOT DISAGREE" IS THE WRONG CLAIM AND THIS COMMENT USED TO MAKE IT. A reviewer was right
 * to push: there are exactly three places they still diverge, all bounded, all deliberate, and all
 * in the direction of the FILTER being slightly wider than the CHIP.
 *   1. THE CONVERSATION FLOOR. SQL does not re-check it (see below). A seller whose 90d window has
 *      slid to 4 stays in the filter for up to RECEIPT_MAX_AGE_DAYS while a surface that supplies
 *      a real `convoCount` — the PDP and the storefront — renders no chip for them. The card
 *      surface, which passes 'receipt-only', still shows one, so the filter and the CARD agree.
 *      ⚠️ WHICH MEANS THE CARD AND THE PDP DISAGREE ABOUT THAT SELLER, and a reviewer was right
 *      that this is the divergence a BUYER actually experiences: chip on the browse card, no chip
 *      on the page it links to, for up to eight days. It is the price of letting the card surface
 *      exist at all (LISTING_CARD_SELECT cannot afford a per-seller conversation count), and it
 *      fails in the direction of the PDP being stricter than the card, which is the right way
 *      round — the page with more information is the one that withholds the claim. The way to
 *      close it is to give the card a real count, not to loosen the PDP.
 *   2. THE CLOCK. SQL reads the database `now()`; the chip reads the viewer's. A device whose
 *      clock is far enough off can land on the other side of the 8-day edge.
 *   3. WHITESPACE. `btrim` strips spaces; JS `.trim()` also strips tabs, newlines and NBSP. Not
 *      reachable today — the only writer is the CASE expression in response-rate.ts, whose three
 *      arms are bare literals — and listed so it is not rediscovered as a mystery.
 * The failure that MATTERS is the opposite one (the filter returning a seller whose card shows
 * nothing), which is why the future-dated receipt below was a bug and these three are not.
 *
 * ⚠️ THIS EXISTS BECAUSE THE ALTERNATIVE IS A HAND-WRITTEN COPY, AND THIS CODEBASE HAS ALREADY
 * PAID FOR THAT ONCE. src/lib/ranking-formula.ts carries the same note in its own header: the
 * rankScore formula was hand-mirrored into the seed and into a backfill script and drifted into
 * THREE different formulas before anyone noticed. Every constant below is interpolated from the
 * exported values above, so re-tuning a threshold changes the chip and the filter in one edit.
 *
 * ⚠️ IT MIRRORS THE `fast` ARM OF tierFor(), WHICH REMAINS THE AUTHORITY. Read them together: this
 * is `receipt present AND receipt inside the window AND rate >= FAST AND median under an hour`,
 * which is the coarse-path spelling of `tier === 'fast'`. It deliberately does NOT re-check the
 * 5-conversation floor — the receipt only exists because the nightly job measured >= 5
 * conversations, which is exactly the `convoCount: 'receipt-only'` bargain the card surface takes.
 *
 * ⚠️ BOTH ENDS OF THE RECEIPT WINDOW ARE TESTED, AND THE UPPER ONE IS NOT PEDANTRY. The obvious
 * predicate is `>= now() - interval '8 days'` alone, which is what this function shipped as until
 * two external reviewers found it independently. A FUTURE-dated receipt passes that test — and
 * gate 2 of responseSignal() rejects it. MEASURED against the live database, three synthetic rows
 * through this exact predicate: a receipt one day in the future returned TRUE from SQL while the
 * JS returns `unmeasured` for the same row. The failure is the precise thing this function exists
 * to prevent: the filter returns the seller, and then their card renders NO CHIP, so a buyer gets
 * a page of results under a promise none of them make.
 *
 * ⚠️ IT ALSO ASSUMES THE COARSE PATH. If a numeric median column is ever added, this predicate
 * needs the same "exact wins over coarse" precedence the JS has, or the filter will start
 * disagreeing with the chip for every seller who has one.
 *
 * `alias` is the Seller table alias in the caller's query (`s`, or `"Seller"`). Returns a bare
 * boolean expression with no leading AND, safe to drop into a WHERE clause.
 *
 * ⚠️ `alias` IS CALLER DATA AND IS INTERPOLATED RAW, SO IT IS VALIDATED. An earlier version of
 * this comment claimed the function "interpolates NO caller data", which was simply false with
 * four `${alias}` sites directly below it — and a wrong safety note is worse than none, because it
 * is what the next author reads before passing a string they built. Anything that is not a bare or
 * double-quoted SQL identifier throws rather than reaching the query.
 */
export function repliesFastSqlPredicate(alias: string): string {
  // ⚠️ TWO ALTERNATIVES, NOT ONE PATTERN WITH TWO OPTIONAL QUOTES. The obvious spelling —
  // /^"?[A-Za-z_]\w*"?$/ — makes the opening and closing quote independent, so `"s` and `s"` both
  // pass and both produce malformed SQL. Two reviewers found it in the same round.
  //
  // ⚠️ IT DOES NOT REJECT SQL RESERVED WORDS: `repliesFastSqlPredicate('select')` is accepted and
  // yields invalid SQL. Deliberate — the reserved list is ~100 words, version-dependent, and
  // maintaining a copy here would be a second mirror to keep in sync for a caller error that
  // surfaces immediately as a syntax error rather than silently. The standard SQL answer already
  // works and this guard already accepts it: quote the alias (`"select"`).
  if (!/^(?:[A-Za-z_][A-Za-z0-9_$]*|"[A-Za-z_][A-Za-z0-9_$ ]*")$/.test(alias)) {
    throw new Error(`repliesFastSqlPredicate: alias must be a bare or double-quoted SQL identifier, got ${JSON.stringify(alias)}`)
  }
  return [
    `${alias}."responseMetricAt" IS NOT NULL`,
    `${alias}."responseMetricAt" <= now()`,
    `${alias}."responseMetricAt" >= now() - interval '${RECEIPT_MAX_AGE_DAYS} days'`,
    `${alias}."responseRate" >= ${RESPONSE_FAST_RATE}`,
    `lower(btrim(${alias}."responseTime")) = 'within an hour'`,
  ].join(' AND ')
}
