// SAVED-SEARCH + PRICE-DROP ALERTS — the PURE rules that decide whether we are allowed to
// interrupt a person.
//
// WHY THIS EXISTS. eno takes no commission and sells no bumps, so the notification channel is
// the ONLY free way back to a buyer who looked and did not convert. Exactly two events earn an
// interruption: a NEW LISTING matching a search they saved, and a PRICE DROP on something they
// were already tracking. Everything else is us talking about ourselves.
//
// ⚠️ THE FAILURE MODE IS NOT "WE SENT TOO FEW". It is getting muted, and a mute is permanent:
// nobody re-enables a marketplace's notifications. Every gate below exists to make the channel
// survivable, and each one is a bound on a DIFFERENT axis — how often (rate), when (quiet hours),
// how much it has to be worth (the drop floors), whether we already said it (dedup), and whether
// anyone is even reading (dormancy). Deleting any one of them leaves the other four looking
// sufficient while the channel dies on the axis that is now unbounded.
//
// PURITY CONTRACT (copied from src/lib/trade-loop.ts, which set the pattern): no Prisma, no
// `server-only`, no I/O, and no `new Date()` without an argument. Every function takes its facts
// AND its clock as arguments, so the whole machine is unit-testable and safely importable from a
// client component. Callers do the reads and the writes; this file only decides.
//
// NO USER-FACING STRINGS LIVE HERE, ON PURPOSE. Every outcome is a CODE plus the numbers behind
// it. Copy is a `tr(en, vi)` decision at the surface that renders it — a notification title, a
// push body and a dashboard row phrase the same fact three different ways, and a pure rules module
// that picked one for them would be wrong in the other two.
//
// ── WHAT ALREADY EXISTS (inventoried 2026-08-12; do NOT rebuild any of it) ────────────────────
//   · `src/lib/saved-search.ts` — SavedSearchParams, `buildListingWhere()` (feed-identical
//     matching), `toUrlParams()`, `describeParams()`. The MATCHING is solved. This file never
//     matches anything; it is handed candidates that already matched.
//   · `src/app/api/cron/saved-search-alerts/route.ts` — the live cron. It counts matches newer
//     than `SavedSearch.lastNotifiedAt`, writes one `Notification` of type 'saved_search', pushes,
//     and advances the cursor in a transaction. It has NO rate limit, NO quiet hours, NO
//     per-listing dedup and NO dormancy check. That is the gap this module fills.
//   · `src/lib/price-drop.ts` + `src/lib/price-drop-rules.ts` — the server-anchored 30-day
//     reference price (`Listing.previousPrice`), the EU-Omnibus qualification rules, the monotonic
//     `lowestNotifiedPrice` ratchet, a 24h per-listing cooldown and a 5/24h per-recipient cap. The
//     ANTI-FAKE-DISCOUNT half is solved and this module does not second-guess it: the percentage
//     floor below IS `DROP.NOTIFY_RATCHET`, imported, not re-typed.
//   · `Notification` (type / title / body / listingId / url / read) — the delivery row.
//     `PushSubscription` + `NativePushToken` — the push fan-out. Both already wired.
//
// ── WHAT DOES NOT EXIST, AND WHAT THIS MODULE DOES ABOUT IT ───────────────────────────────────
// THERE IS NO SERVER-SIDE SAVED-LISTINGS TABLE. Hearts live in `localStorage` under
// `eno:favorites` (src/context/favorites-context.tsx); `POST /api/listings/[id]/save` only bumps
// the aggregate `Listing.savedCount`. `src/lib/price-drop.ts` says so in its own comment, which is
// why its audience is conversations + contact reveals rather than savers.
//
// So "a price drop on a saved listing" cannot be fanned out from a cron today. The closest thing
// that IS reachable — and it is a good approximation, because a saved search is a stronger
// statement of intent than a heart — is a price drop on a listing that matches a search the buyer
// saved. `planSavedSearchAlert({ kind: 'price_drop' })` is exactly that path: same gates, the
// newness test swapped for the drop test, and per-listing dedup doing the work the cursor cannot.

import { DROP } from '@/lib/price-drop-rules'
import { DAY_MS } from '@/lib/trust-math'

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * DAY_MS
/**
 * How far in the future a recorded timestamp may be before it is discarded as a bad clock rather
 * than trusted as a send. Mirrors `HEALTH.NUDGE_CLOCK_SKEW_MS` in src/lib/listing-health.ts —
 * the two modules must not disagree about what counts as skew.
 */
const SKEW_TOLERANCE_MS = HOUR_MS

