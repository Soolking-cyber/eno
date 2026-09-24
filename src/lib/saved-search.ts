import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { inferDistrictFromQuery } from './district-query'
import { CATEGORY_BY_SLUG, LISTING_TYPE_LABEL, type ListingType } from './taxonomy'
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

// Canonical URL (home explorer) that re-applies a saved search.
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
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) sp.set(`attr_${k}`, v)
  return sp.toString()
}

// A short human label from the params (used when the client doesn't supply one).
export function describeParams(p: SavedSearchParams, lang: 'en' | 'vi' = 'en'): string {
  const parts: string[] = []
  if (p.q) parts.push(`"${p.q}"`)
  if (p.brand || p.model) {
    // Brand/model lead the label when present (e.g. "Honda Wave Alpha").
    const b = p.brand ? p.brand.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : ''
    parts.push([b, p.model].filter(Boolean).join(' '))
  } else if (p.category) {
    const c = CATEGORY_BY_SLUG[p.category]
    if (c) parts.push(lang === 'vi' ? c.nameVi : c.name)
  }
  if (p.listingType) parts.push(LISTING_TYPE_LABEL[p.listingType as ListingType]?.[lang] ?? p.listingType)
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
  return parts.length ? parts.join(' · ') : (lang === 'vi' ? 'Tất cả tin đăng' : 'All listings')
}
