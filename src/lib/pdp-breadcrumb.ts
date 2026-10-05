import { MARKETPLACE_SUBCAT_LABELS, POST_HIDDEN_ON_MARKETPLACE, subcategoriesFor } from '@/lib/taxonomy'
import { isRetiredNavCategory } from '@/lib/retired-categories'
import { vehicleHubPathFor } from '@/lib/vehicle-hub-slugs'

/**
 * THE LISTING PAGE'S BREADCRUMB TRAIL, AS DATA (NAV-10, UX3 2026-10-05) — the visible trail in
 * src/app/[lang]/listings/[id]/(pdp)/page.tsx and its BreadcrumbList JSON-LD are both built from here, so
 * the two cannot drift apart.
 *
 *   <site> / <category> / <subcategory> / <title>
 *
 * ⛔ THE ROOT IS THE SITE'S NAME, NEVER "Home". The category furniture-appliances is called "Home" in
 * English, so an English furniture listing read "Home / Home / …" (measured, nav audit N12) — and
 * "Trang chủ" in the JSON-LD said nothing a crawler could use. `siteName` is SITE_NAME at the call
 * site: eno.forum's trail must not name eno.vn.
 *
 * ⛔ A SUBCATEGORY CRUMB, SO THE TRAIL NO LONGER STOPS AT THE CATEGORY. A motorbike-rental listing's only
 * way up was "Cho thuê", whose page is about flats. Its target:
 *   · a car or motorbike hire listing in Ho Chi Minh City → its hub, in the page's language
 *     (/thue-xe-may-tphcm, /motorbike-rental-ho-chi-minh-city …) — a real, indexable page, so the JSON-LD
 *     carries it. Marketplace only: no eno.forum surface links the hubs (their route files say so).
 *   · anything else → the explorer filtered to category + subcategory. That URL canonicalises to `/`, so
 *     it is a visible crumb only — the same rule as a retired shelf's category crumb below: a
 *     BreadcrumbList item whose canonical is another page is a claim the page does not make.
 */

export type SubcategoryCrumb = {
  /** The taxonomy's names — the visible crumb renders `<Bilingual en={name} vi={nameVi || name} />`. */
  name: string
  nameVi: string
  /** A path, before localizedHref: the hub (already in the page's language) or the explorer. */
  href: string
  /** True for a hub: an indexable page, so a BreadcrumbList item too. */
  hub: boolean
}

export function subcategoryCrumb(
  l: { categorySlug: string; subcategorySlug: string | null | undefined; city: string | null | undefined },
  lang: 'en' | 'vi',
  marketplace: boolean,
): SubcategoryCrumb | null {
  if (!l.subcategorySlug) return null
  // ⛔ NOT FOR A SUBCATEGORY THIS EDITION WITHHOLDS (taxonomy.ts POST_HIDDEN_ON_MARKETPLACE — today
  // tickets-travel/visa-runs on eno.vn, O-34): the licensed marketplace's chrome must not ADD visa wording
  // to a page, whatever the row itself says. The category crumb still leads up.
  // ⚠️ THE EDITION'S LIST, NOT isPostableSubcategory (codex, gate 2026-10-05). Since UX2's O-34b that predicate
  // also asks WHO posts — a partner-only slot is closed to a poster it does not know — and a crumb is BROWSE
  // chrome, which O-34b left untouched: VietKite's partner listings in services/visa-legal stay on eno.vn as
  // "Giấy tờ & pháp lý", so their trail keeps that crumb, exactly as the category panel and facets show it.
  if (marketplace && POST_HIDDEN_ON_MARKETPLACE.has(`${l.categorySlug}/${l.subcategorySlug}`)) return null
  const sub = subcategoriesFor(l.categorySlug).find((s) => s.slug === l.subcategorySlug)
  if (!sub) return null
  // The edition's display name (MARKETPLACE_SUBCAT_LABELS: services/visa-legal reads "Legal & permits" on
  // eno.vn). TAXONOMY already carries it on a marketplace build; applying it by `marketplace` as well keeps
  // this function true for both editions in one process, as postableSubcategoriesFor does.
  const label = (marketplace && MARKETPLACE_SUBCAT_LABELS[`${l.categorySlug}/${sub.slug}`]) || sub
  const hub = marketplace ? vehicleHubPathFor(l, lang) : null
  const explorer = `/?${new URLSearchParams({ category: l.categorySlug, subcategory: sub.slug }).toString()}`
  return { name: label.name, nameVi: label.nameVi, href: hub ?? explorer, hub: hub !== null }
}

type LdItem = { '@type': 'ListItem'; name: string; item: string; position: number }

/**
 * The BreadcrumbList for the visible trail: the same levels, named in the page's language like the
 * crumbs (the category's `nameVi` on a Vietnamese page, as /c does since SEO wave B, V2), minus the
 * levels whose link canonicalises elsewhere (a retired shelf's category, an explorer subcategory). The
 * last item is the listing's source title, as before.
 */
export function pdpBreadcrumbLd(input: {
  hostUrl: string
  siteName: string
  lang: 'en' | 'vi'
  category: { slug: string; name: string; nameVi?: string | null }
  subcategory: SubcategoryCrumb | null
  title: string
  canonicalUrl: string
}) {
  const { hostUrl, siteName, lang, category, subcategory, title, canonicalUrl } = input
  const named = (en: string, vi: string | null | undefined) => (lang === 'vi' ? vi || en : en)
  const levels: Omit<LdItem, '@type' | 'position'>[] = [
    { name: siteName, item: hostUrl },
    ...(isRetiredNavCategory(category.slug) ? [] : [{ name: named(category.name, category.nameVi), item: `${hostUrl}/c/${category.slug}` }]),
    ...(subcategory?.hub ? [{ name: named(subcategory.name, subcategory.nameVi), item: `${hostUrl}${subcategory.href}` }] : []),
    { name: title, item: canonicalUrl },
  ]
  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: levels.map((l, i): LdItem => ({ '@type': 'ListItem', ...l, position: i + 1 })),
  }
}
