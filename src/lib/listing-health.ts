// LISTING HEALTH — the PURE rules that decide what, if anything, to tell a seller about a
// listing that is not selling.
//
// WHY THIS EXISTS. eno sells no bumps and no promoted slots (owner policy, and it is not
// negotiable). That removes the lever every other marketplace pulls when a seller says "nothing is
// happening" — and it makes an honest diagnosis the ONLY lever left. A stuck seller does not need
// to be sold anything; they need to be told which of the four things that can be wrong is
// actually wrong on this listing.
//
// ⚠️ DIAGNOSE, DO NOT UPSELL. Every nudge here names a CAUSE we measured and offers exactly ONE
// fix. A "boost your listing" surface with no product behind it is worse than silence, and a
// nudge that lists three things to try is an admission we do not know which one matters.
//
// ⚠️ SILENT IS THE DEFAULT AND THE MOST IMPORTANT BEHAVIOUR IN THIS FILE. A nudge on a healthy
// listing teaches sellers that the channel is noise, and once they have learned that, the ONE
// nudge that would have saved a sale is the one they scroll past. `listingNudge()` returns null
// far more often than it returns anything, and that is the design working.
//
// PURITY CONTRACT (same as src/lib/trade-loop.ts and src/lib/saved-search-alerts.ts): no Prisma,
// no `server-only`, no I/O, no `new Date()` without an argument. Facts in, decision out.
//
// NO USER-FACING STRINGS LIVE HERE. Each nudge is a CODE, a TONE, a FIX and the numbers that
// justify it; the surface renders the sentence through `tr(en, vi)`. The dashboard row, the
// notification body and the seller email say the same fact three different ways, and a rules
// module that picked one for them would be wrong in the other two.
//
// ── WHAT ALREADY EXISTS (inventoried 2026-08-12; do NOT rebuild any of it) ────────────────────
//   · `src/lib/stale.ts` + `/api/cron/daily-reminders` — the "confirm this is still available"
//     nudge, with its own 20h-per-recipient dedupe and an opt-out (`Profile.dailyReminderOptIn`).
//     ⚠️ DELIBERATELY NOT REIMPLEMENTED HERE. Two channels nudging the same seller about the same
//     listing on the same day is exactly the noise this module exists to avoid, and staleness is
//     already covered by a job that has an opt-out this one does not.
//   · `src/lib/price-stat.ts` — `getPriceBand()` returns the P25/median/P75 band for a listing's
//     brand+model+segment, ALREADY suppressed below a 5-listing sample and above a 3× spread. So
//     `facts.band !== null` by itself means "this band is reliable"; this module re-checks nothing.
//   · `src/lib/publish-guard.ts` — `minPhotosFor(categorySlug)` is the publish FLOOR (3 photos,
//     1 for services). Imported, never re-typed: the memory of this repo records that number
//     being hardcoded in two dialogs and inverting the feature.
//   · `src/lib/taxonomy.ts` — `categoryHasBrand()` says whether a brand/model is even meaningful
//     for this category. A "add the brand" nudge on a listing for a sofa would be nonsense.
//   · `ListingDailyStat` (listingId, day, views, leads) — rolled up nightly by
//     `rollupListingDailyStats()`. This is where the WINDOWED counters come from; `Listing.views`
//     and `Listing.contactCount` are LIFETIME cumulative and must not be substituted, or a
//     six-month-old listing looks busy forever.
//
// ── HOW THE NUDGES ARE RANKED ─────────────────────────────────────────────────────────────────
// By HOW MUCH THE SELLER LOSES BY NOT ACTING, tie-broken by HOW STRONG THE EVIDENCE IS. It is a
// fixed total order rather than a score, because a total order can be argued about once and then
// trusted, whereas a weighted score invites tuning nobody can justify afterwards.
//
//   1. A buyer is already waiting.  (`unanswered_messages`)
//      Acquisition already happened. The fix is one tap and the thing at risk is a sale that was
//      won. Nothing else in this list is close, which is why it is the only nudge that bypasses
//      the evidence-window gate: a person waiting is not a verdict, it is a fact.
//   2. Traffic exists, converts at zero, and the MEASURED market says why.  (`price_above_band`)
//      The only nudge that can quote a number the seller can go and check themselves.
//   3–4. Traffic exists, converts at zero, and the listing itself is thin.  (`no_leads_thin_photos`,
//      `no_leads_thin_description`) Same evidence, weaker attribution, so they sit below the band.
//      Photos before words: a marketplace card is a photo with a price on it.
//   5. Almost nobody is seeing it, and a discoverability key is missing.  (`no_views_missing_brand`)
//      A specific, checkable cause for invisibility — brand search and the price band both key on
//      brand+model. Informational: nothing is broken, something is absent.
//   6. Below the conversion bar for photos, with no other signal.  (`few_photos`)
//      The weakest true thing we can say, and the reason `tone` exists: it is `info`, never `warn`.
//
// ⚠️ WARNING COLOUR ONLY WHEN SOMETHING IS ACTUALLY WRONG. `tone: 'warn'` means a measurable
// failure is happening right now (a buyer ignored, traffic converting at zero). A photo
// suggestion is an opportunity, not a fault, and painting it amber is how a dashboard ends up
// permanently yellow and permanently ignored.

