import { migrateLegacyCategoryParams, rangeFacetsFor, facetsFor, facetParamName } from '@/lib/taxonomy'
import { canonicalFacetValue } from '@/lib/multi-facet'
import { queryForExplicitDistrict } from '@/components/marketplace/explorer-place'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'

/**
 * WHAT THE EXPLORER'S URL SAYS, READ IN ONE PURE PASS — the single reader behind both of the
 * explorer's ways of taking state from a URL:
 *   · `applyParams` (listings-explorer.tsx) — the mount / popstate / `eno:apply-url` path, which
 *     sets each axis through its setter; and
 *   · the explorer's `useState` initialisers on a CLIENT-SIDE mount (Back from a listing, an in-app
 *     link), where there is no server HTML to agree with, so the state can START as the URL says.
 *
 * ⛔ WHY THE SECOND PATH EXISTS (E-BACK, 2026-09-29). Back to the explorer used to paint the TOP of
 * the unfiltered feed for 500–750ms before the snapshot restore put the reader back: the URL was
 * applied in a passive effect (after paint), and the restore waits for the feed's signature to
 * match the snapshot's — which, for a search, also waited out the 150ms debounce. Seeding every
 * axis from here makes the signature match in the FIRST render, so the restore runs in the first
 * layout effect, before anything paints.
 * ⚠️ EVERY AXIS `applyParams` SETS MUST BE HERE, or the seeded signature differs from the snapshot's
 * and the restore silently falls back to the top (today's behaviour — so a miss is a lost restore,
 * not a wrong one). Add an axis to the explorer's URL reader and it goes here, once.
 *
 * ⚠️ PURE AND SERVER-SAFE: no `window`, no React. The caller passes `location.search`. Cold loads
 * (hydration) never read it here — the server rendered the unfiltered home, and seeding from the URL
 * there would be a hydration mismatch — so they keep the effect path.
 */

/** 'newest' is the legacy param name for the DEFAULT relevance blend; true recency is 'recent'. */
export type ExplorerSort = 'newest' | 'recent' | 'price-low' | 'price-high' | 'popular'
export type ExplorerView = 'compact' | 'grid' | 'map' | 'video'

export type ExplorerUrlState = {
  query: string
  looseMatch: boolean
  category: string
  district: string
  subcategory: string
  brand: string
  model: string
  line: string
  listingType: string
  condition: string
  goodPrice: boolean
  sort: ExplorerSort
  priceRange: string
  customFilters: Record<string, string>
  /** `?view=` when it names a view, else null (the explorer keeps its default). */
  view: ExplorerView | null
  /**
   * `?province=` / `?ward=` — the Area panel's place as unit CODES ('' = none), UX3 NAV-2. The explorer turns
   * them back into areas through src/lib/vn-areas.ts. A ward without a province is not a place (wards are
   * looked up inside their province), so it reads as no ward. ⛔ The "near you" circle is never in the URL.
   */
  province: string
  ward: string
  /**
   * The URL directs the feed: any axis the explorer's `showExplorer` latch reads, or a view. The
   * same answer the latch and the `?view=` reader reach after mount — computed here so a client
   * mount does not paint one frame of the undirected home chrome first.
   */
  directed: boolean
}

/**
 * The custom filters INTO a request / URL — `parseFilterParams`'s other half. Custom filters are keyed by facet KEY in
 * state, but range facets (year/mileage/engine/size/salary) travel in the URL + API keyed by their numeric COLUMN as
 * `range_<col>` (so the API can do a numeric range query); everything else is `attr_<key>` — taxonomy.ts facetParamName,
 * the one mapping, which a saved search's link writes through too (saved-search.ts toUrlParams).
 * ⚠️ A facet this view does not offer is DROPPED (a stale value never reaches the feed) — the explorer's own rule; a
 * saved search keeps such a stored key as `attr_<key>`, exactly as it always applied it.
 * (Moved here from listings-explorer.tsx, 2026-10-09, so the saved-search tests can build the explorer's own request.)
 */
export function applyFilterParams(p: URLSearchParams, customFilters: Record<string, string>, categorySlug: string, subcategorySlug: string) {
  const sub = subcategorySlug === 'all' ? null : subcategorySlug
  const facets = facetsFor(categorySlug, sub)
  Object.entries(customFilters).forEach(([key, val]) => {
    if (!val || val === 'all') return
    if (!facets.some((x) => x.key === key)) return // facet not valid for this (category, subcategory) — drop stale value
    // A multi facet's list goes out canonical (taxonomy order, unknown parts dropped — src/lib/multi-facet.ts), so one
    // search is one URL and one cache key; a list with nothing valid left is no filter.
    const out = canonicalFacetValue(key, val)
    if (out) p.set(facetParamName(key, categorySlug, sub), out)
  })
}

