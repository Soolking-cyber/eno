// ── PRICE GUIDANCE, FROM WHAT BUYERS PAID ───────────────────────────────────────────────────
//
// The band on the PDP today (src/lib/price-stat.ts + the nightly cron) is built from ASKING
// prices: the P25–P75 of what other sellers are currently hoping for. That is the number the
// market has already rejected — in this market the ask is an opening position and the sale
// happens below it. This module is the replacement, and the only thing it will ever read is a
// price a BUYER agreed to in writing.
//
// ⚠️ THERE IS NO INPUT CHANNEL FOR AN ASKING PRICE, AND THAT IS THE DESIGN, NOT AN OVERSIGHT.
// `GuidanceComparable` carries the `sale*` columns and nothing else money-shaped; the price is
// extracted by `salePriceForGuidance()` from src/lib/trade-loop.ts, which refuses anything that
// is not a buyer-confirmed eno sale. `Listing.price` is not in the type, so "the band quietly
// fell back to asks" is not a bug that can be introduced here by editing a branch — it would
// take a new field and a new predicate, which is a diff somebody has to defend. A fallback is
// the one failure mode that would be invisible in production and fatal to the feature: a band
// built from asks looks exactly like a band built from sales.
//
// ⚠️ ONE RULE ABOUT WHICH SALES MAY BE BELIEVED, AND IT LIVES IN trade-loop.ts. Do not re-derive
// "confirmed" here (`saleConfirmedAt != null` is NOT the rule — see saleState: a stamp without a
// named eno buyer, or a listing taken down after the sale, must not count). Every read below goes
// through the shared predicate so trust and guidance can never disagree about what happened.
//
// ── DAY ONE, THE HONEST ANSWER IS NOTHING ───────────────────────────────────────────────────
// MEASURED against the live database on 2026-08-12 (information_schema over DIRECT_URL): the
// deployed schema has `soldAt / soldChannel / soldPlatform / soldToProfileId` and NO `salePrice`,
// NO `saleConfirmedAt` — the Wave 3 columns are in prisma/schema.prisma and not yet migrated. So
// the true number of confirmed sales in production today is ZERO, and it stays near zero for as
// long as it takes real trades to close and real buyers to answer.
//
// `priceGuidance([], …)` therefore returns `{ shown: false, reason: 'no_comparables' }` and
// <PriceBand> renders NOTHING. Not a placeholder, not "not enough data yet", not a band computed
// from something else — nothing at all. An empty result is the correct output for an empty
// market, and the module reaches it by the ordinary path (an empty pool fails the same threshold
// every small pool fails), so there is no special day-one branch to remove later.
//
// PURITY CONTRACT (identical to trade-loop.ts, and for the same reason): no Prisma, no
// `server-only`, no I/O, no `new Date()` without an argument. The comparables and the clock are
// arguments. That is what lets the maths be tested without a database, and what lets a client
// component import this file to judge a price while the seller is still typing it.
//
// ── THE QUERY THAT FEEDS THIS (the integrator's half, deliberately not in this file) ─────────
// A thin server helper selects the candidate rows and hands them over. The shape it needs:
//
//   SELECT l.id, l."sellerId", s."ownerId" AS "sellerOwnerProfileId",
//          l."brandSlug", l.model, l.condition, l.year,
//          l.status, l."complianceStatus", l."soldChannel", l."soldToProfileId", l."soldAt",
//          l."salePrice", l."saleConfirmedAt", l."saleDeclinedAt", l."saleBuyerHistory",
//          l."saleConfirmPromptedAt"
//     FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId"   -- ownerId: see the per-party cap
//    WHERE l."brandSlug" = $brand                       -- ⚠️ BRAND ONLY. Model is matched HERE.
//      AND l.status = 'sold' AND l."soldChannel" = 'eno'
//      AND l."saleConfirmedAt" IS NOT NULL AND l."complianceStatus" <> 'taken_down'
//      AND COALESCE(l."soldAt", l."saleConfirmedAt") > now() - interval '180 days'
//      AND <marketplaceListingScope()>                  -- ⛔ NOT OPTIONAL, see below
//
// ⚠️ TWO THINGS IN THAT SKETCH WERE WRONG IN THE FIRST DRAFT AND BOTH FAILED SILENTLY — external
// reviewers found them, and they are the reason it is spelled out rather than left to taste:
//   · `lower(model) = lower($model)` PRE-FILTERS AWAY ROWS THIS MODULE WOULD HAVE MATCHED.
//     `modelKey` folds spacing, punctuation and accents ("Wave-Alpha" = "wave alpha"), so a SQL
//     equality on the raw text drops real comparables before the folding can see them — and the
//     unit tests, which hand rows straight in, would never notice. Filter on the BRAND in SQL and
//     let this module match the model, or add a normalized model column and match on that.
//   · A bare `"soldAt" > …` is NULL-false, so every row whose soldAt was never written is
//     discarded by the query — silently deleting the `saleConfirmedAt` fallback below. COALESCE.
//
// ⚠️ AND THE WHERE CLAUSE IS AN INDEX HINT, NEVER THE GATE. Every condition in it is re-checked
// here through `salePriceForGuidance`, because a query is edited by whoever needs a different
// page of results and a predicate is edited by whoever means to change the rule.
// ⚠️ AND IT MUST BE EDITION-SCOPED — scopedListingWhere()/marketplaceListingScope() from
// src/lib/edition-scope.ts. Visa and itinerary products are ORDINARY Listing rows on the shared
// desk, so an unscoped sweep would put "e-Visa, 1 hour" into a motorbike price band (and fail
// scripts/edition-lint.mjs Rule A on the way). This module cannot enforce it directly — nothing
// in a row says which domain serves it.
//
// ⚠️ BUT IT IS NOT ONLY PROSE, AND THIS WAS MEASURED RATHER THAN ASSUMED (three review rounds
// pushed on it, so it was checked against the live DB on 2026-08-12 instead of argued):
//   · ALL 14 visa/itinerary listings sit on ONE storefront (`Seller.ownerId` is @unique for the
//     shared desk), and ZERO of them have a `brandSlug` or a `model` — both counted 0.
//   · This module requires a non-empty brand AND model on the subject AND on every comparable,
//     so a desk SKU cannot join a band at all: it has neither key to match on.
//   · Even given both, every desk row shares one seller and one owner, so the per-party cap
//     admits at most MAX_PER_PARTY of them — three, against a floor of eight. A services-only
//     band is arithmetically unreachable.
// Two structural filters, then the caller's scope, then edition-lint. Keep the scope anyway: the
// measurement describes today's data, and a desk SKU that one day carries a brand would rely on
// the cap alone.