export const ALERTS = {
  /**
   * Vietnam is a SINGLE time zone (UTC+7) and observes no DST, so the offset is a constant and
   * this module needs no tzdb. ⚠️ It is an input everywhere below, not a hidden global, so the
   * one caller that ever needs a per-user zone can pass it without touching these rules.
   */
  TZ_OFFSET_MINUTES: 7 * 60,
  /**
   * Quiet hours, in LOCAL time. 22:00 → 07:00. ⚠️ THE WINDOW WRAPS MIDNIGHT and the predicate
   * below assumes it does (`h >= START || h < END`); a future edit that makes START < END silently
   * inverts the rule into "quiet all day except the evening". If you need a non-wrapping window,
   * rewrite `isQuietHour`, do not just move the numbers.
   *
   * 22:00 rather than 21:00 because the Vietnamese evening IS marketplace prime time — Chợ Tốt /
   * Shopee traffic peaks after dinner, and a 21:00 cutoff would silence the best hour we have.
   */
  QUIET_START_HOUR: 22,
  QUIET_END_HOUR: 7,
  /**
   * Minimum gap between two alerts for the SAME saved search. Six hours caps one search at four
   * a day on its own; the per-user cap below is what actually binds, and this exists so a single
   * hyperactive search cannot eat the whole user budget before the others are considered. The
   * live cron already reads searches `orderBy: { lastNotifiedAt: 'asc' }`, which is the other half
   * of that fairness.
   */
  PER_SEARCH_GAP_MS: 6 * HOUR_MS,
  /**
   * Alerts per RECIPIENT per 24h, across every saved search AND price drops together.
   *
   * ⚠️ ONE SHARED BUDGET, DELIBERATELY TIGHTER THAN `DROP.RECIPIENT_DAILY_CAP` (5). Two
   * independent caps do not compose: a buyer with three saved searches and an active watchlist
   * could clear both and still receive eight pushes in a day. Three is the ceiling because the
   * same bell and the same push channel also carry messages, offers and sale confirmations —
   * notifications the user ASKED for by taking an action. The budget defended here is theirs.
   */
  PER_USER_DAY_CAP: 3,
  /**
   * And per 7 days. Well under 7 × the daily cap (21) so a burst week cannot become a habit: a
   * user who gets the full three on Monday and Tuesday has four left for the rest of the week.
   */
  PER_USER_WEEK_CAP: 10,
  /**
   * How many listing ids the copy may NAME. The headline number is `matchCount` (all of them);
   * this bounds the body, which is one line on a lock screen.
   */
  MAX_LISTINGS_NAMED: 3,
  /**
   * Per-search dedup memory: the most recent N (listing, price-we-told-them) pairs, so one
   * listing never alerts the same search twice for the same reason. Bounded because it is stored
   * as a JSON text column, not a table — see `mergeNotified`.
   *
   * ⚠️ WHAT IT MUST OUTLAST IS THE SWEEP'S EXPOSURE WINDOW, WHICH IS WHY THE SWEEP MUST FOLLOW
   * `Listing.priceDropAt` (the `DROP.BADGE_MS` clock, 3 days) AND NOT `previousPrice != null`.
   * `previousPrice` survives until the next raise, so a sweep keyed on it re-offers the same drop
   * indefinitely and the only thing standing between the buyer and a repeat is this buffer. A
   * reviewer sized that correctly: at maximum throughput the buffer covers ~9 days, so a
   * 30-day exposure would evict live entries and tell the same buyer the same thing twice. Keyed
   * on the badge, the exposure is 3 days and the margin is comfortable. The relationship is
   * asserted in the tests.
   *
   * ⚠️ AND IT IS NOT FREE-STANDING. It must stay above
   * `MAX_RECORDED_PER_RUN × PER_USER_WEEK_CAP` (25 × 10 = 250), or a busy week can evict an entry
   * that is still inside the window it is meant to cover — and an evicted entry re-alerts. A
   * reviewer found exactly that hole in the first draft: an unbounded per-run record list plus a
   * small buffer gave a broad search a permanent thrash loop, re-alerting the same listings on
   * every run forever. The invariant is asserted in the test suite; move one number and it fails.
   */
  NOTIFIED_ID_MEMORY: 300,
  /**
   * How many listings ONE run may claim to have covered.
   *
   * ⚠️ IT BINDS ON THE PRICE-DROP PATH, WHERE THE MEMORY IS THE ONLY DEDUP THERE IS. On the
   * new-match path the cursor covers everything regardless, so an eviction there is harmless — a
   * listing behind the cursor can never be new again. On the drop path there is no cursor to fall
   * back on, so the run covers at most this many and leaves the rest for the next one, which is
   * honest: a listing we did not record is a listing we did not alert about.
   */
  MAX_RECORDED_PER_RUN: 25,
  /**
   * Stop sending to a recipient who has this many UNREAD alerts. THE SINGLE STRONGEST ANTI-MUTE
   * RULE IN THIS FILE, and the cheapest: three ignored alerts is the user telling us, without
   * touching a setting, that this channel is not working for them. It needs no schema (unread is
   * already `Notification.read = false`) and it heals itself — the moment they open one, the
   * count drops and alerts resume. Compare the alternative, which is that they mute us in the OS
   * and we never reach them again about anything, including a message from a real buyer.
   */
  MAX_UNREAD_ALERTS: 3,
  /**
   * The percentage floor for a drop worth interrupting someone about. NOT A NEW NUMBER —
   * `DROP.NOTIFY_RATCHET` is the existing engine's own notify gate (≥10% below the lowest price
   * buyers were EVER notified at), re-exported so there is one definition. Compared in the same
   * MULTIPLICATIVE form the engine uses (`price <= ref * RATCHET`) rather than as a subtracted
   * fraction, because `1 - 0.9` is 0.09999999999999998 in binary floating point and an
   * exactly-10% drop deserves a gate that does not depend on which side of that you round.
   */
  MIN_DROP_RATCHET: DROP.NOTIFY_RATCHET,
  /**
   * And an ABSOLUTE floor on the saving, in VND. ⚠️ THIS ONE IS GENUINELY NEW — the existing
   * engine floors the listing PRICE (`DROP.MIN_PRICE` = 50.000) but never the SAVING, so a 10%
   * cut on a 200.000 item qualified for a push worth 20.000.
   *
   * Measured 2026-08-12 over the 48 active+verified listings on prod: p25 price 1.000.000,
   * median 1.890.000, p75 3.030.000, p10 50.000. 100.000 is exactly 10% of the p25 price, so on
   * the top three quartiles the percentage gate binds first and this floor changes nothing; on
   * the cheap tail below p25 — the tail that would otherwise generate the most pings for the
   * least money — no percentage can clear it. Every listing on prod is priced in đồng
   * (`currency = '₫'`, 51/51), so this is applied unconditionally.
   */
  MIN_SAVING_VND: 100_000,
} as const

/** The two events that earn an interruption. Nothing else may be added without a reason as good. */
export type AlertKind = 'new_match' | 'price_drop'

/**
 * A listing that already matched — this module never matches anything itself (see the header:
 * `buildListingWhere()` owns matching and its semantics are feed-identical).
 */
export type AlertCandidate = {
  listingId: string
  /**
   * ⚠️ REQUIRED, AND IT CARRIES THE EDITION BOUNDARY. Visa and itinerary products are ORDINARY
   * `Listing` rows owned by the desk seller, so nothing about a candidate distinguishes them
   * except this id. See `context.deskSellerIds`.
   */
  sellerId: string
  /** `Listing.createdAt`. A 'new_match' candidate must be newer than the search cursor. */
  createdAt: Date
  /** Current asking price, VND. */
  price: number
  /**
   * `Listing.previousPrice` — the SERVER-ANCHORED lowest price in the trailing 30 days, computed
   * by `src/lib/price-drop.ts` from the `PriceChange` audit. null when there is no active drop.
   * ⚠️ Never a seller-entered "was" price; there is no such field anywhere in the schema, which
   * is the whole point of the anti-fake-discount design. Only read for kind 'price_drop'.
   */
  referencePrice?: number | null
}

