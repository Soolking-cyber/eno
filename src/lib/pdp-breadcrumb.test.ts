import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdpBreadcrumbLd, subcategoryCrumb } from './pdp-breadcrumb'
import { POST_HIDDEN_ON_MARKETPLACE, TAXONOMY } from './taxonomy'
import { isHubCity, vehicleHubPathFor } from './vehicle-hub-slugs'

/**
 * NAV-10 (UX3, 2026-10-05): the listing page's trail is site / category / subcategory / title, its root is
 * the site's name, a vehicle hire listing climbs to its hub, and the BreadcrumbList is built from the same
 * model as the visible crumbs (nav audit N12: "Home / Home / …" in English; a motorbike's only crumb
 * opened /c/rentals, a page about flats).
 */

const HOST = 'https://eno.vn'
const bike = (city: string | null, sub = 'motorbike-rental') => ({ categorySlug: 'rentals', subcategorySlug: sub, city })

describe('isHubCity — the hubs\' city, however it is spelled', () => {
  it.each(['Hồ Chí Minh', 'TP. Hồ Chí Minh', 'Thành phố Hồ Chí Minh', 'Ho Chi Minh City', 'HỒ CHÍ MINH', 'ho chi minh', 'Hồ Chí Minh'.normalize('NFD')])('%s', (city) => {
    expect(isHubCity(city)).toBe(true)
  })
  it.each([null, undefined, '', 'Hà Nội', 'Đà Nẵng', 'Bình Dương'])('not %s', (city) => {
    expect(isHubCity(city)).toBe(false)
  })
})

describe('vehicleHubPathFor', () => {
  it('a car or motorbike hire listing in HCMC → its hub, in the page\'s language', () => {
    expect(vehicleHubPathFor(bike('Hồ Chí Minh'), 'vi')).toBe('/thue-xe-may-tphcm')
    expect(vehicleHubPathFor(bike('Hồ Chí Minh'), 'en')).toBe('/motorbike-rental-ho-chi-minh-city')
    expect(vehicleHubPathFor(bike('Ho Chi Minh City', 'car-rental'), 'vi')).toBe('/thue-xe-tu-lai-tphcm')
    expect(vehicleHubPathFor(bike('Ho Chi Minh City', 'car-rental'), 'en')).toBe('/car-rental-ho-chi-minh-city')
  })
  it('no hub for another city, another kind of vehicle, or another category', () => {
    expect(vehicleHubPathFor(bike('Hà Nội'), 'vi')).toBeNull()
    expect(vehicleHubPathFor(bike('Hồ Chí Minh', 'bicycle-rental'), 'vi')).toBeNull()
    expect(vehicleHubPathFor(bike('Hồ Chí Minh', 'apartment-rental'), 'vi')).toBeNull()
    expect(vehicleHubPathFor({ categorySlug: 'vehicles', subcategorySlug: 'motorbike-rental', city: 'Hồ Chí Minh' }, 'vi')).toBeNull()
  })
  it('the hub component re-exports the same slugs, so the four route files did not move (source contract)', () => {
    const HUB = readFileSync(join(process.cwd(), 'src/components/marketplace/vehicle-hub.tsx'), 'utf8')
    expect(HUB).toContain("export { VEHICLE_HUB_SLUGS } from '@/lib/vehicle-hub-slugs'")
    expect(HUB).not.toMatch(/export const VEHICLE_HUB_SLUGS/)
  })
})