import { normalizeBrand } from './brand-normalize'
import { salePriceForGuidance, type SaleFacts } from './trade-loop'
import { DAY_MS } from './trust-math'

export const PRICE_GUIDANCE = {
  /**
   * Below this many comparables the band is HIDDEN ENTIRELY. 8, per spec — and deliberately
   * NOT the 5 that src/lib/price-stat.ts uses for the asked-price band.
   *
   * ⚠️ THE TWO NUMBERS GUARD DIFFERENT THINGS, WHICH IS WHY THEY DIFFER. price-stat's sample is
   * every ACTIVE listing in the segment, recomputed nightly and self-correcting: it is cheap,
   * abundant, and being a little wrong is survivable because the reader can see the listings it
   * came from. A confirmed sale is scarce (two parties had to speak), permanent, and invisible —
   * nobody can audit it. Sold-price guidance is also the number a seller will actually price
   * against, so a wrong band does not merely mislead, it MOVES the market it claims to describe.
   *
   * MEASURED, rather than argued (200k-trial Monte Carlo, lognormal σ=0.35 around a 12tr median —
   * a plausible spread for one brand+model+year of used motorbike; percentile_cont estimator, the
   * same one used below):
   *     n=5   median edge error 14%   90th-pct edge error 37%   band width 0.23–1.36× the truth
   *     n=8   median edge error 11%   90th-pct edge error 27%   band width 0.43–1.34× the truth
   *     n=12  median edge error  9%   90th-pct edge error 22%   band width 0.52–1.32× the truth
   * At n=5, one band in ten is wrong at an edge by more than a third, and one in ten is under a
   * quarter of its true width — a narrow, confident-looking range that is simply an artefact of
   * five draws. 8 does not fix that (nothing small does), it halves the tail. The cost is real
   * and accepted: at 8 the band appears later, on fewer models, than it would at 5.
   *
   * ⚠️ Changing this is changing what the marketplace claims to know. Re-run the measurement.
   */
  MIN_COMPARABLES: 8,
  /**
   * A band whose top exceeds this multiple of its bottom is not an actionable benchmark and is
   * suppressed. Same number and same reason as PRICE_STAT_MAX_SPREAD in src/lib/price-stat.ts
   * ("7tr–40tr" tells a seller nothing) — kept identical ON PURPOSE so the sold band and the
   * asked band cannot disagree about what is too noisy to show. It is NOT imported from there:
   * price-stat.ts opens with `import 'server-only'`, and this module has to stay importable from
   * a client component.
   */
  MAX_SPREAD: 3,
  /**
   * How old a sale may be and still be a comparable. Used goods depreciate — a phone or a bike
   * that changed hands 18 months ago is evidence about a different market — and a stale band is
   * the failure that looks most like a working one. Half a year is short enough that the number
   * still describes today and long enough to accumulate 8 sales of one model.
   */
  MAX_AGE_DAYS: 180,
  /**
   * How many comparables ONE PARTY may appear in — counting BOTH roles, seller and confirming
   * buyer, against the same budget. A shop that moves twenty identical units is one opinion about
   * the price repeated twenty times; without a cap it would set the "market" band for its own
   * model and then be measured against it.
   *
   * ⚠️ ONE SHARED BUDGET, NOT A SELLER CAP PLUS A BUYER CAP — AND THE DIFFERENCE IS THE WHOLE
   * ANTI-COLLUSION PROPERTY. Two independent caps were the first version, and an external
   * reviewer broke them in one line: three accounts selling in a CYCLE (A→B, B→C, C→A, three
   * times each) put every account at exactly 3 sales and 3 purchases, satisfying both caps, and
   * nine fabricated confirmations then set a public band. Sign-in is passwordless and an account
   * is free, so "three sellers" bought nothing on its own. Charging both sides of a row to one
   * budget makes that cycle cost 6 participations per account and collapses it to four usable
   * rows.
   *
   * ⚠️ READ IT WITH MIN_COMPARABLES AS ARITHMETIC, not as two independent knobs: 8 comparables ×
   * 2 parties = 16 participations, at ≤3 each, so EVERY band that renders involves at least SIX
   * distinct parties (⌈16/3⌉). That derived floor is the property worth keeping; change either
   * number and recompute the sentence.
   *
   * ⚠️ It bounds the cost of manipulation; it does not make it impossible. Six colluding accounts
   * still clear it. What it buys is that a fake band needs six real accounts and nine two-sided
   * confirmations — enough footprint to be visible in the data if anyone ever looks.
   */
  MAX_PER_PARTY: 3,
  /**
   * How far into the future a sale timestamp may sit and still be believed. The recency window
   * only bounds the PAST, so without this a row dated 2099 never ages out and sorts first in the
   * caps — one bad timestamp owning a public band indefinitely. A day forgives real clock skew.
   */
  MAX_FUTURE_SKEW_DAYS: 1,
  /**
   * ⚠️ AN ASK IS NOT A SALE, AND THIS IS THE NUMBER THAT KEEPS THE WARNING HONEST. Everything in
   * the band is a price somebody PAID; the price being judged against it is a price somebody is
   * ASKING, and in this market the ask is an opening position — that asymmetry is the premise of
   * the whole module. So an ask at the top edge of a sold band is ordinary haggling room, not an
   * overpriced listing, and warning about it would fire on the median honest seller until the
   * line became noise. `isAskAboveBand` therefore speaks only above P75 × (1 + this).
   *
   * ⚠️ IT IS AN ASSUMPTION, NOT A MEASUREMENT, AND IT IS THE ONLY ONE IN THIS FILE. There are
   * zero confirmed sales in production (see the header), so the ask→sale gap cannot be measured
   * yet. 15% is a placeholder chosen to be smaller than the spread the band itself tolerates and
   * larger than rounding. RE-DERIVE IT once real trades exist — median(price)/median(salePrice)
   * over confirmed sales, per category — and delete this paragraph when you do.
   */
  ASK_NEGOTIATION_MARGIN: 0.15,
  /**
   * How far under the band a price may sit and still be called a good one. Below P25 × this, the
   * marketplace says NOTHING.
   *
   * ⚠️ THIS IS THE MIRROR OF THE "NO OVERPRICED BADGE" RULE AND IT WAS MISSING. Without a floor,
   * `isBelowTypical` is true for ANY positive price under P25 — so a bait listing at 100.000 đ
   * against an 11tr band collects the marketplace's own consumer-facing green "Below typical"
   * chip beside the seller's photo. Refusing to call a seller expensive while handing a scammer a
   * public endorsement is not restraint, it is the same error inverted. (External reviewer.)
   *
   * It also silences the post wizard while a price is being TYPED: every prefix of 12.000.000 —
   * 1, 12, 1.200, 1.200.000 — is under P25, so the verdict line (and its polite live region)
   * fired on nearly every keystroke, announcing a good deal that did not exist yet. With the
   * floor at half of P25 only the finished number clears it.
   *
   * Half, not 0.9: a genuinely cheap listing is the thing worth surfacing, and 40% under the
   * quartile is a real bargain, not a typo. Under half, the likeliest explanations are a missing
   * digit, a different item, or bait — none of which deserve a badge.
   */
  BELOW_CREDIBLE_FRACTION: 0.5,
  /**
   * ± years counted as the same model year. A centred window, NOT the fixed 2-year bucket
   * `listingSegment()` uses in price-stat.ts, and the difference is deliberate: that bucket is a
   * PARTITION KEY for a SQL GROUP BY, so it has edges (2015 lands in 2014–2015 and never sees a
   * 2016), whereas this is a match predicate evaluated in memory against one subject and can be
   * centred on it. A bucket edge is an artefact of the aggregation, not a fact about motorbikes.
   */
  YEAR_TOLERANCE: 1,
} as const

