import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE BULK CORE SCREENS EVERY PRINTED FIELD, NOT ONLY THE TITLE AND DESCRIPTION (security review 2026-10-22, item 32).
 * The district is printed as the listing's location and the condition beside the price; the single create and edit
 * paths screen both as secondary fields (listings.ts), and this core — CSV upload, /api/v1/listings/bulk, the MCP bulk
 * tool, a partner sync's creates — did not, so a row could carry a phone or a Zalo handle in them. Pinned: a contact
 * detail or a banned word in either fails ON ITS ROW, before any work for it; the rows around it import.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({ creates: [] as Row[], dupChecks: [] as Row[] }))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    category: {
      findMany: async (a: Row) => [
        { id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
        { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
      ].filter((c) => (a.where.slug.in as string[]).includes(c.slug)),
    },
    listing: {
      findMany: async () => [],
      create: async (a: Row) => { h.creates.push(a.data); return { id: `new${h.creates.length}` } },
    },
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async (a: Row) => { h.dupChecks.push(a); return null } }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => new Response(new Uint8Array([1])) }))
vi.mock('@/lib/core/media', () => ({ storeListingImage: async () => 'https://cdn.eno.test/bulk/1.webp', IMG_MAX_BYTES: 1_000_000 }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0 }))

const { bulkImportCore } = await import('@/lib/core/bulk')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }
const CONTACT_REFUSAL = 'Remove phone / contact info / address from the title, description, district and condition'
const row = (over: Row = {}) => ({
  category_slug: 'electronics', title: 'iPhone 15 Pro 256GB', description: 'Pin 92%, máy đẹp, đủ hộp.', price: 18_000_000,
  // Electronics needs three angles; unhashed first-party URLs each count as one.
  image_urls: 'https://cdn.eno.test/a.jpg|https://cdn.eno.test/b.jpg|https://cdn.eno.test/c.jpg', district: 'Quận 1', condition: 'Like new', ...over,
})

beforeEach(() => {
  h.creates = []
  h.dupChecks = []
})

describe('bulkImportCore — the district and the condition are screened like the title', () => {
  it('⛔ a phone or a messenger handle in the district fails on its row, before any work; its neighbours import', async () => {
    const r = await bulkImportCore(SELLER, [
      row({ title: 'iPhone 15 Pro 256GB' }),
      row({ title: 'iPhone 14 128GB', district: 'Quận 3 — gọi 0901 234 567' }),
      row({ title: 'iPhone 13 mini', district: 'Bình Thạnh, zalo: shopdienthoai' }),
      row({ title: 'Galaxy S24' }),
    ])
    expect(r.results).toEqual([
      { row: 1, id: 'new1' },
      { row: 2, error: CONTACT_REFUSAL },
      { row: 3, error: CONTACT_REFUSAL },
      { row: 4, id: 'new2' },
    ])
    expect(h.dupChecks.map((d) => d.title)).toEqual(['iPhone 15 Pro 256GB', 'Galaxy S24'])
  })

  it('⛔ an email or a link in the condition fails too', async () => {
    const r = await bulkImportCore(SELLER, [
      row({ condition: 'Like new — shop@example.com' }),
      row({ title: 'iPad Air', condition: 'Mới 99% xem thêm https://example.com/ipad' }),
    ])
    expect(r.results).toEqual([{ row: 1, error: CONTACT_REFUSAL }, { row: 2, error: CONTACT_REFUSAL }])
    expect(h.creates).toEqual([])
  })

  it('⛔ a banned word in the condition fails as a banned word', async () => {
    const r = await bulkImportCore(SELLER, [row({ condition: 'kèm ma túy' })])
    expect(r.results).toHaveLength(1)
    expect(r.results[0].error).toMatch(/^Contains a banned word/)
    expect(h.creates).toEqual([])
  })

  it('ordinary districts and conditions import, and are stored as written', async () => {
    const r = await bulkImportCore(SELLER, [row({ district: 'Thủ Đức', condition: 'Used — good' })])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
    expect(h.creates[0]).toMatchObject({ district: 'Thủ Đức', location: 'Thủ Đức', condition: 'Used — good' })
  })
})

describe('⛔ bulkImportCore — a licence-aisle service is refused (security review 2026-10-22, item 8)', () => {
  // This core creates rows live and never runs the licence check, so a Services row TITLED as an e-Visa or permit service
  // published unchecked. The single path re-files and holds such a post; a bulk row cannot carry the licence values.
  const service = (title: string) => ({ category_slug: 'services', title, description: 'Fast and friendly.', price: 1_500_000, image_urls: 'https://cdn.eno.test/s.jpg' })
  const REFUSAL = 'e-Visa and legal or permit services are posted one at a time, so eno can check the provider’s licence before they go live'

  it('an e-Visa or work-permit title is refused on its row; an ordinary service imports', async () => {
    const r = await bulkImportCore(SELLER, [service('Vietnam e-Visa 90 days, fast processing'), service('Work permit renewal for teachers'), service('Home cleaning, two cleaners')])
    expect(r.results).toEqual([{ row: 1, error: REFUSAL }, { row: 2, error: REFUSAL }, { row: 3, id: 'new1' }])
    expect(h.creates.map((c) => c.title)).toEqual(['Home cleaning, two cleaners'])
  })

  it('the aisle words in a DESCRIPTION do not refuse a cleaning service (title only, as on the single path)', async () => {
    const r = await bulkImportCore(SELLER, [{ ...service('Office cleaning'), description: 'We clean offices; we do not handle work permit paperwork.' }])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
  })
})
