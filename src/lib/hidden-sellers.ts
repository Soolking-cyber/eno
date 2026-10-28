import { appReviewGate } from '@/lib/app-review-gates'

/**
 * A BLOCK TAKES THE BLOCKED SIDE'S CONTENT OUT OF THE BLOCKER'S FEEDS — AT ONCE, AND BEFORE FIRST PAINT AFTER.
 *
 * App Store Guideline 1.2 (1.0.3 (4) rejected 2026-10-28): "blocking should … remove it from the user's feed
 * instantly". The feeds here are cached HTML and JSON shared by every visitor (ISR pages, the edge HTML cache, the
 * listings API), so the server cannot leave one user's blocked shops out of them. The browser does it instead, with
 * ONE stylesheet: every listing card, card cell and shelf item carries `data-sid="<sellerId>"`, the listing page and
 * the storefront wrap their content in it too, and a `<style id="eno-hidden-sellers">` hides each blocked shop's
 * `[data-sid]` and shows its `[data-sid-notice]` ("You blocked this seller"). No React state, so no feed, rail or
 * restore logic changes: a hidden card is simply not drawn.
 *
 * WHERE THE LIST COMES FROM: GET /api/blocks → `hiddenSellerIds` (src/lib/user-blocks.ts hiddenSellerIdsFor), synced
 * by AuthProvider whenever the signed-in account settles (syncHiddenSellers), and pushed the moment a Block answers
 * (hideSellerNow, then a fresh sync). It is kept in localStorage with the account it belongs to, and the head script
 * (HIDDEN_SELLERS_HEAD_JS, layout.tsx) applies it before first paint on the next load; a sign-out clears it.
 * ⚠️ A shop id is public — every card carries it — never a profile id.
 * Inert while `ugc-safety` is off: nothing is fetched, stored or styled.
 */

export const HIDDEN_SELLERS_KEY = 'eno-hidden-sellers'
export const HIDDEN_SELLERS_STYLE_ID = 'eno-hidden-sellers'

/**
 * What a shop id may look like before it goes into a selector (cuid today). ⛔ Anything else is dropped, never
 * escaped: the ids come from our own API, and a value that could close the attribute string has no business there.
 */
export const SELLER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The stylesheet for these shop ids ('' for none): hide every `[data-sid]` of theirs and every map pin (`.eno-sid-<id>`
 * — a Leaflet divIcon takes a class, not an attribute: listings-map.tsx), show every notice.
 */
export function hiddenSellersCss(ids: readonly string[]): string {
  const ok = [...new Set(ids)].filter((id) => SELLER_ID_RE.test(id))
  if (!ok.length) return ''
  // A SHELF (shelf.tsx) with no item outside these shops goes whole — no heading over an empty scroller (opus, review).
  // A skeleton or any non-card child has no `data-sid`, so it keeps its shelf.
  // ⚠️ ITS OWN RULE, LAST: a browser without `:has()` drops the whole rule a selector it cannot parse sits in, and the
  // cards must stay hidden there.
  const outside = ok.map((id) => `:not([data-sid="${id}"])`).join('')
  return (
    ok.map((id) => `[data-sid="${id}"],.eno-sid-${id}`).join(',') + '{display:none!important}' +
    ok.map((id) => `[data-sid-notice="${id}"]`).join(',') + '{display:block!important}' +
    `[data-shelf]:has([data-shelf-items]):not(:has([data-shelf-items]>${outside})){display:none!important}`
  )
}

/**
 * The pre-paint twin of applyHiddenSellers, for layout.tsx's <head> — the stored list, applied before the first frame
 * so a reload never flashes a blocked shop's cards. The SAME selectors as hiddenSellersCss (hidden-sellers.test.ts runs
 * this snippet and compares). '' while `ugc-safety` is off: the tag is then not emitted.
 * ⛔ NOT WITHOUT A SESSION ON THE WEB (codex, review): a browser with no `sb-` cookie is signed out, and a list stored
 * there belongs to whoever signed in last — so it waits for AuthProvider, which clears it. The apps skip that test, as
 * layout.tsx's `no-session` class does: their cookie can lag the first frame, and the app is one person's device.
 */
