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
// A teacher listing's profile row (src/lib/teachers/page-row.ts — the ONE row the view renders, cache()d): what the
// <title> line and the search verdict read. `reads` pins that only a teacher listing reads it.
const teacher = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, reads: [] as string[] }))
vi.mock('@/lib/teachers/page-row', () => ({ getTeacherPageRow: async (id: string) => { teacher.reads.push(id); return teacher.row } }))
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

/**
 * ⛔ A TEACHER PROFILE'S <title> (SEO plan P1 item 14, owner 2026-10-20): "<Name> — <subjects> teacher, <City> | site",
 * from the PROFILE ROW the page renders (src/lib/teachers/search-title.ts) — the h1's name, what they teach, the city they
 * live in; a missing field left out. ⛔ A teacher abroad is never placed in Vietnam (the 2026-10-08 rule), and no price
 * ever rides on the title or the share card.
 */
const T_LISTING = { title: 'Jane Doe', titleVi: null, listingType: 'teacher', price: 0, category: { name: 'Teachers', slug: 'teachers' } }
const T_ROW = {
  fullName: 'Jane Doe', bio: Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '), videoUrl: null, videoOnRequest: false, hideFromSearch: false,
  subjects: ['general-english', 'ielts'], teachLanguages: [],
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null, teachAreas: ['online', 'd7'],
}
const tmeta = async (lang: string, over: Record<string, unknown> = {}, listing: Record<string, unknown> = {}) => {
  teacher.row = { ...T_ROW, ...over }
  return meta(lang, { ...T_LISTING, city: 'Hồ Chí Minh', ...listing })
}
describe('a teacher profile\'s <title>', () => {
  it('"<Name> — IELTS & English teacher, Ho Chi Minh City" — and in Vietnamese — no price ever', async () => {
    expect((await tmeta('en')).title).toMatch(/^Jane Doe — IELTS & English teacher, Ho Chi Minh City \| eno\.(forum|vn)$/)
    expect((await tmeta('vi')).title).toMatch(/^Jane Doe — Giáo viên IELTS và tiếng Anh tại TP\. Hồ Chí Minh \| /)
  })
  it('the name is the h1\'s — the profile\'s fullName', async () => {
    expect((await tmeta('en', { fullName: 'Jane A. Doe' })).title).toMatch(/^Jane A\. Doe — /)
  })
  it('⛔ a teacher whose card states a salary or a rate: the link preview never carries it (2026-10-11 — shares)', async () => {
    const m = await tmeta('vi', {}, { price: 40_000_000, priceUnit: 'VND/month', currency: '₫', description: 'I love phonics.' })
    const og = m.openGraph as { title?: string; description?: string }
    expect(og.title).toBe('Jane Doe')
    expect(og.description).not.toMatch(/40[.,]000[.,]000/)
    expect(String(m.description)).not.toMatch(/40[.,]000[.,]000/)
    expect(String(m.title)).not.toMatch(/40[.,]000[.,]000|₫|(?<!\p{L})đ(?!\p{L})/u)
  })
  it('⛔ a teacher abroad: no place, never "in Vietnam" — and a profile with no subject reads "Teacher"', async () => {
    const abroad = { livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['online'] }
    expect((await tmeta('en', abroad, { city: '', location: 'Not in Vietnam yet · Online' })).title).toMatch(/^Jane Doe — IELTS & English teacher \| /)
    expect((await tmeta('vi', { ...abroad, subjects: [] }, { city: '' })).title).toMatch(/^Jane Doe — Giáo viên \| /)
    expect((await tmeta('en', { ...abroad, subjects: [] }, { city: '' })).title).not.toMatch(/Vietnam/)
  })
  it('a broken row (no profile): the listing\'s title and "Teacher" — and it is left out of search', async () => {
    teacher.row = null
    const m = await meta('en', { ...T_LISTING, city: 'Hồ Chí Minh' })
    expect(m.title).toMatch(/^Jane Doe — Teacher \| /)
    expect(m.robots).toEqual({ index: false, follow: true })
  })
})

/**
 * ⛔ THE SEARCH VERDICT ON THE ROBOTS TAG (owner decisions 7 and 14, 2026-10-20 — src/lib/teachers/search-floor.ts):
 * `noindex, follow` under the floor (About under 30 words and no intro video), for a masked name, or once the teacher hid
 * the profile from search engines; the default otherwise. Only a teacher listing reads a profile row.
 */
describe('a teacher profile\'s robots tag', () => {
  it('30 words of About: indexable (no robots override)', async () => {
    expect((await tmeta('en')).robots).toBeUndefined()
  })
  it('29 words and no video: noindex, follow', async () => {
    expect((await tmeta('en', { bio: Array.from({ length: 29 }, () => 'w').join(' ') })).robots).toEqual({ index: false, follow: true })
  })
  it('an intro video the page plays lifts it — the profile\'s or the listing\'s; a private one does not', async () => {
    expect((await tmeta('en', { bio: '', videoUrl: 'https://x/v.mp4' })).robots).toBeUndefined()
    expect((await tmeta('en', { bio: '' }, { video: 'https://x/l.mp4' })).robots).toBeUndefined()
    expect((await tmeta('en', { bio: '', videoUrl: 'https://x/v.mp4', videoOnRequest: true })).robots).toEqual({ index: false, follow: true })
  })
  it('⛔ a masked name, or the teacher\'s own switch: noindex, follow — whatever else the profile holds', async () => {
    expect((await tmeta('en', { fullName: 'nn***', videoUrl: 'https://x/v.mp4' })).robots).toEqual({ index: false, follow: true })
    expect((await tmeta('vi', { hideFromSearch: true, videoUrl: 'https://x/v.mp4' })).robots).toEqual({ index: false, follow: true })
  })
  it('a listing that is not a teacher never reads a profile row, and keeps its own rule', async () => {
    teacher.reads = []
    expect((await meta('en')).robots).toBeUndefined()
    expect(teacher.reads).toEqual([])
    await tmeta('en')
    expect(teacher.reads).toEqual(['L1'])
  })
})
