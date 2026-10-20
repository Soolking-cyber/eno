import { describe, expect, it, vi } from 'vitest'
import { mapStagedJob, type StagedJob } from '@/lib/job-listing'

/**
 * The listing page's `robots` (generateMetadata) — teacher visibility plan item 18, owner decision 10 (applied 2026-10-20):
 * a LINKED job, an imported posting whose Apply button opens the original (job-listing.ts isLinkedJobReference), is live
 * but `noindex, follow`, beside the imported vehicle hire it follows (rental-places.ts isVehicleHireReference). An
 * employer's own job, and every other live listing, still carries no robots tag — it is indexed.
 */
const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('./get-listing', () => ({
  getListing: async () => row.current,
  isListingViewable: async () => true,
  listingIsViewable: () => true,
}))
const { generateMetadata } = await import('./page')

const NOINDEX = { index: false, follow: true }

// A TEAST posting as the lead pipeline stages it, mapped by the importer's own code — the row is what
// scripts/import-jobs.ts stores (mutableOf: listingType 'job', the mapped link, place, pay and attributes).
const NOW = Date.parse('2026-10-19T05:00:00Z')
const staged: StagedJob = {
  key: 'k1', url: 'https://teast.co/job/power-english-esl-7f3a?utm_source=x', source: 'teast',
  title: 'ESL Teacher', employer: 'Power English', city: 'Ho Chi Minh City', salary: '40,000,000 VND / month', employment: 'PART_TIME',
  datePosted: '2026-10-07T02:00:00.000Z', applyBy: '2026-10-21', category: 'teaching', coverPath: 'covers/k1.png',
}
const mapped = mapStagedJob(staged, NOW)
if (!mapped.ok) throw new Error(`fixture refused by mapStagedJob: ${mapped.reason}`)
const j = mapped.job
const linkedJob = {
  id: 'L1', title: j.title, titleVi: null, description: j.description, descriptionVi: j.descriptionVi, verified: true, status: 'active',
  price: j.price, priceUnit: j.priceUnit, currency: '₫', salaryM: j.salaryM, listingType: 'job', subcategorySlug: j.subcategorySlug,
  affiliateUrl: j.affiliateUrl, city: j.city, location: j.location, attributes: JSON.stringify(j.attributes), images: '["https://sb.eno.vn/x.webp"]',
  category: { name: 'Jobs', slug: j.categorySlug },
}
const robotsOf = async (over: Record<string, unknown> = {}, lang = 'en') => {
  row.current = { ...linkedJob, ...over }
  return (await generateMetadata({ params: Promise.resolve({ id: 'L1', lang }) } as never)).robots
}

describe('the listing page\'s robots', () => {
  it('⛔ a LINKED job — the importer\'s own row — is noindex, follow on both language variants, with no unavailable_after', async () => {
    expect(linkedJob.affiliateUrl).toBe('https://teast.co/job/power-english-esl-7f3a')
    expect(JSON.parse(linkedJob.attributes).applyBy).toBe('2026-10-21') // the date the retired `unavailable_after` carried
    expect(await robotsOf({}, 'en')).toEqual(NOINDEX)
    expect(await robotsOf({}, 'vi')).toEqual(NOINDEX)
    expect(await robotsOf({ subcategorySlug: 'job-other' })).toEqual(NOINDEX)
    // The STORED link decides, as the sitemap's rule does: a link the page will not trust is still a copied posting.
    expect(await robotsOf({ affiliateUrl: 'http://teast.co/job/power-english-esl-7f3a' })).toEqual(NOINDEX)
  })

  it('an employer\'s OWN job post keeps no robots tag — it is indexed', async () => {
    expect(await robotsOf({ affiliateUrl: null })).toBeUndefined()
    expect(await robotsOf({ affiliateUrl: null }, 'vi')).toBeUndefined()
    expect(await robotsOf({ affiliateUrl: null, subcategorySlug: 'hospitality', attributes: '{}' })).toBeUndefined()
  })

  it('a link-out row that is not a JOB is not a linked job: a Wanted ad, an imported home and a shop item keep their indexing', async () => {
    expect(await robotsOf({ listingType: 'wanted' })).toBeUndefined()
    const home = { listingType: 'rent', category: { name: 'Rentals', slug: 'rentals' }, subcategorySlug: 'apartment-rental', attributes: '{}', priceUnit: 'VND/month' }
    expect(await robotsOf({ ...home, affiliateUrl: 'https://rever.vn/x' })).toBeUndefined()
    expect(await robotsOf({ listingType: 'sell', category: { name: 'Electronics', slug: 'electronics' }, subcategorySlug: null, attributes: '{}', priceUnit: 'VND', affiliateUrl: 'https://tiki.vn/x' })).toBeUndefined()
  })

  it('⛔ the vehicle-hire precedent is unchanged: an imported car is noindex, a car a person posts is not', async () => {
    const car = { listingType: 'rent', category: { name: 'Rentals', slug: 'rentals' }, subcategorySlug: 'car-rental', attributes: '{}', priceUnit: 'VND/day' }
    expect(await robotsOf({ ...car, affiliateUrl: 'https://www.mioto.vn/car/vinfast-vf5-2026/KJJRTU' })).toEqual(NOINDEX)
    expect(await robotsOf({ ...car, affiliateUrl: null })).toBeUndefined()
  })

  it('a sold linked job is noindex too — the sold page answers first, as for every listing', async () => {
    expect(await robotsOf({ status: 'sold' })).toEqual(NOINDEX)
  })
})