export type SavedSearchState = {
  id: string
  profileId: string
  /** `SavedSearch.notify`. */
  notify: boolean
  /**
   * `SavedSearch.lastNotifiedAt`. TWO MEANINGS AT ONCE, and they only stay consistent because
   * `cursorTo` is non-null ONLY when we actually send: "everything created at or before this has
   * been considered" AND "this is when we last spoke to this person about this search". The
   * per-search cooldown reads the second meaning. If a future change advances the cursor on a
   * no-op run, the cooldown silently stops working — advance a separate column instead.
   */
  lastNotifiedAt: Date
  /**
   * When we last actually SPOKE about this search, for the per-search cooldown.
   *
   * ⚠️ SEPARATE FROM THE CURSOR BECAUSE A PRICE-DROP RUN DOES NOT MOVE THE CURSOR (see
   * `cursorTo`). Defaults to `lastNotifiedAt`, which is exact for a new-match-only deployment.
   * A deployment that also runs drop alerts should pass the newest alert `Notification.createdAt`
   * for this recipient, or drop runs will not rate-limit themselves per search — only the
   * per-user caps will bind.
   */
  lastAlertAt?: Date | null
  /**
   * What we have already told this search's owner: (listing, the price we quoted). ⚠️ THERE IS NO
   * COLUMN FOR THIS YET — see `mergeNotified` for the one-line DDL. Pass `undefined` and dedup
   * falls back to the cursor alone, which is correct for 'new_match' and NOT sufficient for
   * 'price_drop': a listing that drops in price was created long before the cursor and would
   * re-alert on every run.
   */
  notified?: readonly NotifiedEntry[]
}

/**
 * One remembered alert: the listing, and THE PRICE WE QUOTED AT THE TIME.
 *
 * ⚠️ THE PRICE IS THE WHOLE POINT AND THE FIRST DRAFT DID NOT HAVE IT — it remembered bare ids,
 * which two independent reviewers each attacked from a different side of the same hole:
 *   · a listing alerted as a NEW MATCH could never afterwards alert as a PRICE DROP, because the
 *     id was already in the set. The buyer discovers an item through their saved search and is
 *     then never told when it gets cheaper — the single event the feature exists for.
 *   · a listing alerted for a 10% drop could never alert again for a further 20% cut, which
 *     silently defeats `lowestNotifiedPrice`, the ratchet the price-drop engine uses precisely so
 *     a genuinely better deal CAN interrupt you twice.
 * Remembering the price collapses both into one rule with no special cases: we may speak again
 * only when the price is a full ratchet below what we last quoted. That is `lowestNotifiedPrice`
 * semantics, per (search, listing), which is what it should have been from the start.
 */
export type NotifiedEntry = { id: string; price: number }

export type RecipientAlertHistory = {
  /**
   * When this recipient was last actually INTERRUPTED — types 'saved_search' AND 'price_drop'
   * together, because from the phone in their hand they are the same buzz. Order does not matter;
   * the caller only needs the trailing 7 days.
   *
   * ⚠️ PUSHED ALERTS ONLY, WHICH IS NOT THE SAME AS "alert notification rows", AND TODAY THE
   * SCHEMA CANNOT TELL THEM APART. `planPriceDropAlert` can return `send: true, push: false` — a
   * bell row written during quiet hours or past the cap precisely so nothing is lost. `Notification`
   * has no `pushed` flag, so a caller that builds this list with a plain
   * `db.notification.findMany({ type: … })` feeds those silent rows back in as interruptions: a
   * reviewer traced it to five overnight silent drops exhausting a daytime budget of three, which
   * inverts the degradation into the data loss it was added to prevent. Either add a nullable
   * `Notification.pushedAt` and filter on it, or accept the over-count knowingly.
   */
  sentAt: readonly Date[]
  /**
   * How many of those are still `read = false`. Feeds the dormancy rule. A caller that cannot
   * cheaply count this may pass 0, which disables the rule — say so at the call site if you do.
   */
  unreadAlerts: number
  /** A global opt-out, if one is ever added. Absent = not muted. */
  muted?: boolean
}

export type AlertContext = {
  /**
   * ⚠️ SAMPLE THIS BEFORE QUERYING THE CANDIDATES, NEVER AFTER. `cursorTo` returns this instant,
   * so a `now` taken after the query moves the search past any listing inserted WHILE the query
   * ran — a concurrent-insert race that silently drops a match with no error and no retry. The
   * live cron already does the right thing (`const runStart = new Date()` before its reads, and
   * `lastNotifiedAt: runStart` after); keep it that way.
   */
  now: Date
  /**
   * ⚠️ THE EDITION BOUNDARY, AND IT FAILS CLOSED. eno.vn is a licensed sàn TMĐT and may not
   * surface e-visa or itinerary services, so a saved search on the marketplace must never match a
   * desk listing. `deskSellerIds()` in src/lib/edition-scope.ts resolves these by owner email and
   * THROWS rather than returning an empty array, precisely because "no desk exists" and "I could
   * not find out" are the same value and opposite decisions.
   *
   * A pure planner cannot throw usefully inside a cron fan-out, so it does the equivalent: an
   * empty list on the marketplace edition sends NOTHING and returns `edition_unresolved`. It does
   * not "assume there is no desk", which is the shape of the leak.
   *
   * The caller should still prefer `scopedListingWhere()` on the query that produced the
   * candidates — this is the second lock, not the first.
   */
  deskSellerIds: readonly string[]
  /**
   * True on eno.forum, where the desk is the merchant and its listings may legitimately match.
   *
   * ⚠️ IT MUST BE `IS_SERVICES` FROM src/lib/edition.ts — A BUILD-TIME CONSTANT — AND NOTHING
   * ELSE. It switches the licensing boundary off, so a value derived from a request (a header, a
   * host, a query param, a per-user setting) hands an outsider the switch: one misclassified
   * marketplace invocation puts e-visa SKUs into an eno.vn buyer's notifications. The pure module
   * cannot read the constant itself without becoming impure, so it is a parameter — which makes
   * the provenance the caller's obligation, and this the note that states it.
   */
  servicesEdition?: boolean
  /** Override for a per-user time zone. Defaults to Vietnam (UTC+7, no DST). */
  tzOffsetMinutes?: number
}

/** Why a whole alert was or was not sent. */
export type AlertOutcome =
  | 'sent'
  | 'search_muted'
  | 'recipient_muted'
  | 'dormant'
  | 'edition_unresolved'
  | 'nothing_new'
  | 'quiet_hours'
  | 'search_cooldown'
  | 'daily_cap'
  | 'weekly_cap'

/** Why one candidate did not make it into an alert. */
export type CandidateSkip =
  | 'desk_listing'
  | 'already_notified'
  | 'not_new'
  | 'no_reference'
  | 'drop_too_small'
  | 'saving_too_small'