/**
 * One candidate comparable: the sale columns of a `Listing` plus the four facts that decide
 * whether it is comparable to anything. Declared structurally so a caller can pass a selected
 * Prisma row straight in without re-shaping it, and so this module never imports Prisma.
 *
 * ⚠️ NOTE WHAT IS ABSENT: there is no `price`. See the header.
 */
export type GuidanceComparable = SaleFacts & {
  /** Listing.id — used only to keep a listing out of its own band. */
  id: string
  /** Listing.sellerId, for the per-party cap. Blank/null rows share ONE bucket (see below). */
  sellerId: string | null
  /**
   * Seller.ownerId — the PERSON behind the storefront, not the storefront.
   *
   * ⚠️ REQUIRED, AND IT IS WHAT MAKES THE CAP AN ANTI-COLLUSION RULE RATHER THAN A TIDINESS ONE.
   * `sellerId` and `soldToProfileId` live in different id spaces (a Seller row vs a Profile), so
   * one person acting as both sides of a trade looks like two unrelated keys and a cycle of three
   * accounts sails through a per-role cap. Joining the owner profile is what lets both roles be
   * charged to the same budget. Pass `null` only when the join genuinely is not available — it
   * falls back to `sellerId`, which is still a distinct key, so the cap degrades to per-storefront
   * rather than failing open.
   */
  sellerOwnerProfileId: string | null
  brandSlug: string | null
  model: string | null
  condition: string | null
  year: number | null
}

