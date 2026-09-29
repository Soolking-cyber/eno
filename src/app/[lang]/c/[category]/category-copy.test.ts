import { describe, expect, it } from 'vitest'
import {
  RENTALS_H1,
  districtMetadata,
  formatCountFull,
  joinList,
  linkedTier,
  pageLang,
  rentalKinds,
  rentalsHeadline,
  rentalsMetadata,
  type PageLang,
  type RentalsFacts,
  type RentalsHeadline,
} from './category-copy'

/**
 * ⛔ EVERY CLAIM IS GATED ON A COUNT. These pin the gates rather than the prose: "Ho Chi Minh City"
 * only while every rental is there, "linked" in the tier the affiliate count supports, no "Trusted"
 * anywhere over linked stock, and the old generic wording when the stock stops supporting the new.
 *
 * The facts below are the shape measured on 2026-09-27 (25,502 rentals, all HCMC, 14,043 / 5,331 /
 * 3,289 / 2,270 by kind) — as inputs, never as copy: the page counts them at render.
 */
const top = [
  { slug: 'd2', label: { en: 'District 2 (Thu Duc)', vi: 'Quận 2 (Thủ Đức)' }, count: 3741 },
  { slug: 'd7', label: { en: 'District 7 (Phu My Hung)', vi: 'Quận 7 (Phú Mỹ Hưng)' }, count: 2655 },
  { slug: 'binh-thanh', label: { en: 'Binh Thanh District', vi: 'Bình Thạnh' }, count: 2476 },
  { slug: 'tan-binh', label: { en: 'Tan Binh District', vi: 'Tân Bình' }, count: 1893 },
]
const LIVE: RentalsFacts = {
  total: 25502,
  allHcmc: true,
  linked: 'all',
  kinds: rentalKinds({ 'apartment-rental': 14043, 'house-rental': 5331, 'room-rental': 3289, 'office-rental': 2270, 'hotel-short-stay': 0 }),
  top,
}
/** The page passes the cached variant; over one set of facts that is the variant those facts give. */
const meta = (f: RentalsFacts, lang: PageLang, site: string) => rentalsMetadata(f, lang, site, rentalsHeadline(f))

describe('linkedTier', () => {
  it('reads all / most / some / none off the two counts', () => {
    expect(linkedTier(25502, 25502)).toBe('all')
    expect(linkedTier(15000, 25502)).toBe('most')
    expect(linkedTier(12751, 25502)).toBe('some') // exactly half is not "most"
    expect(linkedTier(1, 25502)).toBe('some')
    expect(linkedTier(0, 25502)).toBe('none')
    expect(linkedTier(0, 0)).toBe('none')
  })

  /** Two queries, not one snapshot: an import between them must not demote "all" to "most". */
  it('treats a linked count above the total as all', () => {
    expect(linkedTier(25503, 25502)).toBe('all')
  })
})

describe('rentals headline — the HCMC wording only while the stock supports it', () => {
  it('targets "apartments & houses for rent in Ho Chi Minh City" when every rental is there', () => {
    expect(rentalsHeadline(LIVE)).toBe('apartments-houses-hcmc')
    expect(RENTALS_H1['apartments-houses-hcmc'].en).toBe('Apartments & houses for rent in Ho Chi Minh City')
  })

  it('drops the kinds it has no stock for', () => {
    expect(rentalsHeadline({ allHcmc: true, kinds: rentalKinds({ 'apartment-rental': 3 }) })).toBe('apartments-hcmc')
    expect(rentalsHeadline({ allHcmc: true, kinds: rentalKinds({ 'room-rental': 3 }) })).toBe('rentals-hcmc')
  })

  it('falls back to the old "Rentals in Vietnam" the moment one rental is elsewhere', () => {
    expect(rentalsHeadline({ ...LIVE, allHcmc: false })).toBe('rentals-vietnam')
    expect(RENTALS_H1['rentals-vietnam']).toEqual({ en: 'Rentals in Vietnam', vi: 'Cho thuê tại Việt Nam' })
  })
})

