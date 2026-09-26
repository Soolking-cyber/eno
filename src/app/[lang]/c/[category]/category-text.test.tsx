// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { guidesForCategory } from '@/lib/category-guides'
import { CATEGORY_LINKED_SENTENCE, RENTALS_H1, categoryMetadata, rentalKinds, type RentalsHeadline } from './category-copy'
import { CategoryLede } from '@/components/marketplace/category-lede'
import { CategoryGuides, DistrictHeading, DistrictLede, PlaceName, RentalsDistricts, RentalsHeading, RentalsLede } from './category-text'

/**
 * What the server actually emits for each page language — `renderToString` under the provider the
 * `[lang]` layout mounts, which is the HTML a crawler and a first paint get.
 *
 * ⚠️ THE H1 IS WRITTEN TWICE ON PURPOSE (literal `tr()` calls so the string harvester can pre-translate
 * them, and `RENTALS_H1` for the plain-text uses), so the first test renders every headline in both
 * languages against the map: the two cannot drift apart unnoticed.
 */
beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const html = (lang: 'en' | 'vi', node: React.ReactNode) =>
  renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      {node}
    </LanguageProvider>,
  )
const text = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  // A block element's boundary is a word boundary for a reader; textContent would glue them.
  el.innerHTML = html(lang, node).replace(/<\/(h2|p|li)>/g, '</$1> ')
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const KINDS = rentalKinds({ 'apartment-rental': 14043, 'house-rental': 5331, 'room-rental': 3289, 'office-rental': 2270 })

describe('RentalsHeading', () => {
  const cases: [RentalsHeadline, boolean, ReturnType<typeof rentalKinds>][] = [
    ['apartments-houses-hcmc', true, KINDS],
    ['apartments-hcmc', true, rentalKinds({ 'apartment-rental': 1 })],
    ['rentals-hcmc', true, rentalKinds({ 'room-rental': 1 })],
    ['rentals-vietnam', false, KINDS],
  ]
  it.each(cases)('%s renders exactly RENTALS_H1 in both languages', (key, allHcmc, kinds) => {
    for (const lang of ['en', 'vi'] as const) {
      expect(text(lang, <RentalsHeading allHcmc={allHcmc} kinds={kinds} />)).toBe(RENTALS_H1[key][lang])
    }
  })
})

describe('RentalsLede', () => {
  const props = { total: 25502, allHcmc: true, kinds: KINDS, linked: 'all' as const }

  it('English: the live total, each kind, and what "linked" means', () => {
    expect(text('en', <RentalsLede {...props} />)).toBe(
      '25,502 places for rent in Ho Chi Minh City, including 14,043 apartments, 5,331 houses, 3,289 rooms and 2,270 offices. ' +
        'Every one is linked from a partner property portal and links to the original listing.',
    )
  })

  it('Vietnamese: written whole, dot-grouped', () => {
    expect(text('vi', <RentalsLede {...props} />)).toBe(
      '25.502 tin cho thuê tại TP. Hồ Chí Minh, gồm 14.043 căn hộ, 5.331 nhà, 3.289 phòng trọ và 2.270 mặt bằng. ' +
        'Tất cả đều được liên kết từ các trang bất động sản đối tác và dẫn tới tin gốc.',
    )
  })

  it('names no city and no kinds it cannot back, and says nothing about links it does not have', () => {
    const t = text('en', <RentalsLede total={7} allHcmc={false} kinds={[]} linked="none" />)
    expect(t).toBe('7 places for rent in Vietnam.')
  })

  it('counts one as one: "1 place", "1 office"', () => {
    const t = text('en', <RentalsLede total={1} allHcmc kinds={rentalKinds({ 'office-rental': 1 })} linked="none" />)
    expect(t).toBe('1 place for rent in Ho Chi Minh City, including 1 office.')
    // /c/rentals/can-gio, 2026-09-27: "1 place for rent in Can Gio District. Every one links…" — the
    // linked sentence must be singular too, in both languages.
    const canGio = { name: 'Rentals', nameVi: 'Cho thuê', categorySlug: 'rentals', place: { en: 'Can Gio District', vi: 'Huyện Cần Giờ' } }
    expect(text('en', <DistrictLede total={1} {...canGio} linked="all" />)).toBe(
      '1 place for rent in Can Gio District. It links to its original listing on a partner property portal.',
    )
    expect(text('vi', <DistrictLede total={1} {...canGio} linked="all" />)).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ. Tin này dẫn tới tin gốc trên trang bất động sản đối tác.',
    )
    expect(text('en', <DistrictLede total={1} {...canGio} categorySlug="electronics" name="Electronics" linked="all" />)).toBe(
      '1 electronics listing in Can Gio District. It links to its original listing on a partner site.',
    )
    // A single own-stock listing is not "each from a seller" / "Mỗi tin đều".
    expect(text('en', <DistrictLede total={1} {...canGio} linked="none" />)).toBe(
      '1 place for rent in Can Gio District, from a seller with a public trust score — fewer fakes, fewer bait prices.',
    )
    expect(text('vi', <DistrictLede total={1} {...canGio} linked="none" />)).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ. Tin này đến từ người bán có điểm uy tín công khai — ít hàng giả, ít giá mồi hơn.',
    )
    // Two is still plural.
    expect(text('en', <DistrictLede total={2} {...canGio} linked="all" />)).toMatch(/^2 places for rent in Can Gio District\. Every one links/)
    expect(text('vi', <DistrictLede total={2} {...canGio} linked="all" />)).toMatch(/Tất cả đều dẫn tới tin gốc/)
  })

  /** The importers' "enquiries are handled there, not by eno" line was removed on the owner's word. */
  it('never says the enquiry is handled elsewhere', () => {
    for (const lang of ['en', 'vi'] as const) expect(text(lang, <RentalsLede {...props} />)).not.toMatch(/enquir|not by eno|không qua eno/i)
  })
})