/**
 * Custom filters (`attr_*` + `range_*`) keyed back by FACET key.
 * ⛔ ONLY A FACET THIS VIEW OFFERS. `?category=rentals&attr_bedrooms=2` (no subcategory — bedrooms
 * is an apartment/house/room facet) used to land in state, draw a "bedrooms: 2" chip, and then be
 * dropped from the request by applyFilterParams: a chip that filtered nothing (audit 2026-09-25).
 * (Moved here verbatim from listings-explorer.tsx so the URL reader is one pure function.)
 */
export function parseFilterParams(p: URLSearchParams, categorySlug: string, subcategorySlug: string): Record<string, string> {
  const sub = subcategorySlug === 'all' ? null : subcategorySlug
  const rf = rangeFacetsFor(categorySlug, sub)
  const chipKeys = new Set(facetsFor(categorySlug, sub).filter((f) => f.kind !== 'range').map((f) => f.key))
  const out: Record<string, string> = {}
  p.forEach((value, key) => {
    if (key.startsWith('attr_')) {
      const k = key.replace('attr_', '')
      // ⚠️ A multi facet's list is read canonical too: a stale part would otherwise sit in state as a chip that filters
      // nothing — the exact thing this function's offered-only rule exists to prevent.
      const v = chipKeys.has(k) ? canonicalFacetValue(k, value) : null
      if (v) out[k] = v
    }
    else if (key.startsWith('range_')) {
      const col = key.replace('range_', '')
      const f = rf.find((x) => x.range.column === col)
      if (f) out[f.key] = value
    }
  })
  return out
}

const SORTS: readonly ExplorerSort[] = ['recent', 'price-low', 'price-high', 'popular']
const VIEWS: readonly ExplorerView[] = ['compact', 'grid', 'map', 'video']
/** An administrative unit code from the URL — digits only (vn-units codes), else '' (junk is no place). */
const unitCode = (v: string | null): string => (v && /^\d{1,6}$/.test(v) ? v : '')

/** Every axis `applyParams` sets, from one query string (with or without the leading `?`). */
export function readExplorerUrl(search: string | URLSearchParams): ExplorerUrlState {
  const params = migrateLegacyCategoryParams(new URLSearchParams(search))
  const category = params.get('category') || 'all'
  const subcategory = params.get('subcategory') || 'all'
  const district = params.get('district') || 'all'
  // ⚠️ With an explicit `?district=` the server strips a district phrase from `q`, so the box shows
  // the words it actually searches (explorer-place.ts) rather than a phrase it ignores.
  const query = queryForExplicitDistrict(params.get('q') || '', params.get('district'))
  const pmin = params.get('priceMin'), pmax = params.get('priceMax')
  const sortParam = params.get('sort')
  const viewParam = params.get('view')
  const state: Omit<ExplorerUrlState, 'directed'> = {
    query,
    looseMatch: params.get('match') === 'any', // visual search lands with ?match=any
    category,
    district,
    subcategory,
    brand: params.get('brand') || 'all',
    model: params.get('model') || 'all',
    line: params.get('line') || '',
    listingType: params.get('type') || 'all',
    condition: params.get('condition') || 'all',
    // Only the literal 'good' — the same allowlist the server applies.
    goodPrice: params.get('deal') === 'good',
    // Unknown/absent → the default relevance blend ('newest' — legacy param name).
    sort: SORTS.includes(sortParam as ExplorerSort) ? (sortParam as ExplorerSort) : 'newest',
    priceRange: pmin || pmax ? `${pmin || ''}-${pmax || ''}` : 'all',
    customFilters: parseFilterParams(params, category, subcategory),
    view: VIEWS.includes(viewParam as ExplorerView) ? (viewParam as ExplorerView) : null,
    province: unitCode(params.get('province')),
    ward: unitCode(params.get('province')) ? unitCode(params.get('ward')) : '',
  }
  return { ...state, directed: isDirected(state) }
}

/**
 * ⚠️ THE SAME AXIS LIST AS THE EXPLORER'S `showExplorer` LATCH (its useLayoutEffect), plus a view —
 * the explorer's `?view=` reader opens the results view for any recognised view. `sort` and
 * `match` are deliberately absent: they reorder or loosen the same set, they do not direct it.
 * The area (province / ward, NAV-2) directs it too: the explorer's `isLandingMode` already leaves
 * undirected browse on an applied province or ward.
 */