import { minPhotosFor } from '@/lib/publish-guard'
import { categoryHasBrand } from '@/lib/taxonomy'
import { DAY_MS } from '@/lib/trust-math'

const HOUR_MS = 3_600_000

/**
 * The listing states in which a buyer's unanswered question is still worth raising.
 *
 * ⚠️ AN ALLOWLIST, NOT `!== 'sold'`, AND THE DIFFERENCE IS REAL. A reviewer pointed out that the
 * first version's denylist let a `draft`, a `taken_down` listing or any future status string
 * anybody adds produce a `warn` nudge and an unhealthy verdict. 'active' is the ordinary case;
 * 'hidden' is a seller pausing a listing, which does not un-ask the question a buyer already
 * asked. Everything else — sold (the trade is over, and src/lib/trade-loop.ts owns that thread),
 * draft (nobody could have messaged it), taken down (a compliance matter, not a sales one) — is
 * silence, and stays silence when the next status is invented.
 */
const LIVE_CONVERSATION_STATUSES = new Set(['active', 'hidden'])

export const HEALTH = {
  /**
   * The evidence window, in days. Matches the "in 7 days" the seller-facing copy says, and it is
   * the window the caller must roll `ListingDailyStat` over. Change one, change both.
   */
  WINDOW_DAYS: 7,
  /**
   * No verdict before the listing has lived a full window. A listing posted on Tuesday has no
   * conversion rate on Wednesday, and telling its seller otherwise is a guess wearing a number.
   * ⚠️ `unanswered_messages` deliberately bypasses this — see the ranking note above.
   */
  MIN_AGE_DAYS: 7,
  /**
   * A buyer who has waited this long has been abandoned. 24h is the same bar the dispute centre
   * and the response-rate metric use for "answered", so a seller is never told two different
   * things about what counts as replying.
   */
  REPLY_SLA_HOURS: 24,
  /**
   * And the point past which a waiting buyer is no longer a lead worth chasing.
   *
   * ⚠️ IT EXISTS BECAUSE RANK 1 HAS NO OTHER BOUND. It bypasses the evidence window and the
   * rotation cooldown, both for good reasons, and the justification offered for the missing
   * cooldown was that it "disappears the moment the seller replies" — which a reviewer noted is
   * only true of sellers who reply. One abandoned tire-kicker's thread would otherwise hold a
   * `warn` on the dashboard and `isListingHealthy` false for the life of the listing, which is the
   * permanently-amber outcome `MEDIA_NUDGE_MAX_AGE_DAYS` exists to prevent, on a higher tier.
   * Two weeks is where the honest claim runs out: a buyer who asked a fortnight ago has bought
   * something else, and telling the seller to reply is asking them to do archaeology.
   */
  ABANDONED_WAIT_DAYS: 14,
  /**
   * Views in the window below which "people see it and do not contact you" is not a claim we may
   * make — the honest reading is that nobody is seeing it.
   *
   * Measured 2026-08-12 on prod: 48 active+verified listings averaging 1.61 views/day
   * (mean 13 lifetime views over a mean age of 10 days), median 3 lifetime views, max 76. So a
   * typical listing accrues ~11 views a week and 10 is roughly one median week of traffic. A
   * US-marketplace intuition (50, 100) would make every nudge below unreachable on this catalogue.
   */
  MIN_VIEWS_FOR_CONVERSION: 10,
  /** Below this in a window, the listing is effectively invisible and the problem is reach. */
  INVISIBLE_VIEWS: 3,
  /**
   * The photo count a listing should reach to convert, as opposed to the count it needs to be
   * PUBLISHED (`minPhotosFor`, which is 3). Measured 2026-08-12: live photo counts are median 1,
   * p75 3, max 6 across the 48 active+verified listings — so 5 is a reachable stretch on this
   * catalogue rather than an arbitrary round number, and 6 would make the top of the catalogue
   * the only passing grade.
   *
   * ⚠️ READ IT THROUGH `conversionPhotoTarget()`, NEVER DIRECTLY. It does not apply to every
   * category — see that function.
   */
  GOOD_PHOTOS: 5,
  /**
   * How far in the future a recorded nudge timestamp may be before it is treated as clock skew
   * rather than as evidence. Without a bound, a single bad clock writes a timestamp months ahead
   * and silences that fix until the real clock catches up — which on the top-ranked nudge means
   * a buyer waiting in a thread nobody is told about.
   */
  NUDGE_CLOCK_SKEW_MS: 3_600_000,
  /**
   * A description shorter than this cannot answer a buyer's questions. Measured 2026-08-12: the
   * p25 description length across all 51 listings is 203 characters and the median is 488, so
   * this fires on roughly the bottom quartile — the listings that genuinely say almost nothing —
   * rather than on everyone.
   */
  THIN_DESCRIPTION_CHARS: 200,
  /**
   * How far above the segment median counts as "priced above the market". 10% because the band
   * itself is only published when it has ≥5 samples and a <3× spread (see `getPriceBand`), so a
   * smaller margin would be inside the noise the band already survived.
   */
  ABOVE_BAND_FRACTION: 1.1,
  /**
   * How long the same FIX stays suppressed after being shown. A seller who has been told to add
   * photos does not need to be told again on Tuesday; if they were going to, they would have.
   * The next-best true nudge is offered instead, which makes the channel rotate rather than nag.
   */
  NUDGE_COOLDOWN_DAYS: 7,
  /** Suggested prices are rounded to this so the number reads like a price, not a computation. */
  PRICE_SUGGESTION_STEP: 10_000,
  /**
   * How long after posting the no-evidence media nudge (`few_photos`) may still fire. It is the
   * only rule with no traffic condition behind it, so without a bound it is a permanent asterisk
   * on the majority of the catalogue rather than a nudge — see the note at that rule.
   */
  MEDIA_NUDGE_MAX_AGE_DAYS: 30,
} as const

