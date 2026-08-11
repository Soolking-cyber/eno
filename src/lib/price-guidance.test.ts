import { describe, expect, it } from 'vitest'

import * as guidanceModule from './price-guidance'
import {
  PRICE_GUIDANCE,
  isAskAboveBand,
  isBelowTypical,
  percentileCont,
  positionInBand,
  priceGuidance,
  type GuidanceComparable,
  type GuidanceSubject,
  type SoldPriceBand,
} from './price-guidance'
import { serializeBuyerHistory } from './trade-loop'

/**
 * PRICE GUIDANCE — the tests that matter are the ones about what it REFUSES to say.
 *
 * The band is a claim the marketplace makes about what something is worth, made to people who
 * are about to act on it. Getting it wrong once, publicly, ends the feature — so most of what
 * follows asserts silence: silence on day one, silence below the threshold, silence for every
 * sale nobody corroborated, and silence for one shop trying to set its own market.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-12T00:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY)

/** A tight, realistic set of eight used-Vision prices. Hand-computed percentile_cont below. */
const EIGHT_PRICES = [10_000_000, 10_500_000, 11_000_000, 11_500_000, 12_000_000, 12_500_000, 13_000_000, 14_000_000]
/** percentile_cont over EIGHT_PRICES: h = (n−1)·p → interpolate. p25 h=1.75, p50 h=3.5, p75 h=5.25. */
const EXPECTED = { p25: 10_875_000, median: 11_750_000, p75: 12_625_000 }

let seq = 0

/**
 * A BUYER-CONFIRMED eno sale — the only shape that is a comparable. Every other fixture in this
 * file is this one with something removed, which is the point: each removal must make it vanish.
 * Sellers and buyers default to unique ids so the per-party cap only bites in the tests that set
 * them; `sellerOwnerProfileId` defaults to null (the documented degraded path, which falls back
 * to `sellerId`) and the tests that care about the PERSON behind a storefront pass it explicitly.
 */
function confirmed(price: number, over: Partial<GuidanceComparable> = {}): GuidanceComparable {
  seq += 1
  const soldAt = over.soldAt ?? daysAgo(30)
  return {
    id: `listing-${seq}`,
    sellerId: `seller-${seq}`,
    sellerOwnerProfileId: null,
    brandSlug: 'honda',
    model: 'Vision',
    condition: 'used',
    year: 2020,
    status: 'sold',
    complianceStatus: 'clear',
    soldChannel: 'eno',
    soldToProfileId: `buyer-${seq}`,
    soldAt,
    salePrice: price,
    saleConfirmedAt: soldAt,
    saleDeclinedAt: null,
    saleBuyerHistory: null,
    saleConfirmPromptedAt: soldAt,
    ...over,
  }
}

/** Eight confirmed sales of the subject's exact model/year/condition. */
function eight(over: Partial<GuidanceComparable> = {}): GuidanceComparable[] {
  return EIGHT_PRICES.map((p) => confirmed(p, over))
}

const SUBJECT: GuidanceSubject = { brandSlug: 'honda', model: 'Vision', priceUnit: 'VND', condition: 'used', year: 2020 }

function band(rows: readonly GuidanceComparable[], subject: GuidanceSubject = SUBJECT): SoldPriceBand {
  const result = priceGuidance(rows, subject, NOW)
  if (!result.shown) throw new Error(`expected a band, got ${result.reason} (${result.comparables} comparables)`)
  return result.band
}

function hidden(rows: readonly GuidanceComparable[], subject: GuidanceSubject = SUBJECT) {
  const result = priceGuidance(rows, subject, NOW)
  if (result.shown) throw new Error(`expected NO band, got ${JSON.stringify(result.band)}`)
  return result
}

// ── DAY ONE ────────────────────────────────────────────────────────────────────────────────

