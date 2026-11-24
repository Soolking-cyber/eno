import 'server-only'
import { cache } from 'react'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { buildFeedFilters, buildFeedOrderBy } from '@/app/api/listings/feed-query'
import { aliasesFor, canonicalModel } from '@/generated/model-lineage'
import { PRICE_STAT_MAX_SPREAD, PRICE_STAT_MIN_SAMPLE, SALE_LISTING_TYPE } from '@/lib/price-stat'
import { FALLBACK_MIN_SELLERS } from '@/lib/price-fallback'
import { PRICE_GUIDANCE, percentileCont } from '@/lib/price-guidance'
import { isGoodsCategory } from '@/lib/goods-surface'
import { isRetiredNavCategory } from '@/lib/retired-categories'
import { POST_HIDDEN_ON_MARKETPLACE } from '@/lib/taxonomy'
import { ACCESSORY_SHELVES } from '@/lib/feed-taxonomy'
import { IPHONE_18_MODELS, IPHONE_DUO_MODEL } from '@/app/[lang]/iphone-18-vietnam/lowest-prices'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { staleBelowFloor } from '@/lib/stale-noindex'
import { fold } from '@/lib/fold'
import { compactVndRange, formatInteger } from '@/lib/vnd'
import { SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { siteOrigin } from '@/lib/sitemap'
import type { SerializedListingCard } from '@/lib/types'

/**
 * ── MODEL PRICE PAGES (owner-approved 2026-11-17) ─────────────────────────────────────────────────────
 * `/price/<slug>` (English) and `/gia/<slug>` (Vietnamese): one brand + model's live sale listings on its home shelf,
 * cheapest first, under "Typical asking price P25–P75 · N listings" when that band can claim a market (the word "price" in
 * the body: Seobility crawl 3 flagged 25 price pages whose H1 word "price" appeared nowhere in their text).
 *
 * ⛔ ONE SET, READ THROUGH THE FEED: every read is `buildFeedFilters` (verified, active, edition scope, teachers out) with
 * `type=sell&priceMin=1`, so the grid's "Show more" (/api/listings, same params) continues exactly this set. Nothing is
 * hidden by price: the order is disclosed on /legal/ranking ("cheapest first for one model"); a lure only loses the JSON-LD.
 * ⛔ THE CLAIM (line, JSON-LD, sitemap, PDP link) is PriceStat's own gates: n ≥ PRICE_STAT_MIN_SAMPLE, P75 ≤ P25 ×
 * PRICE_STAT_MAX_SPREAD, and FALLBACK_MIN_SELLERS different sellers — one shop's price list is not a market.
 * ⛔ SITEMAP = RULE A (build.ts): submitted only with the claim AND PRICE_STAT_MIN_SAMPLE of our own rows (`affiliateUrl`
 * null), dated by our own rows. Under 5 rows a page turns `noindex, follow` only after 14 days there (owner decision I-g).
 * ⚠️ The band is computed here, not read from PriceStat: its rows are per condition/year segment and its brand+model
 * upsert is not edition-scoped. One band across conditions and storage tiers (owner).
 */
export type ModelPageLang = 'en' | 'vi'
type PriceRow = { price: number; currency: string; sellerId: string }
export type IndexRow = PriceRow & {
  brandSlug: string | null; model: string | null; subcategorySlug: string | null
  affiliateUrl: string | null; updatedAt: Date; category: { slug: string }
}
export type AskingBand = { n: number; sellers: number; p25: number; p75: number; low: number; high: number; claim: boolean; ldLow: boolean; ldHigh: boolean }
export type ModelPageEntry = {
  slug: string; brandSlug: string; brandName: string; model: string; name: string
  categorySlug: string; subcategorySlug: string; n: number; own: number; claim: boolean; lastmod: Date | null
}
export type ModelPageIndex = { bySlug: ReadonlyMap<string, ModelPageEntry>; byKey: ReadonlyMap<string, ModelPageEntry> }

export const MODEL_PAGE_SIZE = 24
/** A highest ask above this × P75 is a typo, not a ceiling — the upper half of price-guard.ts's ½–2× rule. */
const HIGH_CREDIBLE_MULTIPLE = 2
/** These have handwritten pages (src/app/[lang]/iphone-18-vietnam). */
const HANDWRITTEN = new Set([...IPHONE_18_MODELS, IPHONE_DUO_MODEL].map((m) => `apple|${m}`))

/** "iPhone 13" under Apple → "Apple iPhone 13"; "Galaxy S23" under Samsung → "Samsung Galaxy S23"; "Honda Wave" stays. */
export function modelPageName(brandName: string, model: string): string {
  const b = fold(brandName)
  const m = fold(model)
  return m === b || m.startsWith(`${b} `) ? model : `${brandName} ${model}`
}

export function modelPageSlug(name: string): string {
  return fold(name).replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '')
}