export type ListingNudgeCode =
  | 'unanswered_messages'
  | 'price_above_band'
  | 'no_leads_thin_photos'
  | 'no_leads_thin_description'
  | 'no_views_missing_brand'
  | 'few_photos'

/** The ONE action a nudge asks for. One nudge, one fix — see the header. */
export type ListingFix =
  | 'reply_to_buyers'
  | 'lower_price'
  | 'add_photos'
  | 'expand_description'
  | 'add_brand_model'

/**
 * ⚠️ THE COOLDOWN IS KEYED ON THE FIX, NOT THE CODE, AND THIS MAP IS WHY. Two codes ask for the
 * same thing: `no_leads_thin_photos` and `few_photos` both mean "add photos". Keying the cooldown
 * on the code would let a suppressed nudge walk straight back in under its sibling's name — the
 * seller sees "add photos" twice in a week from what looks like two different systems.
 */
export const FIX_FOR_CODE: Record<ListingNudgeCode, ListingFix> = {
  unanswered_messages: 'reply_to_buyers',
  price_above_band: 'lower_price',
  no_leads_thin_photos: 'add_photos',
  no_leads_thin_description: 'expand_description',
  no_views_missing_brand: 'add_brand_model',
  few_photos: 'add_photos',
}

/** Fixed rank, 1 = most valuable. See the ranking note in the header. */
export const RANK_FOR_CODE: Record<ListingNudgeCode, number> = {
  unanswered_messages: 1,
  price_above_band: 2,
  no_leads_thin_photos: 3,
  no_leads_thin_description: 4,
  no_views_missing_brand: 5,
  few_photos: 6,
}