describe('day one: no confirmed sales exist anywhere', () => {
  it('shows NOTHING for an empty comparable set', () => {
    // MEASURED 2026-08-12 against the live DB: the deployed schema has no `salePrice` column at
    // all, so this is not a theoretical edge — it is production today, for every listing.
    expect(priceGuidance([], SUBJECT, NOW)).toEqual({ shown: false, reason: 'no_comparables', comparables: 0 })
  })

  it('⚠️ NEVER falls back to asked prices — twenty unconfirmed sales with prices still yield nothing', () => {
    // The failure this whole module is built to make impossible. Each of these rows carries a
    // perfectly usable NUMBER; none of them carries a second party who agreed to it.
    const rows = [
      ...eight({ saleConfirmedAt: null }), // awaiting the buyer
      ...eight({ soldChannel: 'external', soldToProfileId: null, saleConfirmedAt: null }), // off-platform
      ...eight({ soldChannel: null, soldToProfileId: null, saleConfirmedAt: null }), // unattributed
    ]
    expect(rows).toHaveLength(24)
    expect(priceGuidance(rows, SUBJECT, NOW)).toEqual({ shown: false, reason: 'no_comparables', comparables: 0 })
  })

  it('a hidden result carries no band to accidentally render', () => {
    const result = priceGuidance([], SUBJECT, NOW)
    expect('band' in result).toBe(false)
  })
})

// ── THE THRESHOLD ──────────────────────────────────────────────────────────────────────────

describe('the threshold is 8, and it is a named constant', () => {
  it('is 8 — the spec number, not the 5 the asked-price band uses', () => {
    expect(PRICE_GUIDANCE.MIN_COMPARABLES).toBe(8)
  })

  it('hides at 7 and shows at 8', () => {
    const seven = EIGHT_PRICES.slice(0, 7).map((p) => confirmed(p))
    expect(hidden(seven)).toEqual({ shown: false, reason: 'too_few', comparables: 7 })
    expect(band(eight()).n).toBe(8)
  })

  it('every band that renders involves at least six distinct parties (8 rows × 2 sides, ≤3 each)', () => {
    // Not an assertion about a line of code — an assertion about the ARITHMETIC of the two
    // constants together. If either changes, this is the sentence that has to be recomputed.
    expect(Math.ceil((2 * PRICE_GUIDANCE.MIN_COMPARABLES) / PRICE_GUIDANCE.MAX_PER_PARTY)).toBe(6)
  })
})

// ── ONLY CONFIRMED SALES ───────────────────────────────────────────────────────────────────

describe('confirmation is the gate, and it is the trade-loop predicate', () => {
  const cases: Array<[string, Partial<GuidanceComparable>]> = [
    ['awaiting the buyer (no answer yet)', { saleConfirmedAt: null }],
    ['declined by the buyer', { saleConfirmedAt: null, saleDeclinedAt: daysAgo(20) }],
    ['off-platform ("someone not on eno")', { soldChannel: 'external', soldToProfileId: null, saleConfirmedAt: null }],
    ['unattributed (the dashboard / partner-API shape)', { soldChannel: null, soldToProfileId: null, saleConfirmedAt: null }],
    ['taken down by authority order AFTER the sale', { complianceStatus: 'taken_down' }],
    ['not sold at all', { status: 'active' }],
    // Only reachable by a hand-written UPDATE or a future caller that writes the column without
    // asking canRespondToSale. saleState() refuses to call it confirmed; so must this.
    ['an external sale carrying a confirmation stamp', { soldChannel: 'external', soldToProfileId: null }],
    ['a confirmation stamp with nobody named', { soldChannel: null, soldToProfileId: null }],
    ['a confirmed sale with no price recorded', { salePrice: null }],
    ['a confirmed sale with a nonsense price', { salePrice: 0 }],
  ]

  for (const [name, shape] of cases) {
    it(`excludes: ${name}`, () => {
      expect(hidden(eight(shape)).reason).toBe('no_comparables')
    })
  }

  it('a pile of unbelievable sales cannot move a band built from believable ones', () => {
    const rows = [
      ...eight(),
      // Twenty-four rows at 99tr that nobody corroborated. If any leaked in, p75 would move.
      ...eight({ salePrice: 99_000_000, saleConfirmedAt: null }),
      ...eight({ salePrice: 99_000_000, soldChannel: 'external', soldToProfileId: null }),
      ...eight({ salePrice: 99_000_000, complianceStatus: 'taken_down' }),
    ]
    expect(band(rows)).toMatchObject({ n: 8, ...EXPECTED })
  })

  it('uses the price the BUYER WAS SHOWN, not the raw salePrice column', () => {
    // trade-loop's confirmPromptPrice: a seller who edits the figure inside the prompt window
    // moves `salePrice` while the buyer's outstanding question still quotes the old number. The
    // answer is about the OLD number, so that is the only one guidance may believe.
    const rows = EIGHT_PRICES.map((shown, i) => {
      const buyer = `buyer-shown-${i}`
      return confirmed(99_000_000, {
        soldToProfileId: buyer,
        saleBuyerHistory: serializeBuyerHistory([{ id: buyer, askedAt: daysAgo(30).getTime(), askedPrice: shown }]),
      })
    })
    // Decisive: had it read `salePrice`, every row would be 99tr and the band would be 99tr wide-of-zero.
    expect(band(rows)).toMatchObject({ n: 8, ...EXPECTED })
  })
})

