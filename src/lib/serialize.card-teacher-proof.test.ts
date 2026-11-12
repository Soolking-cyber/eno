import { describe, expect, it } from 'vitest'
import { LISTING_CARD_SELECT, serializeListingCard } from './serialize'

/**
 * THE TEACHER CARD'S PROOF FACTS (owner, 2026-11-12, "build 2") — the card select reads Listing.facetTokens, and
 * serializeListingCard ships `teacherProof`: at most two facet slugs, best first (src/lib/teachers/card-proof.ts), on a
 * TEACHER card only — or no key at all. ⛔ The tokens never leave whole: the column also holds where the teacher will teach
 * (`workIn`) and cover (`coverArea`), and an importer's amenities on other rows.
 */
const TOKENS = '|cover:open|coverSlot:mon-am|coverArea:quan-binh-tan|workIn:quan-go-vap|workIn:online|inVietnam:yes|native:native|experience:5-10-years|cert:tefl|cert:celta|degree:master|subject:ielts|jobType:fulltime|'

const row = (patch: Record<string, unknown> = {}) => serializeListingCard({
  sellerId: 's-1', id: 'L1', title: 'Anna Eriksson', titleVi: null, price: 35_000_000, priceUnit: 'VND/month',
  currency: 'VND', negotiable: false, location: 'Thủ Đức, Hồ Chí Minh', district: 'Thủ Đức', city: 'Hồ Chí Minh', previousPrice: null,
  priceDropAt: null, urgentUntil: null, lat: null, lng: null, images: '[]', video: null, brandSlug: null, model: null,
  condition: null, marketPosition: null, verified: true, postedAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'), savedCount: 0, contactCount: 0, affiliateUrl: null, listingType: 'teacher',
  attributes: null, identityMarkNotice: null, facetTokens: TOKENS,
  category: { id: 'c', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'GraduationCap', color: 'violet' },
  seller: { trustScore: 60, officialPartner: false, ownerId: 'owner-1', owner: { accountType: 'individual' } },
  ...patch,
} as Parameters<typeof serializeListingCard>[0])

describe('serializeListingCard — teacherProof', () => {
  it('the card select reads the tokens (and only for this — see the next tests)', () => {
    expect(LISTING_CARD_SELECT.facetTokens).toBe(true)
  })

  it('a teacher row with tokens: the two strongest facts, best first', () => {
    expect(row().teacherProof).toEqual(['celta', '5-10-years'])
    expect(row({ facetTokens: '|degree:phd|experience:over-10-years|' }).teacherProof).toEqual(['over-10-years', 'phd'])
  })

  it('no key — never an empty array — for only not-proof tokens, NULL, \'\', or a row without the column', () => {
    const cases: Record<string, unknown>[] = [
      { facetTokens: '|experience:under-1-year|cert:other-cert|degree:associate|workIn:online|' },
      { facetTokens: '|degree:no-degree|' },
      { facetTokens: null },
      { facetTokens: '' },
      { facetTokens: undefined },
    ]
    for (const patch of cases) expect(row(patch), JSON.stringify(patch)).not.toHaveProperty('teacherProof')
  })

  it('⛔ any other listing type never carries it, even with cert:/experience:/degree: tokens in the column', () => {
    for (const listingType of ['sell', 'rent', 'job', 'service', 'wanted', 'wholesale', undefined]) {
      const card = row({ listingType, category: { id: 'c', name: 'X', nameVi: 'X', slug: 'electronics', icon: 'x', color: 'sky' } })
      expect(card, String(listingType)).not.toHaveProperty('teacherProof')
    }
  })

  it('⛔ only the slugs leave: the JSON names neither the column nor any other token — where the teacher teaches or covers', () => {
    for (const card of [row(), row({ listingType: 'rent', facetTokens: '|amenity:pool|workIn:quan-go-vap|' })]) {
      const json = JSON.stringify(card)
      for (const s of ['facetTokens', 'workIn', 'coverArea', 'coverSlot', 'quan-go-vap', 'quan-binh-tan', 'mon-am', 'cover:', 'ielts', 'fulltime', 'amenity', 'pool', '|']) {
        expect(json, s).not.toContain(s)
      }
    }
    // And the slugs that do leave are exactly the two facts — no degree beyond them, no third certificate.
    expect(JSON.stringify(row())).toContain('"teacherProof":["celta","5-10-years"]')
    expect(JSON.stringify(row())).not.toContain('master')
    expect(JSON.stringify(row())).not.toContain('tefl')
  })
})
