import { describe, expect, it } from 'vitest'
import {
  conversionPhotoTarget,
  FIX_FOR_CODE,
  HEALTH,
  hoursSince,
  isListingHealthy,
  listingNudge,
  msUntilJudgeable,
  rankListingNudges,
  type ListingHealthFacts,
  type ListingNudgeCode,
} from './listing-health'
import { minPhotosFor } from './publish-guard'

/**
 * LISTING HEALTH.
 *
 * ⚠️ MOST OF THIS FILE TESTS SILENCE, AND THAT IS THE POINT. The easy failure is a module that
 * always has something to say: it passes every "does it produce a nudge" test, ships, and teaches
 * every seller on the platform that the health channel is decoration. By the time the ONE nudge
 * that would have saved a sale appears, nobody reads it. So the tests below spend more effort
 * proving the module stays quiet than proving it speaks.
 *
 * The second thing under test is honesty: every nudge must be derivable from the facts passed in.
 * A nudge that says "priced 12% above similar listings" when there is no reliable band, or "0
 * messages in 7 days" from a LIFETIME counter, is a lie the seller can catch — and one caught lie
 * costs more than every true nudge earns.
 *
 * The clock is always injected.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-12T09:00:00.000Z')

/** A listing with nothing wrong with it: old enough to judge, seen, contacted, well presented. */
function healthy(over: Partial<ListingHealthFacts> = {}): ListingHealthFacts {
  return {
    status: 'active',
    verified: true,
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    categorySlug: 'electronics',
    photoCount: 6,
    descriptionLength: 600,
    brandSlug: 'apple',
    model: 'iPhone 14 Pro',
    price: 10_000_000,
    band: { n: 12, p25: 9_000_000, median: 10_000_000, p75: 11_000_000 },
    viewsInWindow: 40,
    leadsInWindow: 3,
    unansweredThreads: 0,
    oldestUnansweredHours: 0,
    ...over,
  }
}

const codes = (f: ListingHealthFacts, now = NOW): ListingNudgeCode[] => rankListingNudges(f, now).map((n) => n.code)

/* ── Silence ───────────────────────────────────────────────────────────────────────────────── */