// ── THE MATHS ──────────────────────────────────────────────────────────────────────────────

describe('the percentile estimator matches Postgres percentile_cont', () => {
  it('interpolates between order statistics at p·(n−1)', () => {
    const sorted = [1, 2, 3, 4]
    expect(percentileCont(sorted, 0.25)).toBe(1.75)
    expect(percentileCont(sorted, 0.5)).toBe(2.5)
    expect(percentileCont(sorted, 0.75)).toBe(3.25)
  })

  it('is exact at the ends and on a single value', () => {
    expect(percentileCont([5], 0.25)).toBe(5)
    expect(percentileCont([1, 9], 0)).toBe(1)
    expect(percentileCont([1, 9], 1)).toBe(9)
  })

  it('produces the hand-computed band for the eight-sale fixture', () => {
    expect(band(eight())).toEqual({ n: 8, ...EXPECTED, tier: 'model_condition_year' })
  })

  it('rounds to whole đồng — VND has no subunit', () => {
    // Prices chosen so the interpolation lands on a fraction: p25 h=1.75 between 101 and 102.
    const rows = [100, 101, 102, 103, 104, 105, 106, 107].map((p) => confirmed(p * 1_000_001))
    const b = band(rows)
    expect(Number.isInteger(b.p25)).toBe(true)
    expect(Number.isInteger(b.median)).toBe(true)
    expect(Number.isInteger(b.p75)).toBe(true)
  })
})

// ── NARROWING ──────────────────────────────────────────────────────────────────────────────

describe('the band narrows as the fields fill in', () => {
  /** Older, much cheaper units of the same model — same condition, wrong year. */
  const olderUsed = () => [6, 6.2, 6.4, 6.6, 6.8, 7, 7.2, 7.4].map((m) => confirmed(m * 1_000_000, { year: 2016 }))
  /** Same year, different condition. */
  const newSame = () => [18, 18.2, 18.4, 18.6, 18.8, 19, 19.2, 19.4].map((m) => confirmed(m * 1_000_000, { condition: 'new' }))

  it('uses the narrowest tier that clears the threshold', () => {
    expect(band([...eight(), ...olderUsed(), ...newSame()]).tier).toBe('model_condition_year')
  })

  it('drops the YEAR first when the year-matched set is short', () => {
    const sevenThisYear = EIGHT_PRICES.slice(0, 7).map((p) => confirmed(p))
    const b = band([...sevenThisYear, ...olderUsed()])
    expect(b.tier).toBe('model_condition')
    expect(b.n).toBe(15)
  })

  it('⚠️ still tries the YEAR alone before giving up — filling the form in must not make the band worse', () => {
    // The reviewer-found hole in the first ladder: with both facts known it went
    // [mcy, mc, model], so a short condition-matched set fell straight to "all years, all
    // conditions" — while the SAME seller, having left `condition` blank, would have got a tight
    // year-matched band. Stating more about your bike made the guidance worse.
    const sevenThisYear = EIGHT_PRICES.slice(0, 7).map((p) => confirmed(p))
    const rows = [...sevenThisYear, ...newSame()]
    const withCondition = band(rows)
    expect(withCondition.tier).toBe('model_year')
    // And the proof of the property, not just of the branch: saying less buys you nothing.
    const saidLess = band(rows, { brandSlug: 'honda', model: 'Vision', priceUnit: 'VND', year: 2020 })
    expect(saidLess).toEqual(withCondition)
  })

  it('reaches the model rung only when neither single dimension has enough', () => {
    const sevenThisYear = EIGHT_PRICES.slice(0, 7).map((p) => confirmed(p))
    const fiveOldNew = [18, 18.2, 18.4, 18.6, 18.8].map((m) => confirmed(m * 1_000_000, { condition: 'new', year: 2018 }))
    const b = band([...sevenThisYear, ...fiveOldNew])
    expect(b.tier).toBe('model')
    expect(b.n).toBe(12)
  })

  it('narrowing actually NARROWS — the specific band is tighter than the general one', () => {
    const wide = band([...EIGHT_PRICES.slice(0, 7).map((p) => confirmed(p)), ...olderUsed()])
    const tight = band([...eight(), ...olderUsed()])
    expect(tight.tier).toBe('model_condition_year')
    expect(tight.p75 - tight.p25).toBeLessThan(wide.p75 - wide.p25)
  })

  it('counts ±1 model year as the same year, and ±2 as a different one', () => {
    expect(band(eight({ year: 2019 })).tier).toBe('model_condition_year')
    expect(band(eight({ year: 2021 })).tier).toBe('model_condition_year')
    expect(PRICE_GUIDANCE.YEAR_TOLERANCE).toBe(1)
    // 2022 misses the year tier entirely, so the ladder widens one rung rather than hiding.
    expect(band(eight({ year: 2022 })).tier).toBe('model_condition')
  })

  it('offers a year tier to a subject that has a year but no condition', () => {
    const subject: GuidanceSubject = { brandSlug: 'honda', model: 'Vision', priceUnit: 'VND', year: 2020 }
    expect(band(eight(), subject).tier).toBe('model_year')
  })

  it('falls back to model alone when the subject states neither', () => {
    const subject: GuidanceSubject = { brandSlug: 'honda', model: 'Vision', priceUnit: 'VND' }
    expect(band(eight(), subject).tier).toBe('model')
  })

  it('⚠️ a blank condition is ABSENT, not a value — the price-stat trap, on both sides', () => {
    // Subject side: whitespace must not open a condition tier that nothing can satisfy.
    const blankSubject: GuidanceSubject = { brandSlug: 'honda', model: 'Vision', priceUnit: 'VND', condition: '   ', year: 2020 }
    expect(band(eight(), blankSubject).tier).toBe('model_year')
    // Row side: a partner-sync row with a whitespace condition can never match a condition tier,
    // so a subject that HAS one skips both condition rungs — and lands on the year, not on the
    // bare model rung, because the year is still known on both sides.
    expect(band(eight({ condition: '  ' })).tier).toBe('model_year')
  })
})