export function modelPagePath(slug: string, lang: ModelPageLang): string {
  return lang === 'vi' ? `/gia/${slug}` : `/price/${slug}`
}

/** Every stored spelling of a canonical model — feed-query.ts's `?model=` rule. */
export function modelSpellings(brandSlug: string, canon: string): string[] {
  return [canon, ...Object.entries(aliasesFor(brandSlug)).filter(([, c]) => c === canon).map(([raw]) => raw)]
}

/** A shelf that sells THINGS at an asking price: no services, rentals, jobs, teachers, retired shelves, travel "from" prices, or accessory shelves (their rows carry the device's model, not their own). */
export function modelShelfOk(cat: string, sub: string): boolean {
  return isGoodsCategory(cat) && !isRetiredNavCategory(cat) && cat !== 'tickets-travel' && !ACCESSORY_SHELVES.has(sub) && !POST_HIDDEN_ON_MARKETPLACE.has(`${cat}/${sub}`)
}

/** P25/P75 as PriceStat computes them (percentile_cont, rounded), the spread, and the JSON-LD's credibility checks. */
export function askingBand(rows: readonly PriceRow[]): AskingBand | null {
  if (!rows.length || rows.some((r) => r.currency !== '₫')) return null
  const sorted = rows.map((r) => r.price).sort((a, b) => a - b)
  const n = sorted.length
  const sellers = new Set(rows.map((r) => r.sellerId)).size
  const p25 = Math.round(percentileCont(sorted, 0.25))
  const p75 = Math.round(percentileCont(sorted, 0.75))
  const [low, high] = [sorted[0], sorted[n - 1]]
  return {
    n, sellers, p25, p75, low, high,
    claim: n >= PRICE_STAT_MIN_SAMPLE && p75 <= p25 * PRICE_STAT_MAX_SPREAD && sellers >= FALLBACK_MIN_SELLERS,
    ldLow: low >= Math.ceil(p25 * PRICE_GUIDANCE.BELOW_CREDIBLE_FRACTION),
    ldHigh: high <= HIGH_CREDIBLE_MULTIPLE * p75,
  }
}

/** A model string `?model=` reads back unchanged (feed-query trims it and ignores "all"). */
const clean = (s: string | null): s is string => !!s && s === s.trim() && s !== 'all'

/** Group the live rows by brand + canonical model, keep each model's largest shelf, slug it. A contested slug publishes neither model. */
export function buildModelPageIndex(rows: readonly IndexRow[], brands: readonly { slug: string; name: string }[]): ModelPageIndex {
  const brandName = new Map(brands.map((b) => [b.slug, b.name]))
  const groups = new Map<string, Map<string, IndexRow[]>>()
  for (const r of rows) {
    if (!r.brandSlug || !brandName.has(r.brandSlug) || !clean(r.model) || !r.subcategorySlug || !modelShelfOk(r.category.slug, r.subcategorySlug)) continue
    const key = `${r.brandSlug}|${canonicalModel(r.brandSlug, r.model)}`
    if (HANDWRITTEN.has(key)) continue
    const shelves = groups.get(key) ?? groups.set(key, new Map()).get(key)!
    const shelf = `${r.category.slug}/${r.subcategorySlug}`
    const list = shelves.get(shelf)
    if (list) list.push(r)
    else shelves.set(shelf, [r])
  }
  const bySlug = new Map<string, ModelPageEntry>()
  const contested = new Set<string>()
  for (const [key, shelves] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [, home] = [...shelves].sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))[0]
    const [brandSlug, model] = [home[0].brandSlug!, key.slice(key.indexOf('|') + 1)]
    if (!clean(model)) continue
    const name = modelPageName(brandName.get(brandSlug)!, model)
    const slug = modelPageSlug(name)
    if (!slug || contested.has(slug)) continue
    // Two models that read as one name: neither page can show the whole set, so neither is published until model-lineage aliases them.
    if (bySlug.has(slug)) { console.warn('[model-pages] slug collision', slug, bySlug.get(slug)!.model, model); bySlug.delete(slug); contested.add(slug); continue }
    const own = home.filter((r) => r.affiliateUrl == null)
    bySlug.set(slug, {
      slug, brandSlug, brandName: brandName.get(brandSlug)!, model, name,
      categorySlug: home[0].category.slug, subcategorySlug: home[0].subcategorySlug!,
      n: home.length, own: own.length, claim: askingBand(home)?.claim ?? false,
      lastmod: own.reduce<Date | null>((d, r) => (!d || r.updatedAt > d ? r.updatedAt : d), null),
    })
  }
  return { bySlug, byKey: new Map([...bySlug.values()].map((e) => [`${e.brandSlug}|${e.model}`, e])) }
}