describe('silence is the default', () => {
  it('says nothing about a healthy listing', () => {
    expect(rankListingNudges(healthy(), NOW)).toEqual([])
    expect(listingNudge(healthy(), NOW)).toBeNull()
    expect(isListingHealthy(healthy(), NOW)).toBe(true)
  })

  it('says nothing about a listing that is not live', () => {
    // A sold listing has no problems, and a hidden one is hidden on purpose.
    for (const status of ['sold', 'hidden', 'draft']) {
      expect(codes(healthy({ status, photoCount: 1, viewsInWindow: 0, leadsInWindow: 0 }))).toEqual([])
    }
  })

  it('but a WAITING BUYER survives the listing being paused', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. The liveness gate sat above the rank-1 rule, so a seller who
    // hid a listing to pause it — with two buyers waiting 48 hours — was told nothing and
    // isListingHealthy returned true. A person waiting is a fact about a CONVERSATION; hiding a
    // listing does not un-ask a question.
    const paused = healthy({ status: 'hidden', unansweredThreads: 2, oldestUnansweredHours: 48 })
    expect(codes(paused)).toEqual(['unanswered_messages'])
    expect(isListingHealthy(paused, NOW)).toBe(false)
    // It does NOT survive the sale: the trade is over and trade-loop.ts owns that thread.
    expect(codes(healthy({ ...paused, status: 'sold' }))).toEqual([])
    // ⚠️ REVIEWER FINDING, CONFIRMED: an ALLOWLIST, not `!== 'sold'`. A draft nobody could have
    // messaged, a compliance takedown, or any status invented later must not raise a warn nudge.
    for (const status of ['draft', 'taken_down', 'something_new']) {
      expect(codes(healthy({ ...paused, status }))).toEqual([])
    }
    // And a paused listing still gets no performance VERDICT — it is not on the market.
    expect(codes(healthy({ status: 'hidden', photoCount: 1, viewsInWindow: 40, leadsInWindow: 0 }))).toEqual([])
  })

  it('says nothing about an unverified listing — that is the publish gate story, not this one', () => {
    expect(codes(healthy({ verified: false, photoCount: 1, viewsInWindow: 0 }))).toEqual([])
  })

  it('reads an IMMUTABLE clock — a "still available" bump must not reset the evidence window', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. `Listing.postedAt` is the feed-recency key and the schema
    // comment says "confirm availability bumps it"; canBump allows that weekly against a 7-day
    // MIN_AGE_DAYS. Reading it here meant a 90-day-old listing confirmed 3 days ago was "too young
    // to judge" FOREVER — every verdict withheld and isListingHealthy true on the stalest
    // inventory we have, which is the exact population this module exists for.
    const stale = healthy({
      createdAt: new Date(NOW.getTime() - 90 * DAY),
      viewsInWindow: 40,
      leadsInWindow: 0,
      price: 15_000_000,
    })
    expect(codes(stale)).toContain('price_above_band')
    expect(msUntilJudgeable(stale, NOW)).toBe(0)
    // And the field is not `postedAt` — a caller passing the bumpable column would not typecheck.
    expect(Object.keys(stale)).toContain('createdAt')
    expect(Object.keys(stale)).not.toContain('postedAt')
  })

  it('withholds every VERDICT until a full evidence window has passed', () => {
    // Posted yesterday with one photo and no traffic: all true, none of it yet meaningful.
    const young = healthy({
      createdAt: new Date(NOW.getTime() - DAY),
      photoCount: 1,
      descriptionLength: 20,
      viewsInWindow: 0,
      leadsInWindow: 0,
      brandSlug: null,
      model: null,
    })
    expect(codes(young)).toEqual([])
    expect(msUntilJudgeable(young, NOW)).toBe((HEALTH.MIN_AGE_DAYS - 1) * DAY)
    expect(msUntilJudgeable(healthy(), NOW)).toBe(0)
  })

  it('will not claim "seen but never contacted" on traffic too thin to support it', () => {
    // Measured: the median active listing accrues ~11 views a week. Below the floor the honest
    // reading is "nobody is seeing it", so the conversion nudges must stay silent.
    const thin = healthy({ photoCount: 1, descriptionLength: 10, viewsInWindow: HEALTH.MIN_VIEWS_FOR_CONVERSION - 1, leadsInWindow: 0 })
    expect(codes(thin)).not.toContain('no_leads_thin_photos')
    expect(codes(thin)).not.toContain('no_leads_thin_description')
    expect(codes(thin)).not.toContain('price_above_band')
  })

  it('will not blame conversion on a listing that IS converting', () => {
    const converting = healthy({ photoCount: 1, descriptionLength: 10, viewsInWindow: 100, leadsInWindow: 1, price: 20_000_000 })
    expect(codes(converting)).not.toContain('price_above_band')
    expect(codes(converting)).not.toContain('no_leads_thin_photos')
    expect(codes(converting)).not.toContain('no_leads_thin_description')
  })
})

/* ── 1. A buyer is waiting ─────────────────────────────────────────────────────────────────── */