/**
 * `warn` = something is measurably going wrong right now. `info` = nothing is broken, something
 * could be better. Read the warning-colour note in the header before adding a `warn`.
 */
export type NudgeTone = 'warn' | 'info'

type Base<C extends ListingNudgeCode, T extends NudgeTone, F extends ListingFix> = {
  code: C
  tone: T
  rank: number
  fix: F
}

/**
 * A discriminated union so the renderer cannot reach for a number the nudge does not carry.
 * Every field is a MEASURED fact, never a formatted string — money is formatted by
 * `src/lib/vnd.ts` at the surface, and only there.
 */
export type ListingNudge =
  | (Base<'unanswered_messages', 'warn', 'reply_to_buyers'> & {
      /** Conversations where the buyer spoke last and is still waiting. */
      waiting: number
      /** How long the longest-waiting one has waited, hours. */
      oldestWaitingHours: number
    })
  | (Base<'price_above_band', 'warn', 'lower_price'> & {
      windowDays: number
      views: number
      /** Always 0 — the nudge only fires on zero leads, and the copy says so. */
      leads: 0
      price: number
      /** The segment median from `getPriceBand()`. */
      median: number
      /** How many comparable listings the band was built from. */
      sampleSize: number
      /**
       * Whole percent THIS LISTING sits above the median: `price / median − 1`.
       *
       * ⚠️ NOT THE NUMBER FOR "similar listings priced X% lower" — the first draft's comment said
       * it was, and a reviewer caught it. The two are different quantities: a listing 12% above
       * the median has comparables 10.7% BELOW it, because the denominators differ. Shipping the
       * wrong one is precisely the checkable lie this module's header says costs more than every
       * true nudge earns. Use `percentBelowPrice` for that sentence.
       */
      percentAboveMedian: number
      /** Whole percent the median sits BELOW this listing: `1 − median / price`. */
      percentBelowPrice: number
      /** The median, rounded to a price-shaped number. The ONE fix. */
      suggestedPrice: number
    })
  | (Base<'no_leads_thin_photos', 'warn', 'add_photos'> & {
      windowDays: number
      views: number
      photoCount: number
      /** How many more to reach `GOOD_PHOTOS`. Always ≥ 1. */
      addPhotos: number
    })
  | (Base<'no_leads_thin_description', 'warn', 'expand_description'> & {
      windowDays: number
      views: number
      descriptionLength: number
    })
  | (Base<'no_views_missing_brand', 'info', 'add_brand_model'> & {
      windowDays: number
      views: number
      /** Which half is missing, so the copy can ask for the right one. */
      hasBrand: boolean
      hasModel: boolean
    })
  | (Base<'few_photos', 'info', 'add_photos'> & {
      photoCount: number
      /** The publish floor from `minPhotosFor` — this nudge only fires at or below it. */
      publishFloor: number
      addPhotos: number
    })