// ── ONE SHOP CANNOT SET ITS OWN MARKET ─────────────────────────────────────────────────────

describe('the per-party cap', () => {
  it('caps one seller at three, so twenty of their sales are not a market', () => {
    const rows = Array.from({ length: 20 }, (_, i) => confirmed(12_000_000 + i, { sellerId: 'one-big-shop' }))
    expect(hidden(rows)).toEqual({ shown: false, reason: 'too_few', comparables: 3 })
  })

  it('keeps each seller MOST RECENT three, not their oldest', () => {
    const rows = [
      // The shop with a stale cheap sale on the books. If the cap kept it, p25 would collapse.
      confirmed(1_000_000, { sellerId: 'shop-a', soldAt: daysAgo(150) }),
      confirmed(12_000_000, { sellerId: 'shop-a', soldAt: daysAgo(3) }),
      confirmed(12_000_000, { sellerId: 'shop-a', soldAt: daysAgo(2) }),
      confirmed(12_000_000, { sellerId: 'shop-a', soldAt: daysAgo(1) }),
      ...Array.from({ length: 3 }, () => confirmed(12_000_000, { sellerId: 'shop-b' })),
      ...Array.from({ length: 3 }, () => confirmed(12_000_000, { sellerId: 'shop-c' })),
    ]
    expect(band(rows)).toMatchObject({ n: 9, p25: 12_000_000, median: 12_000_000, p75: 12_000_000 })
  })

  it('⚠️ treats a missing sellerId as ONE shared shop — forgetting the column must not remove the cap', () => {
    expect(hidden(Array.from({ length: 12 }, () => confirmed(12_000_000, { sellerId: null })))).toMatchObject({
      reason: 'too_few',
      comparables: 3,
    })
    expect(hidden(Array.from({ length: 12 }, () => confirmed(12_000_000, { sellerId: '  ' })))).toMatchObject({
      reason: 'too_few',
      comparables: 3,
    })
  })

  it('lets three different sellers make a band', () => {
    const rows = ['shop-a', 'shop-b', 'shop-c'].flatMap((sellerId) =>
      [11_000_000, 12_000_000, 13_000_000].map((p) => confirmed(p, { sellerId })),
    )
    expect(band(rows).n).toBe(9)
  })

  it('⚠️ caps the CONFIRMING BUYER too — three storefronts and one buyer account is not a market', () => {
    // Sign-in is passwordless and free, so a seller-only cap proves three shops and nothing about
    // the other side of the trade: one person could hold the shops AND the single buyer account
    // that confirms every sale. Raised by an external reviewer against the seller-only draft.
    const rows = ['shop-a', 'shop-b', 'shop-c', 'shop-d'].flatMap((sellerId) =>
      [11_000_000, 12_000_000, 13_000_000].map((p) => confirmed(p, { sellerId, soldToProfileId: 'one-buyer' })),
    )
    expect(rows).toHaveLength(12)
    expect(hidden(rows)).toEqual({ shown: false, reason: 'too_few', comparables: 3 })
  })

  it('needs independent buyers as well as independent sellers', () => {
    const rows = ['shop-a', 'shop-b', 'shop-c'].flatMap((sellerId, s) =>
      [11_000_000, 12_000_000, 13_000_000].map((p, i) => confirmed(p, { sellerId, soldToProfileId: `buyer-${s}-${i}` })),
    )
    expect(band(rows).n).toBe(9)
    expect(PRICE_GUIDANCE.MAX_PER_PARTY).toBe(3)
  })

  it('⚠️ closes the THREE-ACCOUNT CYCLE that satisfied a seller cap and a buyer cap separately', () => {
    // A→B, B→C, C→A, three times each: every account is at exactly 3 sales and 3 purchases, so
    // two independent caps both pass and nine fabricated confirmations set a public band. One
    // shared budget charges each account 6 and the cycle collapses. (External reviewer, round 2.)
    const people = ['ann', 'binh', 'cuong']
    const rows = [0, 1, 2].flatMap((round) =>
      people.map((person, i) =>
        confirmed(12_000_000 + round, {
          sellerId: `shop-of-${person}`,
          sellerOwnerProfileId: person,
          soldToProfileId: people[(i + 1) % people.length],
          soldAt: daysAgo(round + 1),
        }),
      ),
    )
    expect(rows).toHaveLength(9)
    const result = hidden(rows)
    expect(result.reason).toBe('too_few')
    expect(result.comparables).toBeLessThanOrEqual(4)
  })

  it('⚠️ charges TWO STOREFRONTS WITH ONE OWNER to a single budget', () => {
    // The reason `sellerOwnerProfileId` is a required field: sellerId and soldToProfileId live in
    // different id spaces, so without the owner the same human running two shops looks like two
    // unrelated parties.
    const rows = ['shop-1', 'shop-2'].flatMap((sellerId) =>
      [11_000_000, 12_000_000, 13_000_000].map((p) => confirmed(p, { sellerId, sellerOwnerProfileId: 'one-human' })),
    )
    expect(rows).toHaveLength(6)
    expect(hidden(rows)).toMatchObject({ reason: 'too_few', comparables: 3 })
  })

  it('⚠️ charges a SELF-DEALT row twice, so one party cannot exceed the cap by trading with itself', () => {
    // Testing the two keys independently against the pre-charge count let a party sitting at 2
    // pass both guards and land at 4 — over a cap of 3, in exactly the shape the cap exists for.
    // Found independently by all three reviewer families. The trade loop refuses seller-as-buyer
    // upstream, so this is depth, not a live hole — and a hand-written row is why it is here.
    const rows = Array.from({ length: 6 }, (_, i) =>
      confirmed(12_000_000 + i, { sellerId: 'shop', sellerOwnerProfileId: 'self', soldToProfileId: 'self' }),
    )
    // 3 participations at 2 per row = one row, and the party is spent. Never 2 rows (4 charges).
    expect(hidden(rows)).toMatchObject({ reason: 'too_few', comparables: 1 })
  })

  it('⚠️ is DETERMINISTIC — the same sales in a different row order give the identical band', () => {
    // The cap keeps the newest rows, and almost every real query returns same-day sales in
    // whatever order the planner chose. Without an explicit tie-break, WHICH three of a shop's
    // five same-day sales survived — and so p25/p75 — moved with the row order. (Reviewer, r2.)
    const rows = ['shop-a', 'shop-b', 'shop-c'].flatMap((sellerId) =>
      [9_000_000, 11_000_000, 13_000_000, 15_000_000, 17_000_000].map((p) => confirmed(p, { sellerId })),
    )
    const forwards = band(rows)
    const backwards = band([...rows].reverse())
    const shuffled = band([...rows].sort((a, b) => (a.id < b.id ? 1 : -1)))
    expect(backwards).toEqual(forwards)
    expect(shuffled).toEqual(forwards)
  })
})

