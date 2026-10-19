import { describe, expect, it } from 'vitest'
import { LISTING_CARD_SELECT, serializeListingCard } from './serialize'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'

/**
 * THE CARD'S "IDENTITY VERIFIED" — A BOOLEAN, ON A TEACHER CARD HOLDING TODAY'S VALUE ONLY (owner, 2026-10-15; AUTOMATIC
 * since 2026-10-16). The card reads the display cache (Listing.identityMarkNotice — the IDENTITY_MARK_NOTICE_VERSION, the
 * rule's version, src/lib/teachers/identity-mark-card.ts last computed the mark SHOWN under) and ships `identityMark: true`
 * or nothing: never `false`, never the version, never a reason. A bump takes every older value off at once — the opt-in's
 * '2026-10-16' among them, until the card pass re-derives it; another listing type never carries it, whatever the column
 * says.
 */
const row = (patch: Record<string, unknown> = {}) => serializeListingCard({
  sellerId: 's-1', id: 'L1', title: 'Anna Eriksson', titleVi: null, price: 35_000_000, priceUnit: 'VND/month',
  currency: 'VND', negotiable: false, location: 'Thủ Đức, Hồ Chí Minh', district: null, city: 'Hồ Chí Minh', previousPrice: null,
  priceDropAt: null, urgentUntil: null, lat: null, lng: null, images: '[]', video: null, brandSlug: null, model: null,
  condition: null, marketPosition: null, verified: true, postedAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'), savedCount: 0, contactCount: 0, affiliateUrl: null, listingType: 'teacher',
  attributes: null, identityMarkNotice: IDENTITY_MARK_NOTICE_VERSION,
  category: { id: 'c', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'GraduationCap', color: 'violet' },
  seller: { trustScore: 60, officialPartner: false, ownerId: 'owner-1', owner: { accountType: 'individual' } },
  ...patch,
} as Parameters<typeof serializeListingCard>[0])

describe('serializeListingCard — identityMark', () => {
  it('the card select reads the cache (and only for this — see the next tests)', () => {
    expect(LISTING_CARD_SELECT.identityMarkNotice).toBe(true)
  })

  it('a teacher card holding TODAY\'s value: identityMark === true', () => {
    expect(row().identityMark).toBe(true)
  })

  it('an older value — the opt-in\'s \'2026-10-16\' included — NULL or a row without the column: no key at all — never false', () => {
    expect(IDENTITY_MARK_NOTICE_VERSION).not.toBe('2026-10-16') // the automatic rule's own value, distinct from the opt-in's
    for (const identityMarkNotice of ['2026-10-16', '2026-01-01', null, undefined, '', 'true']) {
      const card = row({ identityMarkNotice })
      expect(card, String(identityMarkNotice)).not.toHaveProperty('identityMark')
    }
  })

  it('⛔ any other listing type never carries it, even with today\'s version in the column', () => {
    for (const listingType of ['sell', 'rent', 'job', 'service', 'wanted', undefined]) {
      const card = row({ listingType, category: { id: 'c', name: 'X', nameVi: 'X', slug: 'electronics', icon: 'x', color: 'sky' } })
      expect(card, String(listingType)).not.toHaveProperty('identityMark')
    }
  })

  it('⛔ only the boolean leaves: the JSON names neither the column nor the version', () => {
    for (const card of [row(), row({ identityMarkNotice: '2026-01-01' }), row({ listingType: 'sell' })]) {
      const json = JSON.stringify(card)
      expect(json).not.toContain('identityMarkNotice')
      expect(json).not.toContain(IDENTITY_MARK_NOTICE_VERSION)
      expect(json).not.toContain('2026-01-01')
      expect(json).not.toMatch(/reason|stamps|withdrawn/i)
    }
  })

  it('⚖️ the name the tick vouches for is the row\'s own title, as stored — the card gets nothing else to print', () => {
    const card = row({ title: 'Nguyễn Thị Minh Khai', titleVi: 'Khai (bản dịch máy)' })
    expect(card.title).toBe('Nguyễn Thị Minh Khai')
    expect(card.identityMark).toBe(true)
  })
})

// GoPlus partnership (2026-10-19): the card carries ONE boolean for "this partner answers availability in its own chat"
// (rental-check/shared.ts isChatOnlyPartner) — never the ownerId it is derived from.
describe('serializeListingCard — seller.chatOnlyPartner', () => {
  const seller = (officialPartner: boolean, ownerId: string | null) => ({ trustScore: 60, officialPartner, ownerId, owner: ownerId ? { accountType: 'business' } : null })
  it('true only for an official partner with an owner, on a row that does not link out', () => {
    expect(row({ seller: seller(true, 'owner-1') }).seller.chatOnlyPartner).toBe(true)
    expect(row({ seller: seller(true, null) }).seller.chatOnlyPartner).toBe(false)
    expect(row({ seller: seller(false, 'owner-1') }).seller.chatOnlyPartner).toBe(false)
    expect(row({ seller: seller(true, 'owner-1'), affiliateUrl: 'https://partner.example/x' }).seller.chatOnlyPartner).toBe(false)
  })
  it('never ships the owner id', () => {
    expect(JSON.stringify(row({ seller: seller(true, 'owner-1') }))).not.toContain('owner-1')
  })
})