describe('unanswered_messages — the only nudge that outranks everything', () => {
  const waiting = (hours: number, over: Partial<ListingHealthFacts> = {}) =>
    healthy({ unansweredThreads: 2, oldestUnansweredHours: hours, ...over })

  it('fires once a buyer has waited past the reply SLA', () => {
    expect(codes(waiting(HEALTH.REPLY_SLA_HOURS - 1))).toEqual([])
    const n = listingNudge(waiting(HEALTH.REPLY_SLA_HOURS), NOW)
    expect(n).toMatchObject({ code: 'unanswered_messages', tone: 'warn', fix: 'reply_to_buyers', waiting: 2 })
  })

  it('bypasses the evidence window — a person waiting is a fact, not a verdict', () => {
    const brandNew = waiting(30, { createdAt: new Date(NOW.getTime() - DAY) })
    expect(codes(brandNew)).toEqual(['unanswered_messages'])
  })

  it('outranks a measured pricing problem', () => {
    const both = waiting(48, {
      viewsInWindow: 50,
      leadsInWindow: 0,
      price: 15_000_000,
      band: { n: 12, p25: 9_000_000, median: 10_000_000, p75: 11_000_000 },
    })
    expect(codes(both)[0]).toBe('unanswered_messages')
    expect(listingNudge(both, NOW)?.code).toBe('unanswered_messages')
  })

  it('stops once the buyer has plainly moved on — rank 1 has no other bound', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. This nudge bypasses the evidence window AND the rotation
    // cooldown, so "it disappears when the seller replies" is only true of sellers who reply. One
    // abandoned thread would hold a warn and isListingHealthy false for the life of the listing —
    // the permanently-amber outcome, one tier up from where it was already fixed.
    const nearly = HEALTH.ABANDONED_WAIT_DAYS * 24 - 1
    expect(codes(waiting(nearly))).toEqual(['unanswered_messages'])
    expect(codes(waiting(HEALTH.ABANDONED_WAIT_DAYS * 24))).toEqual([])
    expect(isListingHealthy(waiting(HEALTH.ABANDONED_WAIT_DAYS * 24), NOW)).toBe(true)
  })

  it('reports whole hours, so the copy never says "waiting 47.83 hours"', () => {
    const n = listingNudge(waiting(47.83), NOW)
    expect(n).toMatchObject({ code: 'unanswered_messages', oldestWaitingHours: 47 })
  })
})

/* ── 2. The market says the price is why ───────────────────────────────────────────────────── */