describe('subcategoryCrumb', () => {
  it('a motorbike in HCMC, on the marketplace: the taxonomy\'s names, linking the hub (indexable)', () => {
    expect(subcategoryCrumb(bike('Hồ Chí Minh'), 'vi', true)).toEqual({ name: 'Motorbike', nameVi: 'Xe máy', href: '/thue-xe-may-tphcm', hub: true })
    expect(subcategoryCrumb(bike('Hồ Chí Minh'), 'en', true)?.href).toBe('/motorbike-rental-ho-chi-minh-city')
  })
  it('on eno.forum no surface links the hubs, so the same listing climbs to the explorer', () => {
    expect(subcategoryCrumb(bike('Hồ Chí Minh'), 'vi', false)).toEqual({
      name: 'Motorbike', nameVi: 'Xe máy', href: '/?category=rentals&subcategory=motorbike-rental', hub: false,
    })
  })
  it('anything without a hub → the explorer filtered to category + subcategory', () => {
    expect(subcategoryCrumb(bike('Hà Nội'), 'vi', true)?.href).toBe('/?category=rentals&subcategory=motorbike-rental')
    expect(subcategoryCrumb({ categorySlug: 'rentals', subcategorySlug: 'apartment-rental', city: 'Hồ Chí Minh' }, 'en', true))
      .toEqual({ name: 'Apartment', nameVi: 'Căn hộ', href: '/?category=rentals&subcategory=apartment-rental', hub: false })
  })
  it('no crumb without a subcategory, or for one the taxonomy does not know', () => {
    expect(subcategoryCrumb({ categorySlug: 'rentals', subcategorySlug: null, city: null }, 'en', true)).toBeNull()
    expect(subcategoryCrumb({ categorySlug: 'rentals', subcategorySlug: 'no-such-shelf', city: null }, 'en', true)).toBeNull()
  })

  it('eno.vn adds no visa wording: no crumb for a subcategory the marketplace withholds (O-34 visa runs)', () => {
    const run = { categorySlug: 'tickets-travel', subcategorySlug: 'visa-runs', city: 'Hồ Chí Minh' }
    expect(subcategoryCrumb(run, 'en', true)).toBeNull()
    expect(subcategoryCrumb(run, 'vi', true)).toBeNull()
    // eno.forum offers it, so there the trail has it.
    expect(subcategoryCrumb(run, 'en', false)?.href).toBe('/?category=tickets-travel&subcategory=visa-runs')
  })

  it('names the e-Visa subcategory the same on both editions (owner, 2026-10-14 — the eno.vn relabel of O-34 retired)', () => {
    const evisa = { categorySlug: 'services', subcategorySlug: 'visa-legal', city: null }
    for (const marketplace of [true, false]) {
      for (const lang of ['en', 'vi'] as const) {
        expect(subcategoryCrumb(evisa, lang, marketplace)).toMatchObject({ name: 'e-Visa', nameVi: 'Visa điện tử', href: '/?category=services&subcategory=visa-legal' })
      }
    }
    expect(subcategoryCrumb({ categorySlug: 'services', subcategorySlug: 'legal-permits', city: null }, 'vi', true))
      .toMatchObject({ name: 'Legal & permits', nameVi: 'Giấy tờ & pháp lý' })
  })

  it('every subcategory, both editions: eno.forum crumbs them all; eno.vn withholds exactly POST_HIDDEN_ON_MARKETPLACE', () => {
    let pairs = 0
    for (const c of TAXONOMY) {
      for (const sub of c.subcategories ?? []) {
        const l = { categorySlug: c.slug, subcategorySlug: sub.slug, city: null }
        const key = `${c.slug}/${sub.slug}`
        for (const lang of ['en', 'vi'] as const) {
          expect(subcategoryCrumb(l, lang, false), `${key} ${lang}`).not.toBeNull()
          expect(subcategoryCrumb(l, lang, true) === null, `${key} ${lang}`).toBe(POST_HIDDEN_ON_MARKETPLACE.has(key))
        }
        pairs++
      }
    }
    expect(pairs).toBeGreaterThan(50)
  })

  it('the licensed edition\'s crumbs never carry itinerary or PayPal wording, and visa wording only on the e-Visa aisle', () => {
    // Independent of POST_HIDDEN_ON_MARKETPLACE (codex, gate: a test that mirrors the hide-list is circular): whatever
    // the lists say, no crumb eno.vn renders may name a service it is not licensed to offer, in either language. The
    // ONE exception is the e-Visa subcategory, which the owner opened on eno.vn on 2026-10-14 (third parties sell
    // there, live after a licence check — eno itself still offers no visa service there).
    const BANNED = /itinerar|lịch trình|paypal/i
    const VISA = /visa|thị thực/i
    for (const c of TAXONOMY) {
      for (const sub of c.subcategories ?? []) {
        for (const lang of ['en', 'vi'] as const) {
          const crumb = subcategoryCrumb({ categorySlug: c.slug, subcategorySlug: sub.slug, city: null }, lang, true)
          if (!crumb) continue
          const words = `${crumb.name} ${crumb.nameVi}`
          expect(words, `${c.slug}/${sub.slug} ${lang}`).not.toMatch(BANNED)
          if (!(c.slug === 'services' && sub.slug === 'visa-legal')) expect(words, `${c.slug}/${sub.slug} ${lang}`).not.toMatch(VISA)
        }
      }
    }
  })
})

