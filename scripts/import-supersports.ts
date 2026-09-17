/**
 * Import the SuperSports Vietnam catalogue (Shopify) as affiliate listings.
 *
 *   npx tsx --env-file=.env scripts/import-supersports.ts                 # DRY RUN (fetches, places, prices, prints)
 *   npx tsx --env-file=.env scripts/import-supersports.ts --limit 50      # a slice, for eyeballing
 *   npx tsx --env-file=.env scripts/import-supersports.ts --apply         # write
 *   npx tsx --env-file=.env scripts/import-supersports.ts --apply --retire  # ALSO retire what vanished
 *
 * ⛔ TWO LOCALES, BECAUSE THE MERCHANT ALREADY WROTE THE ENGLISH. `/products.json` is Vietnamese and
 * `/en/products.json` is the same 5,978 products in the merchant's own English — measured
 * 2026-09-17: 5,975 of 5,977 titles and 5,951 of 5,977 descriptions genuinely differ, and only 5
 * titles / 27 bodies are still Vietnamese on the English side. So `title`/`description` (the English
 * slots) and `titleVi`/`descriptionVi` are BOTH first-party copy and nothing here is machine
 * translated. That is the whole reason this importer exists instead of pointing the AccessTrade one
 * at the campaign: the datafeed reports 0 products, and it would have cost ~$108 of Google
 * Translation to reproduce English the shop publishes for free.
 *
 * ⛔ IDEMPOTENT ON (sellerId, externalId) = the Shopify product id, exactly like the other two
 * importers. Re-running refreshes price, stock and links; it does not multiply the catalogue, and it
 * does NOT re-upload 26,178 photos (the expensive half) for rows that already have them.
 *
 * ⚠️ THE CREATE-ONLY SET, and why each: `title`/`description` hold merchant ENGLISH that a later
 * pass (or a human) may improve, `descriptionVi` likewise, `verified` is moderation state, and
 * `rankScore` is only correct at age 0. `status` is create-only EXCEPT the stock transition
 * active↔sold — a product that sells out on Monday and restocks on Tuesday must come back, while a
 * listing an admin set to `hidden` or `draft` is never touched. (Both reviewers flagged the first
 * draft of this paragraph as self-contradictory; this is the precise rule, and it is what the code
 * below does.)
 *
 * ⚠️ `titleVi` IS REFRESHABLE, DELIBERATELY, and two reviewers read its absence from the create-only
 * list as an oversight — so it is written down. It holds the merchant's OWN Vietnamese product name,
 * which is the canonical name of the thing: when SuperSports renames a product, the Vietnamese
 * listing should follow. That is exactly how import-accesstrade.ts and import-partners.ts treat it.
 * The English slots are different because nothing upstream ever improves them, and something
 * downstream might.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { Prisma } from '../src/generated/prisma/client'
import { makeImageHost } from '../src/lib/host-product-image'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'
import { supersportsFacets } from '../src/lib/supersports-taxonomy'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
/** Retire listings that are no longer in the merchant's catalogue. OFF by default — see the guard. */
const RETIRE = process.argv.includes('--retire')
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 6)
const MAX_IMAGES = Number(arg('images') ?? 5)
/** Skip the AccessTrade round trips (a placement/taxonomy preview does not need links). */
const NO_LINKS = process.argv.includes('--no-links')
/** Mint (and cache) the affiliate links without writing listings. A plain dry run does NOT mint. */
const MINT = process.argv.includes('--mint')
/**
 * ⚠️ THE OWNER'S SWITCH ON A TRADE THIS SCRIPT CANNOT MAKE FOR THEM. `--direct-links` stores the
 * merchant's own product URL instead of the affiliate link: the shopper lands on the product they
 * clicked, and the click earns NOTHING. The default is the affiliate link (the owner's choice,
 * 2026-09-17), which is tracked and earns, but lands on the shop's home page until the advertiser
 * enables deep linking — see mintLinks. One flag, so switching is a re-run, not a rewrite.
 */
const DIRECT_LINKS = process.argv.includes('--direct-links')
const LINKS_FILE = arg('links-file') ?? 'data/supersports-links.json'
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) { console.error('--concurrency must be a positive integer'); process.exit(1) }
if (!Number.isInteger(MAX_IMAGES) || MAX_IMAGES < 1 || MAX_IMAGES > 10) { console.error('--images must be 1..10'); process.exit(1) }
if (!Number.isInteger(LIMIT) || LIMIT < 0) { console.error('--limit must be a non-negative integer'); process.exit(1) }
/**
 * ⛔ `--no-links` IS A PREVIEW FLAG AND MUST NOT WRITE (a reviewer's catch). With `--apply` it still
 * created the storefront and the brands, and still retired zero-priced rows, before the per-product
 * link guard could drop anything — i.e. it mutated the database while promising not to publish.
 */
