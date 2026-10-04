// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { guidesForCategory } from '@/lib/category-guides'
import { CATEGORY_LINKED_SENTENCE, DISTRICT_RENTALS_H1, RENTALS_H1, RENTALS_LINKED_SENTENCE, REPORT_SENTENCE, TEACHERS_CONTACT_SENTENCE, categoryMetadata, districtLinkedSentence, districtMetadata, homeFacts, rentalKinds, type RentalsHeadline } from './category-copy'
import { CategoryLede } from '@/components/marketplace/category-lede'
import { CategoryGuides, DistrictHeading, DistrictLede, OtherRentalsLink, PlaceName, RentalsDistrictHeading, RentalsDistricts, RentalsHeading, RentalsLede, rentalsLinkedLede } from './category-text'
import { readFileSync } from 'node:fs'

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
  /**
   * It takes the variant, not the facts: `(index)/layout.tsx` renders it from the cached
   * `loadRentalsHeadline`, and `rentalsMetadata` builds the title from the same value
   * (category-copy.test.ts pins the title side), so the H1 and the title name one variant.
   */
  const cases: RentalsHeadline[] = ['apartments-houses-hcmc', 'apartments-hcmc', 'rentals-hcmc', 'rentals-vietnam']
  it.each(cases)('%s renders exactly RENTALS_H1 in both languages', (key) => {
    for (const lang of ['en', 'vi'] as const) {
      expect(text(lang, <RentalsHeading headline={key} />)).toBe(RENTALS_H1[key][lang])
    }
  })
})