export type SavedSearchAlertPlan = {
  send: boolean
  kind: AlertKind
  reason: AlertOutcome
  /** Every candidate this alert COVERS — the number the headline should say. */
  matchCount: number
  /** The first `MAX_LISTINGS_NAMED` of those, for the body copy. */
  namedListingIds: string[]
  /** The covered ids. Record these (with their prices) so they do not alert again unchanged. */
  recordListingIds: string[]
  /** `SavedSearch.notified` after this send, deduped + capped. null when not sending. */
  notified: NotifiedEntry[] | null
  /**
   * The new `SavedSearch.lastNotifiedAt`, or null meaning DO NOT ADVANCE.
   *
   * ⚠️ NULL ON EVERY SUPPRESSION, WHICH IS WHAT MAKES A DEFERRAL LOSSLESS. Quiet hours and both
   * caps hold the cursor, so the matches are still there on the next run and the buyer gets ONE
   * batched alert at 07:00 instead of four rows overnight. Advancing on a suppressed run would
   * silently delete matches nobody ever saw.
   *
   * ⚠️ AND NULL ON EVERY PRICE-DROP RUN, EVEN A SUCCESSFUL ONE. The cursor means "every NEW
   * listing up to here has been considered", and a drop run considers old listings only — it
   * never looked at what was posted since the last new-match run. A reviewer found the first
   * draft advancing it anyway: a 09:00 drop alert would push the cursor past three listings
   * posted at 07:00–08:59 that no run had ever examined, and they were gone. The cursor belongs
   * to the new-match path and to nothing else.
   */
  cursorTo: Date | null
  /**
   * The new `SavedSearch.lastAlertAt` — non-null exactly when `send` is true.
   *
   * ⚠️ IT IS RETURNED RATHER THAN LEFT IMPLIED because a reviewer noted the plan told the caller
   * how to move the cursor and then expected it to reconstruct the cooldown clock on its own. The
   * whole write set for a run is `{ cursorTo, alertedAt, notified }`; anything the caller has to
   * derive is a thing two callers will derive differently.
   */
  alertedAt: Date | null
  skipped: { listingId: string; reason: CandidateSkip }[]
  /** When the blocking condition clears, for logging. null when nothing is deferred. */
  retryAfter: Date | null
}

export type PriceDropAlertPlan = {
  /** Write the in-app `Notification` row. */
  send: boolean
  /**
   * Also wake the device.
   *
   * ⚠️ THE ONE ASYMMETRY WITH SAVED SEARCHES, AND IT IS DELIBERATE. A saved-search alert is
   * DEFERRED through quiet hours because nothing is lost — the cursor holds and the matches are
   * still there at 07:00. A price drop cannot be deferred: `priceChangeEffects()` stamps
   * `priceDropNotifiedAt` and `lowestNotifiedPrice` at decision time and never retries, so a
   * suppressed drop is a destroyed drop. So the bell row is written and the PUSH is dropped —
   * nothing is lost and nobody is woken.
   */
  push: boolean
  reason: AlertOutcome | CandidateSkip
  /** VND below the 30-day reference. 0 when it did not qualify. */
  savingVnd: number
  /** The same saving as a fraction of the reference, for copy. 0 when it did not qualify. */
  fraction: number
  /**
   * The entry to fold into this recipient's `alreadyAlerted` memory — non-null exactly when `send`
   * is true, INCLUDING a silent (`push: false`) row, because the buyer can still find it and must
   * not be told the same thing twice. `mergeNotified` takes it.
   */
  record: NotifiedEntry | null
  retryAfter: Date | null
}

/* ── Clock helpers ─────────────────────────────────────────────────────────────────────────── */

/** The hour (0–23) in the recipient's local zone. */
export function localHour(now: Date, tzOffsetMinutes: number = ALERTS.TZ_OFFSET_MINUTES): number {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).getUTCHours()
}

/** Is it quiet hours? The window wraps midnight — see QUIET_START_HOUR. */
export function isQuietHour(now: Date, tzOffsetMinutes: number = ALERTS.TZ_OFFSET_MINUTES): boolean {
  const h = localHour(now, tzOffsetMinutes)
  return h >= ALERTS.QUIET_START_HOUR || h < ALERTS.QUIET_END_HOUR
}

/**
 * The next moment quiet hours end, as a real (UTC) instant. Called only when `isQuietHour` is
 * true; from 23:30 it returns tomorrow 07:00 local, from 02:00 it returns today 07:00 local.
 */
export function quietHoursEnd(now: Date, tzOffsetMinutes: number = ALERTS.TZ_OFFSET_MINUTES): Date {
  const shifted = now.getTime() + tzOffsetMinutes * 60_000
  const d = new Date(shifted)
  const localMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  let end = localMidnight + ALERTS.QUIET_END_HOUR * HOUR_MS
  if (end <= shifted) end += DAY_MS
  return new Date(end - tzOffsetMinutes * 60_000)
}

/* ── Rate limiting ─────────────────────────────────────────────────────────────────────────── */

export type AlertBudget = {
  day: number
  week: number
  dayCapped: boolean
  weekCapped: boolean
  /** When the binding cap frees a slot. null when neither is capped. */
  retryAfter: Date | null
}

/**
 * Fold a send back into the recipient's history.
 *
 * ⚠️ CALL THIS AFTER EVERY SEND INSIDE A CRON PASS, OR THE PER-USER CAP DOES NOTHING. A reviewer
 * found the hole and it is the easiest one here to walk into: `RecipientAlertHistory` is an
 * immutable input, and the documented caller loops over EVERY saved search belonging to a user.
 * Five matching searches produce five independent plans, each reading the same untouched `sentAt`,
 * each deciding it has budget — and the recipient gets five pushes against a cap of three. The
 * caps are per-RECIPIENT, so the accounting has to be per-recipient too, and a plain re-read of
 * the database inside the loop would not help either: the `Notification` rows for this pass are
 * usually written after the fan-out.
 *
 * ⚠️ FOLD A SEND ONLY WHEN IT WAS ACTUALLY PUSHED. `planPriceDropAlert` can return
 * `send: true, push: false` — a bell row written during quiet hours or past the cap. The budget
 * exists to bound how often a phone buzzes; a silent row did not buzz and must not spend a slot.
 *
 * ⚠️ IT IS AN IN-MEMORY FOLD, NOT A LOCK. Two cron workers, or a cron racing the price-write
 * path, still read the same history and can each pass the cap — the caps are best-effort bounds
 * on a best-effort channel, not a reservation system. A pure function cannot fix that; if it ever
 * matters, the reservation belongs in the caller, in the same transaction as the notification
 * insert.
 */
