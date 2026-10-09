import { describe, expect, it, vi } from 'vitest'

/**
 * SEO wave B, V2b (copy sheet CS-3 V2b-1…5, approved by the owner 2026-10-01): the listing page's
 * <title> and share titles follow the `[lang]` variant — `titleVi` when the row has one, the price in
 * Vietnamese grouping, "Đã bán" on a sold page — while the English variant is unchanged.
 */
const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('./get-listing', () => ({
  getListing: async () => row.current,
  isListingViewable: async () => true,
  listingIsViewable: () => true,
}))
const { generateMetadata } = await import('./page')

const base = {
  id: 'L1', title: 'Sofa 3 seats', titleVi: 'Ghế sofa 3 chỗ', verified: true, status: 'active', price: 12_000_000, currency: '₫',
  images: '[]', description: '', location: 'District 1', listingType: 'item', attributes: '{}', priceUnit: null,
  affiliateUrl: null, subcategorySlug: null, category: { name: 'Furniture', slug: 'furniture-appliances' },
}
const meta = async (lang: string, over: Record<string, unknown> = {}) => {
  row.current = { ...base, ...over }
  return generateMetadata({ params: Promise.resolve({ id: 'L1', lang }) } as never)
}

describe('listing <title> by variant (V2b)', () => {
  it('vi: titleVi and the Vietnamese price, in <title>, og:title and twitter:title', async () => {
    const m = await meta('vi')
    expect(m.title).toMatch(/^Ghế sofa 3 chỗ — 12\.000\.000 đ \| /)
    expect((m.openGraph as { title: string }).title).toBe('Ghế sofa 3 chỗ — 12.000.000 đ')
    expect((m.twitter as { title: string }).title).toBe('Ghế sofa 3 chỗ — 12.000.000 đ')
  })

  it('en: unchanged — the source title and the English price', async () => {
    const m = await meta('en')
    expect(m.title).toMatch(/^Sofa 3 seats — 12,000,000 đ \| /)
    expect((m.openGraph as { title: string }).title).toBe('Sofa 3 seats — 12,000,000 đ')
  })

  it('vi without titleVi (null or empty) keeps the source title', async () => {
    expect((await meta('vi', { titleVi: null })).title).toMatch(/^Sofa 3 seats — 12\.000\.000 đ \| /)
    expect((await meta('vi', { titleVi: '' })).title).toMatch(/^Sofa 3 seats — /)
  })

  it('sold: "Đã bán" on vi, "Sold" on en', async () => {
    expect((await meta('vi', { status: 'sold' })).title).toMatch(/^Ghế sofa 3 chỗ — Đã bán \| /)
    expect((await meta('en', { status: 'sold' })).title).toMatch(/^Sofa 3 seats — Sold \| /)
  })

  it('og:description leads with the same price format as og:title when the seller wrote a body (review)', async () => {
    expect((await meta('vi', { description: 'Good condition' })).openGraph).toMatchObject({ description: '12.000.000 đ · Good condition' })
    expect((await meta('en', { description: 'Good condition' })).openGraph).toMatchObject({ description: '12,000,000 đ · Good condition' })
  })

  it('no price: just the title', async () => {
    expect((await meta('vi', { price: 0 })).title).toMatch(/^Ghế sofa 3 chỗ \| /)
  })

  it('the description keeps the source title, and names this site, not "eno.vn" (claim 8)', async () => {
    const m = await meta('vi')
    expect(m.description).toMatch(/^Sofa 3 seats — 12,000,000 đ, Furniture in District 1 on eno\.(forum|vn)$/)
    expect(m.description).toMatch(/on eno\.forum$/) // the suite runs as the services edition (vitest.config.ts)
  })
})

// ⛔ A TEACHER ABROAD IS NOT "IN VIETNAM" (teacher onboarding redesign, 2026-10-08): their row has no city (projection.ts
// teacherHome writes ''), and the title says only what is true — as the profile's JSON-LD now does.
describe('a teacher profile\'s <title>', () => {
  const teacher = { title: 'Jane Doe', titleVi: null, listingType: 'teacher', price: 0, category: { name: 'Teachers', slug: 'teachers' } }
  it('a teacher living in Vietnam: "Teacher in Vietnam" — no price ever', async () => {
    expect((await meta('en', { ...teacher, city: 'Hồ Chí Minh' })).title).toMatch(/^Jane Doe — Teacher in Vietnam \| /)
    expect((await meta('vi', { ...teacher, city: 'Gia Lai' })).title).toMatch(/^Jane Doe — Giáo viên tại Việt Nam \| /)
  })
  it('a teacher abroad (city \'\'): "Teacher", never "in Vietnam"', async () => {
    expect((await meta('en', { ...teacher, city: '', location: 'Not in Vietnam yet · Online' })).title).toMatch(/^Jane Doe — Teacher \| /)
    expect((await meta('vi', { ...teacher, city: '' })).title).toMatch(/^Jane Doe — Giáo viên \| /)
  })
})