// ── RECENCY ────────────────────────────────────────────────────────────────────────────────

describe('a stale price is not a comparable', () => {
  it('keeps a sale just inside the window and drops one just outside it', () => {
    expect(PRICE_GUIDANCE.MAX_AGE_DAYS).toBe(180)
    expect(band(eight({ soldAt: daysAgo(179) })).n).toBe(8)
    expect(hidden(eight({ soldAt: daysAgo(181) })).reason).toBe('no_comparables')
  })

  it('ages the price from soldAt (when it traded), not from the buyer answering late', () => {
    // Sold 18 months ago, confirmed yesterday. The PRICE is 18 months old.
    expect(hidden(eight({ soldAt: daysAgo(540), saleConfirmedAt: daysAgo(1) })).reason).toBe('no_comparables')
  })

  it('falls back to the confirmation stamp when soldAt was never written', () => {
    expect(band(eight({ soldAt: null, saleConfirmedAt: daysAgo(10) })).n).toBe(8)
  })

  it('⚠️ survives a JSON-deserialized row, where a Date came back as a string', () => {
    // The exported type says Date, and a client that fetched comparables from an API route holds
    // an ISO STRING. `soldAt?.getTime()` threw a TypeError there and took the render down — for a
    // feature whose only failure mode is meant to be "renders nothing". (External reviewer.)
    const iso = daysAgo(20).toISOString() as unknown as Date
    expect(band(eight({ soldAt: iso })).n).toBe(8)
    // And an unparseable one is skipped rather than thrown on.
    expect(() => priceGuidance(eight({ soldAt: 'not a date' as unknown as Date, saleConfirmedAt: null }), SUBJECT, NOW)).not.toThrow()
    expect(hidden(eight({ soldAt: 'not a date' as unknown as Date, saleConfirmedAt: null })).reason).toBe('no_comparables')
  })

  it('forgives a few hours of clock skew, which is not the seller fault', () => {
    const rows = [
      confirmed(12_000_000, { soldAt: new Date(NOW.getTime() + 12 * 3_600_000) }),
      ...EIGHT_PRICES.slice(1).map((p) => confirmed(p)),
    ]
    expect(band(rows).n).toBe(8)
  })

  it('⚠️ drops a sale dated far into the future — the past window alone never ages it out', () => {
    // `nowMs - at > maxAgeMs` is false for the year 2099, so an unbounded future date would live
    // in every band forever AND sort first in the per-party caps. Found by an external reviewer.
    const rows = [
      confirmed(99_000_000, { soldAt: new Date(NOW.getTime() + 400 * DAY) }),
      ...EIGHT_PRICES.slice(1).map((p) => confirmed(p)),
    ]
    expect(hidden(rows)).toEqual({ shown: false, reason: 'too_few', comparables: 7 })
    expect(PRICE_GUIDANCE.MAX_FUTURE_SKEW_DAYS).toBe(1)
  })
})