const INDEX_TTL_MS = 3_600_000
let memo: { at: number; value: Promise<ModelPageIndex> } | null = null

/** The index, memoised per process for an hour and shared in flight; a failure is never kept (live-brands.ts's pattern). */
export function modelPageIndex(): Promise<ModelPageIndex> {
  if (memo && Date.now() - memo.at < INDEX_TTL_MS) return memo.value
  const value = (async () => {
    const { where } = await buildFeedFilters(new URLSearchParams({ type: SALE_LISTING_TYPE, priceMin: '1' }))
    const rows = await db.listing.findMany({
      // edition-lint-allow: where is buildFeedFilters' own (marketplaceListingScope pushed into its AND)
      where: { AND: [where, { brandSlug: { not: null } }, { model: { not: null } }, { subcategorySlug: { not: null } }] },
      select: { brandSlug: true, model: true, subcategorySlug: true, price: true, currency: true, sellerId: true, affiliateUrl: true, updatedAt: true, category: { select: { slug: true } } },
    })
    const slugs = [...new Set(rows.map((r) => r.brandSlug!))]
    const brands = await db.brand.findMany({ where: { status: 'active', slug: { in: slugs } }, select: { slug: true, name: true } })
    return buildModelPageIndex(rows, brands)
  })()
  const entry = { at: Date.now(), value }
  memo = entry
  value.catch(() => { if (memo === entry) memo = null })
  return value
}

/** Test seam. */
export function __resetModelPageIndex() {
  memo = null
}

