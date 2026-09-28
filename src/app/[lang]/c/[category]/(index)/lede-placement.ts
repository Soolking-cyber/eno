/**
 * WHERE THE CATEGORY LEDE RENDERS — decision H-c (SEO wave B plan v4). The layout, the page and the
 * skeleton all read this one value, and so do the contract test and H2's crawler spec, so none of
 * them can disagree with the code:
 * - 'page': `CategoryLedeBlock` renders first in `(index)/page.tsx`, below the loading boundary, so for
 *   anything that reads the HTML without JavaScript it is hidden with the grid in
 *   `<div hidden id="S:0">`; `(index)/loading.tsx` draws the lede bars in its place.
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
 * ⚠️ ITS OWN MODULE, with no imports, so a Playwright spec can read it without loading the database
 * client that `category-lede-block.tsx` pulls in.
 */
export const LEDE_PLACEMENT = 'layout' as 'page' | 'layout'