describe('pdpBreadcrumbLd — in step with the visible trail', () => {
  const home = { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' }
  const ld = (o: Partial<Parameters<typeof pdpBreadcrumbLd>[0]>) =>
    pdpBreadcrumbLd({ hostUrl: HOST, siteName: 'eno.vn', lang: 'en', category: home, subcategory: null, title: 'Sofa', canonicalUrl: `${HOST}/listings/x`, ...o })
  const names = (o: Partial<Parameters<typeof pdpBreadcrumbLd>[0]>) => ld(o).itemListElement.map((i) => i.name)

  it('the root is the site, not "Home" — the category of that name made the trail "Home / Home"', () => {
    expect(names({})).toEqual(['eno.vn', 'Home', 'Sofa'])
    expect(names({ siteName: 'eno.forum' })[0]).toBe('eno.forum')
    expect(ld({}).itemListElement.map((i) => [i.position, i.item])).toEqual([[1, HOST], [2, `${HOST}/c/furniture-appliances`], [3, `${HOST}/listings/x`]])
    expect(ld({})['@type']).toBe('BreadcrumbList')
  })

  it('names follow the page\'s language, like the crumbs (the category\'s nameVi)', () => {
    expect(names({ lang: 'vi' })).toEqual(['eno.vn', 'Nhà cửa', 'Sofa'])
  })

  it('a hub crumb is a real page and is listed; an explorer crumb canonicalises to `/` and is not', () => {
    const rentals = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
    const hub = subcategoryCrumb(bike('Hồ Chí Minh'), 'vi', true)
    expect(ld({ lang: 'vi', category: rentals, subcategory: hub }).itemListElement.map((i) => [i.name, i.item])).toEqual([
      ['eno.vn', HOST], ['Cho thuê', `${HOST}/c/rentals`], ['Xe máy', `${HOST}/thue-xe-may-tphcm`], ['Sofa', `${HOST}/listings/x`],
    ])
    const explorer = subcategoryCrumb(bike('Hà Nội'), 'vi', true)
    expect(names({ lang: 'vi', category: rentals, subcategory: explorer })).toEqual(['eno.vn', 'Cho thuê', 'Sofa'])
  })

  it('a retired shelf keeps no category crumb in the markup (its browse link is the explorer)', () => {
    expect(names({ category: { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' } })).toEqual(['eno.vn', 'Sofa'])
  })
})

describe('the listing page renders that model (source contract)', () => {
  const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

  it('the root crumb is SITE_NAME, never the "Home" UI string or a literal eno.vn', () => {
    expect(PAGE).toMatch(/<Link href=\{localizedHref\('\/', pageVariant\)\} prefetch=\{false\} className="[^"]*">\{SITE_NAME\}<\/Link>/)
    expect(PAGE).not.toContain('<Tr text="Home" />')
    expect(PAGE).not.toMatch(/'name': 'eno\.vn'/)
  })

  it('the JSON-LD and the visible subcategory crumb come from the same model', () => {
    expect(PAGE).toMatch(/const breadcrumbLd = pdpBreadcrumbLd\(\{[\s\S]*?siteName: SITE_NAME,[\s\S]*?subcategory,[\s\S]*?\}\)/)
    expect(PAGE).toContain('const subcategory = subcategoryCrumb(')
    expect(PAGE).toContain('<Link href={localizedHref(subcategory.href, pageVariant)} prefetch={false} rel={subcategory.hub ? undefined : \'nofollow\'}')
    expect(PAGE).toContain('<Bilingual en={subcategory.name} vi={subcategory.nameVi || subcategory.name} />')
  })
})
