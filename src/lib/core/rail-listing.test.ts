import { describe, expect, it } from 'vitest'
import type { SerializedListing } from '@/lib/types'
import { railListing } from './rail-listing'

/**
 * Speed plan R20 (2026-11-10): a home rail ships its rows without the two description columns and NOTHING else changes —
 * the no-visible-change variant (rail-listing.ts). Which fields a rail card reads is pinned in
 * components/marketplace/home-rails.card-reads.test.tsx.
 */
const full = {
  id: 'l1',
  title: 'Căn hộ 2PN Thảo Điền',
  titleVi: null,
  description: 'A long English description '.repeat(20),
  descriptionVi: 'Mô tả dài bằng tiếng Việt '.repeat(20),
  price: 15_000_000,
  attributes: { bedrooms: 2 },
  seller: { id: 's1', name: 'Shop', trustScore: 120, isBusiness: true, officialPartner: true, unrated: false },
  category: { id: 'c1', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: 'home', color: 'blue' },
} as unknown as SerializedListing

describe('railListing', () => {
  it('drops description and descriptionVi', () => {
    const out = railListing(full)
    expect(out).not.toHaveProperty('description')
    expect(out).not.toHaveProperty('descriptionVi')
  })

  it('keeps every other field exactly, and leaves the serialized row untouched', () => {
    const { description: _d, descriptionVi: _dv, ...rest } = full
    expect(railListing(full)).toEqual(rest)
    expect(full.description).toMatch(/^A long English description/)
    expect(full.descriptionVi).toMatch(/^Mô tả dài/)
  })

  it('a null descriptionVi goes too: the key itself leaves the wire', () => {
    expect(Object.keys(railListing({ ...full, descriptionVi: null }))).not.toContain('descriptionVi')
  })
})