export type ListingHealthFacts = {
  /** `Listing.status`. Anything but 'active' is silent — a sold listing has no problems. */
  status: string
  /** `Listing.verified`. An unverified listing's problem is the publish gate's to explain. */
  verified: boolean
  /**
   * `Listing.createdAt` — WHEN THE LISTING WAS FIRST POSTED, and immutable.
   *
   * ⚠️ NOT `Listing.postedAt`, WHICH IS WHAT THE FIRST DRAFT USED AND IS A TRAP THIS FILE SET FOR
   * ITSELF. The schema comment on that column says it plainly: "also the feed-recency key;
   * 'confirm availability' bumps it". Both age gates below read this field, and `canBump` lets a
   * seller refresh weekly against a 7-day `MIN_AGE_DAYS` — so a listing that had been up for
   * ninety days, confirmed three days ago, was "too young to judge" forever. Every conversion
   * verdict withheld, `isListingHealthy` true, and `msUntilJudgeable` cheerfully answering "four
   * more days" on precisely the stalest inventory on the platform. The same bump re-armed
   * `MEDIA_NUDGE_MAX_AGE_DAYS`, inverting the gate that exists to make `few_photos` shut up.
   * A reviewer found it. An age gate must read a clock the subject cannot move.
   */
  createdAt: Date
  /** `Category.slug`. Drives `minPhotosFor` and `categoryHasBrand`; null is treated as generic. */
  categorySlug: string | null
  /** Number of DISTINCT photos on the listing (the same count the publish gate checks). */
  photoCount: number
  /** `Listing.description.length`. */
  descriptionLength: number
  /** `Listing.brandSlug` / `Listing.model`. */
  brandSlug: string | null
  model: string | null
  /** `Listing.price`, VND. */
  price: number
  /**
   * ⚠️ `getPriceBand()`'s RETURN VALUE VERBATIM, or null. That helper already suppresses bands
   * below 5 samples and above a 3× spread, so a non-null value here means "reliable" and this
   * module re-checks nothing. Passing a hand-built band defeats both suppressions.
   */
  band: { n: number; p25: number; median: number; p75: number } | null
  /**
   * Views over the last `WINDOW_DAYS`, from `ListingDailyStat`.
   * ⚠️ NOT `Listing.views`, which is LIFETIME. Substituting it makes an old listing look busy
   * forever and silences every conversion nudge on exactly the listings that need one.
   */
  viewsInWindow: number
  /** Leads (contact reveals) over the same window, from `ListingDailyStat.leads`. */
  leadsInWindow: number
  /**
   * Conversations STARTED on this listing inside the window — the other half of "did a buyer make
   * contact", and the half `leadsInWindow` structurally cannot see.
   *
   * ⚠️ REQUIRED, AND `undefined` MEANS "NOT MEASURED", NOT "NONE". A caller that cannot supply it
   * gets no conversion nudges, because "I could not measure contact" and "nobody made contact" are
   * opposite claims and only one of them may be said out loud to a seller. Producer:
   * count Conversation rows for this listing with createdAt inside the window.
   */
  conversationsInWindow: number | undefined
  /** Conversations on this listing where the buyer spoke last and the seller has not replied. */
  unansweredThreads: number
  /** Hours the longest-waiting of those has been waiting. 0 when there are none. */
  oldestUnansweredHours: number
  /**
   * The nudges actually SHOWN for this listing recently, for the repeat cooldown. The caller only
   * needs the last `NUDGE_COOLDOWN_DAYS`; older entries are ignored.
   *
   * ⚠️ PLURAL, AND THE FIRST DRAFT WAS SINGULAR — a reviewer showed the cooldown was defeated by
   * alternation. With only the most recent nudge in view, `add_photos` on Monday →
   * `lower_price` on Tuesday → `add_photos` on Wednesday delivers the same ask twice inside a
   * stated seven-day suppression, because by Wednesday the only thing remembered is Tuesday. A
   * cooldown that a two-step sequence walks around is not a cooldown.
   */
  recentNudges?: readonly { code: ListingNudgeCode; at: Date }[]
}

/**
 * The photo count worth reaching FOR CONVERSION in this category.
 *
 * ⚠️ IT IS NOT ALWAYS `GOOD_PHOTOS`, AND THE FIRST DRAFT ASSUMED IT WAS. `minPhotosFor` returns 1
 * for the categories that sell WORK rather than an object — a visa service, a lesson, a cleaner —
 * because, in the publish gate's own words, the three-angle rule "can only be satisfied by
 * padding: the same shot three times, or unrelated stock images". A reviewer pointed out that the
 * `warn`-level photo nudge was comparing those listings against a flat 5 and telling a service
 * seller with real traffic to add four photos of nothing. So the conversion target inherits the
 * judgement the publish floor already encodes: where one photo is enough to publish, one photo is
 * enough, and this module has nothing to say about photos at all.
 */
export function conversionPhotoTarget(categorySlug: string | null | undefined): number {
  return minPhotosFor(categorySlug) === 1 ? 1 : HEALTH.GOOD_PHOTOS
}