export function withAlertSent(history: RecipientAlertHistory, at: Date): RecipientAlertHistory {
  // ⚠️ `unreadAlerts` MOVES TOO, AND LEAVING IT BEHIND WAS THE SAME BUG ONE FIELD OVER — a
  // reviewer caught it in the function written to fix that bug. An alert just pushed is by
  // definition unread, so a buyer sitting at two unread with five matching searches would have had
  // every plan re-read `2`, clear the dormancy gate five times, and finish at five unread against
  // a ceiling of three. Both counters are per-recipient; both have to be folded per-recipient.
  return { ...history, sentAt: [...history.sentAt, at], unreadAlerts: history.unreadAlerts + 1 }
}

/**
 * How much of the recipient's shared alert budget is spent. Sliding windows, not calendar days:
 * a calendar reset means everyone's budget refills at midnight and the 00:01 send is the one that
 * wakes them — which is precisely the hour quiet hours exists to protect.
 */
export function alertBudget(sentAt: readonly Date[], now: Date): AlertBudget {
  const t = now.getTime()
  const inDay: number[] = []
  const inWeek: number[] = []
  for (const d of sentAt) {
    const ms = d.getTime()
    if (!Number.isFinite(ms)) continue
    // ⚠️ A FUTURE TIMESTAMP IS CLOCK SKEW, NOT A SEND, and the first version counted it. `t - ms`
    // is negative for a future date, so `< WEEK_MS` was trivially true: one row stamped 90 days
    // ahead filled a cap slot for three months AND pushed `retryAfter` three months out. The
    // listing-health module already refuses to trust a future timestamp; a reviewer noticed this
    // one did not. A few minutes of skew is real and still counts.
    const age = t - ms
    if (age <= -SKEW_TOLERANCE_MS) continue
    if (age < WEEK_MS) inWeek.push(ms)
    if (age < DAY_MS) inDay.push(ms)
  }
  const dayCapped = inDay.length >= ALERTS.PER_USER_DAY_CAP && inDay.length > 0
  const weekCapped = inWeek.length >= ALERTS.PER_USER_WEEK_CAP && inWeek.length > 0
  let retry: number | null = null
  if (dayCapped) retry = slotFreesAt(inDay, ALERTS.PER_USER_DAY_CAP, DAY_MS)
  if (weekCapped) {
    const w = slotFreesAt(inWeek, ALERTS.PER_USER_WEEK_CAP, WEEK_MS)
    retry = retry == null ? w : Math.max(retry, w)
  }
  return { day: inDay.length, week: inWeek.length, dayCapped, weekCapped, retryAfter: retry == null ? null : new Date(retry) }
}

/**
 * When the window next holds FEWER than `cap` sends.
 *
 * ⚠️ NOT "when the oldest one expires", which is what the first version computed and is only
 * correct when the window holds exactly `cap`. A reviewer pointed out the overshoot case — more
 * sends than the cap, reachable from concurrent workers or from history written before a cap was
 * lowered — where the oldest expiring still leaves the window full, so the advertised retry time
 * was a time at which nothing changes. Enough of the oldest have to fall out, which is the send at
 * index `length - cap` once sorted ascending. At exactly `cap` that index is 0, i.e. the oldest,
 * so the simple case is unchanged.
 */
function slotFreesAt(window: readonly number[], cap: number, span: number): number {
  const sorted = [...window].sort((a, b) => a - b)
  return sorted[Math.max(0, sorted.length - cap)] + span
}

/* ── The price floor ───────────────────────────────────────────────────────────────────────── */

export type DropQualification = {
  ok: boolean
  /** VND below the reference. */
  savingVnd: number
  /** The saving as a fraction of the reference (0.12 = 12% off). */
  fraction: number
  reason: 'ok' | 'no_reference' | 'drop_too_small' | 'saving_too_small'
}

/**
 * Is this drop worth interrupting someone about? BOTH floors must clear: at least
 * `DROP.NOTIFY_RATCHET` off the server-anchored reference, AND at least `MIN_SAVING_VND` of
 * actual money. Percentage alone rewards cheap listings for cutting nothing; money alone rewards
 * expensive listings for cutting a rounding error.
 */
export function qualifyingDrop(referencePrice: number | null | undefined, price: number): DropQualification {
  const ref = typeof referencePrice === 'number' && Number.isFinite(referencePrice) ? referencePrice : 0
  if (!(ref > 0) || !Number.isFinite(price) || price < 0) {
    return { ok: false, savingVnd: 0, fraction: 0, reason: 'no_reference' }
  }
  const savingVnd = ref - price
  const fraction = savingVnd / ref
  // Multiplicative, exactly as src/lib/price-drop.ts writes it — see MIN_DROP_RATCHET.
  if (!(price <= ref * ALERTS.MIN_DROP_RATCHET)) {
    return { ok: false, savingVnd: Math.max(0, savingVnd), fraction: Math.max(0, fraction), reason: 'drop_too_small' }
  }
  if (savingVnd < ALERTS.MIN_SAVING_VND) {
    return { ok: false, savingVnd, fraction, reason: 'saving_too_small' }
  }
  return { ok: true, savingVnd, fraction, reason: 'ok' }
}

/* ── Dedup memory ──────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THERE IS NO COLUMN FOR THIS YET. The minimal storage is one NULLABLE text column holding a
 * JSON array of `[id, price]` tuples — the same shape `SavedSearch.params` already uses, so it
 * needs no new table and no FK:
 *
 *   ALTER TABLE "SavedSearch" ADD COLUMN "notified" TEXT;
 *
 * Tuples rather than objects only to keep the column small: at the cap, ~300 × 35 bytes ≈ 10KB,
 * read once per search per cron pass. Until the column exists, pass `undefined` and read the
 * warning on `SavedSearchState.notified`.
 */
export function parseNotified(raw: string | null | undefined): NotifiedEntry[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    const out: NotifiedEntry[] = []
    for (const row of v) {
      if (!Array.isArray(row)) continue
      const [id, price] = row as unknown[]
      if (typeof id === 'string' && id && typeof price === 'number' && Number.isFinite(price)) out.push({ id, price })
    }
    return out
  } catch {
    return []
  }
}

export function serializeNotified(entries: readonly NotifiedEntry[]): string {
  return JSON.stringify(entries.map((e) => [e.id, e.price]))
}

/**
 * Newest-wins ring buffer. `added` goes to the FRONT so the most recently alerted entries are the
 * last to age out, and the result is capped at `NOTIFIED_ID_MEMORY`. One entry per listing: a
 * newer quote replaces an older one, which is what makes the ratchet monotonic downward.
 */