function isDirected(s: Omit<ExplorerUrlState, 'directed'>): boolean {
  return (
    s.category !== 'all' || s.query.trim() !== '' || s.district !== 'all' || s.subcategory !== 'all' ||
    s.brand !== 'all' || s.model !== 'all' || s.line !== '' || s.listingType !== 'all' ||
    s.condition !== 'all' || s.goodPrice || s.priceRange !== 'all' || Object.keys(s.customFilters).length > 0 ||
    s.view !== null || s.province !== '' || s.ward !== ''
  )
}

/**
 * Is this the feed the server seeded — page one of the unfiltered, default-order home? The same gate
 * as the explorer's react-query `initialData` (every filter at its default, sort 'newest', no words;
 * `line` is absent there too — it is only ever sent under a brand, and the brand is in the gate).
 * A URL that is anything else starts a client mount with NO rows rather than the ISR seed, which
 * answers a different question (E-BACK).
 */
export function isSeededFeed(s: ExplorerUrlState): boolean {
  return (
    s.category === 'all' && s.subcategory === 'all' && s.brand === 'all' && s.model === 'all' &&
    s.district === 'all' && s.condition === 'all' && !s.goodPrice && s.priceRange === 'all' &&
    s.listingType === 'all' && s.sort === 'newest' && !s.query.trim() && Object.keys(s.customFilters).length === 0 &&
    !s.province && !s.ward
  )
}

/**
 * ⛔ THE QUERY KEYS THAT DIRECT THE FEED AWAY FROM THE ISR SEED — the pre-paint mask's list (E-SSR
 * phase 1, 2026-09-29). The home route serves ONE 6h-ISR document for every query string, so a cold
 * /?q=honda paints the unfiltered seed (twelve unrelated cards, the whole catalogue's count, a
 * "Recommended" heading) until hydration, the request and the answer — ≈4s on a phone. A URL naming any
 * of these keys (with a value) is answered by something else, so its seed is masked from the first paint.
 * ⚠️ `sort` IS HERE AND NOT IN `isDirected`: a reordered feed is the same set, but the seed is in the
 * default order, so its cards would still sit in the wrong places. `view` counts unless it is the
 * default grid; every `attr_*` / `range_*` counts. Over-inclusion is cheap for the FEED — a key the reader
 * ignores (`deal=junk`) is answered by the seed itself and unmasks on the first effect.
 * ⛔ BUT NOT FOR THE HOME TEACHER SHELF, WHICH SITS ABOVE THE FEED SINCE 2026-10-28: the mask takes it out of
 * the layout (`display: none`, globals.css), so a masked URL the explorer then reads as the undirected home in
 * the default order makes it appear above an already painted grid. So `sort` masks only a value the explorer
 * APPLIES (`SORTS` — never `newest`, the seed's own order, and never junk, which readExplorerUrl reads as
 * `newest`): an explicit `?sort=newest` link is the seed exactly, shelf included (codex, commit gate 2026-10-28).
 * The other ignored values (`deal=junk`, `category=all`, `match` with no words) remain the accepted gap
 * globals.css names: nothing eno publishes carries one.
 * ⚠️ ONE LIST FOR THE SCRIPT AND THE TESTS: `PREPAINT_SCRIPT` is built from it by JSON.stringify, so the
 * browser's copy cannot drift from `explorerUrlMasks`.
 */
export const MASK_KEYS = ['q', 'category', 'subcategory', 'brand', 'model', 'line', 'type', 'condition', 'deal', 'sort', 'priceMin', 'priceMax', 'district', 'match', 'view', 'province', 'ward'] as const

/** Does this query string direct the feed away from the ISR seed? The rule `PREPAINT_SCRIPT` applies. */
export function explorerUrlMasks(search: string | URLSearchParams): boolean {
  const p = new URLSearchParams(search)
  let mask = false
  p.forEach((v, k) => {
    if (mask || !v) return
    if (k === 'view') { if (v !== 'grid') mask = true; return }
    // Only an order the explorer applies — see MASK_KEYS (`newest` and junk are the seed's own order).
    if (k === 'sort') { if ((SORTS as readonly string[]).includes(v)) mask = true; return }
    if ((MASK_KEYS as readonly string[]).includes(k) || k.startsWith('attr_') || k.startsWith('range_')) mask = true
  })
  return mask
}

