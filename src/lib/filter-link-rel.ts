/**
 * ⛔ THE `rel` OF A FILTER CHIP'S LINK: nofollow whenever the link carries a query (Seobility crawl 2, 2026-11-24). A query is a
 * filtered view, and every filtered view canonicalises to its path (`/?category=…` → `/`, a shop's `?category=…` → the shop), so a
 * followed one hands a crawler another full copy of the page. The chips became links for "Open link in new tab" (owner,
 * 2026-11-07) and carried no rel: Seobility, which renders JavaScript, walked brand → model → model and counted 1,228 copies of the
 * 777 KB home page (1,228 of its 1,395 "pages with large file size"). nofollow is the rule category-filters-link.tsx already set for
 * links into `/?category=`; the new tab still opens. A link with no query (the home's bare category tile, `/c/<slug>`, tileHref)
 * is a real page and stays followed.
 * ⚠️ ITS OWN MODULE, IMPORTING NOTHING: ui/dropdown-menu.tsx (in every bundle) calls it, and explorer-url.ts pulls in the taxonomy.
 */
export function filterLinkRel(href: string): 'nofollow' | undefined {
  return href.includes('?') ? 'nofollow' : undefined
}