describe('RentalsLede', () => {
  const props = { total: 25502, allHcmc: true, kinds: KINDS, linked: 'all' as const }

  it('English: the live total, each kind, and what "linked" means', () => {
    expect(text('en', <RentalsLede {...props} />)).toBe(
      '25,502 places for rent in Ho Chi Minh City, including 14,043 apartments, 5,331 houses, 3,289 rooms and 2,270 offices. ' +
        'Every listing links to its original ad on another listing site.',
    )
  })

  it('Vietnamese: written whole, dot-grouped', () => {
    expect(text('vi', <RentalsLede {...props} />)).toBe(
      '25.502 tin cho thuê tại TP. Hồ Chí Minh, gồm 14.043 căn hộ, 5.331 nhà, 3.289 phòng trọ và 2.270 mặt bằng. ' +
        'Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.',
    )
  })

  it('names vehicle hire in its own sentence, never inside the "places" count', () => {
    expect(text('en', <RentalsLede {...props} vehicles={{ cars: 5904, motorbikes: 245 }} />)).toBe(
      '25,502 places for rent in Ho Chi Minh City, including 14,043 apartments, 5,331 houses, 3,289 rooms and 2,270 offices. ' +
        'Every listing links to its original ad on another listing site. Plus 5,904 cars and 245 motorbikes for hire.',
    )
    expect(text('vi', <RentalsLede {...props} vehicles={{ cars: 5904, motorbikes: 245 }} />)).toMatch(/ Ngoài ra còn 5\.904 xe ô tô và 245 xe máy cho thuê\.$/)
    expect(text('en', <RentalsLede {...props} vehicles={{ cars: 0, motorbikes: 1 }} />)).toMatch(/\. Plus 1 motorbike for hire\.$/)
    expect(text('en', <RentalsLede {...props} vehicles={{ cars: 1, motorbikes: 0 }} />)).toMatch(/\. Plus 1 car for hire\.$/)
    expect(text('en', <RentalsLede {...props} vehicles={{ cars: 0, motorbikes: 0 }} />)).not.toMatch(/hire/)
    expect(text('en', <RentalsLede {...props} />)).not.toMatch(/hire/)
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
      '1 place for rent in Can Gio District. It links to its original ad on another listing site.',
    )
    expect(text('vi', <DistrictLede total={1} {...canGio} linked="all" />)).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ. Tin này dẫn tới tin gốc trên một trang đăng tin khác.',
    )
    expect(text('en', <DistrictLede total={1} {...canGio} categorySlug="electronics" name="Electronics" linked="all" />)).toBe(
      '1 electronics listing in Can Gio District. It links to its original listing on a source site.',
    )
    // Own stock: the report sentence speaks of "any listing", not of "each" one, so 1 reads as well as 2
    // (owner 2026-10-04 retired the trust-score claim; CS-3 claim 3 the bait-price tail, 2026-10-01).
    expect(text('en', <DistrictLede total={1} {...canGio} linked="none" />)).toBe(
      '1 place for rent in Can Gio District. Members can report any listing that breaks the rules.',
    )
    expect(text('vi', <DistrictLede total={1} {...canGio} linked="none" />)).toBe(
      '1 tin cho thuê tại Huyện Cần Giờ. Thành viên có thể báo cáo bất kỳ tin vi phạm nào.',
    )
    // Two is still plural.
    expect(text('en', <DistrictLede total={2} {...canGio} linked="all" />)).toMatch(/^2 places for rent in Can Gio District\. Every listing links/)
    expect(text('vi', <DistrictLede total={2} {...canGio} linked="all" />)).toMatch(/Mỗi tin đều dẫn tới tin gốc/)
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

  it('replaces the report sentence with the linked one when the scope is linked', () => {
    const lede = (lang: 'en' | 'vi', linked: 'all' | 'none') =>
      text(lang, <DistrictLede total={3741} name="Rentals" nameVi="Cho thuê" categorySlug="rentals" place={place} linked={linked} />)
    // D-f (SEO wave B, D1): the neutral sentence, CS-2 D1-14.
    expect(lede('en', 'all')).toBe('3,741 places for rent in District 2 (Thu Duc). Every listing links to its original ad on another listing site.')
    expect(lede('vi', 'all')).toBe('3.741 tin cho thuê tại Quận 2 (Thủ Đức). Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.')
    expect(lede('en', 'all')).not.toMatch(/trust/)
    expect(lede('en', 'none')).toBe(`3,741 places for rent in District 2 (Thu Duc). ${REPORT_SENTENCE.en}`)
    expect(lede('vi', 'none')).toBe(`3.741 tin cho thuê tại Quận 2 (Thủ Đức). ${REPORT_SENTENCE.vi}`)
  })

  /**
   * ⛔ OWNER DECISION 2026-10-04: no trust-score claim on these pages — "Every seller has a public trust
   * score" was untrue where official partners (badge instead) and ownerless storefronts (no score) hold
   * the shelf. Every tail here must be the description's own sentence — the same category-copy.ts
   * source — in both languages, so the page and its meta cannot say two things. Teachers are the one
   * deliberate exception, pinned two tests down: the description has no tail at all (CS-3 V2-9b,
   * approved), the page the /c/teachers lede's contact sentence.
   */
  it('ends on the district description\'s own tail, for every category, tier and count, in both languages', () => {
    const at = { place: { en: 'District 1', vi: 'Quận 1' }, inHcmc: false }
    const cats = [
      { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
      { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
      { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
      { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' },
    ]
    for (const cat of cats) for (const linked of ['none', 'all', 'most', 'some'] as const) for (const total of [1, 30]) {
      if (total === 1 && linked !== 'none' && linked !== 'all') continue // at 1 the tier can only be all/none (linkedTier)
      for (const lang of ['en', 'vi'] as const) {
        const page = text(lang, <DistrictLede total={total} name={cat.name} nameVi={cat.nameVi} categorySlug={cat.slug} place={at.place} linked={linked} />)
        const meta = districtMetadata({ ...at, category: cat, total, linked }, lang, 'eno.vn').description
        const tail = linked === 'none' ? REPORT_SENTENCE[lang] : districtLinkedSentence(linked, cat.slug, lang, total)
        expect(page.slice(-tail.length - 2), `${cat.slug} ${linked} ${total} ${lang}`).toBe(`. ${tail}`)
        expect(meta.slice(-tail.length - 2), `${cat.slug} ${linked} ${total} ${lang}`).toBe(`. ${tail}`)
        expect(`${page} ${meta}`).not.toMatch(/trust score|uy tín|tin xấu|fewer fakes|bait|giá mồi|hàng giả|partner|đối tác/i)
      }
    }
  })

  it('jobs say "a job site" on the page, as in their description (CS-3 claim 4)', () => {
    const jobs = { name: 'Jobs', nameVi: 'Việc làm', categorySlug: 'jobs', place: { en: 'District 1', vi: 'Quận 1' } }
    expect(text('en', <DistrictLede total={30} {...jobs} linked="all" />)).toBe('30 jobs listings in District 1. Every one links to its original listing on a job site.')
    expect(text('vi', <DistrictLede total={30} {...jobs} linked="most" />)).toBe('30 tin việc làm tại Quận 1. Phần lớn dẫn tới tin gốc trên trang tuyển dụng.')
    expect(text('en', <DistrictLede total={1} {...jobs} linked="all" />)).toBe('1 jobs listing in District 1. It links to its original listing on a job site.')
    expect(text('en', <DistrictLede total={30} {...jobs} linked="some" />)).not.toMatch(/source site/)
  })

  it('teachers carry the /c/teachers lede\'s contact sentence, never the listings one (CS-3 claim 6)', () => {
    const t = { name: 'Teachers', nameVi: 'Giáo viên', categorySlug: 'teachers', place: { en: 'District 1', vi: 'Quận 1' } }
    expect(text('en', <DistrictLede total={14} {...t} linked="none" />)).toBe(`14 teachers listings in District 1. ${TEACHERS_CONTACT_SENTENCE.en}`)
    expect(text('vi', <DistrictLede total={14} {...t} linked="none" />)).toBe(`14 tin giáo viên tại Quận 1. ${TEACHERS_CONTACT_SENTENCE.vi}`)
    // The description beside it keeps CS-3 V2-9b's approved shape — the count and nothing after it.
    const meta = (lang: 'en' | 'vi') =>
      districtMetadata({ place: t.place, inHcmc: false, category: { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' }, total: 14, linked: 'none' }, lang, 'eno.vn').description
    expect(meta('en')).toBe('14 teachers listings in District 1.')
    expect(meta('vi')).toBe('14 tin giáo viên tại Quận 1.')
    for (const lang of ['en', 'vi'] as const) {
      expect(text(lang, <DistrictLede total={1} {...t} linked="none" />)).not.toMatch(/trust|uy tín|report|báo cáo|fewer fakes|giá mồi/i)
      // Word for word the /c/teachers lede's own sentence (category-lede.tsx).
      expect(text(lang, <CategoryLede name="Teachers" nameVi="Giáo viên" slug="teachers" />)).toContain(TEACHERS_CONTACT_SENTENCE[lang])
    }
  })

  it('keeps "listings" wording for categories other than rentals', () => {
    const t = text('en', <DistrictLede total={3} name="Services" nameVi="Dịch vụ" categorySlug="services" place={{ en: 'Binh Trung', vi: 'Bình Trưng' }} linked="most" />)
    expect(t).toBe('3 services listings in Binh Trung. Most link to their original listing on a source site.')
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

describe('CategoryLede — the report sentence only where nothing is linked', () => {
  const cat = { name: 'Electronics', nameVi: 'Đồ điện tử', slug: 'electronics' }

  it.each(['all', 'most', 'some'] as const)('%s linked: renders exactly CATEGORY_LINKED_SENTENCE, no trust claim', (tier) => {
    for (const lang of ['en', 'vi'] as const) {
      const out = text(lang, <CategoryLede {...cat} linked={tier} />)
      expect(out).toBe(CATEGORY_LINKED_SENTENCE[tier][lang])
      expect(out).not.toMatch(/trust|uy tín/i)
    }
  })

  // Owner 2026-10-04: the description's REPORT_SENTENCE — no trust-score claim, no bait-price comparison
  // (CS-3 claim 3) and no "on eno.vn" (eno.forum printed it about itself).
  it('renders exactly REPORT_SENTENCE where nothing is linked (and by default)', () => {
    for (const lang of ['en', 'vi'] as const) {
      expect(text(lang, <CategoryLede {...cat} linked="none" />)).toBe(REPORT_SENTENCE[lang])
      expect(text(lang, <CategoryLede {...cat} />)).toBe(REPORT_SENTENCE[lang])
      expect(categoryMetadata(cat, 'none', 'eno.vn', lang).description.endsWith(` ${REPORT_SENTENCE[lang]}`)).toBe(true)
      expect(text(lang, <CategoryLede {...cat} total={12} />)).not.toMatch(/trust|uy tín|tin xấu|fewer fakes|bait|giá mồi|hàng giả|eno\.vn/i)
    }
  })

  it('jobs keeps its own linked-postings sentence whatever the tier', () => {
    expect(text('en', <CategoryLede name="Jobs" nameVi="Việc làm" slug="jobs" linked="all" />)).toMatch(/^Most jobs here link to the original posting/)
  })
})

describe('categoryMetadata — every non-rentals category', () => {
  it('drops the trust sentence once anything is linked', () => {
    for (const tier of ['all', 'most', 'some'] as const) {
      const m = categoryMetadata({ slug: 'electronics', name: 'Electronics' }, tier, 'eno.vn')
      expect(m.title).toBe('Electronics in Vietnam | eno.vn')
      expect(m.description).toBe(`Browse electronics for expats in Vietnam. ${CATEGORY_LINKED_SENTENCE[tier].en}`)
      expect(`${m.title} ${m.description}`).not.toMatch(/trust/i)
    }
  })

  // SEO wave B, V2 (CS-3 claims 2 and 3, owner 2026-10-01): no "— Trusted listings", no bait-price
  // comparison; owner 2026-10-04: the report sentence, not the trust-score claim.
  it('ends on the report sentence, without "Trusted" or any trust claim, when nothing is linked', () => {
    expect(categoryMetadata({ slug: 'sports', name: 'Sports' }, 'none', 'eno.vn')).toEqual({
      title: 'Sports in Vietnam | eno.vn',
      description: 'Browse sports for expats in Vietnam. Members can report any listing that breaks the rules.',
    })
  })
})

describe('RentIndexLink', () => {
  /**
   * ⚠️ THE EDITION IS READ ONCE AT IMPORT and vitest pins it to 'services', so the marketplace render
   * re-imports the component and the language context together (same instance — see footer.test.tsx).
   */
  async function render(edition: 'marketplace' | 'services', lang: 'en' | 'vi') {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
    try {
      const ctx = await import('@/context/language-context')
      const { RentIndexLink } = await import('./category-text')
      const out = renderToString(
        <ctx.LanguageProvider initialLang={lang} initialViDict={{}}>
          <RentIndexLink />
        </ctx.LanguageProvider>,
      )
      const el = document.createElement('div')
      el.innerHTML = out
      return { el, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() }
    } finally {
      vi.unstubAllEnvs()
    }
  }

  it('links /hcmc-rent-index, with no fragment, in the page language', async () => {
    for (const [lang, want] of [
      ['en', 'Median rent by district: HCMC Rent Index'],
      ['vi', 'Giá thuê trung vị theo quận: Chỉ số giá thuê nhà TP.HCM'],
    ] as const) {
      const { el, text: t } = await render('marketplace', lang)
      expect(t).toBe(want)
      expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/hcmc-rent-index'])
    }
  })

  it('renders nothing on eno.forum, where the rent index is a 404', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const { el, text: t } = await render('services', lang)
      expect(el.querySelector('a[href^="/hcmc-rent-index"]')).toBeNull()
      expect(t).toBe('')
    }
  })
})

describe('CategoryLede on /c/jobs — the site\'s own name', () => {
  /** Same re-import as RentIndexLink above: the edition is read once at import. */
  async function jobsLede(edition: 'marketplace' | 'services', lang: 'en' | 'vi') {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
    try {
      const ctx = await import('@/context/language-context')
      const { CategoryLede: Lede } = await import('@/components/marketplace/category-lede')
      const el = document.createElement('div')
      el.innerHTML = renderToString(
        <ctx.LanguageProvider initialLang={lang} initialViDict={{}}>
          <Lede name="Jobs" nameVi="Việc làm" slug="jobs" linked="all" />
        </ctx.LanguageProvider>,
      )
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    } finally {
      vi.unstubAllEnvs()
    }
  }

  // eno.forum printed "eno.vn does not handle applications" about itself.
  it('names eno.vn on the marketplace and eno.forum on the forum, in both languages', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const vn = await jobsLede('marketplace', lang)
      const forum = await jobsLede('services', lang)
      expect(vn).toContain(lang === 'vi' ? 'eno.vn không xử lý hồ sơ' : 'eno.vn does not handle applications')
      expect(forum).toContain(lang === 'vi' ? 'eno.forum không xử lý hồ sơ' : 'eno.forum does not handle applications')
      expect(forum).not.toContain('eno.vn')
      expect(forum.replace('eno.forum', 'eno.vn')).toBe(vn) // the same sentence, the name swapped
    }
  })
})

/* ── SEO wave B, D1: rentals district pages list homes (CS-2, approved 2026-09-30) ─────────────── */
describe('rentals district copy (D1)', () => {
  const D7 = { en: 'District 7 (Phu My Hung)', vi: 'Quận 7 (Phú Mỹ Hưng)' }
  const homes = homeFacts({ 'apartment-rental': 1877, 'house-rental': 277, 'room-rental': 196, 'office-rental': 212 })
  const base = { name: 'Rentals', nameVi: 'Cho thuê', categorySlug: 'rentals', place: D7, linked: 'all' as const }
  const html2 = (lang: 'en' | 'vi', node: React.ReactNode) => {
    const el = document.createElement('div')
    el.innerHTML = html(lang, node)
    return el
  }

  it.each(['apartments-houses', 'apartments'] as const)('%s: the H1 is DISTRICT_RENTALS_H1 + the place, in both languages', (h) => {
    for (const lang of ['en', 'vi'] as const) {
      expect(text(lang, <RentalsDistrictHeading headline={h} place={D7} />)).toBe(`${DISTRICT_RENTALS_H1[h][lang]} ${D7[lang]}`)
    }
  })

  it('the D-f sentences render exactly RENTALS_LINKED_SENTENCE', () => {
    for (const lang of ['en', 'vi'] as const) {
      for (const tier of ['all', 'most', 'some'] as const) {
        // The `tr` a page gets: the English, or the authored Vietnamese.
        const tr = (en: string, vi?: string) => (lang === 'vi' ? vi ?? en : en)
        expect(rentalsLinkedLede(tier, false, tr)).toBe(RENTALS_LINKED_SENTENCE[tier][lang])
        expect(rentalsLinkedLede(tier, true, tr)).toBe(RENTALS_LINKED_SENTENCE.one[lang])
      }
    }
  })

  it.each(['en', 'vi'] as const)('%s: with homes, the lede counts homes and names no office', (lang) => {
    const t = text(lang, <DistrictLede total={2562} {...base} homes={homes} homesLinked="all" slug="d7" />)
    expect(t).toBe(lang === 'vi'
      ? '2.350 chỗ ở cho thuê tại Quận 7 (Phú Mỹ Hưng), gồm 1.877 căn hộ, 277 nhà và 196 phòng trọ. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.'
      : '2,350 homes for rent in District 7 (Phu My Hung), including 1,877 apartments, 277 houses and 196 rooms. Every listing links to its original ad on another listing site.')
    expect(t).not.toMatch(/office|văn phòng|mặt bằng/i)
  })

  it('"1 home", in the count and the tail', () => {
    const one = homeFacts({ 'room-rental': 1 })
    expect(text('en', <DistrictLede total={1} {...base} homes={one} homesLinked="all" />)).toBe('1 home for rent in District 7 (Phu My Hung), including 1 room. It links to its original ad on another listing site.')
  })

  it.each(['en', 'vi'] as const)('%s: the three Thu Duc pages cross-link, followed', (lang) => {
    const ALL = ['d2', 'd9', 'thu-duc']
    const links = (slug: string, linkable = ALL) => [...html2(lang, <DistrictLede total={50} {...base} homes={homes} homesLinked="all" slug={slug} linkable={linkable} />).querySelectorAll('a')]
      .map((a) => [a.getAttribute('href'), a.getAttribute('rel')])
    expect(links('thu-duc')).toEqual([['/c/rentals/d2', null], ['/c/rentals/d9', null]])
    expect(links('d2')).toEqual([['/c/rentals/thu-duc', null]])
    expect(links('d9')).toEqual([['/c/rentals/thu-duc', null]])
    expect(links('d7')).toEqual([])
    // A page under the floor is named, never linked (it may be noindex).
    expect(links('thu-duc', ['d2'])).toEqual([['/c/rentals/d2', null]])
    expect(links('d2', [])).toEqual([])
    const t = text(lang, <DistrictLede total={50} {...base} homes={homes} homesLinked="all" slug="thu-duc" linkable={ALL} />)
    expect(t).toContain(lang === 'vi'
      ? 'Trang này gồm toàn bộ TP Thủ Đức, kể cả các tin vẫn ghi Quận 2 (Thảo Điền) hoặc Quận 9.'
      : 'This page covers all of Thu Duc City, including listings still labelled District 2 (Thao Dien) or District 9.')
    expect(text(lang, <DistrictLede total={50} {...base} homes={homes} homesLinked="all" slug="d2" linkable={[]} />)).toContain(lang === 'vi'
      ? 'Quận 2 được sáp nhập vào TP Thủ Đức năm 2021. Các tin này cũng có trên trang TP Thủ Đức.'
      : 'District 2 became part of Thu Duc City in 2021. These listings are also on the Thu Duc City page.')
  })

  it.each(['en', 'vi'] as const)('%s: offices sit behind one nofollow link, and nothing at 0', (lang) => {
    const el = html2(lang, <OtherRentalsLink n={212} href="/?category=rentals&district=d7&subcategory=office-rental" />)
    const a = el.querySelector('a')!
    expect(a.getAttribute('rel')).toBe('nofollow')
    expect(a.getAttribute('href')).toBe('/?category=rentals&district=d7&subcategory=office-rental')
    expect(a.textContent).toBe(lang === 'vi' ? 'Ngoài ra còn 212 văn phòng, mặt bằng cho thuê' : 'Also here: 212 offices and shopfronts')
    expect(html(lang, <OtherRentalsLink n={0} href="/x" />)).toBe('')
    expect(text(lang, <OtherRentalsLink n={1} href="/x" />)).toBe(lang === 'vi' ? 'Ngoài ra còn 1 văn phòng, mặt bằng cho thuê' : 'Also here: 1 office or shopfront')
  })

  it('the district page renders the availability hint on rentals only, under the lede', () => {
    const src = readFileSync('src/app/[lang]/c/[category]/[district]/page.tsx', 'utf8')
    expect(src).toMatch(/\{rentals && <RentalCheckHint /)
    expect(src).toMatch(/const rentals = cat\.slug === 'rentals'/)
  })
})