/** The thing being priced: a listing on its PDP, or the half-filled form in the post wizard. */
export type GuidanceSubject = {
  /** Present on a real listing; absent while posting. Excludes the subject from its own band. */
  id?: string | null
  brandSlug: string | null
  model: string | null
  condition?: string | null
  year?: number | null
  /**
   * ⛔ REQUIRED, BECAUSE brand+model IS NOT A CATEGORY BOUNDARY AND A RENT IS NOT A PRICE.
   *
   * `brandSlug`/`model` are written for ANY category, and `priceUnit` is 'VND/month' for rentals
   * and 'VND/service' for services — so nothing else in this shape can tell a Toyota Vios FOR SALE
   * from a Toyota Vios FOR RENT. The existing asked-price guidance already refuses that case on
   * purpose (post-wizard.tsx: "rentals price per MONTH — the PriceStat bands are sale prices, so
   * guidance there would coach sellers against the wrong market"), and this module dropped the
   * guard while inheriting the job. Concretely: an 18.000.000 đ/month listing measured against a
   * sold-car band reads as wildly underpriced and the guidance would coach the landlord to raise
   * a rent toward a car's sale price.
   * Anything other than a one-off sale unit returns NO band — a wrong band destroys trust in the
   * feature permanently, which is the whole reason it is gated at 8 comparables in the first place.
   * Comparables carry the same field for the same reason: a per-month row may never enter a
   * sale-price band, whatever its brand and model say. Found by an external reviewer.
   */
  priceUnit: string | null
}

/**
 * Which dimensions the band's comparables share with the subject. Reported so the UI can say
 * what it is actually comparing against — "same model" and "same model, year and condition" are
 * different claims and a seller is entitled to know which one they are being shown.
 */
export type GuidanceTier = 'model' | 'model_condition' | 'model_year' | 'model_condition_year'

/** Whole đồng, always. VND has no subunit; `Listing.salePrice` is đồng by definition (schema). */
export type SoldPriceBand = {
  /** Comparables the band was computed from, AFTER the per-party cap. Always ≥ MIN_COMPARABLES. */
  n: number
  p25: number
  median: number
  p75: number
  tier: GuidanceTier
}

/**
 * Why nothing is shown. Slugs, never prose — same convention as `DenyReason` in trade-loop.ts:
 * the client owns the wording, and none of these is ever rendered to a user anyway (the band is
 * simply absent). They exist for tests and telemetry.
 *  · no_subject_model — the subject has no brand+model, so "comparable" is undefined.
 *  · not_a_sale_price  — the subject is a rent or a fee; a sale band would coach the wrong market.
 *  · no_comparables   — zero confirmed sales survived the filters. THE DAY-ONE STATE.
 *  · too_few          — some, but under MIN_COMPARABLES even at the widest tier.
 *  · too_wide         — enough sales, but the spread makes the range useless (MAX_SPREAD).
 */
export type GuidanceHiddenReason =
  | 'no_subject_model'
  /** The subject is priced per month / per service, so a band of one-off SALE prices does not
   *  describe its market at all — see GuidanceSubject.priceUnit. */
  | 'not_a_sale_price'
  | 'no_comparables'
  | 'too_few'
  | 'too_wide'

