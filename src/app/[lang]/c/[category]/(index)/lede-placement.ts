/**
 * WHERE THE CATEGORY LEDE RENDERS — decision H-c (SEO wave B plan v4). The layout, the page and the
 * skeleton all read this one value, and so do the contract test and H2's crawler spec, so none of
 * them can disagree with the code:
 * - 'page': `CategoryLedeBlock` renders first in `(index)/page.tsx`, below the loading boundary, so for
 *   anything that reads the HTML without JavaScript it is hidden with the grid in
 *   `<div hidden id="S:0">`; `(index)/loading.tsx` drew the lede bars in its place. (HISTORY: since UX3 FAST-8,
 *   2026-10-05, there is no `(index)/loading.tsx`, so 'page' would now render inline as well.)
 * - 'layout': it renders under the H1 in `(index)/layout.tsx`, above the boundary, visible to crawlers;
 *   the shell then waits on the block's COUNTs on a cold render and on every category-to-category
 *   navigation, and the skeleton drops the lede bars.
 * ⚠️ 'layout' ships only if the H-gate shows no regression against the build before H1b in the cold
 * first byte, the category → category time to the first visible change, and the time to the new H1
 * (each no worse than the larger of 10% and 50 ms, in medians).
 * IT SAYS 'layout' SINCE H1b (H-gate, 2026-09-28, both placements built and measured against the build
 * before H1b): cold first byte on /c/rentals and /c/electronics, en and vi, 7 fresh starts each, -16
 * to +14 ms; category → category, 4x CPU, 5 runs each way, prefetched or not, new H1 -41 to +69 ms
 * (the H1 is the first visible change in every one); Lighthouse, 13-14 runs a page, LCP -4% and +0%,
 * TBT +8% and -4% on /c/rentals and /c/electronics. The full tables are in the H1b commit message.
 * ⚠️ ITS OWN MODULE, so a Playwright spec can read it without loading the database client that
 * `category-lede-block.tsx` pulls in. Its one import (since 2026-11-14) is itself import-free and RELATIVE — the spec
 * resolves no path alias (goods-surface.test.ts holds both to that).
 */
import { isGoodsCategory } from '../../../../../lib/goods-surface'

export const LEDE_PLACEMENT = 'layout' as 'page' | 'layout'

/**
 * ⛔ WHERE ONE CATEGORY'S LEDE RENDERS (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options
 * and deploy"). A goods category (src/lib/goods-surface.ts — /c/electronics, /c/fashion, …) renders it WHOLE, right AFTER THE
 * GRID, from the page — 'after-grid': `<CategoryLedeBlock placement="after-grid">` between the grid's end and Guides, so the
 * count and "Most listings here link to their original on a source site" close the listings they describe (it reverses, for
 * goods, decision H-c's one placement for every category and clamped-lede.tsx's "ONE LINE SINCE 2026-10-18": below the grid
 * there is no fold to budget). Every other category keeps `LEDE_PLACEMENT`. Still inline in the first HTML (no Suspense),
 * still exactly one `[data-category-lede]` per page, and still after the grid in the DOM, not only on screen (layout.tsx).
 */
export function ledePlacementFor(slug: string): 'page' | 'layout' | 'after-grid' {
  return isGoodsCategory(slug) ? 'after-grid' : LEDE_PLACEMENT
}
