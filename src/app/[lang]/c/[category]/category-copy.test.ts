import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LINKED_SENTENCE,
  categoryMetadata,
  crumbNames,
  districtLinkedSentence,
  RENTALS_H1,
  byAreaChips,
  topSubcategories,
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
        'Every listing links to its original ad on another listing site.',
    )
  })

  it('Vietnamese: its own sentence, dot-grouped numbers, Vietnamese place names', () => {
    const m = meta(LIVE, 'vi', 'eno.vn')
    // "căn hộ, nhà ở" parsed as "apartments, housing" (nhà ở = dwelling); "và nhà tại" cannot.
    expect(m.title).toBe('Cho thuê căn hộ và nhà tại TP. Hồ Chí Minh | eno.vn')
    expect(m.description).toBe(
      '25.502 tin cho thuê tại TP. Hồ Chí Minh, gồm 14.043 căn hộ, 5.331 nhà, 3.289 phòng trọ và 2.270 mặt bằng. ' +
        'Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.',
    )
  })

  it('says "most" / "some" / nothing as the linked count falls', () => {
    expect(meta({ ...LIVE, linked: 'most' }, 'en', 'x').description).toMatch(/Most listings link to their original ads/)
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
    expect(m.description).toBe('3,741 places for rent in District 2 (Thu Duc), Ho Chi Minh City. Every listing links to its original ad on another listing site.')
  })

  // /c/rentals/can-gio held exactly one rental on 2026-09-27 and read "1 places for rent", then
  // "1 place for rent … Every one links …" (VI "Tất cả đều …") — the tail must be singular too.
  it('counts one as one — the count AND the linked sentence, in both languages', () => {
    const canGio = { ...base, place: { en: 'Can Gio District', vi: 'Huyện Cần Giờ' }, total: 1, linked: 'all' as const }
    expect(districtMetadata(canGio, 'en', 'eno.vn').description).toBe(
      '1 place for rent in Can Gio District, Ho Chi Minh City. It links to its original ad on another listing site.',
    )
    expect(districtMetadata(canGio, 'vi', 'eno.vn').description).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ, TP. Hồ Chí Minh. Tin này dẫn tới tin gốc trên một trang đăng tin khác.',
    )
    const elecOne = { ...canGio, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } }
    expect(districtMetadata(elecOne, 'en', 'eno.vn').description).toMatch(/^1 electronics listing in [^.]+\. It links to its original listing on a source site\.$/)
    for (const lang of ['en', 'vi'] as const) {
      expect(districtMetadata(canGio, lang, 'eno.vn').description).not.toMatch(/Every (one|listing)|Mỗi tin đều/)
      // …and two is still plural.
      expect(districtMetadata({ ...canGio, total: 2 }, lang, 'eno.vn').description).toMatch(/Every listing links|Mỗi tin đều dẫn/)
    }
    const elec = { ...base, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }, total: 1, linked: 'none' as const }
    expect(districtMetadata(elec, 'en', 'eno.vn').description).toMatch(/^1 electronics listing in /)
    const one = meta({ ...LIVE, total: 1, kinds: rentalKinds({ 'office-rental': 1 }) }, 'en', 'eno.vn')
    expect(one.description).toMatch(/^1 place for rent in Ho Chi Minh City, including 1 office\./)
  })

  it('Vietnamese renders its own title and sentence', () => {
    const m = districtMetadata({ ...base, linked: 'all' }, 'vi', 'eno.vn')
    expect(m.title).toBe('Cho thuê tại Quận 2 (Thủ Đức), TP. Hồ Chí Minh | eno.vn')
    expect(m.description).toBe('3.741 tin cho thuê tại Quận 2 (Thủ Đức), TP. Hồ Chí Minh. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.')
  })

  it('keeps the trust sentence only where nothing in scope is linked', () => {
    const own = districtMetadata({ ...base, category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }, place: { en: 'Binh Trung', vi: 'Bình Trưng' }, inHcmc: false, total: 3, linked: 'none' }, 'en', 'eno.vn')
    expect(own.title).toBe('Services in Binh Trung | eno.vn')
    expect(own.description).toMatch(/public trust score/)
    const linked = districtMetadata({ ...base, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }, linked: 'most' }, 'en', 'eno.vn')
    expect(linked.description).toMatch(/Most link to their original listing on a source site\.$/)
    expect(linked.description).not.toMatch(/trust/)
  })
})

/**
 * ⛔ NO "PARTNER" FOR A LINKED SOURCE (review P2, 2026-10-01). "Partner" now means a company with a signed
 * agreement (partner-badge.tsx's tooltip); the shops and portals this stock is linked from hold none.
 */