/**
 * The home layout's pre-paint script (E-SSR). It runs in the FIRST chunk — (home)/layout.tsx is above
 * the route's loading boundary — so `html[data-explorer-directed]` is set before the seed can paint,
 * and globals.css masks the seed while it is. The explorer lifts it once the grid draws the URL's own
 * answer (listings-explorer.tsx, `awaitingUrlAnswer`).
 * ⚠️ ES5 SYNTAX, WRAPPED IN try: it is inline, un-transpiled, and runs before anything else can report
 * an error — a throw here must cost nothing but the mask.
 * ⚠️ 15s SAFETY NET: if the explorer never hydrates (no JS, a failed chunk), the attribute removes
 * itself and the page shows exactly what it showed before this existed — never a page of grey boxes.
 */
/**
 * ⛔ AND IT RESERVES THE RETURNING VISITOR'S RECENTS ROW (E-RETURNING option 1, owner O-16, 2026-09-30).
 * On the UNDIRECTED home, a visitor with at least one recent search (the header's own history,
 * `eno:recent_searches` — src/lib/reco-signals.ts) gets one 44px row of those searches between the
 * category grid and the toolbar. The list lives in localStorage, which the server cannot read, so
 * without this the row could only appear after hydration and push the toolbar and the feed down by
 * 60px — a layout shift on every returning cold load. Setting `html[data-has-recents]` here, before the
 * first paint, lets globals.css hold the row open from the first frame; the explorer fills it once it
 * hydrates and keeps the attribute in step afterwards (listings-explorer.tsx, `recentTerms`).
 * ⚠️ THE SAME TEST AS THE ROW: an array holding at least one non-blank string (`recentSearchTerms`).
 * A reservation the row then does not fill would be the shift this exists to prevent.
 * ⚠️ A directed URL returns before it: the row is an undirected-home affordance only.
 */
export const RECENTS_ATTR = 'data-has-recents'

/**
 * ⛔ THE HOME TEACHER SHELF'S PRE-PAINT HOLD (2026-10-28 — the shelf sits ABOVE the feed since then). Set by
 * `PREPAINT_SCRIPT` on every URL the mask covers, beside `data-explorer-directed` — but WITHOUT its 15s timer: globals.css
 * keeps the shelf `display: none` while it is set, so a box that may be about to unmount is never laid out above the
 * painted feed. Two shifts it prevents (codex + opus, commit gate 2026-10-28): a phone that has not hydrated within 15s
 * (the mask lifts, the shelf would appear, hydration would take it away again), and a masked URL the explorer then reads
 * as the plain home (`deal=junk`, `category=all`), where the shelf would pop in above the grid.
 * Released only by the reader: the explorer removes it the first time the feed's own state changes after mount
 * (listings-explorer.tsx, `feedSig`), so a later visit to the plain home shows the shelf as part of a change they made.
 * Until then the shelf stays out of that landing — the cost, and the right one for a deep link.
 */
export const SHELF_OFF_ATTR = 'data-shelf-off'

/** The recent searches the returning-visitor row shows: the non-blank strings, trimmed, newest first. */
export function recentSearchTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  // De-duplicated case-insensitively, first occurrence wins: the chips are keyed by term (gate 2026-09-30).
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue
    const t = x.trim()
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); out.push(t)
  }
  return out
}

export const PREPAINT_SCRIPT = `(function(){try{var K=${JSON.stringify(MASK_KEYS)};var S=${JSON.stringify(SORTS)};var m=false;new URLSearchParams(location.search).forEach(function(v,k){if(m||!v)return;if(k==='view'){if(v!=='grid')m=true;return}if(k==='sort'){if(S.indexOf(v)>-1)m=true;return}if(K.indexOf(k)>-1||k.indexOf('attr_')===0||k.indexOf('range_')===0)m=true});if(!m){try{var r=JSON.parse(localStorage.getItem(${JSON.stringify(RECENT_SEARCHES_KEY)})||'[]');if(Array.isArray(r))for(var i=0;i<r.length;i++){if(typeof r[i]==='string'&&r[i].trim()){document.documentElement.setAttribute(${JSON.stringify(RECENTS_ATTR)},'');break}}}catch(e){}return}var d=document.documentElement;d.setAttribute('data-explorer-directed','');d.setAttribute(${JSON.stringify(SHELF_OFF_ATTR)},'');setTimeout(function(){d.removeAttribute('data-explorer-directed')},15000)}catch(e){}})();`