if (APPLY && NO_LINKS && !DIRECT_LINKS) { console.error('--no-links is a preview flag: use it without --apply, or pass --direct-links to write merchant URLs'); process.exit(1) }

const SHOP = 'https://supersports.com.vn'
const SELLER_NAME = 'SuperSports'
const MERCHANT_CITY = 'Hồ Chí Minh'
const BUCKET = 'listings'
const EDGE = 1200
const WEBP_QUALITY = 80
/** The approved AccessTrade campaign (`supersports_shopify`), and our publisher id. */
const CAMPAIGN_ID = '5883902897773910283'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

type Variant = { id: number; price: string; available: boolean; option1: string | null; option2: string | null; option3: string | null }
type Img = { id: number; src: string }
type Product = {
  id: number; title: string; handle: string; body_html: string; vendor: string
  product_type: string; tags: string[]; variants: Variant[]; images: Img[]
  options: { name: string; values: string[] }[]
}

/** Vietnamese-specific letters — Latin text carrying none of these is not Vietnamese prose. */
const VI_DIACRITIC = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

const stripHtml = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim()
const optionValues = (p: Product, re: RegExp) => p.options.find((o) => re.test(o.name))?.values.map((v) => v.trim()).filter(Boolean) ?? []
const SIZE_OPTION = /ích\s*thước|ÍCH\s*THƯỚC|^size$/i
const sizesOf = (p: Product) => optionValues(p, SIZE_OPTION)
/**
 * The size run a buyer can actually order: the size option's value on each sellable VARIANT.
 * Shopify's `option1/2/3` line up with `options[0..2]`, so which field to read depends on where the
 * merchant put the size option — it is `option1` on most of this catalogue and `option2` where
 * colour comes first. Falls back to the product-level option list when the variants say nothing
 * (some rows carry a single default variant).
 */
function sizesInStock(p: Product, sellable: Variant[]): string[] {
  const idx = p.options.findIndex((o) => SIZE_OPTION.test(o.name))
  if (idx < 0) return sizesOf(p)
  const field = (['option1', 'option2', 'option3'] as const)[idx]
  const values = sellable.map((v) => (v[field] ?? '').trim()).filter(Boolean)
  return values.length ? [...new Set(values)] : sizesOf(p)
}
const colorOf = (p: Product) => optionValues(p, /àu\s*sắc|ÀU\s*SẮC|^colou?r$/i)[0] ?? null

/**
 * One locale's whole catalogue. Shopify pages at 250 and answers an empty array past the end, so the
 * end of the crawl is unambiguous — but a 500 or a timeout mid-way is NOT, which is why a failed
 * page throws instead of ending the loop. A short crawl that looks complete is how an importer
 * retires a catalogue it simply failed to read.
 */
const MAX_PAGES = 60