export type PriceGuidance =
  | { shown: true; band: SoldPriceBand }
  | {
      shown: false
      reason: GuidanceHiddenReason
      /** Usable comparables at the widest tier. ⚠️ DIAGNOSTIC ONLY — never render it. "Based on
       *  4 sales" is exactly the half-confidence this feature exists to refuse. */
      comparables: number
    }

/**
 * The JS twin of Postgres `percentile_cont(p) WITHIN GROUP (ORDER BY …)` — linear interpolation
 * between order statistics at index p·(n−1). Same estimator as the asked-price cron
 * (/api/cron/price-stats), so if this ever moves into SQL the numbers do not shift by a
 * percent-and-a-bit on the day of the move. `sorted` must be ascending and non-empty.
 *
 * Interpolated rather than nearest-rank because at n=8 a nearest-rank quartile jumps a whole
 * order statistic when one sale is added — a band that visibly lurches for no reason a seller
 * can see is a band they stop believing.
 */
export function percentileCont(sorted: readonly number[], p: number): number {
  // An empty sample has no percentile. NaN rather than 0, because 0 is a PRICE and would sail
  // into a band; NaN poisons any arithmetic downstream loudly. `priceGuidance` never reaches
  // here with an empty array (MIN_COMPARABLES is checked first) — this is for other callers.
  if (sorted.length === 0) return Number.NaN
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

/** Free-text model → matching key. Reuses the repo's existing folding function (lowercase,
 *  de-accent, alphanumerics only) rather than rolling a second one: "Wave Alpha", "wave-alpha"
 *  and "WAVE ALPHA" are one model. price-stat.ts's lesson was that two normalizers disagree
 *  silently and the band just never renders. Strictly wider than the `lower(model)` match the
 *  SQL uses, so it can only ever admit rows that query returned, never drop them. */
function modelKey(raw: string | null | undefined): string {
  return normalizeBrand(raw || '')
}

/** brandSlug is ALREADY canonical (brandSlugify owns it), so it is compared as a key, not
 *  folded — folding would collapse two genuinely distinct slugs that differ only by a hyphen. */
function brandKey(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase()
}

/** ⚠️ EMPTY IS ABSENT. The partner sync stores whitespace-only conditions, and price-stat.ts
 *  records what that cost there: one side treated '' as a value, the other as null, and the two
 *  never met. Here '' means "not stated", so such a row can never satisfy a condition tier. */
function conditionKey(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase()
}

function finiteYear(year: number | null | undefined): number | null {
  return typeof year === 'number' && Number.isFinite(year) ? Math.trunc(year) : null
}

/**
 * Epoch ms from a timestamp, or null.
 *
 * ⚠️ THE TYPE SAYS `Date`; THE WIRE SAYS STRING. This module is importable from a client
 * component, and a client that fetched its comparables from an API route holds JSON — where a
 * `Date` came back as an ISO string. `(row.soldAt ?? …)?.getTime()` then throws a TypeError and
 * takes the whole render down, for a feature whose entire failure mode is supposed to be
 * "renders nothing". An external reviewer walked that path; this turns a crash into a skipped
 * row. It deliberately does NOT widen the exported type — `Date` is still the contract.
 */
function epochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isFinite(t) ? t : null
  }
  return null
}

/** A comparable that survived the confirmation, brand/model and recency filters. */
type Usable = {
  /** Listing.id. Carried for the cap's DETERMINISTIC tie-break, nothing else. */
  id: string
  price: number
  /** The person on the selling side: the storefront owner if known, else the storefront. */
  sellerParty: string
  /** Listing.soldToProfileId — the CONFIRMING buyer. Always present on a confirmed sale
   *  (saleState refuses to call an unnamed sale confirmed); read for the per-party cap. */
  buyerId: string
  condition: string
  year: number | null
  /** When the trade happened — the age the recency window measures. */
  at: number
}

const TIER_DIMENSIONS: Record<GuidanceTier, { condition: boolean; year: boolean }> = {
  model_condition_year: { condition: true, year: true },
  model_condition: { condition: true, year: false },
  model_year: { condition: false, year: true },
  model: { condition: false, year: false },
}

