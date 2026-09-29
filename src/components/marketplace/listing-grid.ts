/**
 * THE listing grid — the same columns and gaps as RAIL_CARD_W / RAIL_SCROLLER in shelf.tsx and the
 * home feed (memory eno-card-feed-standards): 2 / 3 / 4 columns, 8px apart on a phone, 16px from sm.
 *
 * ⚠️ A PLAIN MODULE, NOT 'use client'. Server components import it too (saved/loading.tsx,
 * seo-landing.tsx, the /c skeleton); from a client module they would receive a client REFERENCE
 * in place of this string and render `class="[object Object]"`.
 *
 * ⚠️ ONE STRING, BECAUSE THE COPIES DRIFTED. Every grid carried its own literal, and the category,
 * storefront, saved and landing grids kept an older `gap-4` (16px on a phone) while the home feed
 * moved to `gap-2` — the same card sat 8px narrower on /c/* than on / (K-GRID-GAP, 2026-09-29).
 */
export const LISTING_GRID = 'grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4'