/** The pages pages.xml submits (rule A — see the header), by slug. */
export async function submittableModelPages(): Promise<{ slug: string; lastmod: Date | null }[]> {
  return [...(await modelPageIndex()).bySlug.values()]
    .filter((e) => e.claim && e.own >= PRICE_STAT_MIN_SAMPLE)
    .map((e) => ({ slug: e.slug, lastmod: e.lastmod }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
}

/** The PDP's link: the model's page when this live sale listing sits on its home shelf and the page claims a band. */
export async function modelPageSlugFor(l: {
  brandSlug: string | null; model: string | null; categorySlug: string; subcategorySlug: string | null; listingType: string; status: string
}): Promise<string | null> {
  if (l.status !== 'active' || l.listingType !== SALE_LISTING_TYPE || !l.brandSlug || !l.model) return null
  const e = (await modelPageIndex()).byKey.get(`${l.brandSlug}|${canonicalModel(l.brandSlug, l.model)}`)
  return e?.claim && e.categorySlug === l.categorySlug && e.subcategorySlug === l.subcategorySlug ? e.slug : null
}

export type ModelPage = {
  entry: ModelPageEntry; params: Record<string, string>; total: number; band: AskingBand | null; indexable: boolean; listings: SerializedListingCard[]
}

/** One page's set, read fresh at each regeneration; null (a 404) for an unknown slug or an empty set. */
export const loadModelPage = cache(async (slug: string, lang: ModelPageLang): Promise<ModelPage | null> => {
  const entry = (await modelPageIndex()).bySlug.get(slug)
  if (!entry) return null
  const params = { category: entry.categorySlug, subcategory: entry.subcategorySlug, brand: entry.brandSlug, model: entry.model, type: SALE_LISTING_TYPE, priceMin: '1' }
  const { where } = await buildFeedFilters(new URLSearchParams(params))
  const [prices, rows] = await Promise.all([
    // edition-lint-allow: where is buildFeedFilters' own (marketplaceListingScope pushed into its AND)
    db.listing.findMany({ where, select: { price: true, currency: true, sellerId: true } }),
    // edition-lint-allow: where is buildFeedFilters' own (marketplaceListingScope pushed into its AND)
    db.listing.findMany({ where, select: LISTING_CARD_SELECT, orderBy: buildFeedOrderBy('price-low'), take: MODEL_PAGE_SIZE }),
  ])
  const total = prices.length
  if (!total) return null
  const scope = [{ category: { slug: entry.categorySlug } }, { subcategorySlug: entry.subcategorySlug }, { brandSlug: entry.brandSlug }, { model: { in: modelSpellings(entry.brandSlug, entry.model) } }, { listingType: SALE_LISTING_TYPE }, { price: { gt: 0 } }]
  const indexable = !(await staleBelowFloor({ where: { AND: scope }, live: total, floor: PRICE_STAT_MIN_SAMPLE }))
  const listings = await localizeListingTitles(rows.map(serializeListingCard), lang === 'vi' ? 'vi' : undefined)
  return { entry, params, total, band: askingBand(prices), indexable, listings }
})

export function modelPageMetadata(entry: ModelPageEntry, page: Pick<ModelPage, 'band' | 'indexable'>, lang: ModelPageLang): Metadata {
  const vi = lang === 'vi'
  const b = page.band?.claim ? page.band : null
  const range = b ? compactVndRange(b.p25, b.p75, lang) : ''
  const n = b ? formatInteger(b.n, lang) : ''
  const title = vi ? `Giá ${entry.name} tại Việt Nam | ${SITE_NAME}` : `${entry.name} price in Vietnam | ${SITE_NAME}`
  const description = b
    ? (vi ? `Giá rao phổ biến ${range} cho ${entry.name}, từ ${n} tin trên ${SITE_NAME}. Rẻ nhất trước.` : `Typical asking price ${range} for ${entry.name}, from ${n} listings on ${SITE_NAME}. Cheapest first.`)
    : (vi ? `Tin rao ${entry.name} trên ${SITE_NAME}, rẻ nhất trước.` : `${entry.name} listings on ${SITE_NAME}, cheapest first.`)
  const canonical = modelPagePath(entry.slug, lang)
  const en = modelPagePath(entry.slug, 'en')
  return {
    title, description,
    alternates: { canonical, languages: { en, 'vi-VN': modelPagePath(entry.slug, 'vi'), 'x-default': en } },
    ...(page.indexable ? {} : { robots: { index: false, follow: true } }),
    ...pageShare({ title, description, url: canonical }),
  }
}

/** A stored photo as an absolute URL, or null (model-product-ld.ts's rule). */
function absoluteImage(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return src
  return src.startsWith('/') && !src.startsWith('//') ? `${siteOrigin()}${src}` : null
}

/**
 * The page's one Product: an AggregateOffer of measured numbers only — no `itemCondition` (the set mixes conditions),
 * no `highPrice` past HIGH_CREDIBLE_MULTIPLE × P75, and none at all under the claim or with a lure below the credible floor.
 * ⛔ The image is a PARTNER's or a BUSINESS's photo (cheapest first), never a person's or a guest storefront's.
 */
export function modelProductLd(entry: ModelPageEntry, band: AskingBand | null, cards: readonly SerializedListingCard[], lang: ModelPageLang): Record<string, unknown> | null {
  if (!band?.claim || !band.ldLow) return null
  const image = cards.filter((c) => c.seller.officialPartner || c.seller.isBusiness).map((c) => (c.images[0] ? absoluteImage(c.images[0]) : null)).find((u) => u)
  if (!image) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: entry.name,
    brand: { '@type': 'Brand', name: entry.brandName },
    image,
    url: `${siteOrigin()}${modelPagePath(entry.slug, lang)}`,
    offers: { '@type': 'AggregateOffer', priceCurrency: 'VND', lowPrice: band.low, offerCount: band.n, ...(band.ldHigh ? { highPrice: band.high } : {}) },
  }
}