/**
 * The narrowing ladder for this subject: narrowest first, widening ONE dimension at a time until
 * a tier has enough comparables. Tiers the subject cannot express are absent — a subject with no
 * year is never offered a year tier — so "narrowing as the fields fill in" is literally this
 * list growing a rung as the seller types.
 *
 * CONDITION OUTRANKS YEAR, so when a rung has to go, the year goes first: new-versus-used is
 * usually the bigger price lever (often a factor of two) while ±1 model year is a few percent.
 * The ladder never widens past brand+model: a band across two models is not a band, it is an
 * average of unlike things.
 *
 * ⚠️ A SUBJECT WITH BOTH FACTS GETS THE model_year RUNG TOO, AND LEAVING IT OUT PUNISHED THE
 * SELLER WHO FILLED THE FORM IN. The first version returned [mcy, mc, model] when both were
 * known, so a short condition-matched set fell STRAIGHT to the all-years-all-conditions rung —
 * while the same seller, having left `condition` blank, would have got [my, model] and a tight
 * year-matched band. Stating more about your bike made the guidance worse, which is exactly
 * backwards. (Found by an external reviewer; reproduced as a test.) The rungs are therefore
 * ordered by how much they narrow, not by a tidy one-dimension-at-a-time rule.
 */
function tierLadder(subject: GuidanceSubject): GuidanceTier[] {
  const hasCondition = conditionKey(subject.condition) !== ''
  const hasYear = finiteYear(subject.year) !== null
  if (hasCondition && hasYear) return ['model_condition_year', 'model_condition', 'model_year', 'model']
  if (hasCondition) return ['model_condition', 'model']
  if (hasYear) return ['model_year', 'model']
  return ['model']
}

/**
 * At most MAX_PER_PARTY rows per party, charging BOTH sides of every trade to the SAME budget,
 * newest first — a shop's current prices, not its history.
 *
 * ⚠️ ONE BUDGET, NOT A SELLER PASS AND A BUYER PASS. Two independent caps were the previous
 * version and an external reviewer broke them in one line: three accounts selling in a CYCLE
 * (A→B, B→C, C→A, three times each) leave every account at exactly 3 sales and 3 purchases,
 * which satisfies both caps, and nine fabricated confirmations then set a public band. Charging
 * a row to both of its parties costs each account 6 of its 3-participation budget and collapses
 * the cycle to four usable rows. See MAX_PER_PARTY for the arithmetic this buys.
 *
 * ⚠️ THE SORT CARRIES AN EXPLICIT TIE-BREAK, AND IT IS NOT COSMETIC. `at` alone left equal
 * timestamps in input order, so WHICH three of a shop's five same-day sales survived — and
 * therefore p25/p75, and sometimes `shown` versus `too_few` — depended on the order Postgres
 * happened to return rows in, with no ORDER BY in the sketched query. A public price that moves
 * when the planner changes its mind is not a price. Also found by a reviewer; the id makes the
 * answer a function of the data alone.
 *
 * ⚠️ A MISSING id IS ONE SHARED BUCKET, NOT "EXEMPT". Bucketing unknowns separately (or skipping
 * the cap for them) would mean a projection that forgets to select the column silently removes
 * the cap — the safe direction for an unknown is to assume the rows came from the same party,
 * which caps them together and can only ever suppress a band, never inflate one.
 *
 * ⚠️ GREEDY, AND KNOWINGLY SUB-OPTIMAL. Newest-first can spend a party's budget on rows a
 * cleverer assignment would have skipped, so a set that COULD have yielded 8 comparables
 * sometimes yields fewer. That is the safe direction — it suppresses a band, it never invents
 * one — and a matching/flow search is a lot of machinery for a rule whose job is to be
 * obviously right.
 */
function capParties(rows: readonly Usable[]): Usable[] {
  const ordered = [...rows].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const used = new Map<string, number>()
  const spent = (key: string) => used.get(key) ?? 0
  const out: Usable[] = []
  for (const row of ordered) {
    // ⚠️ THE ROW'S COST IS TALLIED FIRST, AND A SELF-DEALT ROW COSTS ITS ONE PARTY TWO. Testing
    // the two keys independently against the PRE-CHARGE count let a party sitting at 2 pass both
    // guards and land at 4 — over a cap of 3, in exactly the shape the cap exists for. All three
    // external reviewers found the same off-by-one; the trade loop refuses seller-as-own-buyer
    // upstream, so this is a defence in depth against a hand-written row, not a live hole.
    const cost = new Map<string, number>()
    cost.set(row.sellerParty, (cost.get(row.sellerParty) ?? 0) + 1)
    cost.set(row.buyerId, (cost.get(row.buyerId) ?? 0) + 1)
    let affordable = true
    for (const [key, c] of cost) {
      if (spent(key) + c > PRICE_GUIDANCE.MAX_PER_PARTY) {
        affordable = false
        break
      }
    }
    if (!affordable) continue
    for (const [key, c] of cost) used.set(key, spent(key) + c)
    out.push(row)
  }
  return out
}

function matchesTier(row: Usable, tier: GuidanceTier, subject: GuidanceSubject): boolean {
  const dims = TIER_DIMENSIONS[tier]
  if (dims.condition && (row.condition === '' || row.condition !== conditionKey(subject.condition))) return false
  if (dims.year) {
    const want = finiteYear(subject.year)
    if (want === null || row.year === null) return false
    if (Math.abs(row.year - want) > PRICE_GUIDANCE.YEAR_TOLERANCE) return false
  }
  return true
}