describe('price_above_band — the only nudge that quotes a checkable number', () => {
  const stuck = (over: Partial<ListingHealthFacts> = {}) =>
    healthy({ viewsInWindow: 40, leadsInWindow: 0, photoCount: 6, descriptionLength: 600, ...over })

  it('names the cause with the numbers behind it', () => {
    const n = listingNudge(stuck({ price: 11_200_000 }), NOW)
    expect(n).toMatchObject({
      code: 'price_above_band',
      tone: 'warn',
      fix: 'lower_price',
      windowDays: HEALTH.WINDOW_DAYS,
      views: 40,
      leads: 0,
      sampleSize: 12,
      percentAboveMedian: 12,
      suggestedPrice: 10_000_000,
    })
  })

  it('does NOT let the renderer say "similar listings priced 12% lower" from the wrong number', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. A listing 12% above the median has comparables 10.7% BELOW
    // it — the denominators differ. The first draft's doc comment prescribed the first number for
    // the second sentence, which is exactly the checkable lie the module header warns about.
    const n = listingNudge(stuck({ price: 11_200_000 }), NOW) as { percentAboveMedian: number; percentBelowPrice: number }
    expect(n.percentAboveMedian).toBe(12)
    expect(n.percentBelowPrice).toBe(11) // round(1 - 10/11.2) = round(10.71) = 11
    expect(n.percentBelowPrice).not.toBe(n.percentAboveMedian)
    // The identity that makes them different, at a ratio where rounding cannot hide it.
    const half = listingNudge(stuck({ price: 20_000_000 }), NOW) as { percentAboveMedian: number; percentBelowPrice: number }
    expect(half.percentAboveMedian).toBe(100)
    expect(half.percentBelowPrice).toBe(50)
  })

  it('stays silent without a reliable band', () => {
    // getPriceBand() already suppresses below 5 samples and above a 3x spread, so null means
    // "no benchmark exists" and this module must not invent one from the listing price.
    expect(codes(stuck({ price: 99_000_000, band: null }))).not.toContain('price_above_band')
  })

  it('needs a real margin over the median, not a rounding error', () => {
    const median = 10_000_000
    const justUnder = median * HEALTH.ABOVE_BAND_FRACTION - 1
    expect(codes(stuck({ price: justUnder }))).not.toContain('price_above_band')
    expect(codes(stuck({ price: median * HEALTH.ABOVE_BAND_FRACTION }))).toContain('price_above_band')
  })

  it('rounds the suggestion to a price-shaped number', () => {
    const n = listingNudge(stuck({ price: 20_000_000, band: { n: 9, p25: 7_000_000, median: 8_123_456, p75: 9_000_000 } }), NOW)
    expect(n).toMatchObject({ code: 'price_above_band', suggestedPrice: 8_120_000 })
  })

  it('never suggests a price of zero on a cheap band', () => {
    const n = listingNudge(stuck({ price: 30_000, band: { n: 8, p25: 1_000, median: 4_000, p75: 6_000 } }), NOW)
    expect(n).toMatchObject({ code: 'price_above_band' })
    expect((n as { suggestedPrice: number }).suggestedPrice).toBeGreaterThan(0)
  })

  it('never suggests a price ABOVE the one the seller is already asking', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED BY ARITHMETIC. Band median 6.000, asking 7.000 — which clears
    // the 10% margin, because at that scale the margin (600) is smaller than the rounding step
    // (10.000). Rounding the median to the nearest step gave 10.000, so the nudge read "priced
    // above the market, try 10.000" to a seller asking 7.000: the checkable lie, printed by the
    // one nudge whose entire value is that the seller can check it.
    for (const [median, price] of [[6_000, 7_000], [4_000, 30_000], [1_000, 1_200], [8_123_456, 20_000_000]]) {
      const n = listingNudge(stuck({ price, band: { n: 8, p25: median * 0.8, median, p75: median * 1.2 } }), NOW)
      expect(n?.code).toBe('price_above_band')
      const s = (n as { suggestedPrice: number }).suggestedPrice
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(price)
    }
  })

  it('outranks the media nudges — measured evidence beats a heuristic', () => {
    const all = codes(stuck({ price: 15_000_000, photoCount: 1, descriptionLength: 10 }))
    expect(all.slice(0, 3)).toEqual(['price_above_band', 'no_leads_thin_photos', 'no_leads_thin_description'])
  })
})

/* ── 3–4. Traffic, no leads, thin listing ──────────────────────────────────────────────────── */

describe('no_leads_thin_photos / no_leads_thin_description', () => {
  const seen = (over: Partial<ListingHealthFacts> = {}) =>
    healthy({ viewsInWindow: 14, leadsInWindow: 0, band: null, ...over })

  it('asks for a specific number of photos, never zero', () => {
    const n = listingNudge(seen({ photoCount: 2, descriptionLength: 600 }), NOW)
    expect(n).toMatchObject({
      code: 'no_leads_thin_photos',
      tone: 'warn',
      fix: 'add_photos',
      views: 14,
      photoCount: 2,
      addPhotos: HEALTH.GOOD_PHOTOS - 2,
    })
  })

  it('goes quiet once the listing is at the conversion target for photos', () => {
    expect(codes(seen({ photoCount: HEALTH.GOOD_PHOTOS, descriptionLength: 600 }))).toEqual([])
  })

  it('falls through to the description when the photos are fine', () => {
    const n = listingNudge(seen({ photoCount: 6, descriptionLength: 50 }), NOW)
    expect(n).toMatchObject({ code: 'no_leads_thin_description', tone: 'warn', descriptionLength: 50 })
  })

  it('uses the measured bottom-quartile description length as the bar', () => {
    // p25 of live descriptions is 203 characters; the bar is 200, so this fires on roughly the
    // bottom quartile rather than on everyone.
    expect(codes(seen({ photoCount: 6, descriptionLength: HEALTH.THIN_DESCRIPTION_CHARS }))).toEqual([])
    expect(codes(seen({ photoCount: 6, descriptionLength: HEALTH.THIN_DESCRIPTION_CHARS - 1 }))).toContain('no_leads_thin_description')
  })

  it('puts photos before words — a marketplace card is a photo with a price on it', () => {
    expect(codes(seen({ photoCount: 1, descriptionLength: 10 }))[0]).toBe('no_leads_thin_photos')
  })
})

