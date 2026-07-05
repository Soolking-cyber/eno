// First-party personalization signals, stored in localStorage. These are the user's
// OWN on-site behaviour (recent searches + recently-viewed categories/brands) — the
// only honest, available signal for a "For You" rail (a site can't read a user's
// searches on other platforms). USING them for personalization is gated on the 'all'
// consent (see lib/consent.ts); the rail falls back to Trending otherwise.

const VIEWED_KEY = 'eno:viewed'           // [{ c: categorySlug, b?: brandSlug }], newest first
const VIEWED_IDS_KEY = 'eno:viewed_ids'   // string[] of listing ids, newest first
const SEARCH_KEY = 'eno:recent_searches'  // string[], written by the header search
const MAX = 24
const MAX_IDS = 20

type Viewed = { c: string; b?: string }

/** Record a viewed listing's category (+ brand) as a relevance signal. */
export function recordView(categorySlug?: string | null, brandSlug?: string | null): void {
  if (typeof window === 'undefined' || !categorySlug) return
  try {
    const list: Viewed[] = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]')
    const entry: Viewed = brandSlug ? { c: categorySlug, b: brandSlug } : { c: categorySlug }
    const next = [entry, ...list.filter((v) => !(v.c === entry.c && v.b === entry.b))].slice(0, MAX)
    localStorage.setItem(VIEWED_KEY, JSON.stringify(next))
  } catch { /* private mode — skip */ }
}

/** Record the exact listing a buyer opened, so they can re-find it (the category/brand
 *  signal above only powers ranking — it can't re-surface the specific item). */
export function recordViewedListing(id?: string | null): void {
  if (typeof window === 'undefined' || !id) return
  try {
    const list: string[] = JSON.parse(localStorage.getItem(VIEWED_IDS_KEY) || '[]')
    const next = [id, ...(Array.isArray(list) ? list : []).filter((x) => x !== id)].slice(0, MAX_IDS)
    localStorage.setItem(VIEWED_IDS_KEY, JSON.stringify(next))
  } catch { /* private mode — skip */ }
}

/** Recently-viewed listing ids, newest first. */
export function getViewedListingIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const list = JSON.parse(localStorage.getItem(VIEWED_IDS_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export type RecoSignals = { terms: string[]; categories: string[]; brands: string[] }

/** Read the personalization signals (most-recent-first, deduped, capped). */
export function getRecoSignals(): RecoSignals {
  if (typeof window === 'undefined') return { terms: [], categories: [], brands: [] }
  let terms: string[] = []
  let viewed: Viewed[] = []
  try { terms = JSON.parse(localStorage.getItem(SEARCH_KEY) || '[]') } catch { /* ignore */ }
  try { viewed = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]') } catch { /* ignore */ }
  const categories = Array.from(new Set(viewed.map((v) => v.c).filter(Boolean))).slice(0, 6)
  const brands = Array.from(new Set(viewed.map((v) => v.b).filter((b): b is string => !!b))).slice(0, 6)
  return { terms: (Array.isArray(terms) ? terms : []).filter(Boolean).slice(0, 6), categories, brands }
}


// Inbound search INTENT — the one honest way to act on "what they searched elsewhere":
// the query the visitor arrived WITH. We can read it from our own campaign params
// (utm_term / keyword — e.g. a Google Ad with keyword insertion: a user who searched
// "honda accord" and clicked our ad lands on ...?utm_term=honda+accord) or from a
// referrer that carries its query. We can NOT read a user's search history on another
// platform — no site can; this captures the intent only at the moment they land.
// `q` is intentionally NOT read here — that drives the explorer's own search instead.
export function getInboundQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    const p = new URLSearchParams(window.location.search)
    for (const k of ['utm_term', 'keyword', 'kw', 'intent']) {
      const v = p.get(k)?.trim()
      if (v) return v.slice(0, 80)
    }
    const ref = document.referrer
    if (ref) {
      const u = new URL(ref)
      if (u.hostname && u.hostname !== window.location.hostname) {
        for (const k of ['q', 'query', 'search', 'p', 'text', 'wd']) {
          const v = u.searchParams.get(k)?.trim()
          if (v) return v.slice(0, 80)
        }
      }
    }
  } catch { /* malformed referrer/url — ignore */ }
  return ''
}