export function mergeNotified(existing: readonly NotifiedEntry[] | undefined, added: readonly NotifiedEntry[]): NotifiedEntry[] {
  const out: NotifiedEntry[] = []
  const seen = new Set<string>()
  for (const e of [...added, ...(existing ?? [])]) {
    if (!e?.id || seen.has(e.id)) continue
    seen.add(e.id)
    out.push({ id: e.id, price: e.price })
    if (out.length >= ALERTS.NOTIFIED_ID_MEMORY) break
  }
  return out
}

/**
 * May we speak about this listing again, given what we last quoted for it?
 *
 * Never told them → yes. Told them → only when the price is a full `MIN_DROP_RATCHET` below the
 * quote they already have, which is `lowestNotifiedPrice` semantics scoped to this search.
 *
 * ⚠️ `kind` MATTERS. A listing cannot be NEW twice, so on the new-match path any memory of it at
 * all is a stop — the price question is not the right one to ask there, and asking it would let a
 * listing re-announce itself as "new" after a discount.
 */
export function mayRealert(memory: readonly NotifiedEntry[] | undefined, kind: AlertKind, listingId: string, price: number): boolean {
  const told = (memory ?? []).find((e) => e.id === listingId)
  if (!told) return true
  if (kind === 'new_match') return false
  return price <= told.price * ALERTS.MIN_DROP_RATCHET
}

/* ── The planners ──────────────────────────────────────────────────────────────────────────── */

export type SavedSearchAlertInput = {
  kind: AlertKind
  search: SavedSearchState
  /**
   * ⚠️ THE CALLER MUST PASS EVERY MATCH IT INTENDS THIS RUN TO COVER. `cursorTo` moves the search
   * past everything considered here, so a truncated list silently drops the remainder. Bound the
   * query by the caps instead (the plan never names more than `MAX_LISTINGS_NAMED` anyway), or
   * ignore `cursorTo` if you truncated.
   */
  candidates: readonly AlertCandidate[]
  /**
   * Set when the candidate query was bounded (a `take:`) and more matches exist. Forces
   * `cursorTo: null`, because a cursor may only move past listings somebody actually looked at.
   *
   * ⚠️ THE SAFE WAY TO BOUND THE QUERY. The alternative — trusting the contract above and hoping
   * nobody adds a `take:` later — is how a search silently loses everything past the limit on the
   * one run where a backlog exists, which is exactly the run that matters.
   */
  candidatesTruncated?: boolean
  recipient: RecipientAlertHistory
  context: AlertContext
}

/**
 * When we last spoke about this search, clamped so a bad clock cannot mute it.
 *
 * ⚠️ THE CLAMP IS THE POINT. Both source columns are ordinary timestamps, and a future-dated one
 * made `now - lastSpoke` negative — permanently under the six-hour gap, so the search was silenced
 * until real time caught up. This module already refuses to trust a future send in `alertBudget`
 * and listing-health does the same for a nudge; a reviewer noticed the cooldown clock had been
 * left out of that discipline.
 */
function spokeAt(search: Pick<SavedSearchState, 'lastNotifiedAt' | 'lastAlertAt'>, now: Date): number {
  const raw = (search.lastAlertAt ?? search.lastNotifiedAt).getTime()
  const t = now.getTime()
  if (!Number.isFinite(raw)) return 0
  // ⚠️ CLAMPING TO `now` WOULD BE THE OBVIOUS FIX AND IT NEVER RECOVERS: the clamp re-evaluates to
  // `now` on every run, so "spoke just now" is true forever and the search is muted permanently —
  // the same outcome by a different route. A timestamp beyond the skew tolerance is not a time we
  // spoke, so it is discarded; jitter inside the tolerance is real and still clamped.
  if (raw - t > SKEW_TOLERANCE_MS) return 0
  return Math.min(raw, t)
}

/**
 * The cheap half of the decision — everything knowable WITHOUT the candidate query.
 *
 * Returns the blocking outcome, or null meaning "go and look for matches". Purely an
 * optimisation: `planSavedSearchAlert` is the authority and re-checks all of it. It exists
 * because a deferred search is re-examined on every cron tick until the deferral clears, and
 * during a nine-hour quiet window that is nine `db.listing.count()` calls per saved search that
 * could not have produced anything. Skipping the query is free; skipping the decision is not.
 *
 * ⚠️ ITS ORDER DELIBERATELY DIFFERS FROM THE PLANNER'S. The planner asks "is there anything to
 * say" before "is now a good time", so a silent run never reports a deferral. Here there are no
 * candidates yet, so timing is all there is. Do not read its reason as the planner's answer.
 */
export function preflightAlert(
  search: Pick<SavedSearchState, 'notify' | 'lastNotifiedAt' | 'lastAlertAt'>,
  recipient: RecipientAlertHistory,
  context: AlertContext,
): AlertOutcome | null {
  const tz = context.tzOffsetMinutes ?? ALERTS.TZ_OFFSET_MINUTES
  if (!search.notify) return 'search_muted'
  if (recipient.muted) return 'recipient_muted'
  if (recipient.unreadAlerts >= ALERTS.MAX_UNREAD_ALERTS) return 'dormant'
  if (context.servicesEdition !== true && context.deskSellerIds.length === 0) return 'edition_unresolved'
  if (isQuietHour(context.now, tz)) return 'quiet_hours'
  if (context.now.getTime() - spokeAt(search, context.now) < ALERTS.PER_SEARCH_GAP_MS) return 'search_cooldown'
  const budget = alertBudget(recipient.sentAt, context.now)
  if (budget.dayCapped) return 'daily_cap'
  if (budget.weekCapped) return 'weekly_cap'
  return null
}

/**
 * Should this saved search interrupt its owner right now, and with which listings?
 *
 * The gate ORDER is load-bearing: consent (`search_muted` / `recipient_muted` / `dormant`) before
 * correctness (`edition_unresolved`) before "is there anything to say" (`nothing_new`) before
 * timing (`quiet_hours` / cooldown / caps). A muted search must never report `daily_cap`, and a
 * run with nothing to say must never burn a retry log line on quiet hours.
 */