/* ── 5. Invisible ──────────────────────────────────────────────────────────────────────────── */

describe('no_views_missing_brand', () => {
  const invisible = (over: Partial<ListingHealthFacts> = {}) =>
    healthy({ viewsInWindow: 0, leadsInWindow: 0, photoCount: 6, descriptionLength: 600, ...over })

  it('fires only when a brand is actually missing on a listing nobody is seeing', () => {
    const n = listingNudge(invisible({ brandSlug: null, model: null }), NOW)
    expect(n).toMatchObject({ code: 'no_views_missing_brand', tone: 'info', fix: 'add_brand_model', hasBrand: false, hasModel: false })
  })

  it('still fires when only the model is missing, and says which half', () => {
    const n = listingNudge(invisible({ model: null }), NOW)
    expect(n).toMatchObject({ code: 'no_views_missing_brand', hasBrand: true, hasModel: false })
  })

  it('is INFO, not a warning — nothing is broken, something is absent', () => {
    expect(listingNudge(invisible({ brandSlug: null, model: null }), NOW)?.tone).toBe('info')
  })

  it('never asks for a brand where a brand is meaningless', () => {
    // A brand on a sofa listing in a non-brand category is nonsense; categoryHasBrand decides.
    expect(codes(invisible({ categorySlug: 'property', brandSlug: null, model: null }))).not.toContain('no_views_missing_brand')
    expect(codes(invisible({ categorySlug: null, brandSlug: null, model: null }))).not.toContain('no_views_missing_brand')
  })

  it('does not fire on a listing that IS being seen', () => {
    const seen = invisible({ viewsInWindow: HEALTH.INVISIBLE_VIEWS, brandSlug: null, model: null })
    expect(codes(seen)).not.toContain('no_views_missing_brand')
  })
})

/* ── 6. The weakest true thing ─────────────────────────────────────────────────────────────── */