describe('rentalsMetadata', () => {
  it('English: keyword title, live counts by kind, and what linked means', () => {
    const m = meta(LIVE, 'en', 'eno.vn')
    expect(m.title).toBe('Apartments & Houses for Rent in Ho Chi Minh City | eno.vn')
    expect(m.description).toBe(
      '25,502 places for rent in Ho Chi Minh City, including 14,043 apartments, 5,331 houses, 3,289 rooms and 2,270 offices. ' +
        'Every listing links to its original on a partner property portal.',
    )
  })

  it('Vietnamese: its own sentence, dot-grouped numbers, Vietnamese place names', () => {
    const m = meta(LIVE, 'vi', 'eno.vn')
    // "căn hộ, nhà ở" parsed as "apartments, housing" (nhà ở = dwelling); "và nhà tại" cannot.
    expect(m.title).toBe('Cho thuê căn hộ và nhà tại TP. Hồ Chí Minh | eno.vn')
    expect(m.description).toBe(
      '25.502 tin cho thuê tại TP. Hồ Chí Minh, gồm 14.043 căn hộ, 5.331 nhà, 3.289 phòng trọ và 2.270 mặt bằng. ' +
        'Mỗi tin đều dẫn tới tin gốc trên trang bất động sản đối tác.',
    )
  })

  it('says "most" / "some" / nothing as the linked count falls', () => {
    expect(meta({ ...LIVE, linked: 'most' }, 'en', 'x').description).toMatch(/Most listings link to their original/)
    expect(meta({ ...LIVE, linked: 'some' }, 'en', 'x').description).toMatch(/Some listings link to their original/)
    expect(meta({ ...LIVE, linked: 'none' }, 'en', 'x').description).not.toMatch(/partner/)
  })

  it('never says Ho Chi Minh City, and never "Trusted", once the stock leaves HCMC', () => {
    const m = meta({ ...LIVE, allHcmc: false }, 'en', 'eno.vn')
    expect(m.title).toBe('Rentals in Vietnam | eno.vn')
    expect(m.description).toMatch(/^25,502 places for rent in Vietnam,/)
    expect(`${m.title} ${m.description}`).not.toMatch(/Ho Chi Minh|Trusted/)
  })

  it('never makes a trust claim over this stock, in either language', () => {
    for (const lang of ['en', 'vi'] as const) {
      const m = meta(LIVE, lang, 'eno.vn')
      expect(`${m.title} ${m.description}`).not.toMatch(/trust|uy tín/i)
    }
  })
})

describe('rentalsMetadata takes the headline variant the H1 prints', () => {
  const VARIANTS: RentalsHeadline[] = ['apartments-houses-hcmc', 'apartments-hcmc', 'rentals-hcmc', 'rentals-vietnam']

  /**
   * ⛔ THE H1 AND THE TITLE ARE BUILT FROM ONE CACHED VALUE (SEO wave B, H1b). The H1 renders in
   * `(index)/layout.tsx` from `loadRentalsHeadline`, above the loading boundary, where it may not wait on
   * the counts; the title takes the same value. Title Case in the title, sentence case in the H1 —
   * otherwise the same words, in both languages (the H1 side: category-text.test.tsx).
   */
  it.each(VARIANTS)('%s: the title names exactly what RENTALS_H1 says', (v) => {
    for (const lang of ['en', 'vi'] as const) {
      const { title } = rentalsMetadata(LIVE, lang, 'eno.vn', v)
      expect(title.replace(/ \| eno\.vn$/, '').toLowerCase()).toBe(RENTALS_H1[v][lang].toLowerCase())
    }
  })

  it('the title follows the parameter, not the facts; the description follows the facts', () => {
    const stale = rentalsMetadata({ ...LIVE, allHcmc: false }, 'en', 'eno.vn', 'apartments-houses-hcmc')
    expect(stale.title).toBe('Apartments & Houses for Rent in Ho Chi Minh City | eno.vn')
    expect(stale.description).toMatch(/^25,502 places for rent in Vietnam,/)
  })

  /**
   * ⚠️ A CACHED VARIANT CAN OUTLIVE THE STOCK (category-data.ts, `loadRentalsHeadline`). If /c/rentals
   * empties inside that window, generateMetadata still passes the variant, so the title keeps matching
   * the H1, and the description is built from the empty facts `loadRentalsFacts(id, 0)` returns: it
   * says 0 and claims nothing about links (`linkedTier(x, 0)` is 'none'). Noindexed once 14 days at 0.
   */
  it('an emptied category under a cached variant: the title matches the H1, the description says 0 and claims nothing', () => {
    const empty: RentalsFacts = { total: 0, allHcmc: false, linked: linkedTier(7, 0), kinds: rentalKinds({}), top: [] }
    for (const lang of ['en', 'vi'] as const) {
      const m = rentalsMetadata(empty, lang, 'eno.vn', 'apartments-houses-hcmc')
      expect(m.title.replace(/ \| eno\.vn$/, '').toLowerCase()).toBe(RENTALS_H1['apartments-houses-hcmc'][lang].toLowerCase())
      expect(m.description).toBe(lang === 'en' ? '0 places for rent in Vietnam.' : '0 tin cho thuê tại Việt Nam.')
    }
  })
})

