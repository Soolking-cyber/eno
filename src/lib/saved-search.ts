import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { inferDistrictFromQuery } from './district-query'
import { CATEGORY_BY_SLUG, LISTING_TYPE_LABEL, facetParamName, rangeFacetsFor, type ListingType } from './taxonomy'
import { TEACHERS_CATEGORY_SLUG } from './teachers/constants'
import { groupVnd, moneyLocale } from './vnd'

// The serialized shape of a saved search — the subset of explorer filters we
// persist + match on. Stored as JSON in SavedSearch.params.
export type SavedSearchParams = {
  category?: string
  subcategory?: string
  brand?: string // canonical brand slug
  model?: string // exact model display string
  listingType?: string
  q?: string
  district?: string
  condition?: string // 'new' | 'used'
  priceMin?: number
  priceMax?: number
  attrs?: Record<string, string>
}

// Sanitize an arbitrary object (from the client) into SavedSearchParams.
export function normalizeParams(input: unknown): SavedSearchParams {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v && v !== 'all' ? v.slice(0, 80) : undefined)
  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const attrs: Record<string, string> = {}
  if (o.attrs && typeof o.attrs === 'object' && !Array.isArray(o.attrs)) {
    for (const [k, v] of Object.entries(o.attrs as Record<string, unknown>)) {
      if (typeof v === 'string' && v && v !== 'all' && /^[a-z0-9_]+$/i.test(k)) attrs[k] = v.slice(0, 40)
    }
  }
  return {
    category: str(o.category),
    subcategory: str(o.subcategory),
    brand: str(o.brand),
    model: str(o.model),
    listingType: str(o.listingType),
    q: typeof o.q === 'string' ? o.q.trim().slice(0, 120) || undefined : undefined,
    district: str(o.district),
    condition: o.condition === 'new' || o.condition === 'used' ? o.condition : undefined,
    priceMin: num(o.priceMin),
    priceMax: num(o.priceMax),
    attrs: Object.keys(attrs).length ? attrs : undefined,
  }
}

// ⚠️ THE PRISMA WHERE FOR A SAVED SEARCH (`buildListingWhere`) LIVES IN ./saved-search-where.ts. It
// reads the database (the district scope resolves landing slugs against stored names), and this
// module is plain parsing and labelling — keeping the two apart means importing these helpers can
// never pull Prisma into a bundle.

/**
 * ⛔ NO SAVED SEARCH ON THE TEACHERS CATEGORY (owner decision, 2026-10-09) — THE ONE RULE every "Save search" / "Create an
 * alert" entry point reads: use-explorer.ts (`hasSavableSearch`, and `useSaveSearch`, which hands the explorer NO save
 * function there and refuses a resumed one) → every button in listings-explorer.tsx.
 * A saved search exists to send alerts, and the alert cron never sends one about teachers: it counts through
 * scopedListingWhere's default, which leaves the teachers category out (edition-scope.ts; the cron's own comment points
 * back here). The explorer still offered both CTAs on `?category=teachers`, so a school that saved "IELTS teachers in
 * District 7" was told "Saved — we'll alert you on new matches" and never heard a word. Alerting schools about PEOPLE
 * would be a decision of its own, not the side effect of a filter — so the CTA goes and the cron stays as it is.
 * ⚠️ The CATEGORY decides, nothing else: no category ("all listings") is offered as before — that feed leaves teachers
 * out too, so its alert counts what it showed.
 */
export function savedSearchOffered(category: string | null | undefined): boolean {
  return category !== TEACHERS_CATEGORY_SLUG
}

// Canonical URL (home explorer) that re-applies a saved search.
// ⛔ AND THE ALERT'S OWN QUERY (2026-10-09): saved-search-where.ts runs the feed's filter loops over exactly this string,
// and the cron's notification opens `/?${toUrlParams(p)}` — so a filter here is what the alert counts AND what the link
// shows. Each `attrs` key goes out under the explorer's own name for it (taxonomy.ts facetParamName): a range facet of
// (category, subcategory) — year, mileage, engine, size, salary — as `range_<column>`, the rest as `attr_<key>`. Ranges
// went out as `attr_<key>` here: an `attributes` text match no row has, so a range alert never fired and its link opened
// without the range. A stored row needs no migration — every save always kept a range under `attrs` by facet key.
export function toUrlParams(p: SavedSearchParams): string {
  const sp = new URLSearchParams()
  if (p.category) sp.set('category', p.category)
  if (p.subcategory) sp.set('subcategory', p.subcategory)
  if (p.brand) sp.set('brand', p.brand)
  if (p.model) sp.set('model', p.model)
  if (p.listingType) sp.set('type', p.listingType)
  if (p.q) sp.set('q', p.q)
  if (p.district) sp.set('district', p.district)
  if (p.condition) sp.set('condition', p.condition)
  if (typeof p.priceMin === 'number') sp.set('priceMin', String(p.priceMin))
  if (typeof p.priceMax === 'number') sp.set('priceMax', String(p.priceMax))
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) sp.set(facetParamName(k, p.category, p.subcategory), v)
  return sp.toString()
}