describe('few_photos', () => {
  const quiet = (over: Partial<ListingHealthFacts> = {}) =>
    healthy({ viewsInWindow: 5, leadsInWindow: 0, descriptionLength: 600, band: null, ...over })

  it('is INFO — a photo suggestion is an opportunity, not a fault', () => {
    // ⚠️ THE RULE THAT KEEPS THE DASHBOARD FROM GOING PERMANENTLY AMBER. If this ever flips to
    // 'warn', every listing at the publish minimum is a warning and the colour stops meaning
    // anything on the listings that are genuinely failing.
    const n = listingNudge(quiet({ photoCount: 1 }), NOW)
    expect(n).toMatchObject({ code: 'few_photos', tone: 'info', fix: 'add_photos', publishFloor: 3, addPhotos: 4 })
  })

  it('only fires at or below the PUBLISH floor, so a fourth photo buys silence', () => {
    expect(codes(quiet({ photoCount: minPhotosFor('electronics') }))).toContain('few_photos')
    expect(codes(quiet({ photoCount: minPhotosFor('electronics') + 1 }))).toEqual([])
  })

  it('STOPS after the listing first month — it is the one rule with no evidence behind it', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. This rule has no traffic condition, and on the measured
    // catalogue (median photo count 1, publish floor 3) it is true for MOST live listings. Left
    // unbounded it re-fired every cooldown for the life of the listing, so `isListingHealthy` was
    // permanently false for the median listing and the header's promise that the channel "goes
    // quiet naturally" was false for its own weakest nudge. A seller still at the minimum a month
    // on has decided; the evidence-backed photo nudge (rank 3) keeps working regardless of age.
    const young = quiet({ photoCount: 1, createdAt: new Date(NOW.getTime() - 20 * DAY) })
    expect(codes(young)).toEqual(['few_photos'])
    const old = quiet({ photoCount: 1, createdAt: new Date(NOW.getTime() - (HEALTH.MEDIA_NUDGE_MAX_AGE_DAYS + 1) * DAY) })
    expect(codes(old)).toEqual([])
    expect(isListingHealthy(old, NOW)).toBe(true)
    // But with traffic converting at zero there IS evidence, and the warn-tier nudge still fires.
    const oldAndStuck = quiet({ photoCount: 1, createdAt: old.createdAt, viewsInWindow: 40, leadsInWindow: 0 })
    expect(codes(oldAndStuck)).toEqual(['no_leads_thin_photos'])
  })

  it('NEVER asks a single-photo category for photos, at either tone', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. minPhotosFor('services') is 1 because a visa service or a
    // cleaner has no object to photograph from three sides — the publish gate's own words are that
    // the rule "can only be satisfied by padding". The first draft compared the WARN-level photo
    // nudge against a flat GOOD_PHOTOS, so a service listing with real traffic got amber "add 4
    // photos" of nothing: the exact nag the info-tier gate was written to avoid.
    expect(minPhotosFor('services')).toBe(1)
    expect(conversionPhotoTarget('services')).toBe(1)
    expect(conversionPhotoTarget('electronics')).toBe(HEALTH.GOOD_PHOTOS)
    expect(codes(quiet({ categorySlug: 'services', photoCount: 1 }))).toEqual([])
    // And with traffic converting at zero, which is where the warn-tier nudge lives.
    const busy = quiet({ categorySlug: 'services', photoCount: 1, viewsInWindow: 40, leadsInWindow: 0 })
    expect(codes(busy)).not.toContain('no_leads_thin_photos')
    expect(codes(busy)).not.toContain('few_photos')
  })
})

/* ── One nudge, and the cooldown that rotates it ───────────────────────────────────────────── */