/**
 * The median, rounded to something that reads like a price rather than a computation.
 *
 * ⚠️ IT TAKES THE ASKING PRICE AND WILL NEVER RETURN A NUMBER AT OR ABOVE IT. A reviewer found
 * the first version doing exactly that: with a band median of 6.000 and an asking price of 7.000
 * (which clears the 10% margin, because the margin is smaller than the rounding step at that
 * scale) it rounded UP to 10.000 and produced "priced above the market — try 10.000" on a listing
 * asking 7.000. That is the checkable lie this module's header says costs more than every true
 * nudge earns, printed by the one nudge whose whole value is that the seller can verify it.
 * Reachable for any band median under ~50.000. Rounding is cosmetic; being below the current
 * price is the point, so cosmetics lose.
 */
function suggestPrice(median: number, price: number, step: number): number {
  const rounded = step > 0 ? Math.round(median / step) * step : Math.round(median)
  if (rounded > 0 && rounded < price) return rounded
  const exact = Math.round(median)
  // `price >= median * ABOVE_BAND_FRACTION` is the gate that got us here, so the unrounded
  // median is strictly below the asking price whenever the fraction is > 1.
  return exact < price ? exact : Math.floor(median)
}

/**
 * Every TRUE nudge for this listing, in rank order (best first). Exported for tests and for a
 * dashboard that wants to show the full diagnosis; the notification channel must use
 * `listingNudge()`, which returns at most one.
 *
 * Returns an EMPTY array for a healthy listing, for a listing too young to judge, and for
 * anything not live. That is the common case.
 */
