import { describe, expect, it, vi, beforeEach } from 'vitest'

// Tests for the duplicate guard's FACET EXEMPTION (owner report, 2026-08-11).
//
// ⚠️ THIS EXEMPTION DELIBERATELY WEAKENS AN ANTI-SPAM GUARD, so the tests have to hold both
// halves: a real variant must get through, and a real repost must still be caught. If only
// the first half is covered, "differsByFacet" could be widened until the guard does nothing
// and everything would still be green.
//
// The reported case is exact: an official partner's e-visa catalogue is eight rows differing
// only by entry type × speed, sharing product artwork, and a NINTH could not be posted even
// with a changed photo.
//
// ⚠️ THE FIRST DIAGNOSIS WRITTEN HERE — "so it was the IMAGE signal" — WAS WRONG, and the
// correction is worth keeping because it is the kind of mistake this file exists to catch.
// Each of those rows carries exactly ONE photo, and `isImageRepost` requires `count >= 2`, so
// the image signal is unreachable for a single-image listing and cannot have blocked anything.
// Measuring instead of reasoning found the real shape: pg_trgm similarity across the 28 real
// pairs is 0.962–0.987 against a SIM_HARD bar of 0.95, i.e. a catalogue sits above the text
// threshold by construction and only the ±10% price window keeps it out of a false positive.
// That is what the second exemption (`exactOnly`, below) addresses.

const queryRaw = vi.fn()
const catalogueSeller = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({ db: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))
// The real dHash comparison needs hashes embedded in URLs; force "the photos match" so every
// test below is exercising the FACET decision rather than image parsing.
vi.mock('./image-hash', () => ({ isImageRepost: () => true }))
// Default: an ordinary anonymous seller, so the facet suite below keeps testing the FULL guard.
// The relaxed-rule suite flips it explicitly.
vi.mock('./catalogue-seller', () => ({ isVerifiedCatalogueSeller: (...a: unknown[]) => catalogueSeller(...a) }))

const { findDuplicateListing } = await import('./duplicate-guard')

const CAT = 'cat-visa'
const existing = (over: Record<string, unknown> = {}) => ({
  id: 'live-1',
  title: 'Vietnam E-Visa - Single Entry - 2 Business Days',
  price: 1320000,
  categoryId: CAT,
  images: JSON.stringify(['a.webp', 'b.webp', 'c.webp']),
  attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '2D' }),
  score: 0.4,
  ...over,
})

const post = (attributes: Record<string, string> | null, over: Record<string, unknown> = {}) =>
  findDuplicateListing({
    sellerId: 's1',
    categoryId: CAT,
    title: 'Vietnam E-Visa - Single Entry - 1 Hour',
    searchText: 'vietnam e-visa single entry',
    price: 3160000,
    images: ['a.webp', 'b.webp', 'c.webp'], // same artwork on purpose
    attributes,
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  queryRaw.mockResolvedValue([existing()])
  catalogueSeller.mockResolvedValue(false)
})

describe('duplicate guard — taxonomy facets', () => {
  it('ALLOWS a variant that differs by facet, even with identical photos', async () => {
    // The reported failure. Same seller, same category, same images, different speed.
    expect(await post({ visaEntryType: 'single', visaSpeed: '1H' })).toBeNull()
  })

  it('still BLOCKS a repost whose facets are identical', async () => {
    // ⚠️ The half that keeps the guard a guard. Same facets + same photos = a repost.
    const r = await post({ visaEntryType: 'single', visaSpeed: '2D' })
    expect(r).toMatchObject({ id: 'live-1' })
  })

  it('still BLOCKS when the candidate declares NO facets', async () => {
    // A category without facets must behave exactly as before the exemption existed.
    expect(await post(null)).toMatchObject({ id: 'live-1' })
    expect(await post({})).toMatchObject({ id: 'live-1' })
  })

  it('still BLOCKS when the EXISTING row has no facets to compare', async () => {
    queryRaw.mockResolvedValue([existing({ attributes: null })])
    expect(await post({ visaEntryType: 'single', visaSpeed: '1H' })).toMatchObject({ id: 'live-1' })
  })

  it('does not let UNREADABLE attributes waive the guard', async () => {
    // Corrupt JSON must fail toward blocking, not toward allowing — otherwise writing junk
    // into the column becomes a bypass.
    queryRaw.mockResolvedValue([existing({ attributes: '{not json' })])
    expect(await post({ visaEntryType: 'single', visaSpeed: '1H' })).toMatchObject({ id: 'live-1' })
  })

  it('still BLOCKS when the candidate merely ADDS a key the live row lacks', async () => {
    // ⚠️ THE BYPASS THIS GUARD MOST NEEDS TO RESIST. The facet check short-circuits every other
    // signal, so anything that makes it true disables duplicate detection entirely for that row.
    // The first implementation counted "absent on the old listing" as different — meaning any
    // seller could append one junk attribute and repost forever. Only keys present on BOTH
    // sides count now.
    expect(await post({ visaEntryType: 'single', visaSpeed: '2D', colour: 'red' })).toMatchObject({ id: 'live-1' })
    expect(await post({ somethingInvented: 'x' })).toMatchObject({ id: 'live-1' })
  })

  it('ignores EXTRA facets on the existing row that the candidate omits', async () => {
    // A fuller old record is not evidence of a different product; only keys the candidate
    // actually declares are compared.
    queryRaw.mockResolvedValue([existing({ attributes: JSON.stringify({ visaEntryType: 'single', visaSpeed: '2D', provider: 'vietkite' }) })])
    expect(await post({ visaEntryType: 'single', visaSpeed: '2D' })).toMatchObject({ id: 'live-1' })
  })

  it('fails OPEN if the scan throws — a guard must never block a legitimate post', async () => {
    queryRaw.mockRejectedValue(new Error('db down'))
    expect(await post({ visaEntryType: 'single', visaSpeed: '1H' })).toBeNull()
  })
})