describe('districtMetadata', () => {
  const base = {
    category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
    place: { en: 'District 2 (Thu Duc)', vi: 'Quận 2 (Thủ Đức)' },
    inHcmc: true,
    total: 3741,
  }

  /** "Rentals in Quận 2 — Trusted" was the live English title on 2026-09-27. */
  it('English name, the city, and no "Trusted" over linked stock', () => {
    const m = districtMetadata({ ...base, linked: 'all' }, 'en', 'eno.vn')
    expect(m.title).toBe('Rentals in District 2 (Thu Duc), Ho Chi Minh City | eno.vn')
    expect(m.description).toBe('3,741 places for rent in District 2 (Thu Duc), Ho Chi Minh City. Every one links to its original listing on a partner property portal.')
  })

  // /c/rentals/can-gio held exactly one rental on 2026-09-27 and read "1 places for rent", then
  // "1 place for rent … Every one links …" (VI "Tất cả đều …") — the tail must be singular too.
  it('counts one as one — the count AND the linked sentence, in both languages', () => {
    const canGio = { ...base, place: { en: 'Can Gio District', vi: 'Huyện Cần Giờ' }, total: 1, linked: 'all' as const }
    expect(districtMetadata(canGio, 'en', 'eno.vn').description).toBe(
      '1 place for rent in Can Gio District, Ho Chi Minh City. It links to its original listing on a partner property portal.',
    )
    expect(districtMetadata(canGio, 'vi', 'eno.vn').description).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ, TP. Hồ Chí Minh. Tin này dẫn tới tin gốc trên trang bất động sản đối tác.',
    )
    const elecOne = { ...canGio, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } }
    expect(districtMetadata(elecOne, 'en', 'eno.vn').description).toMatch(/^1 electronics listing in [^.]+\. It links to its original listing on a partner site\.$/)
    for (const lang of ['en', 'vi'] as const) {
      expect(districtMetadata(canGio, lang, 'eno.vn').description).not.toMatch(/Every one|Tất cả đều/)
      // …and two is still plural.
      expect(districtMetadata({ ...canGio, total: 2 }, lang, 'eno.vn').description).toMatch(/Every one links|Tất cả đều dẫn/)
    }
    const elec = { ...base, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }, total: 1, linked: 'none' as const }
    expect(districtMetadata(elec, 'en', 'eno.vn').description).toMatch(/^1 electronics listing in /)
    const one = meta({ ...LIVE, total: 1, kinds: rentalKinds({ 'office-rental': 1 }) }, 'en', 'eno.vn')
    expect(one.description).toMatch(/^1 place for rent in Ho Chi Minh City, including 1 office\./)
  })

  it('Vietnamese renders its own title and sentence', () => {
    const m = districtMetadata({ ...base, linked: 'all' }, 'vi', 'eno.vn')
    expect(m.title).toBe('Cho thuê tại Quận 2 (Thủ Đức), TP. Hồ Chí Minh | eno.vn')
    expect(m.description).toBe('3.741 tin cho thuê tại Quận 2 (Thủ Đức), TP. Hồ Chí Minh. Tất cả đều dẫn tới tin gốc trên trang bất động sản đối tác.')
  })

  it('keeps the trust sentence only where nothing in scope is linked', () => {
    const own = districtMetadata({ ...base, category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }, place: { en: 'Binh Trung', vi: 'Bình Trưng' }, inHcmc: false, total: 3, linked: 'none' }, 'en', 'eno.vn')
    expect(own.title).toBe('Services in Binh Trung | eno.vn')
    expect(own.description).toMatch(/public trust score/)
    const linked = districtMetadata({ ...base, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }, linked: 'most' }, 'en', 'eno.vn')
    expect(linked.description).toMatch(/Most link to their original listing on a partner site\.$/)
    expect(linked.description).not.toMatch(/trust/)
  })
})

describe('helpers', () => {
  it('formats full counts per language, never compacted', () => {
    expect(formatCountFull(25502, 'en')).toBe('25,502')
    expect(formatCountFull(25502, 'vi')).toBe('25.502')
    expect(formatCountFull(25502, 'zh-Hans')).toBe('25,502')
  })

  it('joins a list in each language', () => {
    expect(joinList(['a'], 'en')).toBe('a')
    expect(joinList(['a', 'b', 'c'], 'en')).toBe('a, b and c')
    expect(joinList(['a', 'b'], 'vi')).toBe('a và b')
    expect(joinList([], 'en')).toBe('')
  })

  it('drops zero kinds and keeps display order', () => {
    expect(rentalKinds({ 'office-rental': 2, 'apartment-rental': 5, 'house-rental': 0 })).toEqual([
      { slug: 'apartment-rental', count: 5 },
      { slug: 'office-rental', count: 2 },
    ])
  })

  it('reads the [lang] segment as en/vi only', () => {
    expect(pageLang('vi')).toBe('vi')
    expect(pageLang('en')).toBe('en')
    expect(pageLang(undefined)).toBe('en')
  })
})