// ── SUPPRESSION ────────────────────────────────────────────────────────────────────────────

describe('a range too wide to act on is not shown', () => {
  it('suppresses a band whose top is more than 3× its bottom', () => {
    const rows = [5, 6, 7, 8, 25, 30, 35, 40].map((m) => confirmed(m * 1_000_000))
    expect(hidden(rows)).toEqual({ shown: false, reason: 'too_wide', comparables: 8 })
  })

  it('⚠️ does NOT widen and retry — a vaguer comparison is not a fix for a noisy one', () => {
    // The narrow tier is noisy; the wider tier holds a tight set that WOULD render. Showing it
    // would mean the answer depends on how bad the specific answer was, which is a rule
    // optimising for showing something.
    const noisyThisYear = [5, 6, 7, 8, 25, 30, 35, 40].map((m) => confirmed(m * 1_000_000))
    const tightOlder = EIGHT_PRICES.map((p) => confirmed(p, { year: 2016 }))
    expect(hidden([...noisyThisYear, ...tightOlder]).reason).toBe('too_wide')
  })

  it('keeps the spread rule identical to the asked-price band', () => {
    expect(PRICE_GUIDANCE.MAX_SPREAD).toBe(3)
  })
})

// ── SCOPE ──────────────────────────────────────────────────────────────────────────────────

