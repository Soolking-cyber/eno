import { Prisma } from '@/generated/prisma/client'
import { fold } from './fold'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { CATEGORY_BY_SLUG, LISTING_TYPE_LABEL, type ListingType } from './taxonomy'

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

// District filter mirroring /api/listings (DISTRICTS[].match against district+location).
function districtFilter(slug?: string): Prisma.ListingWhereInput | undefined {
  if (!slug || slug === 'all') return undefined
  const def = DISTRICTS.find((d) => d.slug === slug)
  if (!def?.match?.length) return undefined
  const OR: Prisma.ListingWhereInput[] = []
  for (const m of def.match) OR.push({ district: { contains: m } }, { location: { contains: m } })
  return { OR }
}

// Build the Prisma where for a saved search — IDENTICAL semantics to the public
// feed (/api/listings) so "matches" line up with what the buyer would see.
export function buildListingWhere(p: SavedSearchParams): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [{ verified: true }, { status: 'active' }]
  if (p.category) and.push({ category: { slug: p.category } })
  if (p.subcategory) and.push({ subcategorySlug: p.subcategory })
  if (p.brand) and.push({ brandSlug: p.brand })
  if (p.model) and.push({ model: p.model })
  if (p.listingType) and.push({ listingType: p.listingType })
  if (p.condition === 'new') and.push({ OR: [{ condition: { contains: 'new' } }, { condition: { contains: 'mới' } }] })
  else if (p.condition === 'used') and.push({ NOT: { OR: [{ condition: { contains: 'new' } }, { condition: { contains: 'mới' } }] } })
  if (typeof p.priceMin === 'number' || typeof p.priceMax === 'number') {
    const price: Prisma.FloatFilter = {}
    if (typeof p.priceMin === 'number') price.gte = p.priceMin
    if (typeof p.priceMax === 'number') price.lte = p.priceMax
    and.push({ price })
  }
  if (p.q) and.push({ searchText: { contains: fold(p.q) } })
  const df = districtFilter(p.district)
  if (df) and.push(df)
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) and.push({ attributes: { contains: `"${k}":"${v}"` } })
  return { AND: and }
}

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
    const d = DISTRICTS.find((x) => x.slug === p.district)
    if (d) parts.push(lang === 'vi' ? d.name : d.nameEn)
  }
  if (typeof p.priceMin === 'number' || typeof p.priceMax === 'number') {
    parts.push(`${p.priceMin ? p.priceMin.toLocaleString('en-US') : '0'}–${p.priceMax ? p.priceMax.toLocaleString('en-US') : '∞'}₫`)
  }
  return parts.length ? parts.join(' · ') : (lang === 'vi' ? 'Tất cả tin đăng' : 'All listings')
}