export function rankListingNudges(facts: ListingHealthFacts, now: Date): ListingNudge[] {
  const out: ListingNudge[] = []

  // 1. A buyer is waiting.
  //
  // ⚠️ IT SURVIVES THE LISTING BEING PAUSED, AND THE FIRST DRAFT DID NOT — a reviewer pointed out
  // that the `status !== 'active'` early return sat ABOVE this rule, so a seller who hid a listing
  // to pause it, with two buyers waiting 48 hours, was told nothing and `isListingHealthy` said
  // true. A person waiting is a fact about a CONVERSATION, not about the listing's visibility, and
  // hiding a listing does not un-ask a question. It does not survive the listing being SOLD: the
  // trade is over and src/lib/trade-loop.ts owns what happens in that thread from there.
  //
  // Bypasses the evidence window too, on purpose — see the header.
  const waitHours = facts.oldestUnansweredHours
  const chaseable = waitHours >= HEALTH.REPLY_SLA_HOURS && waitHours < HEALTH.ABANDONED_WAIT_DAYS * 24
  if (LIVE_CONVERSATION_STATUSES.has(facts.status) && facts.unansweredThreads > 0 && chaseable) {
    out.push({
      code: 'unanswered_messages',
      tone: 'warn',
      rank: RANK_FOR_CODE.unanswered_messages,
      fix: 'reply_to_buyers',
      waiting: facts.unansweredThreads,
      oldestWaitingHours: Math.floor(facts.oldestUnansweredHours),
    })
  }

  // Everything below is a VERDICT about a live listing's performance, and a listing that is not
  // live has none: a sold one has no problems, a hidden one is hidden on purpose, and an
  // unverified one's story belongs to the publish gate.
  if (facts.status !== 'active' || !facts.verified) return out

  const ageMs = now.getTime() - facts.createdAt.getTime()
  if (ageMs < HEALTH.MIN_AGE_DAYS * DAY_MS) return out

  const views = Math.max(0, facts.viewsInWindow)
  const leads = Math.max(0, facts.leadsInWindow)
  const windowDays = HEALTH.WINDOW_DAYS
  // ⛔ "NO LEADS" IS NOT "NO BUYERS" — A CONTACT REVEAL IS NOT THE ONLY WAY A BUYER ARRIVES, AND
  // TREATING IT AS ONE MADE THIS MODULE TELL SELLERS A CHECKABLE LIE ABOUT THEIR OWN INBOX.
  // `leadsInWindow` counts phone reveals, and a reveal is gated on the seller having ALREADY
  // replied in an in-app conversation (api/listings/[id]/contact returns 403 `reply_required`).
  // So for every listing whose buyers simply stayed in chat — the normal case — leads is 0 while
  // real conversations are sitting in the inbox. Three `warn` nudges keyed off this fired on
  // healthy listings: "25 views, 0 messages in 7 days · similar listings priced 12% lower" shown
  // to a seller who had answered four threads that week. A nudge the reader can immediately
  // disprove does not just fail; it teaches them to ignore the channel, which is the one asset
  // this feature has. Found by an external reviewer.
  // ⚠️ `conversationsInWindow` is therefore REQUIRED to attribute a conversion failure, and it is
  // deliberately not optional-with-a-default: a caller that cannot supply it must not get these
  // nudges at all, because "I could not measure contact" and "nobody made contact" are opposite
  // claims. Absent (undefined) suppresses; 0 is a real, usable measurement.
  const contacts = facts.conversationsInWindow
  const converting =
    views >= HEALTH.MIN_VIEWS_FOR_CONVERSION && leads === 0 && contacts === 0
  const publishFloor = minPhotosFor(facts.categorySlug)
  const photoTarget = conversionPhotoTarget(facts.categorySlug)

  // 2. The market says the price is the reason.
  if (converting && facts.band && facts.band.median > 0 && facts.price >= facts.band.median * HEALTH.ABOVE_BAND_FRACTION) {
    out.push({
      code: 'price_above_band',
      tone: 'warn',
      rank: RANK_FOR_CODE.price_above_band,
      fix: 'lower_price',
      windowDays,
      views,
      leads: 0,
      price: facts.price,
      median: facts.band.median,
      sampleSize: facts.band.n,
      percentAboveMedian: Math.round((facts.price / facts.band.median - 1) * 100),
      percentBelowPrice: Math.round((1 - facts.band.median / facts.price) * 100),
      suggestedPrice: suggestPrice(facts.band.median, facts.price, HEALTH.PRICE_SUGGESTION_STEP),
    })
  }

  // 3. Traffic, no leads, and too few photos to decide from.
  if (converting && facts.photoCount < photoTarget) {
    out.push({
      code: 'no_leads_thin_photos',
      tone: 'warn',
      rank: RANK_FOR_CODE.no_leads_thin_photos,
      fix: 'add_photos',
      windowDays,
      views,
      photoCount: facts.photoCount,
      addPhotos: Math.max(1, photoTarget - facts.photoCount),
    })
  }

  // 4. Traffic, no leads, and nothing written down.
  if (converting && facts.descriptionLength < HEALTH.THIN_DESCRIPTION_CHARS) {
    out.push({
      code: 'no_leads_thin_description',
      tone: 'warn',
      rank: RANK_FOR_CODE.no_leads_thin_description,
      fix: 'expand_description',
      windowDays,
      views,
      descriptionLength: Math.max(0, facts.descriptionLength),
    })
  }

  // 5. Invisible, and a discoverability key is missing. Only where a brand means something.
  if (views < HEALTH.INVISIBLE_VIEWS && categoryHasBrand(facts.categorySlug) && (!facts.brandSlug || !facts.model)) {
    out.push({
      code: 'no_views_missing_brand',
      tone: 'info',
      rank: RANK_FOR_CODE.no_views_missing_brand,
      fix: 'add_brand_model',
      windowDays,
      views,
      hasBrand: !!facts.brandSlug,
      hasModel: !!facts.model,
    })
  }

  // 6. The weakest true thing. ⚠️ Gated at the PUBLISH FLOOR, not at the conversion target: a
  // seller who added a fourth photo has gone past the minimum and does not need a permanent
  // asterisk. In a single-photo category floor and target are both 1, so this is silent there.
  //
  // ⚠️ AND GATED ON AGE, WHICH IS WHAT MAKES THE CHANNEL GO QUIET. A reviewer pointed out that
  // this rule has no traffic condition, so on the measured catalogue (median photo count 1,
  // publish floor 3) it was true for MOST live listings and re-fired every cooldown for the life
  // of the listing — `isListingHealthy` would never return true for the median listing, and the
  // header's promise that the channel "goes quiet naturally once there is nothing left to say"
  // was false for its own weakest nudge. A seller still at the minimum a month later has decided.
  // With the 7-day cooldown that is at most ~3 asks, in the window where acting still helps.
  if (ageMs <= HEALTH.MEDIA_NUDGE_MAX_AGE_DAYS * DAY_MS && facts.photoCount <= publishFloor && facts.photoCount < photoTarget) {
    out.push({
      code: 'few_photos',
      tone: 'info',
      rank: RANK_FOR_CODE.few_photos,
      fix: 'add_photos',
      photoCount: facts.photoCount,
      publishFloor,
      addPhotos: Math.max(1, photoTarget - facts.photoCount),
    })
  }

  return out.sort((a, b) => a.rank - b.rank)
}

