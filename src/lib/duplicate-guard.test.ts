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
// with a changed photo. Measured against the real rows, no pair trips the title or text
// signals — so it was the IMAGE signal, whose bar is only "2 photos in common and a bare
// majority". Swapping one image cannot clear that.

const queryRaw = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({ db: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))
// The real dHash comparison needs hashes embedded in URLs; force "the photos match" so every
// test below is exercising the FACET decision rather than image parsing.
vi.mock('./image-hash', () => ({ isImageRepost: () => true }))

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