export function hiddenSellersHeadJs(on: boolean): string {
  if (!on) return ''
  return (
    '(function(){try{' +
    `var v=JSON.parse(localStorage.getItem(${JSON.stringify(HIDDEN_SELLERS_KEY)})||'null');` +
    'if(!v||!Array.isArray(v.ids))return;' +
    "var C=window.Capacitor,nat=(C&&C.isNativePlatform&&C.isNativePlatform())||/EnoNativeApp|EnoNativeTabs/.test(navigator.userAgent||'');" +
    "if(!nat&&('; '+document.cookie).indexOf('; sb-')<0)return;" +
    `var re=new RegExp(${JSON.stringify(SELLER_ID_RE.source)}),ok=[],seen={};` +
    'for(var i=0;i<v.ids.length;i++){var d=v.ids[i];if(typeof d==="string"&&re.test(d)&&!seen[d]){seen[d]=1;ok.push(d)}}' +
    'if(!ok.length)return;var a=[],b=[];' +
    "var o='';for(var j=0;j<ok.length;j++){a.push('[data-sid=\"'+ok[j]+'\"],.eno-sid-'+ok[j]);b.push('[data-sid-notice=\"'+ok[j]+'\"]');o+=':not([data-sid=\"'+ok[j]+'\"])'}" +
    `var st=document.createElement('style');st.id=${JSON.stringify(HIDDEN_SELLERS_STYLE_ID)};` +
    "st.textContent=a.join(',')+'{display:none!important}'+b.join(',')+'{display:block!important}'+'[data-shelf]:has([data-shelf-items]):not(:has([data-shelf-items]>'+o+')){display:none!important}';" +
    'document.head.appendChild(st)}catch(e){}})();'
  )
}

/** The snippet for THIS build ('' without `ugc-safety`). */
export const HIDDEN_SELLERS_HEAD_JS = hiddenSellersHeadJs(appReviewGate('ugc-safety'))

/**
 * ⛔ THE FEED LEAVES THEM OUT TOO, NOT ONLY THE STYLESHEET. Hiding cards is not enough where one shop fills whole pages —
 * the first 24 results for "scooter" were ALL the imported shop Apple's reviewer stood on — so the page would show a
 * count and an empty grid. The explorer's feed requests carry `xs=<ids>` (hiddenSellersParam) and /api/listings leaves
 * those shops out of the rows, the total and the facets (feed-query.ts buildFeedFilters). A URL param, not a cookie: the
 * feed is edge-cached by URL, so only a blocker's own requests get their own cache entry.
 * Capped at the newest MAX_HIDDEN_IN_QUERY (a URL has a length); past that the stylesheet alone hides the rest.
 */
export const HIDDEN_SELLERS_PARAM = 'xs'
export const MAX_HIDDEN_IN_QUERY = 100

/** The `xs` value for a feed request ('' for none — the param is then left off and the shared cache entry is used). */
export function hiddenSellersParam(): string {
  return appReviewGate('ugc-safety') ? current.slice(0, MAX_HIDDEN_IN_QUERY).join(',') : ''
}

/** The server's reading of `xs`: plain shop ids only, at most MAX_HIDDEN_IN_QUERY — anything else is dropped. */
export function parseHiddenSellersParam(v: string | null | undefined): string[] {
  if (!v) return []
  return [...new Set(v.split(','))].filter((id) => SELLER_ID_RE.test(id)).slice(0, MAX_HIDDEN_IN_QUERY)
}

/**
 * Fired on `window` when the hidden set CHANGES — useHiddenSellersParam (src/lib/use-hidden-sellers.ts) re-renders its
 * readers on it. ⚠️ THE HOOK LIVES IN ITS OWN MODULE: this one is imported by server code too (layout.tsx's head script,
 * feed-query.ts's parser), and a React hook import in a server module fails `next build` (codex, review).
 */
export const HIDDEN_SELLERS_EVENT = 'eno:hidden-sellers'

let current: string[] = []
let owner: string | null = null
let syncSeq = 0

/**
 * ⛔ START FROM THE STORED LIST, ON THE SAME TERMS AS THE HEAD SCRIPT (opus, review): the stylesheet alone is not enough on
 * a reload — the explorer's FIRST feed request must already carry `xs`, or a page one shop fills comes back as a count
 * over an empty grid, and its later pages are offset against a different set. AuthProvider's sync then confirms it, or
 * clears it for another account. Never on the server (no window), never on the web without a session cookie.
 */