describe('what counts as the same thing', () => {
  it('needs a brand AND a model on the subject', () => {
    expect(priceGuidance(eight(), { brandSlug: null, model: 'Vision', priceUnit: 'VND' }, NOW)).toEqual({
      shown: false,
      reason: 'no_subject_model',
      comparables: 0,
    })
    expect(priceGuidance(eight(), { brandSlug: 'honda', model: '  ', priceUnit: 'VND' }, NOW)).toEqual({
      shown: false,
      reason: 'no_subject_model',
      comparables: 0,
    })
  })

  it('folds case, spacing and accents on the free-typed model', () => {
    const rows = EIGHT_PRICES.map((p, i) => confirmed(p, { model: ['wave alpha', 'Wave-Alpha', 'WAVE  ALPHA'][i % 3] }))
    const subject: GuidanceSubject = { brandSlug: 'honda', model: 'Wave Alpha', priceUnit: 'VND', condition: 'used', year: 2020 }
    expect(band(rows, subject).n).toBe(8)
  })

  it('excludes a different model entirely', () => {
    expect(hidden(eight({ model: 'Air Blade' })).reason).toBe('no_comparables')
  })

  it('compares brandSlug as a canonical key — case-insensitive, but never folded across slugs', () => {
    expect(band(eight(), { ...SUBJECT, brandSlug: 'HONDA' }).n).toBe(8)
    expect(hidden(eight({ brandSlug: 'honda-vn' })).reason).toBe('no_comparables')
  })

  it('keeps a listing out of its own band', () => {
    const rows = eight()
    const subject: GuidanceSubject = { ...SUBJECT, id: rows[0].id }
    expect(hidden(rows, subject)).toEqual({ shown: false, reason: 'too_few', comparables: 7 })
  })
})

// ── THE VERDICT ────────────────────────────────────────────────────────────────────────────