describe('linked sentences name the source, never a partner', () => {
  it('CATEGORY_LINKED_SENTENCE, every tier, both languages', () => {
    for (const tier of ['all', 'most', 'some'] as const) {
      for (const lang of ['en', 'vi'] as const) expect(CATEGORY_LINKED_SENTENCE[tier][lang]).not.toMatch(/partner|đối tác/i)
    }
  })
  it('the district sentence for a retail category, every tier and the singular, both languages', () => {
    const elec = { category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }, place: { en: 'District 1', vi: 'Quận 1' }, inHcmc: true }
    for (const linked of ['all', 'most', 'some'] as const) {
      for (const total of [1, 40]) {
        if (total === 1 && linked !== 'all') continue
        for (const lang of ['en', 'vi'] as const) {
          const d = districtMetadata({ ...elec, total, linked }, lang, 'eno.vn').description
          expect(d).not.toMatch(/partner|đối tác/i)
          expect(d).toMatch(/source site|trang nguồn/)
        }
      }
    }
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

describe('byAreaChips — "By area" only where there are areas to browse (C1-LEDE)', () => {
  const chip = (slug: string, count: number) => ({ slug, count })

  it('shows no row while fewer than three places hold five or more listings', () => {
    // /c/electronics on 2026-09-29: one own-stock listing in one ward printed "By area: Cau Giay".
    expect(byAreaChips([chip('cau-giay', 1)], 80)).toEqual([])
    expect(byAreaChips([chip('a', 50), chip('b', 9), chip('c', 4), chip('d', 4)], 80)).toEqual([])
  })

  it('shows every place, busiest first as given, once three clear the bar — small ones included', () => {
    const chips = [chip('d2', 3741), chip('d7', 2655), chip('binh-thanh', 2476), chip('can-gio', 1)]
    expect(byAreaChips(chips, 80)).toEqual(chips)
    expect(byAreaChips(chips, 2)).toEqual(chips.slice(0, 2))
  })
})

describe('topSubcategories — what the lede may name after "including" (C1-LEDE)', () => {
  const defs = [
    { slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' },
    { slug: 'laptops', name: 'Laptops', nameVi: 'Laptop' },
    { slug: 'audio', name: 'Audio', nameVi: 'Âm thanh' },
    { slug: 'tvs', name: 'TVs', nameVi: 'Tivi' },
    { slug: 'accessories', name: 'Other accessories', nameVi: 'Phụ kiện khác' },
    { slug: 'misc', name: 'Other', nameVi: 'Khác' },
  ]

  it('names the three busiest, busiest first, skipping slugs the taxonomy no longer defines', () => {
    const groups = [
      { slug: 'audio', count: 3508 }, { slug: 'phones', count: 41002 }, { slug: 'gone-slug', count: 50000 },
      { slug: 'tvs', count: 120 }, { slug: 'laptops', count: 9114 }, { slug: null, count: 7 },
    ]
    expect(topSubcategories(groups, defs, 63730).map((t) => t.name)).toEqual(['Phones', 'Laptops', 'Audio'])
  })

  it('never names a catch-all — "including Other (412)" names no kind of thing', () => {
    const groups = [{ slug: 'misc', count: 900 }, { slug: 'accessories', count: 800 }, { slug: 'phones', count: 10 }]
    expect(topSubcategories(groups, defs, 2000)).toEqual([{ name: 'Phones', nameVi: 'Điện thoại', count: 10 }])
  })

  it('names nothing that holds the whole category', () => {
    expect(topSubcategories([{ slug: 'phones', count: 40 }], defs, 40)).toEqual([])
  })
})

/**
 * SEO wave B, V2 — the category metadata in the page's language, and the English claims CS-3 fixed
 * (copy sheet CS-3, approved by the owner 2026-10-01). Every Vietnamese string is the sheet's, verbatim.
 */
describe('categoryMetadata in both languages (V2, CS-3)', () => {
  const furniture = { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' }

  it('the Vietnamese title is the page H1 — "{nameVi} ở Việt Nam" — in every tier (V2-3, V2-4)', () => {
    for (const tier of ['none', 'all', 'most', 'some'] as const) {
      expect(categoryMetadata(furniture, tier, 'eno.vn', 'vi').title).toBe('Nhà cửa ở Việt Nam | eno.vn')
      expect(categoryMetadata(furniture, tier, 'eno.vn', 'en').title).toBe('Home in Vietnam | eno.vn')
    }
  })

  it('no "Trusted" and no "fewer fakes" in any title or description, either language (claims 2, 3)', () => {
    for (const slug of ['furniture-appliances', 'jobs', 'teachers', 'rentals', 'electronics']) {
      for (const tier of ['none', 'all', 'most', 'some'] as const) {
        for (const lang of ['en', 'vi'] as const) {
          const m = categoryMetadata({ ...furniture, slug }, tier, 'eno.vn', lang)
          expect(`${m.title} ${m.description}`).not.toMatch(/trusted|fewer fakes|bait|giá mồi|hàng giả|partner|đối tác/i)
        }
      }
    }
  })

  it('tier none: browse lead plus the trust sentence (V2-5)', () => {
    expect(categoryMetadata(furniture, 'none', 'eno.vn', 'vi').description).toBe(
      'Xem tin nhà cửa tại Việt Nam. Mỗi người bán đều có điểm uy tín công khai, và tin xấu sẽ bị báo cáo.',
    )
    expect(categoryMetadata(furniture, 'none', 'eno.vn', 'en').description).toBe(
      'Browse home for expats in Vietnam. Every seller has a public trust score and bad listings get reported.',
    )
  })

  it('linked retail: the existing CATEGORY_LINKED_SENTENCE pair (V2-6)', () => {
    for (const tier of ['all', 'most', 'some'] as const) {
      expect(categoryMetadata(furniture, tier, 'eno.vn', 'vi').description).toBe(`Xem tin nhà cửa tại Việt Nam. ${CATEGORY_LINKED_SENTENCE[tier].vi}`)
    }
  })

  it('jobs: "a job site" / "trang tuyển dụng" in every linked tier (V2-8a…c)', () => {
    const jobs = { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }
    expect(categoryMetadata(jobs, 'all', 'eno.vn', 'en').description).toBe('Browse jobs for expats in Vietnam. Every listing here links to its original on a job site.')
    expect(categoryMetadata(jobs, 'all', 'eno.vn', 'vi').description).toBe('Xem tin việc làm tại Việt Nam. Mỗi tin ở đây đều dẫn tới tin gốc trên trang tuyển dụng.')
    expect(categoryMetadata(jobs, 'most', 'eno.vn', 'en').description).toBe('Browse jobs for expats in Vietnam. Most listings here link to their original on a job site.')
    expect(categoryMetadata(jobs, 'most', 'eno.vn', 'vi').description).toBe('Xem tin việc làm tại Việt Nam. Phần lớn tin ở đây dẫn tới tin gốc trên trang tuyển dụng.')
    expect(categoryMetadata(jobs, 'some', 'eno.vn', 'en').description).toBe('Browse jobs for expats in Vietnam. Some listings here link to their original on a job site.')
    expect(categoryMetadata(jobs, 'some', 'eno.vn', 'vi').description).toBe('Xem tin việc làm tại Việt Nam. Một số tin ở đây dẫn tới tin gốc trên trang tuyển dụng.')
  })

  it('teachers: people, not listings — the share-gate sentence in any tier (V2-9a)', () => {
    const t = { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' }
    for (const tier of ['none', 'all'] as const) {
      expect(categoryMetadata(t, tier, 'eno.vn', 'en')).toEqual({
        title: 'Teachers in Vietnam | eno.vn',
        description: 'English and subject teachers looking for work in Vietnam. Their phone, email and CV are shared only when the teacher chooses to.',
      })
      expect(categoryMetadata(t, tier, 'eno.vn', 'vi')).toEqual({
        title: 'Giáo viên ở Việt Nam | eno.vn',
        description: 'Giáo viên tiếng Anh và các môn học đang tìm việc tại Việt Nam. Số điện thoại, email và CV chỉ được chia sẻ khi giáo viên đồng ý.',
      })
    }
  })

  it('rentals through the generic branch: D-f sentence, never "partner" (V2-10)', () => {
    const r = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
    expect(categoryMetadata(r, 'all', 'eno.vn', 'en').description).toBe('Browse rentals for expats in Vietnam. Every listing links to its original ad on another listing site.')
    expect(categoryMetadata(r, 'all', 'eno.vn', 'vi').description).toBe('Xem tin cho thuê tại Việt Nam. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.')
    for (const tier of ['all', 'most', 'some'] as const) {
      for (const lang of ['en', 'vi'] as const) {
        expect(categoryMetadata(r, tier, 'eno.vn', lang).description.length).toBeLessThanOrEqual(160)
      }
    }
  })

  it('a row with no nameVi falls back to the English name, as the visible H1 does', () => {
    expect(categoryMetadata({ slug: 'x', name: 'Misc', nameVi: '' }, 'none', 'eno.vn', 'vi').title).toBe('Misc ở Việt Nam | eno.vn')
  })

  it('every description fits 160 characters', () => {
    for (const slug of ['furniture-appliances', 'jobs', 'teachers', 'rentals']) {
      for (const tier of ['none', 'all', 'most', 'some'] as const) {
        for (const lang of ['en', 'vi'] as const) {
          expect(categoryMetadata({ ...furniture, slug, name: 'Electronics & Appliances', nameVi: 'Điện tử & Gia dụng' }, tier, 'eno.forum', lang).description.length).toBeLessThanOrEqual(160)
        }
      }
    }
  })
})

describe('district metadata claims (V2, CS-3)', () => {
  const at = { place: { en: 'District 1', vi: 'Quận 1' }, inHcmc: true }

  it('no bait-price comparison on the English trust tail (claim 3)', () => {
    const own = districtMetadata({ ...at, category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }, total: 12, linked: 'none' }, 'en', 'eno.vn')
    expect(own.description).toBe('12 services listings in District 1, Ho Chi Minh City. Every seller has a public trust score and bad listings get reported.')
  })

  it('teachers carry no seller-trust tail in either language (V2-9b)', () => {
    const t = { ...at, category: { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' }, total: 14, linked: 'none' as const }
    expect(districtMetadata(t, 'en', 'eno.vn').description).toBe('14 teachers listings in District 1, Ho Chi Minh City.')
    expect(districtMetadata(t, 'vi', 'eno.vn').description).toBe('14 tin giáo viên tại Quận 1, TP. Hồ Chí Minh.')
  })

  it('jobs name "a job site" / "trang tuyển dụng" in the meta description (V2-8d)', () => {
    const j = { ...at, category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' } }
    expect(districtMetadata({ ...j, total: 30, linked: 'all' }, 'en', 'eno.vn').description).toMatch(/\. Every one links to its original listing on a job site\.$/)
    expect(districtMetadata({ ...j, total: 30, linked: 'all' }, 'vi', 'eno.vn').description).toMatch(/\. Tất cả đều dẫn tới tin gốc trên trang tuyển dụng\.$/)
    expect(districtMetadata({ ...j, total: 30, linked: 'most' }, 'vi', 'eno.vn').description).toMatch(/Phần lớn dẫn tới tin gốc trên trang tuyển dụng\.$/)
    expect(districtMetadata({ ...j, total: 30, linked: 'some' }, 'en', 'eno.vn').description).toMatch(/Some link to their original listing on a job site\.$/)
    expect(districtMetadata({ ...j, total: 1, linked: 'all' }, 'vi', 'eno.vn').description).toMatch(/Tin này dẫn tới tin gốc trên trang tuyển dụng\.$/)
  })

  it('a row with no nameVi falls back to the English name in Vietnamese (review)', () => {
    const m = districtMetadata({ ...at, category: { slug: 'misc', name: 'Misc', nameVi: '' }, total: 12, linked: 'none' }, 'vi', 'eno.vn')
    expect(m.title).toBe('Misc tại Quận 1, TP. Hồ Chí Minh | eno.vn')
    expect(m.description).toMatch(/^12 tin misc tại Quận 1/)
  })

  it('the on-page lede sentence keeps its own noun (districtLinkedSentence without the override)', () => {
    expect(districtLinkedSentence('all', 'jobs', 'en', 30)).toBe('Every one links to its original listing on a source site.')
  })
})

describe('crumbNames (V2-7, V2-11, V2-12)', () => {
  it('equals the visible crumbs in each language', () => {
    expect(crumbNames({ name: 'Rentals', nameVi: 'Cho thuê' }, 'vi')).toEqual({ home: 'Trang chủ', category: 'Cho thuê' })
    expect(crumbNames({ name: 'Rentals', nameVi: 'Cho thuê' }, 'en')).toEqual({ home: 'Home', category: 'Rentals' })
    expect(crumbNames({ name: 'Misc', nameVi: '' }, 'vi').category).toBe('Misc')
  })

  it('both pages build their JSON-LD crumbs from it (source contract)', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), 'src/app/[lang]/c/[category]', f), 'utf8')
    for (const f of ['(index)/page.tsx', '[district]/page.tsx']) {
      const s = read(f)
      expect(s, f).toMatch(/name: crumbs\.home, item: hostUrl/)
      expect(s, f).toMatch(/name: crumbs\.category, item: `\$\{hostUrl\}\/c\/\$\{cat\.slug\}`/)
      expect(s, f).not.toMatch(/name: 'Home'/)
    }
    expect(read('[district]/page.tsx')).toMatch(/name: place\[lang\]/)
  })
})