export function planSavedSearchAlert(input: SavedSearchAlertInput): SavedSearchAlertPlan {
  const { kind, search, candidates, recipient, context } = input
  const now = context.now
  const tz = context.tzOffsetMinutes ?? ALERTS.TZ_OFFSET_MINUTES

  const blocked = (reason: AlertOutcome, retryAfter: Date | null = null): SavedSearchAlertPlan => ({
    send: false,
    kind,
    reason,
    matchCount: 0,
    namedListingIds: [],
    recordListingIds: [],
    notified: null,
    cursorTo: null,
    alertedAt: null,
    skipped: [],
    retryAfter,
  })

  if (!search.notify) return blocked('search_muted')
  if (recipient.muted) return blocked('recipient_muted')
  if (recipient.unreadAlerts >= ALERTS.MAX_UNREAD_ALERTS) return blocked('dormant')

  // FAIL CLOSED. See AlertContext.deskSellerIds — an empty list on the marketplace edition means
  // "could not resolve the desk", never "there is no desk".
  const servicesEdition = context.servicesEdition === true
  if (!servicesEdition && context.deskSellerIds.length === 0) return blocked('edition_unresolved')
  const desk = new Set(servicesEdition ? [] : context.deskSellerIds)

  const cursor = search.lastNotifiedAt.getTime()
  const notifiable: AlertCandidate[] = []
  const skipped: { listingId: string; reason: CandidateSkip }[] = []
  const seenCandidate = new Set<string>()

  for (const c of candidates) {
    if (seenCandidate.has(c.listingId)) continue
    seenCandidate.add(c.listingId)
    if (desk.has(c.sellerId)) { skipped.push({ listingId: c.listingId, reason: 'desk_listing' }); continue }
    if (!mayRealert(search.notified, kind, c.listingId, c.price)) {
      skipped.push({ listingId: c.listingId, reason: 'already_notified' })
      continue
    }
    if (kind === 'new_match') {
      // Strictly newer than the cursor, matching the live cron's `createdAt: { gt: lastNotifiedAt }`.
      if (!(c.createdAt.getTime() > cursor)) { skipped.push({ listingId: c.listingId, reason: 'not_new' }); continue }
    } else {
      // A price drop is about a listing that already existed, so newness is not the test — the
      // dedup memory is. This is the branch that NEEDS `search.notified` to be real.
      const q = qualifyingDrop(c.referencePrice, c.price)
      if (!q.ok) { skipped.push({ listingId: c.listingId, reason: q.reason as CandidateSkip }); continue }
    }
    notifiable.push(c)
  }

  if (notifiable.length === 0) {
    // Nothing to say — but there may still be something to RECORD.
    //
    // ⚠️ THE CURSOR MOVES HERE ONLY IF THE CALLER HAS A SEPARATE "WHEN WE LAST SPOKE" CLOCK, and
    // the reason is the dual meaning of `lastNotifiedAt`. A reviewer showed the cost of freezing
    // it unconditionally: a search whose only matches are permanently disqualified — the desk's
    // listings on the marketplace, or ids already in the memory — never advances, so the cron
    // re-fetches and re-rejects the identical rows on every tick, forever, and the window only
    // ever grows. Advancing it when `lastAlertAt` is absent is worse: the cooldown would then
    // read a value that moves every run and block the search permanently. So the fix is available
    // exactly when the caller has paid for it with a column.
    // ⚠️ `kind === 'new_match'` IS LOAD-BEARING AND ITS ABSENCE WAS A REAL BUG — all three
    // reviewers found it independently, which is the strongest signal this gate ever produced.
    // A drop sweep almost always finds nothing notifiable, and a drop-running deployment always
    // supplies `lastAlertAt`, so without this check the 09:00 sweep set the cursor to 09:00 and
    // every listing posted 07:00–08:59 fell behind it unexamined. That is the exact failure the
    // comment on `cursorTo` says was already caught once on the send path.
    const canAdvance = kind === 'new_match' && search.lastAlertAt != null
    return { ...blocked('nothing_new'), cursorTo: canAdvance ? advanceTo(candidates, now, input.candidatesTruncated) : null, skipped }
  }

  const deferred = (reason: AlertOutcome, retryAfter: Date | null): SavedSearchAlertPlan => ({
    ...blocked(reason, retryAfter),
    matchCount: notifiable.length,
    recordListingIds: [],
    skipped,
  })

  if (isQuietHour(now, tz)) return deferred('quiet_hours', quietHoursEnd(now, tz))
  // "When we last spoke" — see SavedSearchState.lastAlertAt, which a drop-running deployment must
  // supply because a drop run never moves the cursor.
  const lastSpoke = spokeAt(search, now)
  if (now.getTime() - lastSpoke < ALERTS.PER_SEARCH_GAP_MS) {
    return deferred('search_cooldown', new Date(lastSpoke + ALERTS.PER_SEARCH_GAP_MS))
  }
  const budget = alertBudget(recipient.sentAt, now)
  if (budget.dayCapped) return deferred('daily_cap', budget.retryAfter)
  if (budget.weekCapped) return deferred('weekly_cap', budget.retryAfter)

  // What this alert actually COVERS. On the new-match path the cursor covers every notifiable
  // candidate whether or not it fits in the memory buffer, so the count is honest at any size. On
  // the drop path there is no cursor, so the run covers only what it can remember — see
  // MAX_RECORDED_PER_RUN — and the remainder is left for the next run rather than claimed.
  const covered = kind === 'price_drop' ? notifiable.slice(0, ALERTS.MAX_RECORDED_PER_RUN) : notifiable
  const recorded = covered.slice(0, ALERTS.MAX_RECORDED_PER_RUN)

  return {
    send: true,
    kind,
    reason: 'sent',
    matchCount: covered.length,
    namedListingIds: covered.slice(0, ALERTS.MAX_LISTINGS_NAMED).map((c) => c.listingId),
    recordListingIds: recorded.map((c) => c.listingId),
    notified: mergeNotified(search.notified, recorded.map((c) => ({ id: c.listingId, price: c.price }))),
    // ⚠️ NEW MATCHES ONLY, and never past listings nobody looked at. See cursorTo above.
    cursorTo: kind === 'new_match' ? advanceTo(candidates, now, input.candidatesTruncated) : null,
    alertedAt: now,
    skipped,
    retryAfter: null,
  }
}

/**
 * How far the cursor may move: `now` normally, and only as far as the NEWEST CANDIDATE EXAMINED
 * when the caller bounded its query.
 *
 * ⚠️ THE TRUNCATED CASE USED TO RETURN null, WHICH FROZE THE SEARCH FOREVER. A reviewer traced it:
 * a bounded query whose whole batch is unalertable (fifty of the desk's listings, or fifty ids
 * already in the memory) produced `nothing_new` with a null cursor, so the next tick fetched the
 * identical batch, skipped it identically, and every newer match queued behind it was never
 * reached. Refusing to advance is only right for rows nobody LOOKED at; a row we examined and
 * rejected is a row we are done with.
 *
 * ⚠️ THIS REQUIRES THE BOUNDED QUERY TO BE ORDERED BY `createdAt` ASCENDING, or "the newest one we
 * saw" does not mean "everything older was seen". An unordered `take:` is not a page.
 */
