// First-party personalization signals, stored in localStorage. These are the user's
// OWN on-site behaviour (recent searches + recently-viewed categories/brands) — the
// only honest, available signal for a "For You" rail (a site can't read a user's
// searches on other platforms). USING them for personalization is gated on the 'all'
// consent (see lib/consent.ts); the rail falls back to Trending otherwise.

const VIEWED_KEY = 'eno:viewed'           // [{ c: categorySlug, b?: brandSlug }], newest first
const SEARCH_KEY = 'eno:recent_searches'  // string[], written by the header search
const MAX = 24

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

export function hasRecoSignals(s: RecoSignals): boolean {
  return s.terms.length > 0 || s.categories.length > 0 || s.brands.length > 0
}