function loadStored(): void {
  if (typeof window === 'undefined' || !appReviewGate('ugc-safety')) return
  try {
    const C = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    const nat = !!C?.isNativePlatform?.() || /EnoNativeApp|EnoNativeTabs/.test(navigator.userAgent || '')
    if (!nat && ('; ' + document.cookie).indexOf('; sb-') < 0) return
    const v = JSON.parse(localStorage.getItem(HIDDEN_SELLERS_KEY) || 'null') as { u?: unknown; ids?: unknown } | null
    if (!v || typeof v.u !== 'string' || !Array.isArray(v.ids)) return
    current = [...new Set(v.ids.filter((x): x is string => typeof x === 'string' && SELLER_ID_RE.test(x)))]
    owner = v.u
  } catch { /* storage refused: the sync fills it */ }
}
loadStored()

/** The shop ids hidden right now (tests, and the settings list's own bookkeeping). */
export function hiddenSellerIds(): readonly string[] {
  return current
}

/** Hide exactly these shops now — the stylesheet, and the stored copy for the next load (for `uid`). */
function applyHiddenSellers(ids: readonly string[], uid: string | null): void {
  const before = current.join(',')
  current = [...new Set(ids)].filter((id) => SELLER_ID_RE.test(id))
  if (typeof document === 'undefined') return
  if (current.join(',') !== before) {
    try { window.dispatchEvent(new Event(HIDDEN_SELLERS_EVENT)) } catch { /* no window events: nothing cached to refresh */ }
  }
  const css = hiddenSellersCss(current)
  let el = document.getElementById(HIDDEN_SELLERS_STYLE_ID)
  if (css) {
    if (!el) {
      el = document.createElement('style')
      el.id = HIDDEN_SELLERS_STYLE_ID
      document.head.appendChild(el)
    }
    if (el.textContent !== css) el.textContent = css
  } else {
    el?.remove()
  }
  try {
    if (uid && current.length) localStorage.setItem(HIDDEN_SELLERS_KEY, JSON.stringify({ u: uid, ids: current }))
    else localStorage.removeItem(HIDDEN_SELLERS_KEY)
  } catch { /* storage refused (private mode): this page is still right; the next load waits for the sync */ }
}

/**
 * Hide one shop NOW — the Block button calls this the moment its request succeeds, then syncs (the server's list also
 * carries the person's own shop when the block was made from a chat, which the button cannot know).
 */
export function hideSellerNow(sellerId: string): void {
  if (!appReviewGate('ugc-safety')) return
  applyHiddenSellers([...current, sellerId], owner)
}

/**
 * Bring the hidden shops in line with the server for this account — or clear them on sign-out (`uid` null). A newer
 * sync wins over an older one still in flight, so a list fetched before a block cannot undo it. A failed fetch keeps
 * what is shown (the stored list belongs to this same account; a different one was cleared first).
 */
export async function syncHiddenSellers(uid: string | null): Promise<void> {
  if (!appReviewGate('ugc-safety')) return
  const seq = ++syncSeq
  if (!uid) {
    owner = null
    applyHiddenSellers([], null)
    return
  }
  if (owner !== uid) {
    // Another account's list (or the head script's copy of it) must not stand while this one's loads.
    let stored: { u?: unknown; ids?: unknown } | null = null
    try { stored = JSON.parse(localStorage.getItem(HIDDEN_SELLERS_KEY) || 'null') } catch { stored = null }
    owner = uid
    applyHiddenSellers(stored?.u === uid && Array.isArray(stored.ids) ? stored.ids.filter((x): x is string => typeof x === 'string') : [], uid)
  }
  try {
    const res = await fetch('/api/blocks?only=ids', { cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { hiddenSellerIds?: unknown }
    if (seq !== syncSeq || owner !== uid) return
    const ids = Array.isArray(body.hiddenSellerIds) ? body.hiddenSellerIds.filter((x): x is string => typeof x === 'string') : []
    applyHiddenSellers(ids, uid)
  } catch { /* offline: keep what is shown */ }
}

/** Test seam: forget the module's state (`reload` — then read the stored list again, as a fresh page load does). */
export function resetHiddenSellersForTest(opts: { reload?: boolean } = {}): void {
  current = []
  owner = null
  syncSeq = 0
  if (opts.reload) loadStored()
}