// ⚠️ THE SECOND EXEMPTION, AND IT IS BROADER THAN THE FIRST — a registry-backed business is
// judged by the EXACT-REPOST rule only (same category + same title + same price), with the text,
// title-similarity and image signals switched off entirely. These tests exist to pin both edges:
// the catalogue must get through, and the one duplicate a real business actually produces — the
// accidental double-submit — must still be caught. Note every case below reuses the SAME photos
// and a text score that would trip the full guard, because that is the point: for this seller
// those signals no longer have a vote.
describe('duplicate guard — verified catalogue sellers', () => {
  beforeEach(() => { catalogueSeller.mockResolvedValue(true) })

  it('ALLOWS a new catalogue row even at the text similarity that blocked it before', async () => {
    // The measured shape of the real report: near-identical wording (0.96–0.99 in production),
    // identical artwork, no facet difference to fall back on — and it must still post.
    queryRaw.mockResolvedValue([existing({ score: 0.99 })])
    expect(await post(null, { title: 'Vietnam E-Visa - Single Entry - 3 Business Days', price: 1_400_000 })).toBeNull()
  })

  it('ALLOWS a row whose title matches but whose price is genuinely different', async () => {
    // Same product name at a real price step is a re-priced variant, not a repost. 1,320,000 →
    // 1,600,000 is 17.5%, and the closest pair in the real catalogue is 11.6% apart, so this
    // sits comfortably outside the ±2% window without being an unrealistic gap.
    expect(await post(null, { title: existing().title, price: 1_600_000 })).toBeNull()
  })

  it('ALLOWS a row whose price matches but whose title does not', async () => {
    // "Single" → "Multiple Entry" scores 0.778, below the 0.85 bar — a real variant.
    expect(await post(null, { title: 'Vietnam E-Visa - Multiple Entry - 2 Business Days', price: 1_320_000 })).toBeNull()
  })

  it('still BLOCKS the accidental double-submit — same category, title and price', async () => {
    // ⚠️ THE HALF THAT KEEPS THIS FROM BEING A BLANKET WAIVER. Two taps on Publish is the one
    // duplicate a legitimate business really does create, and it is exactly what survives here.
    expect(await post(null, { title: existing().title, price: 1_320_000 })).toMatchObject({ id: 'live-1' })
  })

  // ⚠️ THE TWO BYPASSES BOTH EXTERNAL REVIEWERS FOUND, PINNED SO THEY CANNOT COME BACK. The
  // first version of this rule demanded an EXACT title-token match and an EXACT price, which a
  // determined bumper defeats trivially and repeatably — and an exempt seller has no other
  // signal left to catch them, so each of these was an unlimited repost channel.
  it('ALLOWS the additive variants a stricter title rule would have blocked', async () => {
    // ⛔ THIS IS THE TEST THAT PICKED THE RULE, AND IT ASSERTS LENIENCY ON PURPOSE. Two stricter
    // versions were written and reverted: a 0.85 Jaccard, then token containment. Containment did
    // catch the "append #2026 and repost" dodge — but reviewers produced the case that matters
    // more, and it is ordinary retail: a business listing "Airport Transfer" beside "Airport
    // Transfer SUV" at the same price. Containment blocks the second one, which is precisely the
    // false positive this whole exemption exists to remove. The owner's standing rule is that
    // launch gates stay lenient and false positives get fixed, so leniency won knowingly.
    // ⚠️ The consequence — an exempt seller CAN bump by appending a token — is the accepted
    // trade, bounded by the fact that exemption requires a hand-set partner flag or a live tax
    // registry match. If this ever flips, it is a policy decision, not a tidy-up.
    for (const title of [
      'Vietnam E-Visa - Single Entry - 2 Business Days #2026',
      'Vietnam E-Visa - Single Entry - 2 Business Days Express',
      'Vietnam E-Visa Single Entry',
    ]) {
      expect(await post(null, { title, price: 1_320_000 })).toBeNull()
    }
  })

  it('ALLOWS a one-word variant, which no threshold could separate from a repost anyway', async () => {
    // Kept explicit because it is the arithmetic that rules out ever "tightening" this: a
    // one-token substitution in an eight-token title scores 0.778 on Jaccard — and so does the
    // legitimate variant the exemption exists to unblock ("Single" vs "Multiple"). Identical
    // score, opposite intent, so the title alone cannot tell them apart. Both must post.
    expect(await post(null, { title: 'Vietnam E-Visa - Single Entry - 2 Business Day', price: 1_320_000 })).toBeNull()
    expect(await post(null, { title: 'Vietnam E-Visa - Multiple Entry - 2 Business Days', price: 1_320_000 })).toBeNull()
  })

  it('still BLOCKS a reordered title — same words, same price, same category', async () => {
    // Word ORDER is not a difference, so shuffling is not a new listing. This plus the price
    // window is what still catches the accidental double-submit.
    expect(await post(null, { title: 'Business Days 2 - Entry Single - Vietnam E-Visa', price: 1_320_000 })).toMatchObject({ id: 'live-1' })
  })

  it('still BLOCKS a repost that moves the price by a single dong', async () => {
    // Under the old exact-price rule, +1đ was a complete bypass of every remaining signal.
    expect(await post(null, { title: existing().title, price: 1_320_001 })).toMatchObject({ id: 'live-1' })
    expect(await post(null, { title: existing().title, price: 1_319_999 })).toMatchObject({ id: 'live-1' })
  })

  it('scopes the SQL window to the rule that judges it, not to text similarity', async () => {
    // ⚠️ PINS THE FIX FOR A HOLE A REVIEWER FOUND IN THE WINDOW, NOT IN THE RULE. The ordinary
    // path takes the top 25 rows BY TEXT SIMILARITY, which is meaningless to a rule keyed on
    // (category, title tokens, price) — so an exempt seller with >25 active rows could
    // re-submit the same title and price with an edited description, rank below the cut, and
    // post twice. Exempt sellers are precisely the ones with big catalogues, since the same
    // predicate also waives their listing cap. The relaxed path therefore filters in SQL.
    await post(null, { title: existing().title, price: 1_320_000 })
    const sql = queryRaw.mock.calls.at(-1)![0] as { strings: string[]; values: unknown[] }
    const text = sql.strings.join('?')
    expect(text).toContain('"categoryId"')
    expect(text).toContain('price BETWEEN')
    expect(text).not.toContain('LIMIT')
    expect(text).not.toContain('similarity(')
    expect(sql.values).toContain(CAT)
    // The band must be a strict SUPERSET of what `priceDelta` accepts: it normalises by the
    // LARGER price, so the upper edge is price/(1-p), which is wider than price*(1+p).
    const [lo, hi] = sql.values.filter((v): v is number => typeof v === 'number')
    expect(lo).toBeLessThanOrEqual(1_320_000 * 0.98)
    expect(hi).toBeGreaterThanOrEqual(Math.ceil(1_320_000 / 0.98))
  })

  it('applies the FULL guard when the exemption lookup throws', async () => {
    // ⚠️ THE SHIP-BLOCKER, AND IT IS ABOUT WHICH WAY EACH HALF FAILS. The seller lookup used to
    // sit inside the scan's fail-open try/catch, so one database error returned "no duplicate"
    // and disabled spam protection for EVERY seller while still answering 200. The scan fails
    // open; the exemption fails CLOSED. Same photos + same category here, so the ordinary image
    // signal must fire — proving the full guard ran rather than the relaxed one.
    catalogueSeller.mockRejectedValue(new Error('seller lookup down'))
    expect(await post(null, { title: 'Something Completely Different', price: 9_999_999 })).toMatchObject({ id: 'live-1' })
  })

  it('does not block across CATEGORIES even on an exact title and price match', async () => {
    queryRaw.mockResolvedValue([existing({ categoryId: 'cat-other' })])
    expect(await post(null, { title: existing().title, price: 1_320_000 })).toBeNull()
  })
})