/**
 * THE ONE nudge to show for this listing, or null.
 *
 * Null is the expected answer. A listing with traffic, leads, market-rate pricing and answered
 * messages has nothing wrong with it and must be told nothing.
 *
 * The repeat cooldown is keyed on the FIX (see `FIX_FOR_CODE`) and applied to EVERY nudge shown
 * within `NUDGE_COOLDOWN_DAYS`, not just the most recent one (see `recentNudges`): any nudge
 * asking for an action already asked for is skipped, and the next-best TRUE one is offered
 * instead. So a seller who ignores "add photos" hears about the price next, rather than hearing
 * about photos again — the channel rotates instead of nagging, and it goes quiet naturally once
 * there is nothing left to say.
 */
export function listingNudge(facts: ListingHealthFacts, now: Date): ListingNudge | null {
  const ranked = rankListingNudges(facts, now)
  if (ranked.length === 0) return null
  const suppressed = suppressedFixes(facts.recentNudges, now)
  if (suppressed.size === 0) return ranked[0]
  return ranked.find((n) => NEVER_SUPPRESSED.has(n.fix) || !suppressed.has(n.fix)) ?? null
}

/**
 * Fixes the rotation cooldown may not silence.
 *
 * ⚠️ RANK 1 BYPASSES THE COOLDOWN FOR THE SAME REASON IT BYPASSES THE EVIDENCE WINDOW, and the
 * first version let it be suppressed — a reviewer walked the case: a buyer waits 24h on Monday and
 * the seller is told; by Wednesday the SAME buyer has waited 72h, `reply_to_buyers` is still inside
 * the seven-day window, and the seller is handed a photo suggestion instead and hears nothing about
 * the abandoned buyer for a week. A cooldown exists to stop us repeating an ask the seller has
 * already considered and declined; a person still waiting is not a repeated ask, it is the same
 * question getting worse. This one also cannot nag forever by construction: it disappears the
 * instant the seller replies.
 */
const NEVER_SUPPRESSED = new Set<ListingFix>(['reply_to_buyers'])

/**
 * The fixes we have already asked for inside the cooldown window.
 *
 * A future-dated entry beyond `NUDGE_CLOCK_SKEW_MS` is discarded rather than trusted: it is a bad
 * clock, not a nudge somebody saw, and treating it as evidence would suppress that fix until real
 * time reached the bogus timestamp.
 */
function suppressedFixes(recent: readonly { code: ListingNudgeCode; at: Date }[] | undefined, now: Date): Set<ListingFix> {
  const out = new Set<ListingFix>()
  for (const e of recent ?? []) {
    const age = now.getTime() - e.at.getTime()
    if (age <= -HEALTH.NUDGE_CLOCK_SKEW_MS) continue
    if (age < HEALTH.NUDGE_COOLDOWN_DAYS * DAY_MS) out.add(FIX_FOR_CODE[e.code])
  }
  return out
}

/**
 * Is this listing healthy — nothing true to say about it?
 *
 * ⚠️ NOT the negation of `listingNudge() === null`, and the difference is the point: a listing
 * whose only nudge is on cooldown is SILENT but not healthy. A dashboard that paints a green tick
 * from the silence would be lying. Ask this when you mean "is it fine", ask `listingNudge` when
 * you mean "should I say something".
 */
export function isListingHealthy(facts: ListingHealthFacts, now: Date): boolean {
  return rankListingNudges(facts, now).length === 0
}

/** How long until this listing is old enough to judge. 0 once the window has passed. */
export function msUntilJudgeable(facts: ListingHealthFacts, now: Date): number {
  return Math.max(0, facts.createdAt.getTime() + HEALTH.MIN_AGE_DAYS * DAY_MS - now.getTime())
}

/** Hours-to-milliseconds for callers building `oldestUnansweredHours` from timestamps. */
export function hoursSince(at: Date, now: Date): number {
  return Math.max(0, (now.getTime() - at.getTime()) / HOUR_MS)
}
