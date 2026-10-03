/**
 * ── CATEGORIES TAKEN OUT OF NAVIGATION BY THE SECOND-HAND FOCUS ──────────────────────────────────────
 *
 * Owner, 2026-10-03: "remove tiki and cellphones products from the app, we will have tight focus on
 * second hand stores and rentals plus job postings". Hiding the new-goods catalogues left these four
 * shelves all but empty (measured that day: vehicles 2 live, books-stationery 6, hobbies-sports 4,
 * pets 0 — 95 of vehicles' 98 had been Tiki), so they leave every list that ADVERTISES categories:
 * the footer grid, the category rail and phone ladder, the header's first-visit shortcuts, search
 * suggestions, llms.txt and the "Other categories" chips on every /c/<slug> page.
 *
 * ⚠️ THEY STAY POSTABLE AND THEIR ROWS STAY VISIBLE. A person can still post a bike for sale; its PDP
 * renders; only the browse surfaces stop offering an empty shelf. (Blocking posting is a separate
 * owner decision — `isPostableCategory` is untouched.)
 *
 * ⛔ A LEAF MODULE WITH NO IMPORTS: next.config.ts imports it for the vehicles redirects, and next.config
 * resolves no `@/` alias.
 */
export const RETIRED_NAV_CATEGORIES: ReadonlySet<string> = new Set(['vehicles', 'pets', 'books-stationery', 'hobbies-sports'])

/**
 * Every category NO browse surface links: the four above, plus the ones measured empty — `property`,
 * `moving-sale`, `community-events` (0 live, 2026-09-27) and `sports` (0 live since SuperSports was hidden,
 * 2026-10-02). The footer grid (FOOTER_HIDDEN_CATEGORIES) and the "Other categories" chips on every
 * /c/<slug> page both read this, so the two can never disagree about which shelves are dead ends.
 * ⚠️ HAND-KEPT for the empty four: /c/<slug> lifts its own noindex the moment a listing lands, this does
 * not. When one fills, delete it here (re-measure first).
 */
export const UNLINKED_CATEGORIES: ReadonlySet<string> = new Set(['property', 'moving-sale', 'community-events', 'sports', ...RETIRED_NAV_CATEGORIES])

/** True when `slug` is one of the four the browse surfaces no longer offer. */
export const isRetiredNavCategory = (slug: string | null | undefined): boolean => !!slug && RETIRED_NAV_CATEGORIES.has(slug)

/**
 * Where a link to a category's browse page should point. Normally `/c/<slug>`; for a retired category
 * that 308s away (vehicles, on the marketplace) or is no longer offered, the explorer filtered to it —
 * `/?category=<slug>` — so a PDP breadcrumb on a bike listed for sale lands on bikes for sale, not on a
 * rental hub. The explorer URL canonicalises to `/`, so it adds no indexable duplicate.
 */
export function categoryBrowsePath(slug: string): string {
  return RETIRED_NAV_CATEGORIES.has(slug) ? `/?category=${encodeURIComponent(slug)}` : `/c/${slug}`
}

/** The shape next.config's `redirects()` takes. */
type Redirect = { source: string; destination: string; permanent: boolean }

/**
 * The categories whose /c/ pages (and district pages) redirect on the marketplace — the sitemap must not
 * submit them there (pages.xml/build.ts). Pets, books and hobbies are only left out of navigation.
 */
export const REDIRECTED_CATEGORY_SLUGS: readonly string[] = ['vehicles']

export function redirectedCategories(edition: string | undefined): ReadonlySet<string> {
  return new Set(edition === 'services' ? [] : REDIRECTED_CATEGORY_SLUGS)
}

/**
 * `/c/vehicles` (and its district pages) and `/motorbikes-for-sale-vietnam` → the HCMC motorbike-rental
 * hub, permanently (308) — the mapping the owner's brief named (2026-10-03). Vehicles held 2 live rows after
 * the hide and the for-sale landing 0 motorbikes, while the rental hubs carry thousands of live bikes.
 *
 * ⛔ ONE TARGET FOR EVERY VISITOR — NO LANGUAGE TWIN (commit-gate review, 2026-10-03). A first cut sent a
 * `lang=vi` cookie or a Vietnamese Accept-Language to /thue-xe-may-tphcm. That made the destination depend
 * on the request: a permanent redirect is cached by the browser per URL with no `Vary` to undo it, and a
 * temporary one gives up the consolidation. It also cut across the owner's own rule for language-pinned
 * pages (decision V-a, src/lib/lang-pinned.ts: "No language redirect" — a Vietnamese visitor on the English
 * page gets the one-tap banner to its twin, which /motorbike-rental-ho-chi-minh-city has: its pair is
 * /thue-xe-may-tphcm, with reciprocal hreflang).
 *
 * ⛔ MARKETPLACE EDITION ONLY. On eno.forum the hubs are self-canonical copies that no forum surface links
 * (footer.tsx gates them on IS_SERVICES, motorbike-rental-ho-chi-minh-city/page.tsx says why: promoting
 * the forum's duplicates competes with eno.vn's pages). A permanent redirect into one is the same
 * promotion, cached by browsers — so there /c/vehicles stays as it is.
 * ⚠️ NO `subcategory=car` RULE: nothing links `/c/vehicles?subcategory=…` (the category page reads no
 * query, car chips link the home explorer), so it would never fire (review, 2026-10-03).
 */
export function retiredCategoryRedirects(edition: string | undefined): Redirect[] {
  if (edition === 'services') return []
  const sources = [...REDIRECTED_CATEGORY_SLUGS.flatMap((slug) => [`/c/${slug}`, `/c/${slug}/:district`]), '/motorbikes-for-sale-vietnam']
  return sources.map((source) => ({ source, destination: '/motorbike-rental-ho-chi-minh-city', permanent: true }))
}