/**
 * THE BAND, or the reason there is none.
 *
 * `now` is an argument, like everywhere else in this pair of modules: the recency window makes
 * the answer clock-dependent, and a clock read during render is a hydration mismatch on any
 * cacheable route. Compute it on the server (or under a mount gate) and pass the result down —
 * <PriceBand> itself reads no clock at all.
 *
 * Order of operations, and each step can only ever REMOVE rows:
 *   1. `salePriceForGuidance` — confirmed eno sales only, at the price the buyer was SHOWN.
 *   2. same brand + model, not the subject itself, sold within MAX_AGE_DAYS (and not dated into
 *      next year).
 *   3. the narrowing ladder: first tier reaching MIN_COMPARABLES after the per-party caps wins.
 *   4. MAX_SPREAD, which suppresses a range too wide to act on.
 *
 * ⚠️ STEP 4 DOES NOT WIDEN AND RETRY. If the chosen tier is too spread out, the answer is
 * "nothing", not "try a vaguer comparison": a wider tier mixes in more unlike things, so its
 * spread is almost always worse, and a rule that keeps searching for a tier it can display is a
 * rule optimising for showing SOMETHING. That is the failure this feature cannot afford.
 */
/**
 * Is this a ONE-OFF SALE price, i.e. the only kind a sale band describes?
 *
 * `priceUnit` is 'VND' (or empty) for a sale, 'VND/month' for a rental and 'VND/service' for a
 * service — see taxonomy.ts. Anything carrying a period or a per-unit suffix is a recurring or
 * per-delivery price and cannot be compared against a band built from outright sales.
 * ⚠️ Deliberately an ALLOW-list, not a deny-list of known suffixes: a unit this function has never
 * heard of must be refused rather than waved through, because the cost of a wrong band is the
 * feature being distrusted permanently and the cost of a missing one is nothing at all.
 */
export function isSaleUnit(priceUnit: string | null | undefined): boolean {
  if (priceUnit == null) return true // unset is the sale default, and matches how listings store it
  const u = priceUnit.trim()
  return u === '' || u === 'VND' || u === '₫'
}

export function priceGuidance(
  comparables: readonly GuidanceComparable[],
  subject: GuidanceSubject,
  now: Date,
): PriceGuidance {
  const brand = brandKey(subject.brandSlug)
  const model = modelKey(subject.model)
  if (!brand || !model) return { shown: false, reason: 'no_subject_model', comparables: 0 }

  // ⛔ A RECURRING PRICE IS NOT A SALE PRICE — see the note on GuidanceSubject.priceUnit. A rent or
  // a service fee measured against a band of one-off sale prices produces guidance that is not
  // merely useless but inverted, and brand+model cannot distinguish them. Refuse first, before any
  // pooling: there is no partial answer worth giving here.
  if (!isSaleUnit(subject.priceUnit)) return { shown: false, reason: 'not_a_sale_price', comparables: 0 }

  const maxAgeMs = PRICE_GUIDANCE.MAX_AGE_DAYS * DAY_MS
  const nowMs = now.getTime()
  const pool: Usable[] = []
  for (const row of comparables) {
    // ⚠️ THE ONE PREDICATE. Not `row.saleConfirmedAt != null` — that is a different, weaker
    // question (see saleState / countsTowardTrust for the three ways it is weaker).
    const price = salePriceForGuidance(row)
    if (price === null) continue
    if (subject.id && row.id === subject.id) continue
    if (brandKey(row.brandSlug) !== brand) continue
    if (modelKey(row.model) !== model) continue
    // `soldAt` is when the trade happened; `saleConfirmedAt` is when the buyer got round to
    // answering. The first is the age of the PRICE, so it wins — the fallback only matters for a
    // row whose soldAt was never written.
    const at = epochMs(row.soldAt) ?? epochMs(row.saleConfirmedAt)
    if (at === null) continue
    if (nowMs - at > maxAgeMs) continue
    // ⚠️ THE FUTURE IS BOUNDED TOO, AND ONLY BY A DAY. A modest skew (a phone clock, a timezone
    // slip on an imported row) is forgiven, because dropping it would punish a seller for a clock
    // they do not control. An UNBOUNDED future date is a different animal: `nowMs - at > maxAgeMs`
    // is false for the year 2099, so such a row would never age out AND would sort first in the
    // per-party caps — one bad timestamp pinning a public band forever. Found by an external
    // reviewer; the earlier comment here argued for skew and then let anything through.
    if (at - nowMs > PRICE_GUIDANCE.MAX_FUTURE_SKEW_DAYS * DAY_MS) continue
    pool.push({
      id: row.id,
      price,
      // The PERSON, when the caller joined them; the storefront otherwise. Never blank-to-unique:
      // an unknown party shares the one empty-string bucket, which caps rather than exempts.
      sellerParty: (row.sellerOwnerProfileId || row.sellerId || '').trim(),
      buyerId: (row.soldToProfileId || '').trim(),
      condition: conditionKey(row.condition),
      year: finiteYear(row.year),
      at,
    })
  }
  if (pool.length === 0) return { shown: false, reason: 'no_comparables', comparables: 0 }

  const ladder = tierLadder(subject)
  let widest = 0
  for (const tier of ladder) {
    const rows = capParties(pool.filter((row) => matchesTier(row, tier, subject)))
    // The last rung is always 'model', so this ends up holding the widest available count —
    // which is what `too_few` reports.
    widest = Math.max(widest, rows.length)
    if (rows.length < PRICE_GUIDANCE.MIN_COMPARABLES) continue

    const sorted = rows.map((row) => row.price).sort((a, b) => a - b)
    const p25 = Math.round(percentileCont(sorted, 0.25))
    const median = Math.round(percentileCont(sorted, 0.5))
    const p75 = Math.round(percentileCont(sorted, 0.75))
    if (p75 > p25 * PRICE_GUIDANCE.MAX_SPREAD) {
      return { shown: false, reason: 'too_wide', comparables: rows.length }
    }
    return { shown: true, band: { n: rows.length, p25, median, p75, tier } }
  }
  return { shown: false, reason: 'too_few', comparables: widest }
}