/** The params back out of a saved search's canonical URL (`toUrlParams`'s inverse — a `range_<column>` back to its facet key). */
export function paramsFromUrl(url: string): SavedSearchParams {
  const sp = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : url)
  const ranges = rangeFacetsFor(sp.get('category') ?? '', sp.get('subcategory'))
  const attrs: Record<string, string> = {}
  for (const [k, v] of sp) {
    if (k.startsWith('attr_')) attrs[k.slice(5)] = v
    else if (k.startsWith('range_')) {
      const f = ranges.find((x) => x.range.column === k.slice(6))
      if (f) attrs[f.key] = v
    }
  }
  return normalizeParams({
    category: sp.get('category'), subcategory: sp.get('subcategory'), brand: sp.get('brand'), model: sp.get('model'),
    listingType: sp.get('type'), q: sp.get('q'), district: sp.get('district'), condition: sp.get('condition'),
    priceMin: sp.get('priceMin') ?? undefined, priceMax: sp.get('priceMax') ?? undefined, attrs,
  })
}

/**
 * A short human label from the params (used when the client doesn't supply one).
 * ⚠️ The server stores it in ENGLISH (it has no reader to ask), so the dashboard re-labels a stored
 * default in the reader's language by calling this again with their `lang` and `tr` — category and
 * listing-type names then go through the translator, and a district stays the place name it is.
 */
export function describeParams(p: SavedSearchParams, lang: string = 'en', tr?: (en: string, vi?: string) => string): string {
  const parts: string[] = []
  const pick = (en: string, vi: string) => (tr ? tr(en, vi) : lang === 'vi' ? vi : en)
  if (p.q) parts.push(`"${p.q}"`)
  if (p.brand || p.model) {
    // Brand/model lead the label when present (e.g. "Honda Wave Alpha").
    const b = p.brand ? p.brand.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : ''
    parts.push([b, p.model].filter(Boolean).join(' '))
  } else if (p.category) {
    const c = CATEGORY_BY_SLUG[p.category]
    if (c) parts.push(pick(c.name, c.nameVi || c.name))
  }
  if (p.listingType) {
    const l = LISTING_TYPE_LABEL[p.listingType as ListingType]
    parts.push(l ? pick(l.en, l.vi) : p.listingType)
  }
  if (p.district) {
    // A /c/<category>/<district> landing slug (`quan-7`, `quan-binh-thanh`) is a real scope too, so it
    // is named rather than left out: by the curated district its words read as (localized, accented),
    // else de-slugified the way the explorer's chip shows it.
    const curated = DISTRICTS.find((x) => x.slug === p.district)?.slug ?? inferDistrictFromQuery(p.district.replace(/-/g, ' '))?.slug
    const d = curated ? DISTRICTS.find((x) => x.slug === curated) : undefined
    parts.push(d ? (lang === 'vi' ? d.name : d.nameEn) : p.district.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
  }
  if (typeof p.priceMin === 'number' || typeof p.priceMax === 'number') {
    // Locale-aware grouping (vi = "12.000.000", en = "12,000,000") + the right VND
    // label — a vi user must not see en-US comma grouping / a bare ₫ symbol.
    const loc = moneyLocale(lang)
    const lo = p.priceMin ? groupVnd(String(p.priceMin), loc) : '0'
    const hi = p.priceMax ? groupVnd(String(p.priceMax), loc) : '∞'
    parts.push(`${lo}–${hi} ${loc === 'vi' ? 'đ' : 'VND'}`)
  }
  return parts.length ? parts.join(' · ') : pick('All listings', 'Tất cả tin đăng')
}
