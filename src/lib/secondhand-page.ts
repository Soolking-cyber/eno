import { clean } from './partner-fetch'

/**
 * Reading one partner-shop product page for the second-hand showcase check (src/lib/secondhand-showcase.ts) — the
 * shapes and helpers the generic reader and every shop's own rules (src/lib/secondhand-shop-rules.ts) share.
 * Pure: no fetching, no database.
 */

export type PageRead = { url: string; status: number; finalUrl: string; html: string; error?: string }

export type Verdict =
  | { state: 'available'; reason: string; price?: number; name?: string; movedTo?: string }
  | { state: 'unavailable'; reason: string; name?: string }
  /** `followUp`: a second URL the shop's rules can decide from (Điện Thoại Giá Kho's data route for a framework shell). */
  | { state: 'unknown'; reason: string; blocked?: boolean; followUp?: string }

export const available = (reason: string, price: number | undefined, name?: string, movedTo?: string): Verdict => ({ state: 'available', reason, price, name, movedTo })
export const unavailable = (reason: string, name?: string): Verdict => ({ state: 'unavailable', reason, name })
export const unknown = (reason: string): Verdict => ({ state: 'unknown', reason })

/** host + path, without the scheme, `www.`, the query and a trailing slash — "the same page". */
export const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
export const samePage = (read: PageRead) => normUrl(read.finalUrl || read.url) === normUrl(read.url)

/** A Cloudflare/WAF interstitial — a block on the crawler, never evidence about the product. */
export function isBotWall(read: Pick<PageRead, 'status' | 'html'>): boolean {
  if (![403, 429, 503].includes(read.status)) return false
  return /Attention Required!|Just a moment\.\.\.|cf-browser-verification|challenge-platform|cf_chl_/i.test(read.html)
}

/**
 * Every Product node in the page's JSON-LD — all three shapes (a bare object, an @graph, a top-level array) and a @type
 * that is a word or a full schema.org URI (zshop.vn writes "http://schema.org/Product"). A shop rule pins the one it
 * means (by sku, or by url); the generic reader takes the first.
 */
export function productNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const typeName = (t: unknown) => String(t).split(/[/#]/).pop()
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const types = Array.isArray(o['@type']) ? (o['@type'] as unknown[]).map(typeName) : [typeName(o['@type'])]
    if (types.some((t) => t === 'Product' || t === 'IndividualProduct')) out.push(o)
    if (Array.isArray(o['@graph'])) walk(o['@graph'])
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())) } catch { /* a malformed block is not fatal */ }
  }
  return out
}

export const nameOf = (node: Record<string, unknown> | undefined) => (node ? clean(String(node.name ?? '')) || undefined : undefined)

type Availability = 'in' | 'out' | 'other' | 'none'

/**
 * What a Product node's offers say: every availability (one per offer — a variant each), and the lowest positive price
 * among the offers not out of stock. `priceSpecification` is read too (Điện Máy Sài Gòn publishes the price only there),
 * skipping its ListPrice / StrikethroughPrice — the struck-through was-price.
 *
 * ⛔ AN OUT-OF-STOCK OFFER IS NOT AN OUT-OF-STOCK PRODUCT: a multi-variant page lists one offer per colour. `out` only when
 * EVERY offer says so (plan review, 2026-10-17 — the importer's own `inStock` regex over the whole offers string would
 * retire a phone with one sold colour).
 */
/**
 * `price` is the lowest in-stock offer's (what the availability tests ask: is anything on sale at a price?); `onePrice` is
 * set only when every in-stock offer carries that same price — ⛔ the only price a run may WRITE: on a page of several
 * variants the lowest is often another variant's, and the import took the first offer's (review, 2026-10-17).
 */
export function offerFacts(node: Record<string, unknown>): { availability: Availability; values: string[]; price?: number; onePrice?: number } {
  const raw = node.offers
  const offers = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
  // An AggregateOffer's own offers, as an array or a single object (both are valid schema.org).
  const flat = offers.flatMap((o) => (Array.isArray(o.offers) ? (o.offers as Record<string, unknown>[]) : o.offers && typeof o.offers === 'object' ? [o.offers as Record<string, unknown>] : [o]))
  const tail = (v: unknown) => String(v ?? '').split(/[/#]/).pop() ?? ''
  const values = flat.map((o) => tail(o.availability)).filter(Boolean)
  const isOut = (v: string) => /^(OutOfStock|SoldOut|Discontinued)$/i.test(v)
  const isIn = (v: string) => /^(InStock|LimitedAvailability|OnlineOnly|InStoreOnly)$/i.test(v)
  const availability: Availability = !values.length ? 'none' : values.some(isIn) ? 'in' : values.every(isOut) ? 'out' : 'other'
  const num = (v: unknown) => { const n = vndAmount(v); return Number.isFinite(n) && n > 0 ? n : undefined }
  const prices: number[] = []
  for (const o of flat) {
    if (flat.length > 1 && isOut(tail(o.availability))) continue
    const direct = num(o.price) ?? num(o.lowPrice)
    if (direct) { prices.push(direct); continue }
    const specs = (Array.isArray(o.priceSpecification) ? o.priceSpecification : o.priceSpecification ? [o.priceSpecification] : []) as Record<string, unknown>[]
    for (const s of specs) {
      if (/ListPrice|StrikethroughPrice/i.test(String(s.priceType ?? ''))) continue
      const n = num(s.price)
      if (n) { prices.push(n); break }
    }
  }
  const distinct = new Set(prices.map((p) => Math.round(p)))
  return { availability, values, price: prices.length ? Math.round(Math.min(...prices)) : undefined, onePrice: distinct.size === 1 ? [...distinct][0] : undefined }
}

/**
 * A VND amount as a shop writes it — plain digits ("12990000"), a decimal ("12990000.0000"), or grouped by dots or commas
 * ("12.990.000", "12,990,000 ₫") — and NaN for anything else (absent, "Liên hệ", "12.990.000,00"). VND has no minor unit,
 * so "12.990" is twelve thousand nine hundred and ninety. ⚠️ NaN IS NOT ZERO: a rule may call a row `no-price` (which
 * retires it) only on an amount it READ as zero, never on one it could not read (review, 2026-10-17).
 */
export function vndAmount(v: unknown): number {
  const s = String(v ?? '').replace(/[^\d.,]/g, '')
  if (/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN
}

/** A page read's error when the address (or a redirect) left the partner shops' hosts: never fetched (secondhand-showcase-run). */
export const OFF_SITE = 'off-site address'

/** The value of the hidden input with this id (either quote style, any attribute order before `value`). */
export function inputValue(html: string, id: string): string | undefined {
  const tag = new RegExp(`<input\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`, 'i').exec(html)?.[0]
  const v = tag ? /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null
  return v ? (v[1] ?? v[2]).trim() : undefined
}

export function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