async function crawl(prefix: string): Promise<Product[]> {
  const out: Product[] = []
  let page = 1
  for (; page <= MAX_PAGES; page++) {
    let last: unknown = null
    let got: Product[] | null = null
    for (let attempt = 0; attempt < 3 && !got; attempt++) {
      try {
        const res = await fetch(`${SHOP}${prefix}/products.json?limit=250&page=${page}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        /**
         * ⛔ ONLY AN EXPLICIT EMPTY ARRAY ENDS THE CRAWL (a reviewer's catch). `products ?? []`
         * turned a malformed `{}` — a CDN error page served as JSON, a truncated body — into "the
         * catalogue ends here", which is the one input that makes a short crawl look complete and
         * lets `--retire` mark the unread tail `sold`.
         */
        const body = (await res.json()) as { products?: Product[] }
        if (!Array.isArray(body.products)) throw new Error('response has no products array')
        got = body.products
      } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))) }
    }
    if (!got) throw new Error(`${prefix || '/'} page ${page} failed: ${(last as Error)?.message}`)
    if (!got.length) break
    out.push(...got)
    await new Promise((r) => setTimeout(r, 1200))
  }
  /**
   * ⛔ RUNNING OUT OF PAGES IS NOT THE END OF THE CATALOGUE (a reviewer's catch, and the one hole
   * the three retire guards did not watch). The loop stops either because a page came back empty —
   * the real end — or because it hit the cap, which is a TRUNCATED read that would otherwise look
   * exactly like a complete one: 15,000 self-consistent products, both locales agreeing, every
   * ratio guard satisfied, and ~1,000 live listings silently retired. Say so instead.
   */
  if (page > MAX_PAGES) throw new Error(`${prefix || '/'} hit the ${MAX_PAGES}-page cap — the crawl is truncated, refusing to treat it as complete`)
  return out
}

/**
 * PER-PRODUCT AFFILIATE LINKS, minted by AccessTrade (`product_link/create`, max 20 urls per call —
 * measured; 21+ returns "Longer than maximum length 20").
 *
 * ⛔ MEASURED AND WORTH KNOWING BEFORE ANYONE CALLS THIS A BUG: the minted link does NOT currently
 * land on the product page. It carries `url=<product>` all the way to `click.accesstrade.vn`, which
 * hands the click to the advertiser's own tracker (`centralgrouponline.go2cloud.org`, offer 275)
 * WITHOUT it, and the shopper arrives at `supersports.com.vn/en`. Verified 2026-09-17 with real
 * handles in both locales and with the short link. The tracker itself honours `&url=`, so this is a
 * switch on the advertiser's side, not a defect in what we send — and when they flip it, every link
 * already stored here starts deep-linking with no re-import.
 * ⛔ AND THE OBVIOUS WORKAROUND IS WORSE: a hand-built go2cloud link deep-links today, but it
 * carries AccessTrade's `aff_id` with no publisher sub-id, so the click would be attributed to
 * nobody. A link that reaches the product and earns nothing is not the trade the owner chose.
 *
 * ⚠️ CACHED ON DISK, keyed by product id. 5,978 products is 299 calls; nothing about a link changes
 * between runs, so a re-import must not spend them again.
 */
async function mintLinks(products: Product[], cachePath: string): Promise<Map<number, string>> {
  /**
   * ⚠️ THE CACHE REMEMBERS THE HANDLE A LINK WAS MINTED FOR (a reviewer's catch). Keyed by product
   * id alone, a link minted for `/products/old-name` is served for ever after the merchant renames
   * the product — and the day deep linking starts working, it lands on a 404.
   * ⚠️ An older id→string cache is still readable; those entries carry no handle and re-mint once.
   */
  const raw: Record<string, { link: string; handle: string } | string> = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, { link: string; handle: string } | string>
    : {}
  const cache: Record<string, { link: string; handle: string }> = {}
  for (const [id, v] of Object.entries(raw)) if (typeof v === 'object' && v?.link) cache[id] = v
  const have = new Map<number, string>(Object.entries(cache).map(([k, v]) => [Number(k), v.link]))
  const key = process.env.ACCESSTRADE_KEY
  const todo = products.filter((p) => !have.has(p.id) || cache[String(p.id)]?.handle !== p.handle)
  if (!todo.length) return have
  if (!key) { console.error('ACCESSTRADE_KEY missing — cannot mint links (run with --no-links to skip)'); process.exit(1) }
  console.log(`minting ${todo.length} affiliate link(s) in ${Math.ceil(todo.length / 20)} call(s)…`)
  let minted = 0, failed = 0
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20)
    const urls = batch.map((p) => `${SHOP}/products/${p.handle}`)
    try {
      const res = await fetch('https://api.accesstrade.vn/v1/product_link/create', {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: CAMPAIGN_ID, urls }),
        signal: AbortSignal.timeout(60_000),
      })
      const json = await res.json() as { data?: { success_link?: { aff_link: string; url_origin: string }[] } }
      const byOrigin = new Map((json.data?.success_link ?? []).map((l) => [l.url_origin, l.aff_link]))
      for (const p of batch) {
        const link = byOrigin.get(`${SHOP}/products/${p.handle}`)
        if (link) { have.set(p.id, link); cache[String(p.id)] = { link, handle: p.handle }; minted++ } else failed++
      }
    } catch { failed += batch.length }
    if (i % 200 === 0 || i + 20 >= todo.length) console.log(`  links ${minted + failed}/${todo.length} (${failed} failed)`)
    // ⚠️ Persist as we go: 299 calls is ~5 minutes, and a crash at call 250 must not re-spend them.
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(cache, null, 0))
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(`  links: ${minted} minted, ${failed} failed, ${have.size} in cache\n`)
  return have
}

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null
// Photos are stored CLEAN under `listings/affiliate/m/` and the eno.vn mark is drawn by the app at
// one size in one corner — the owner's 2026-09-13 rule. Never burn a mark into an imported photo.
const hostImage = makeImageHost({ storage, storageUrl: storageUrl!, bucket: BUCKET, edge: EDGE, quality: WEBP_QUALITY, mark: 'overlay' })

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — SuperSports${LIMIT ? ` (first ${LIMIT})` : ''}, up to ${MAX_IMAGES} image(s) each\n`)

  const [vi, en] = await Promise.all([crawl(''), crawl('/en')])
  console.log(`crawled: ${vi.length} VI, ${en.length} EN`)
  /**
   * ⛔ A PARTIAL CRAWL MUST NEVER RETIRE A CATALOGUE, and comparing the two locales to each other is
   * not enough — a merchant outage truncates both (a reviewer's catch). So: the two must agree with
   * each other AND the run must be big enough to be a catalogue at all, and retirement additionally
   * requires the run to be within 10% of what we already hold for this seller (checked below).
   */
  if (!vi.length || !en.length) { console.error('empty crawl — refusing'); process.exit(1) }
  const ratio = Math.min(vi.length, en.length) / Math.max(vi.length, en.length)
  if (ratio < 0.9) { console.error(`locales disagree (${vi.length} vs ${en.length}) — refusing`); process.exit(1) }
  if (vi.length < 1000) { console.error(`only ${vi.length} products — that is not the SuperSports catalogue, refusing`); process.exit(1) }

  const enById = new Map(en.map((p) => [p.id, p]))
  /**
   * ⛔ WHAT IS IMPORTED AND WHAT IS STILL SOLD ARE TWO DIFFERENT QUESTIONS (a reviewer's catch, and
   * the sharpest finding in the round). Importing needs both locales — English copy is the whole
   * point of this script. RETIREMENT must be decided by the VIETNAMESE crawl alone, because that is
   * the merchant's canonical catalogue: if the English locale is slow to publish 100 new products,
   * they are missing from the intersection but very much still on sale, and retiring them would
   * mark 100 live listings `sold` for a translation lag.
   */
  const liveIds = new Set(vi.map((p) => String(p.id)))
  /**
   * ⛔ THE VIETNAMESE CRAWL IS THE SPINE, AND ENGLISH IS AN OVERLAY (a reviewer's catch). Importing
   * only the intersection meant a product the English locale had not published yet was skipped
   * ENTIRELY — no price refresh, no stock refresh — so it sat `active` at yesterday's price while
   * the merchant had sold out of it. Every VI product is imported; a missing EN twin costs it only
   * its English copy, which the Vietnamese fallback below already covers (5 titles and 27 bodies
   * are Vietnamese on the English side anyway).
   */
  const all = vi
  const products = LIMIT ? all.slice(0, LIMIT) : all
  console.log(`${all.length} products (${en.length} with English copy)${LIMIT ? `, importing ${products.length}` : ''}\n`)

  /**
   * ⚠️ A DRY RUN MINTS NOTHING (a reviewer's catch): minting is 299 AccessTrade calls and a file
   * write, and the banner promises a dry run only "fetches, places, prices, prints". `--mint` warms
   * the cache on its own when that is what you want.
   */
  const links = NO_LINKS || DIRECT_LINKS
    // ⚠️ THE ENGLISH ROW'S OWN HANDLE UNDER THE ENGLISH PATH (a reviewer's catch). The two locales
    // share handles today (measured: 1 of 5,977 differs), but `/en/products/<vi-handle>` is only
    // right by coincidence, and this is precisely the flag someone flips when they want landings
    // that work.
    ? new Map<number, string>(DIRECT_LINKS ? products.map((p) => [p.id, `${SHOP}/en/products/${enById.get(p.id)?.handle ?? p.handle}`]) : [])
    : (APPLY || MINT) ? await mintLinks(products, LINKS_FILE) : new Map<number, string>()
  if (!APPLY && !MINT && !NO_LINKS && !DIRECT_LINKS) console.log('(dry run: no links minted — pass --mint to fill the cache)\n')
  if (DIRECT_LINKS) console.log('⚠️ --direct-links: storing the merchant product URL. Clicks reach the product and earn NOTHING.\n')

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]))
  for (const slug of ['sports', 'baby-kids']) {
    // ⛔ The Category rows come from scripts/sync-categories.ts, which must run on the box BEFORE
    // this. An importer that cannot find the row skips the product rather than writing a wrong id.
    if (!catId.has(slug)) { console.error(`Category "${slug}" is missing — run scripts/sync-categories.ts first`); process.exit(1) }
  }

  // ⛔ ONE STOREFRONT, AND A STOREFRONT WITH AN OWNER IS REFUSED — hanging 5,978 affiliate rows off
  // a real person's account would hand them a catalogue they never posted (VinWonders' seeder
  // learned this; both other importers carry the same guard).
  let seller = await db.seller.findFirst({ where: { name: SELLER_NAME }, select: { id: true, ownerId: true, trustScore: true } })
  if (seller?.ownerId) { console.error(`"${SELLER_NAME}" is owned by a real account — refusing`); process.exit(1) }
  if (!seller) {
    console.log(`storefront "${SELLER_NAME}" — ${APPLY ? 'creating' : 'would create'}`)
    if (APPLY) {
      seller = await db.seller.create({
        data: {
          name: SELLER_NAME,
          // ⚠️ THE LINK LANDS ON THE SHOP, NOT THE PRODUCT (see mintLinks), so the storefront says
          // so in the one place every buyer sees before they click.
          bio: 'Sports brands from the SuperSports Vietnam store. Products are bought and paid for on supersports.com.vn.',
          location: MERCHANT_CITY, officialPartner: false, verified: false,
        },
        select: { id: true, ownerId: true, trustScore: true },
      })
    }
  }

  if (APPLY) {
    // The 54 vendors this catalogue actually carries — created once, with the app's own
    // normalisation so an imported brand collides with a human-typed one instead of duplicating it.
    const vendors = [...new Set(products.map((p) => (p.vendor || '').trim()).filter(Boolean))]
    const have = new Set((await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug))
    let created = 0
    for (const name of vendors) {
      const slug = brandSlugify(name)
      if (!slug || have.has(slug)) continue
      await db.brand.create({ data: { slug, name, normalized: normalizeBrand(name) } }).then(() => { created++ }).catch(() => {})
    }
    if (created) console.log(`brands created: ${created}\n`)
  }

  /**
   * ⛔ THE RETIRE GUARD'S BASELINE IS READ BEFORE ANY WRITE (a reviewer's catch, and a good one).
   * Counted after the import loop it has already shrunk: the loop flips every out-of-stock product
   * to `sold`, so a truncated crawl of 5,000 against 6,000 live listings would compare 5,000 to
   * 5,000, pass the 10% guard written to fail it, and retire the 1,000 products it never saw.
   */
  const heldBefore: { id: string; externalId: string | null }[] = APPLY && RETIRE && seller
    ? await db.listing.findMany({ where: { sellerId: seller.id, status: 'active' }, select: { id: true, externalId: true } })
    : []

  let seen = 0, created = 0, updated = 0, skipped = 0, imaged = 0, noShelf = 0, noLink = 0
  const dropped: Record<string, number> = {}
  const drop = (why: string) => { dropped[why] = (dropped[why] || 0) + 1; skipped++ }
  const failures: string[] = []

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    await Promise.all(products.slice(i, i + CONCURRENCY).map(async (p) => {
      // ⚠️ THE WHOLE ROW IS GUARDED. This job talks to Postgres over an SSH tunnel and to two
      // CDNs; an unguarded throw inside Promise.all ends the run and orphans the photos its
      // siblings just uploaded. The run is idempotent, so skipping a row is always the better
      // failure (the partner importer learned this the hard way).
      try { await importOne(p) } catch (e) { skipped++; failures.push((e as Error).message.slice(0, 90)) }
    }))
    if (seen % 250 < CONCURRENCY || seen >= products.length) {
      console.log(`  ${seen}/${products.length}  created=${created} updated=${updated} images=${imaged} skipped=${skipped}`)
    }
  }

  async function importOne(viP: Product) {
    seen++
    // ⚠️ The English row may be absent (see "spine" above); the Vietnamese one is the fallback the
    // title/description code below already expects.
    const enP = enById.get(viP.id) ?? viP
    const externalId = String(viP.id)
    /**
     * ⚠️ THE PRICE AND THE SIZES DESCRIBE WHAT A BUYER CAN ACTUALLY BUY (a reviewer's catch). Taking
     * the minimum across ALL variants advertises the sold-out M at ₫500,000 on a product where only
     * the L at ₫900,000 is left, and the size chips would offer that M too. When anything is in
     * stock, only in-stock variants count; when nothing is, the whole run is used — the listing is
     * going `sold` anyway and a price is still needed for the record.
     */
    const inStock = viP.variants.some((v) => v.available)
    const sellable = inStock ? viP.variants.filter((v) => v.available) : viP.variants
    const prices = sellable.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0)
    const price = prices.length ? Math.min(...prices) : 0

    const existing = seller
      ? await db.listing.findFirst({
          where: { sellerId: seller.id, externalId },
          select: { id: true, images: true, status: true, title: true, titleVi: true, description: true, descriptionVi: true, categoryId: true, subcategorySlug: true, brandSlug: true, affiliateUrl: true },
        })
      : null

    /**
     * ⛔ NO PRICE IS NOT A FREE PRODUCT. 20 products (gift-with-purchase items, "[GIFT – NOT FOR
     * SALE]") carry only zero-priced variants, and `price.tsx` renders 0 as "Free / Miễn phí". An
     * existing listing goes `sold` (recoverable: the next run with a real price brings it back);
     * a new one is not created.
     */
    if (price <= 0) {
      // Conditional in the same way the stock write below is: `existing.status` is a snapshot, the
      // WHERE is the truth at write time.
      if (APPLY && existing) {
        await db.listing.updateMany({ where: { id: existing.id, status: 'active' }, data: { status: 'sold' } })
      }
      drop('no price'); return
    }

    // ⚠️ The ENGLISH row is the source for `title`/`description`, with the Vietnamese as the
    // fallback for the 5 titles / 27 bodies the merchant has not translated yet — never a machine
    // translation, and never Vietnamese in the English slot when English exists.
    const enTitle = (enP.title || '').trim()
    const viTitle = (viP.title || '').trim()
    if (viTitle.length < 3 && enTitle.length < 3) { drop('no title'); return }
    const title = (enTitle || viTitle).slice(0, 180)
    const titleVi = (viTitle || enTitle).slice(0, 180)
    const enBody = stripHtml(enP.body_html || '')
    const viBody = stripHtml(viP.body_html || '')
    // 1,800 chars, like the other importers: it is a product blurb, and the tail of a Shopify body
    // is size charts and care instructions. It also bounds what a cache miss can cost when a
    // visitor reads this listing in one of the nine machine-translated languages.
    const description = (enBody || viBody || title).slice(0, 1800)
    const descriptionVi = (viBody || enBody || titleVi).slice(0, 1800)

    const facets = supersportsFacets({
      productType: viP.product_type, enTitle: title, tags: viP.tags ?? [], viTitle: titleVi,
      enMissing: !enById.has(viP.id),
      sizes: sizesInStock(viP, sellable), color: colorOf(enP) ?? colorOf(viP),
    })
    if (!facets.subcategorySlug) noShelf++
    const categoryId = catId.get(facets.categorySlug)!

    /**
     * ⚠️ A FAILED MINT MUST NOT FREEZE A LIVE LISTING (a reviewer's catch). Dropping the row when
     * AccessTrade is having a bad minute drops its price and stock refresh too, so a sold-out
     * product stays `active` at yesterday's price for as long as the outage lasts. The link already
     * stored is still a working link — keep it and refresh everything else.
     */
    const affiliateUrl = links.get(viP.id) ?? existing?.affiliateUrl ?? null
    // ⚠️ A listing with no outbound link is unreachable — that link is the card's whole action. A
    // dry run holds no links by design (see `--mint`), so only a real write insists on one.
    if (!affiliateUrl && APPLY) { noLink++; drop('no affiliate link'); return }

    // ⚠️ THE PREVIEW REFUSES WHAT AN APPLY WOULD REFUSE (a reviewer's catch). A product with no
    // photo is dropped on write, so counting it as "created" here overstates the catalogue in
    // exactly the number an operator reads the dry run for.
    if (!existing?.images && !(viP.images ?? []).length) { drop('no image'); return }
    if (!APPLY) { existing ? updated++ : created++; return }

    /**
     * ⚠️ PHOTOS ARE FETCHED ONCE. Five per product across 5,978 products is 26,178
     * fetch→resize→watermark→upload round trips (~1.9 GB); repeating them on every price refresh
     * would grow storage without bound. A listing that already has photos keeps them.
     */
    let images: string = existing?.images ?? ''
    const current: string[] = (() => { try { const v = JSON.parse(images || '[]'); return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : [] } catch { return [] } })()
    if (!current.length) {
      const srcs = (viP.images ?? []).slice(0, MAX_IMAGES).map((im) => im.src).filter(Boolean)
      if (!srcs.length) { drop('no image'); return }
      const hosted = (await Promise.all(srcs.map((u) => hostImage(u, facets.categorySlug)))).filter((u): u is string => !!u)
      if (!hosted.length) { drop('image host failed'); return }
      images = JSON.stringify(hosted); imaged += hosted.length
    }
    if (!images || images === '[]') { drop('no image'); return }

    const brandSlug = brandSlugify((viP.vendor || '').trim()) || null
    /**
     * ⛔ A ROW'S STORED PLACEMENT WINS ON A REFRESH — the rule refreshPlacement encodes for the other
     * importers. An admin (or a later model pass) who re-files a product must not have this run move
     * it back; a row with no subcategory is still ours to place.
     * ⚠️ AND A PLACED ROW IS NOT REWRITTEN AT ALL, not even with identical values (a reviewer's
     * catch). `existing` is read before the image uploads, so writing the placement back would
     * overwrite a re-file that happened in between. `keepPlacement` drops both columns from the
     * update rather than racing on them.
     */
    const keepPlacement = Boolean(existing?.subcategorySlug && catSlug.get(existing.categoryId))
    const placed = keepPlacement
      ? { categorySlug: catSlug.get(existing!.categoryId)!, subcategorySlug: existing!.subcategorySlug }
      : { categorySlug: facets.categorySlug, subcategorySlug: facets.subcategorySlug }

    const fields = {
      title, description, titleVi, descriptionVi,
      // ⛔ THE SYMBOL '₫', NOT 'VND' — three features read `currency === '₫'` and treat anything
      // else as a foreign currency (the dual-currency line, the PDP offer, and the value reported
      // to Meta CAPI). 9,726 rows once sent eighteen-million-DOLLAR view events because of this.
      price, priceUnit: '', currency: '₫', negotiable: false,
      // SuperSports is a Central Group retail chain: every product is new stock, stated by the shop.
      condition: 'new',
      images, categoryId: catId.get(placed.categorySlug) ?? categoryId,
      location: MERCHANT_CITY, city: MERCHANT_CITY,
      subcategorySlug: placed.subcategorySlug, brandSlug,
      /**
       * Facets are REFRESHABLE, unlike brand/model on the other importers, and the reason is that
       * nobody edits them by hand here: they are computed from the merchant's own `product_type`,
       * title prefix, tags, size run and colour, so a merchant correction should reach the site.
       * `attributes` holds the single-valued ones the whole app already understands; `facetTokens`
       * holds the multi-valued ones (sizes, sports) that `attributes` cannot express.
       */
      attributes: Object.keys(facets.attributes).length ? JSON.stringify(facets.attributes) : null,
      facetTokens: facets.facetTokens,
      /**
       * ⛔ WITHOUT THIS THE PRODUCT IS INVISIBLE TO SEARCH. feed-query.ts matches this folded blob,
       * and a direct Prisma write never runs the POST path that builds it. Folded from BOTH
       * languages plus placement and brand, so "giày chạy bộ" and "running shoes" find one product.
       */
      /**
       * ⛔ FOLD THE ROW'S CURRENT TEXT, NOT ONLY THE MERCHANT'S (a reviewer's catch, and the same
       * bug import-accesstrade.ts carries a long note about). `searchText` is refreshable while
       * `title`/`description`/`descriptionVi` are create-only, so a refresh built from merchant text
       * alone would make search disagree with what the page displays: an admin corrects a title, the
       * next run re-indexes the row under the OLD words, and `rebuild-search-text.ts` cannot find it
       * because it selects `searchText: ''` and a clobbered blob is wrong, not empty.
       */
      searchText: buildSearchText([
        existing?.title ?? title, title,
        existing?.titleVi ?? titleVi, titleVi,
        (existing?.description ?? description).slice(0, 400), description.slice(0, 400),
        (existing?.descriptionVi ?? descriptionVi).slice(0, 400),
        viP.product_type, MERCHANT_CITY, placed.categorySlug, placed.subcategorySlug, brandSlug,
      ]),
      affiliateUrl,
      verified: true, status: 'active',
      // ⛔ create-only: rankScore defaults to 0, which is dead last in a feed ordered by it — the
      // first partner import's 152 rows sat invisible for a day because of exactly this.
      rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: new Date(), featured: false }),
    }
    /**
     * ⚠️ ONE EXCEPTION TO "THE ENGLISH SLOTS ARE CREATE-ONLY", AND IT REPAIRS RATHER THAN OVERWRITES
     * (a reviewer's catch). A product whose English row had not published when we first saw it was
     * created with VIETNAMESE in `title`/`description`, and create-only would keep it that way for
     * ever — the title warmer skips Vietnamese strings, so it would never be translated either.
     * When the stored value still reads as Vietnamese AND the merchant now has English, take the
     * English. A value a human or a model improved is not Vietnamese, so it is never touched.
     */
    const stuckVietnamese = (stored: string | null | undefined, incoming: string) =>
      !!stored && VI_DIACRITIC.test(stored) && !VI_DIACRITIC.test(incoming)
    const englishArrived = {
      ...(stuckVietnamese(existing?.title, title) ? { title } : {}),
      ...(stuckVietnamese(existing?.description, description) ? { description } : {}),
    }

    const { status, verified, title: _t, description: _d, descriptionVi: _dv, rankScore: _r, ...rest } = fields
    const refreshable = {
      ...(keepPlacement ? (({ categoryId: _c, subcategorySlug: _s, ...noPlacement }) => noPlacement)(rest) : rest),
      ...englishArrived,
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        /**
         * ⛔ THE REFRESH AND THE STOCK TRANSITION COMMIT TOGETHER (a reviewer's catch). As two
         * statements, an upsert that succeeded while the status write failed left a sold-out product
         * `active` at its NEW price — and nothing could repair it, because the product is still in
         * the catalogue and so is never retired.
         */
        const ops: Prisma.PrismaPromise<unknown>[] = [
          db.listing.upsert({
            where: { sellerId_externalId: { sellerId: seller!.id, externalId } },
            update: refreshable,
            create: { ...fields, sellerId: seller!.id, externalId, status: inStock ? 'active' : 'sold' },
          }),
        ]
        /**
         * ⛔ STOCK IS A SEPARATE, CONDITIONAL WRITE — AND THE CONDITION IS IN THE DATABASE, NOT IN A
         * VARIABLE READ MINUTES AGO (a reviewer's catch). `existing.status` is read before the image
         * uploads and the retries, so an admin who hides a listing during that window would have had
         * it written back to `active` by the upsert. `updateMany` with the status in its WHERE makes
         * the check and the write one statement: a row an admin moved to `hidden` or `draft` matches
         * nothing and is left exactly as it is.
         */
        if (existing) {
          ops.push(db.listing.updateMany({
            where: { id: existing.id, status: { in: ['active', 'sold'] } },
            data: { status: inStock ? 'active' : 'sold' },
          }))
        }
        await db.$transaction(ops)
        existing ? updated++ : created++
        return
      } catch (e) {
        if (attempt === 1) { skipped++; failures.push((e as Error).message.slice(0, 90)); return }
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
  }

  /**
   * RETIREMENT — a product that leaves the catalogue becomes `sold`, never deleted.
   * ⛔ THREE GUARDS, because this is the one irreversible-feeling thing here: it needs `--retire`,
   * it refuses on a partial run (`--limit`), and it refuses if this crawl holds less than 90% of
   * what we already have for this seller (a merchant outage that returned a short but self-
   * consistent catalogue would otherwise retire thousands of live listings).
   */
  if (APPLY && RETIRE && seller) {
    if (LIMIT) console.log('\n--retire ignored: this was a --limit run, so "not seen" means nothing')
    else {
      /**
       * ⛔ THE GUARD MEASURES COVERAGE OF WHAT WE HOLD, NOT THE SIZE OF THE CATALOGUE (a reviewer's
       * catch). "5,000 crawled vs 6,000 live" compares two different populations — the crawl counts
       * sold-out products too — so a shop with 3,000 live listings passed a 5,000-product truncated
       * crawl and retired the 1,000 it never saw. The honest question is how many of the listings
       * that were active BEFORE this run are still in the catalogue; below 90%, something is wrong
       * with the crawl, not with the shop.
       */
      const gone = heldBefore.filter((l) => l.externalId && !liveIds.has(l.externalId)).map((l) => l.id)
      if (heldBefore.length && gone.length > heldBefore.length * 0.1) {
        console.error(`\n⛔ retire refused: ${gone.length} of ${heldBefore.length} live listings are missing from the crawl — too big a drop`)
      } else {
        // ⚠️ `status: 'active'` in the WHERE as well as in the read: the retire pass runs minutes
        // after the import, and a row an admin hid in between must not be dragged to `sold`.
        if (gone.length) await db.listing.updateMany({ where: { id: { in: gone }, status: 'active' }, data: { status: 'sold' } })
        console.log(`\nretired ${gone.length} listing(s) no longer in the catalogue`)
      }
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} created, ${updated} updated, ${imaged} images hosted, ${skipped} skipped`)
  if (noShelf) console.log(`  ⚠️ ${noShelf} product(s) had a product_type this app does not map — filed in the aisle with no shelf`)
  if (noLink) console.log(`  ⚠️ ${noLink} product(s) had no affiliate link`)
  if (Object.keys(dropped).length) console.log(`  dropped: ${JSON.stringify(dropped)}`)
  if (failures.length) {
    const kinds: Record<string, number> = {}
    for (const f of failures) kinds[f.split(':')[0]] = (kinds[f.split(':')[0]] || 0) + 1
    console.log(`  write failures: ${JSON.stringify(kinds)}`)
  }
  await db.$disconnect()
  /**
   * ⛔ A RUN THAT COULD NOT WRITE MUST NOT REPORT SUCCESS (a reviewer's catch). The per-row guards
   * exist so one dropped tunnel cannot kill a 5,978-row job — but "every write failed" and "the
   * import worked" printed the same exit code, which is what automation reads.
   */
  /**
   * ⚠️ AND "NOTHING WAS WRITTEN AT ALL" COUNTS (a reviewer's catch): a 20-row run where all 20 fail
   * sits under any percentage threshold, and automation reads the exit code, not the summary.
   */
  if (APPLY && products.length && (created + updated === 0 || failures.length > Math.max(20, products.length * 0.05))) {
    console.error(`\n⛔ ${failures.length} write failure(s), ${created + updated} row(s) written of ${products.length} — exiting non-zero`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