/** Where a price sits against the band. `null` when the price is not a usable number — an empty
 *  or half-typed field in the post wizard has no position, and inventing 'typical' for it would
 *  put a verdict on screen before the seller has said anything. */
export type BandPosition = 'below' | 'typical' | 'above'

/**
 * The RAW geometric position — the SAME comparison the asked-price side already makes
 * (market-price.tsx, and the cron's `CASE WHEN price < p25 … > p75 …` that writes
 * `Listing.marketPosition`): strictly outside the quartiles, so a price sitting exactly on an
 * edge reads as typical. Stated here because a marketplace that used `<=` in one place and `<` in
 * another would badge the identical price two different ways on two screens.
 *
 * ⚠️ `'above'` FROM THIS FUNCTION IS NOT THE WARNING. Use `isAskAboveBand` for anything shown to
 * a human: an ask sitting just over a SOLD band is normal negotiating room, and this function
 * does not know that the number it was handed is an ask.
 */
export function positionInBand(price: number | null | undefined, band: SoldPriceBand): BandPosition | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  if (price < band.p25) return 'below'
  if (price > band.p75) return 'above'
  return 'typical'
}

/**
 * The only verdict a BUYER-FACING surface may draw from the band.
 *
 * ⚠️ THERE IS NO `isAboveTypical` COUNTERPART, AND ONE MUST NOT BE ADDED FOR THE CARD. Telling
 * buyers "this one is overpriced" is punishing a seller in front of their market on the strength
 * of eight sales, which is neither the marketplace's job nor a claim eight sales can support.
 * The seller hears the same fact privately, while they can still act on it (<PriceBand> at
 * posting time). Same fact, different room.
 *
 * ⚠️ IT IS FLOORED, AND THE FLOOR IS THE OTHER HALF OF THAT RULE. "Below typical" is a PUBLIC
 * endorsement; an impossibly low price has not earned one. See BELOW_CREDIBLE_FRACTION for the
 * bait listing that collected a green chip without it, and for the half-typed price that
 * announced a bargain on every keystroke.
 */
export function isBelowTypical(price: number | null | undefined, band: SoldPriceBand): boolean {
  if (typeof price !== 'number' || positionInBand(price, band) !== 'below') return false
  return price >= band.p25 * PRICE_GUIDANCE.BELOW_CREDIBLE_FRACTION
}

/**
 * Is this ASK far enough above a band of SALE prices to be worth saying out loud? The SELLER's
 * half of the verdict, and the only one that speaks about being expensive.
 *
 * ⚠️ ASYMMETRIC ON PURPOSE — this side carries the negotiation margin and `isBelowTypical` does
 * not. An ask above a sold band is expected (the ask is where haggling starts), so claiming
 * "too high" needs headroom before it means anything. An ask BELOW what the same model actually
 * sold for is already the stronger statement — asks normally sit above sales — so the strict
 * comparison is the conservative one there, and padding it would only produce good-price chips
 * nobody earned. Two rules, because there are genuinely two questions.
 */
export function isAskAboveBand(ask: number | null | undefined, band: SoldPriceBand): boolean {
  if (typeof ask !== 'number' || positionInBand(ask, band) !== 'above') return false
  return ask > band.p75 * (1 + PRICE_GUIDANCE.ASK_NEGOTIATION_MARGIN)
}