describe('listingNudge — one nudge, the highest-value one', () => {
  const broken = healthy({
    viewsInWindow: 40,
    leadsInWindow: 0,
    price: 15_000_000,
    photoCount: 1,
    descriptionLength: 10,
    unansweredThreads: 1,
    oldestUnansweredHours: 72,
  })

  it('returns exactly one, and it is rank 1', () => {
    expect(rankListingNudges(broken, NOW).length).toBeGreaterThan(1)
    expect(listingNudge(broken, NOW)).toMatchObject({ code: 'unanswered_messages', rank: 1 })
  })

  it('rotates to the next TRUE nudge rather than repeating itself', () => {
    const after = healthy({
      ...broken,
      unansweredThreads: 0,
      oldestUnansweredHours: 0,
      recentNudges: [{ code: 'price_above_band', at: new Date(NOW.getTime() - DAY) }],
    })
    expect(rankListingNudges(after, NOW)[0].code).toBe('price_above_band')
    expect(listingNudge(after, NOW)?.code).toBe('no_leads_thin_photos')
  })

  it('suppresses by FIX, not by code — the two add_photos codes are one ask', () => {
    // ⚠️ Without this, a suppressed `no_leads_thin_photos` walks straight back in as `few_photos`
    // and the seller is told to add photos twice in a week by what looks like two systems.
    expect(FIX_FOR_CODE.no_leads_thin_photos).toBe(FIX_FOR_CODE.few_photos)
    const facts = healthy({
      viewsInWindow: 40,
      leadsInWindow: 0,
      band: null,
      photoCount: 1,
      descriptionLength: 600,
      recentNudges: [{ code: 'no_leads_thin_photos', at: new Date(NOW.getTime() - DAY) }],
    })
    expect(codes(facts)).toEqual(['no_leads_thin_photos', 'few_photos'])
    expect(listingNudge(facts, NOW)).toBeNull()
  })

  it('repeats once the cooldown has expired', () => {
    const at = new Date(NOW.getTime() - HEALTH.NUDGE_COOLDOWN_DAYS * DAY)
    const facts = healthy({ viewsInWindow: 40, leadsInWindow: 0, band: null, photoCount: 1, descriptionLength: 600, recentNudges: [{ code: 'no_leads_thin_photos', at }] })
    expect(listingNudge(facts, NOW)?.code).toBe('no_leads_thin_photos')
  })

  it('is not defeated by alternating fixes — every nudge in the window suppresses', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. With only the LAST nudge remembered, add_photos on Monday →
    // lower_price on Tuesday → add_photos on Wednesday delivers the same ask twice inside a stated
    // seven-day suppression. A cooldown a two-step sequence walks around is not a cooldown.
    const facts = healthy({
      viewsInWindow: 40,
      leadsInWindow: 0,
      price: 15_000_000,
      photoCount: 1,
      descriptionLength: 10,
      recentNudges: [
        { code: 'no_leads_thin_photos', at: new Date(NOW.getTime() - 2 * DAY) },
        { code: 'price_above_band', at: new Date(NOW.getTime() - DAY) },
      ],
    })
    expect(codes(facts)).toEqual(['price_above_band', 'no_leads_thin_photos', 'no_leads_thin_description', 'few_photos'])
    // Both add_photos codes AND lower_price are spoken for; the description is the one left.
    expect(listingNudge(facts, NOW)?.code).toBe('no_leads_thin_description')
  })

  it('discards a future-dated entry rather than being silenced by a bad clock', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. A timestamp months ahead is clock skew, not evidence; taking
    // it at face value suppresses that fix until real time catches up.
    const only = { viewsInWindow: 5, leadsInWindow: 0, band: null, descriptionLength: 600, photoCount: 1 }
    const skewed = healthy({ ...only, recentNudges: [{ code: 'few_photos' as const, at: new Date(NOW.getTime() + 90 * DAY) }] })
    expect(codes(skewed)).toEqual(['few_photos'])
    expect(listingNudge(skewed, NOW)?.code).toBe('few_photos')
    // A few minutes of skew is still treated as a real, just-shown nudge.
    const fresh = healthy({ ...only, recentNudges: [{ code: 'few_photos' as const, at: new Date(NOW.getTime() + 60_000) }] })
    expect(listingNudge(fresh, NOW)).toBeNull()
  })

  it('NEVER lets the cooldown silence a waiting buyer', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. Buyer waits 24h Monday and the seller is told; by Wednesday
    // the SAME buyer has waited 72h, reply_to_buyers is still inside the 7-day window, and the
    // first version handed the seller a photo suggestion instead — the abandoned buyer unmentioned
    // for a week. A cooldown stops us REPEATING an ask; a person still waiting is the same question
    // getting worse. It cannot nag forever either: it vanishes the moment the seller replies.
    const facts = healthy({
      unansweredThreads: 1,
      oldestUnansweredHours: 72,
      photoCount: 1,
      viewsInWindow: 40,
      leadsInWindow: 0,
      recentNudges: [{ code: 'unanswered_messages', at: new Date(NOW.getTime() - 2 * DAY) }],
    })
    expect(listingNudge(facts, NOW)?.code).toBe('unanswered_messages')
    // Every other fix still rotates normally.
    const photos = healthy({ ...facts, unansweredThreads: 0, oldestUnansweredHours: 0, band: null, descriptionLength: 600, recentNudges: [{ code: 'no_leads_thin_photos', at: new Date(NOW.getTime() - 2 * DAY) }] })
    expect(listingNudge(photos, NOW)).toBeNull()
  })

  it('goes silent rather than reaching for a nudge that is not true', () => {
    const facts = healthy({ photoCount: 1, viewsInWindow: 5, leadsInWindow: 0, band: null, recentNudges: [{ code: 'few_photos', at: new Date(NOW.getTime() - DAY) }] })
    expect(codes(facts)).toEqual(['few_photos'])
    expect(listingNudge(facts, NOW)).toBeNull()
  })
})