describe('RentalsDistricts', () => {
  const top = [
    { slug: 'd2', label: { en: 'District 2 (Thu Duc)', vi: 'Quận 2 (Thủ Đức)' }, count: 3741 },
    { slug: 'd7', label: { en: 'District 7 (Phu My Hung)', vi: 'Quận 7 (Phú Mỹ Hưng)' }, count: 2655 },
    { slug: 'binh-thanh', label: { en: 'Binh Thanh District', vi: 'Bình Thạnh' }, count: 2476 },
  ]

  it('links each busiest district by its canonical slug, named in the page language', () => {
    const en = html('en', <RentalsDistricts allHcmc top={top} />)
    expect(en).toContain('href="/c/rentals/d2"')
    expect(en).toContain('href="/c/rentals/binh-thanh"')
    expect(en).not.toMatch(/href="\/c\/rentals\/quan-/)
    expect(text('en', <RentalsDistricts allHcmc top={top} />)).toBe(
      'Renting in Ho Chi Minh City The most listings are in District 2 (Thu Duc), District 7 (Phu My Hung) and Binh Thanh District.',
    )
    expect(text('vi', <RentalsDistricts allHcmc top={top} />)).toBe(
      'Thuê nhà ở TP. Hồ Chí Minh Nhiều tin nhất ở Quận 2 (Thủ Đức), Quận 7 (Phú Mỹ Hưng) và Bình Thạnh.',
    )
  })

  it('renders nothing without districts', () => {
    expect(html('en', <RentalsDistricts allHcmc top={[]} />)).toBe('')
  })
})

describe('district page copy', () => {
  const place = { en: 'District 2 (Thu Duc)', vi: 'Quận 2 (Thủ Đức)' }

  it('heads the page with the English place name on English pages', () => {
    expect(text('en', <DistrictHeading name="Rentals" nameVi="Cho thuê" place={place} />)).toBe('Rentals in District 2 (Thu Duc)')
    expect(text('vi', <DistrictHeading name="Rentals" nameVi="Cho thuê" place={place} />)).toBe('Cho thuê tại Quận 2 (Thủ Đức)')
    expect(text('en', <PlaceName {...place} />)).toBe('District 2 (Thu Duc)')
  })

  it('replaces the trust sentence with the linked one when the scope is linked', () => {
    const lede = (lang: 'en' | 'vi', linked: 'all' | 'none') =>
      text(lang, <DistrictLede total={3741} name="Rentals" nameVi="Cho thuê" categorySlug="rentals" place={place} linked={linked} />)
    expect(lede('en', 'all')).toBe('3,741 places for rent in District 2 (Thu Duc). Every one links to its original listing on a partner property portal.')
    expect(lede('vi', 'all')).toBe('3.741 tin cho thuê tại Quận 2 (Thủ Đức). Tất cả đều dẫn tới tin gốc trên trang bất động sản đối tác.')
    expect(lede('en', 'all')).not.toMatch(/trust/)
    expect(lede('en', 'none')).toMatch(/each from a seller with a public trust score/)
  })

  it('keeps "listings" wording for categories other than rentals', () => {
    const t = text('en', <DistrictLede total={3} name="Services" nameVi="Dịch vụ" categorySlug="services" place={{ en: 'Binh Trung', vi: 'Bình Trưng' }} linked="most" />)
    expect(t).toBe('3 services listings in Binh Trung. Most link to their original listing on a partner site.')
  })
})

describe('CategoryGuides', () => {
  it('lists each guide by its own label, and marks a guide whose language differs from the page', () => {
    const guides = guidesForCategory('rentals', 'vi') // English guides on a Vietnamese page (fallback)
    const out = html('vi', <CategoryGuides guides={guides} />)
    expect(out).toContain('Cẩm nang')
    for (const g of guides) {
      expect(out).toContain(`href="${g.href}"`)
      expect(out).toContain(g.label)
    }
    expect(out).toContain('lang="en"')
    // Same language as the page: no attribute.
    expect(html('en', <CategoryGuides guides={guidesForCategory('rentals', 'en')} />)).not.toContain('lang="en"')
  })

  it('renders flat rows, not bordered cards', () => {
    const out = html('en', <CategoryGuides guides={guidesForCategory('furniture-appliances', 'en')} />)
    expect(out).toContain('divide-y')
    expect(out).not.toMatch(/rounded-xl border/)
  })

  it('renders nothing when the category has no guides', () => {
    expect(html('en', <CategoryGuides guides={[]} />)).toBe('')
  })
})

describe('CategoryLede — the trust sentence only over stock posted here', () => {
  const cat = { name: 'Electronics', nameVi: 'Đồ điện tử', slug: 'electronics' }

  it.each(['all', 'most', 'some'] as const)('%s linked: renders exactly CATEGORY_LINKED_SENTENCE, no trust claim', (tier) => {
    for (const lang of ['en', 'vi'] as const) {
      const out = text(lang, <CategoryLede {...cat} linked={tier} />)
      expect(out).toBe(CATEGORY_LINKED_SENTENCE[tier][lang])
      expect(out).not.toMatch(/trust|uy tín/i)
    }
  })

  it('keeps the old trust sentence where nothing is linked (and by default)', () => {
    expect(text('en', <CategoryLede {...cat} linked="none" />)).toMatch(/public trust score/)
    expect(text('en', <CategoryLede {...cat} />)).toMatch(/public trust score/)
    expect(text('vi', <CategoryLede {...cat} />)).toMatch(/điểm uy tín công khai/)
  })

  it('jobs keeps its own linked-postings sentence whatever the tier', () => {
    expect(text('en', <CategoryLede name="Jobs" nameVi="Việc làm" slug="jobs" linked="all" />)).toMatch(/^Most jobs here link to the original posting/)
  })
})

describe('categoryMetadata — every non-rentals category', () => {
  it('drops "Trusted" and the trust sentence once anything is linked', () => {
    for (const tier of ['all', 'most', 'some'] as const) {
      const m = categoryMetadata({ name: 'Electronics' }, tier, 'eno.vn')
      expect(m.title).toBe('Electronics in Vietnam | eno.vn')
      expect(m.description).toBe(`Browse electronics for expats in Vietnam. ${CATEGORY_LINKED_SENTENCE[tier].en}`)
      expect(`${m.title} ${m.description}`).not.toMatch(/trust/i)
    }
  })

  it('keeps the old copy word for word when nothing is linked', () => {
    expect(categoryMetadata({ name: 'Sports' }, 'none', 'eno.vn')).toEqual({
      title: 'Sports in Vietnam — Trusted listings | eno.vn',
      description: 'Browse sports for expats in Vietnam. Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.',
    })
  })
})