function advanceTo(candidates: readonly AlertCandidate[], now: Date, truncated?: boolean): Date | null {
  if (!truncated) return now
  let newest = 0
  for (const c of candidates) newest = Math.max(newest, c.createdAt.getTime())
  if (!newest) return null
  return new Date(Math.min(newest, now.getTime()))
}

export type PriceDropAlertInput = {
  /** The listing whose price just moved. `referencePrice` is `Listing.previousPrice`. */
  listing: AlertCandidate
  recipient: RecipientAlertHistory
  /**
   * What this recipient has already been told about, and AT WHAT PRICE. Dedup is per
   * (recipient, listing), and it ratchets: see `mayRealert`.
   *
   * ⚠️ IT CARRIES THE PRICE FOR THE SAME REASON `SavedSearch.notified` DOES. The first version
   * took bare ids, and a reviewer noted it contradicted the sibling path it sits beside: once a
   * listing appeared, every later drop for that recipient returned `already_notified` no matter
   * how much deeper the cut, which is precisely the behaviour `lowestNotifiedPrice` exists to
   * prevent. The two drop paths must not disagree about when a better deal earns a second word.
   */
  alreadyAlerted?: readonly NotifiedEntry[]
  context: AlertContext
}

/**
 * May we interrupt THIS recipient about THIS drop?
 *
 * ⚠️ THIS IS A SECOND LAYER, NOT A REPLACEMENT. `priceChangeEffects()` in src/lib/price-drop.ts
 * has already decided the drop is genuine (30-day reference, 72h age and hold, raise-cycling
 * suppression, the monotonic ratchet, the 24h per-listing cooldown). Nothing here re-litigates
 * any of that. What it adds is the three things that engine has no view of: quiet hours, an
 * absolute floor on the SAVING rather than only the price, and the shared per-recipient budget
 * that saved-search alerts also draw on.
 *
 * Gate order: correctness floors first, budget last, so a drop that was never worth sending does
 * not consume a retry decision.
 *
 * ⚠️ THIS AND `planSavedSearchAlert({ kind: 'price_drop' })` ARE TWO DIFFERENT TRIGGERS AND MUST
 * NEVER BE DRIVEN FROM THE SAME ONE. A reviewer read them side by side and asked how they can
 * disagree about whether a deferral destroys a drop; the answer is that they are not looking at
 * the same event:
 *   · THIS one is EVENT-driven — it runs inside the price WRITE, from `priceChangeEffects()`'s
 *     `notify` thunk, at the single instant the ratchet and cooldown are stamped. There is no
 *     second chance, so it may not defer, and it drops only the push.
 *   · The saved-search one is SWEEP-driven — a cron reading `Listing.previousPrice`, which the
 *     engine keeps for the whole badge window. Tomorrow's sweep sees the same drop, so deferring
 *     is free and it defers properly.
 * Wire this one to the write path and that one to the sweep. Wiring both to the write path would
 * double-notify; wiring both to the sweep would silently lose every drop that happened at 23:00.
 */
export function planPriceDropAlert(input: PriceDropAlertInput): PriceDropAlertPlan {
  const { listing, recipient, context } = input
  const now = context.now
  const tz = context.tzOffsetMinutes ?? ALERTS.TZ_OFFSET_MINUTES
  const no = (reason: AlertOutcome | CandidateSkip, savingVnd = 0, fraction = 0, retryAfter: Date | null = null): PriceDropAlertPlan =>
    ({ send: false, push: false, reason, savingVnd, fraction, record: null, retryAfter })

  // ⚠️ ONLY EXPLICIT CONSENT STOPS THE ROW HERE. `muted` is the buyer saying no. DORMANCY IS NOT:
  // it is an inference from three unread bell rows, and a reviewer pointed out that letting an
  // inference delete an irreversible event contradicts every other branch below — the caps were
  // rewritten to write a silent row for exactly this reason, and dormancy had been left on the
  // harsher path. A buyer with three unread notifications would have lost a 60%-off drop with no
  // row, no push and no way to learn it happened, because the listing's ratchet had already moved.
  if (recipient.muted) return no('recipient_muted')

  const servicesEdition = context.servicesEdition === true
  if (!servicesEdition && context.deskSellerIds.length === 0) return no('edition_unresolved')
  if (!servicesEdition && context.deskSellerIds.includes(listing.sellerId)) return no('desk_listing')

  const q = qualifyingDrop(listing.referencePrice, listing.price)
  if (!q.ok) return no(q.reason as CandidateSkip, q.savingVnd, q.fraction)

  if (!mayRealert(input.alreadyAlerted, 'price_drop', listing.listingId, listing.price)) {
    return no('already_notified', q.savingVnd, q.fraction)
  }

  // ── Timing and budget suppress the BUZZ, never the ROW ────────────────────────────────────
  // ⚠️ A CAP THAT DELETES AN IRREVERSIBLE EVENT IS NOT A RATE LIMIT, IT IS DATA LOSS, and the
  // first version made exactly that mistake by returning `send: false` here. A reviewer put it
  // beside this module's own quiet-hours reasoning: `priceChangeEffects()` stamps the ratchet at
  // decision time and never retries, so a buyer who happened to get three saved-search alerts
  // earlier in the day lost a 60%-off drop entirely — no bell row, no second chance, and no way
  // to ever learn it had happened. The interruption is the push. The row costs nothing and is the
  // thing the buyer can still find. So consent and the price floors stop the row; timing and
  // budget stop only the buzz.
  //
  // ⚠️ WHICH MEANS THE CALLER FOLDS A SEND INTO THE BUDGET ONLY WHEN `push` IS TRUE — see
  // `withAlertSent`. A row nobody was pushed did not spend the thing the cap is protecting.
  const budget = alertBudget(recipient.sentAt, now)
  const silent = (reason: AlertOutcome, retryAfter: Date | null): PriceDropAlertPlan =>
    ({ send: true, push: false, reason, savingVnd: q.savingVnd, fraction: q.fraction, record: { id: listing.listingId, price: listing.price }, retryAfter })
  if (recipient.unreadAlerts >= ALERTS.MAX_UNREAD_ALERTS) return silent('dormant', null)
  if (budget.dayCapped) return silent('daily_cap', budget.retryAfter)
  if (budget.weekCapped) return silent('weekly_cap', budget.retryAfter)
  if (isQuietHour(now, tz)) return silent('quiet_hours', quietHoursEnd(now, tz))
  return { send: true, push: true, reason: 'sent', savingVnd: q.savingVnd, fraction: q.fraction, record: { id: listing.listingId, price: listing.price }, retryAfter: null }
}