/* ── Contracts the renderer relies on ──────────────────────────────────────────────────────── */

describe('nudge contracts', () => {
  it('ranks are a strict total order and every nudge carries its declared fix', () => {
    // A worst-case listing that trips five of the six rules at once — the sixth (few_photos) is
    // structurally unreachable alongside no_leads_thin_photos only when the fall-through matters,
    // so it is asserted separately above.
    const worst = rankListingNudges(
      healthy({
        viewsInWindow: 40,
        leadsInWindow: 0,
        price: 15_000_000,
        photoCount: 1,
        descriptionLength: 10,
        unansweredThreads: 1,
        oldestUnansweredHours: 72,
      }),
      NOW,
    )
    expect(worst.map((n) => n.code)).toEqual([
      'unanswered_messages',
      'price_above_band',
      'no_leads_thin_photos',
      'no_leads_thin_description',
      'few_photos',
    ])
    const ranks = worst.map((n) => n.rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(ranks.length)
    for (const n of worst) expect(n.fix).toBe(FIX_FOR_CODE[n.code])
    // Every declared code is reachable — a code with no rule behind it is dead copy.
    const allCodes = Object.keys(FIX_FOR_CODE) as ListingNudgeCode[]
    expect(allCodes).toHaveLength(6)
    const invisible = codes(healthy({ viewsInWindow: 0, leadsInWindow: 0, brandSlug: null, model: null, photoCount: 6, descriptionLength: 600 }))
    expect(invisible).toContain('no_views_missing_brand')
  })

  it('carries numbers, never formatted money — vnd.ts owns that at the surface', () => {
    const n = listingNudge(healthy({ viewsInWindow: 40, leadsInWindow: 0, price: 15_000_000 }), NOW)
    expect(n?.code).toBe('price_above_band')
    for (const v of Object.values(n as Record<string, unknown>)) {
      expect(typeof v === 'string' ? /[₫đ]|VND/.test(v) : false).toBe(false)
    }
  })

  it('warn is reserved for something measurably wrong', () => {
    const tones = new Map<ListingNudgeCode, string>()
    const facts = healthy({
      viewsInWindow: 40,
      leadsInWindow: 0,
      price: 15_000_000,
      photoCount: 1,
      descriptionLength: 10,
      unansweredThreads: 1,
      oldestUnansweredHours: 72,
    })
    for (const n of rankListingNudges(facts, NOW)) tones.set(n.code, n.tone)
    expect(tones.get('unanswered_messages')).toBe('warn')
    expect(tones.get('price_above_band')).toBe('warn')
    expect(tones.get('no_leads_thin_photos')).toBe('warn')
    expect(tones.get('few_photos')).toBe('info')
  })

  it('isListingHealthy is NOT the negation of a silent nudge', () => {
    // A listing whose only nudge is on cooldown is silent but not healthy; a dashboard that
    // painted a green tick from the silence would be lying.
    const facts = healthy({ photoCount: 1, viewsInWindow: 5, leadsInWindow: 0, band: null, recentNudges: [{ code: 'few_photos', at: new Date(NOW.getTime() - DAY) }] })
    expect(listingNudge(facts, NOW)).toBeNull()
    expect(isListingHealthy(facts, NOW)).toBe(false)
  })

  it('hoursSince never goes negative on clock skew', () => {
    expect(hoursSince(new Date(NOW.getTime() + 60_000), NOW)).toBe(0)
    expect(hoursSince(new Date(NOW.getTime() - 3_600_000), NOW)).toBe(1)
  })
})