describe('where a price sits against the band', () => {
  const b: SoldPriceBand = { n: 8, p25: 10_000_000, median: 11_000_000, p75: 12_000_000, tier: 'model' }

  it('is strictly outside the quartiles — an edge price reads as typical', () => {
    expect(positionInBand(9_999_999, b)).toBe('below')
    expect(positionInBand(10_000_000, b)).toBe('typical')
    expect(positionInBand(11_000_000, b)).toBe('typical')
    expect(positionInBand(12_000_000, b)).toBe('typical')
    expect(positionInBand(12_000_001, b)).toBe('above')
  })

  it('has no opinion about a price that is not a price yet', () => {
    expect(positionInBand(null, b)).toBeNull()
    expect(positionInBand(undefined, b)).toBeNull()
    expect(positionInBand(0, b)).toBeNull()
    expect(positionInBand(Number.NaN, b)).toBeNull()
  })

  it('surfaces only the good news', () => {
    expect(isBelowTypical(9_000_000, b)).toBe(true)
    expect(isBelowTypical(11_000_000, b)).toBe(false)
    expect(isBelowTypical(20_000_000, b)).toBe(false)
  })

  it('⚠️ refuses to endorse an impossibly low price — a bait listing earns no green chip', () => {
    // The mirror of the no-overpriced-badge rule, and it was missing: without a floor, ANY
    // positive price under P25 is "Below typical", so a bait listing at 100.000 đ against an
    // 11tr band collected the marketplace's own consumer-facing endorsement. (External reviewer.)
    expect(PRICE_GUIDANCE.BELOW_CREDIBLE_FRACTION).toBe(0.5)
    expect(isBelowTypical(100_000, b)).toBe(false)
    expect(isBelowTypical(b.p25 * 0.49, b)).toBe(false)
    expect(isBelowTypical(b.p25 * 0.5, b)).toBe(true)
    // A real bargain still counts — 40% under the quartile is a deal, not a typo.
    expect(isBelowTypical(b.p25 * 0.6, b)).toBe(true)
  })

  it('⚠️ stays silent through every PREFIX of a price being typed', () => {
    // 1 → 12 → 1.200 → 1.200.000 are all under P25, so an unfloored verdict announced a bargain
    // on nearly every keystroke — through a polite live region, out loud.
    for (const prefix of [1, 12, 120, 1_200, 12_000, 120_000, 1_200_000]) {
      expect(isBelowTypical(prefix, b)).toBe(false)
    }
    expect(isBelowTypical(9_000_000, b)).toBe(true) // the finished number
  })

  it('has no percentile for an empty sample, and does not answer 0', () => {
    // 0 is a PRICE and would sail into a band; NaN poisons the arithmetic loudly instead.
    expect(Number.isNaN(percentileCont([], 0.25))).toBe(true)
  })

  it('⚠️ exports NO above-typical helper — the card must not be able to badge a seller as expensive', () => {
    expect(Object.keys(guidanceModule)).not.toContain('isAboveTypical')
  })

  describe('an ask judged against a band of SALE prices', () => {
    it('stays quiet inside the negotiating margin — the warning must not fire on the median seller', () => {
      // The premise of the module is that the ask is an opening position and the sale lands under
      // it. So a bare `> p75` would flag nearly every honest seller: with this fixture p75/median
      // is 1.074, which any customary haggling margin clears. Raised by an external reviewer.
      expect(positionInBand(b.p75 + 1, b)).toBe('above') // raw geometry: yes, above
      expect(isAskAboveBand(b.p75 + 1, b)).toBe(false) // what a human is told: nothing
      expect(isAskAboveBand(b.p75 * 1.1, b)).toBe(false)
    })

    it('speaks once the ask is clear of the margin', () => {
      expect(PRICE_GUIDANCE.ASK_NEGOTIATION_MARGIN).toBe(0.15)
      expect(isAskAboveBand(b.p75 * 1.16, b)).toBe(true)
      expect(isAskAboveBand(b.p75 * 2, b)).toBe(true)
    })

    it('is asymmetric on purpose — the below side carries no margin', () => {
      // An ask BELOW what the model actually sold for is already the stronger statement, so the
      // strict comparison is the conservative one; padding it would mint good-price chips.
      expect(isBelowTypical(b.p25 - 1, b)).toBe(true)
      expect(isAskAboveBand(null, b)).toBe(false)
      expect(isAskAboveBand(0, b)).toBe(false)
    })
  })
})

/**
 * ⛔ A RENT IS NOT A SALE PRICE, AND brand+model CANNOT TELL THEM APART.
 *
 * `brandSlug`/`model` are written for ANY category and `priceUnit` is 'VND/month' for rentals, so
 * a Toyota Vios FOR RENT and a Toyota Vios FOR SALE are indistinguishable in this shape. The
 * existing asked-price guidance refuses rentals on purpose — "the PriceStat bands are sale prices,
 * so guidance there would coach sellers against the wrong market" — and this module inherited the
 * job without the guard. An 18.000.000 d/month listing against a sold-car band reads as wildly
 * underpriced, i.e. the guidance would tell a landlord to RAISE the rent toward a car's sale price.
 * Found by an external reviewer.
 */
describe('recurring prices never get a sale band', () => {
  const sold = () => eight()

  it('refuses a per-month subject even with a full pool', () => {
    const r = priceGuidance(sold(), { ...SUBJECT, priceUnit: 'VND/month' }, NOW)
    expect(r.shown).toBe(false)
    if (!r.shown) expect(r.reason).toBe('not_a_sale_price')
  })

  it('refuses a per-service subject', () => {
    const r = priceGuidance(sold(), { ...SUBJECT, priceUnit: 'VND/service' }, NOW)
    expect(r.shown).toBe(false)
  })

  it('allows the sale units a listing actually stores', () => {
    // ⚠️ Must reuse SUBJECT's brand+model: `eight()` builds comparables for it, and a mismatched
    // subject would return false for the ordinary no-comparables reason and prove nothing.
    for (const unit of ['VND', '', null]) {
      const r = priceGuidance(sold(), { ...SUBJECT, priceUnit: unit }, NOW)
      expect(r.shown).toBe(true)
    }
  })

  it('refuses an unrecognised unit rather than waving it through', () => {
    // Allow-list, not deny-list: a missing band costs nothing, a wrong one costs the feature.
    const r = priceGuidance(sold(), { ...SUBJECT, priceUnit: 'VND/week' }, NOW)
    expect(r.shown).toBe(false)
  })
})
