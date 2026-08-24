/**
 * Pull each CellphoneS product's real photo gallery from the merchant's own product page.
 *
 *   npx tsx scripts/scrape-cellphones-gallery.ts --limit 5             # DRY RUN
 *   npx tsx scripts/scrape-cellphones-gallery.ts --limit 50 --apply
 *   npx tsx scripts/scrape-cellphones-gallery.ts --apply               # the whole catalogue
 *
 * ⛔ THE AFFILIATE FEED GIVES EXACTLY ONE IMAGE. Both `datafeeds` and `product_detail` return a
 * single `image` string — there is no gallery anywhere in the AccessTrade API. The merchant's page
 * has 7-18. Measured on a random sample of six products: mean 8.7.
 *
 * ⚠️ TWO THINGS MADE THIS LOOK IMPOSSIBLE, AND BOTH WERE MY MEASUREMENT, NOT THE SITE:
 *  1. SCOPE. Counting every <img> on the page mixes the gallery with the related-products rail,
 *     and filtering those apart by filename fails because CellphoneS filenames are arbitrary
 *     (`fuji_3`, `group_817`, `text_ng_n_14__5_13`). The gallery has its own container.
 *  2. LAZY LOADING. A gallery <img> below the fold has NO src until it is scrolled to, so a
 *     correct selector still returned zero. Scrolling it into view turned a measured 0 into 7 on
 *     the same product. Any "the page doesn't have it" conclusion has to survive a scroll first.
 *
 * ⚠️ URL-PATTERN SHORTCUTS DO NOT WORK — checked, twice. Sequential suffixes on the feed's image
 * (`-2`, `-3`, …) appear to 200 on HEAD and 404 on GET, so a HEAD probe reports 8 images that do
 * not exist; hashing the bytes is what exposed it. Slug-derived paths match only the handful of
 * products whose filename equals their slug.
 *
 * ⚠️ POLITE BY CONSTRUCTION: low concurrency and a pause per page. This is thousands of requests
 * to someone else's site — it should look like a slow crawler, not an attack.
 */
import 'dotenv/config'
import { chromium, type Browser } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { watermarkSvg, watermarkPlacement, inkForLuminance } from '../src/lib/core/watermark-mark'
import { hammingHex } from '../src/lib/image-hash-url'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 3)
const MAX_IMAGES = Number(arg('max-images') ?? 6)
const EDGE = 1100
const BUCKET = 'listings'
/** Two images this close are the same shot; the gallery repeats the hero in its thumbnail strip. */
const DUP_DISTANCE = 6

/** Reasons galleryFor gave up, so "no gallery" can never hide a bug again. */
const galleryErrors: string[] = []

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('supabase env required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error('refusing the retired project'); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null

/** The gallery URLs on one product page, in order, hero first. */
async function galleryFor(browser: Browser, url: string): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2600)
    await page.evaluate(() => document.querySelector('.gallery-slide, .box-gallery')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(2600)
    /**
     * ⛔ PASSED AS A STRING, NOT A FUNCTION, AND THAT IS THE ONLY THING THAT WORKS HERE.
     * tsx/esbuild rewrites any function it can name — including `const grab = () => …` — into a
     * call to its `__name` helper, which does not exist in the browser context. The callback then
     * dies with "ReferenceError: __name is not defined" and a silent catch reported it as "no
     * gallery" on pages that visibly had five images. A string expression is never transpiled.
     */
    return await page.evaluate(`(() => {
      var grab = function (sel) {
        return Array.prototype.slice.call(document.querySelectorAll(sel))
          .map(function (el) {
            return (el.currentSrc || el.src || el.getAttribute('data-src') || '')
              .replace(/.*\\/plain\\//, '').replace(/\\?.*$/, '')
          })
          .filter(function (u) { return u.indexOf('media/catalog/product') !== -1 })
      }
      var g = grab('.gallery-slide.gallery-top img')
      var list = g.length ? g : grab('.box-gallery img')
      var out = []
      for (var i = 0; i < list.length; i++) if (out.indexOf(list[i]) === -1) out.push(list[i])
      return out
    })()`) as string[]
  } catch (e) {
    // ⚠️ A SILENT `catch { return [] }` HERE READS AS "this product has no gallery" AND IS A LIE.
    // The first run reported 6/6 with no gallery on pages that visibly had five images.
    galleryErrors.push((e as Error).message.slice(0, 70))
    return []
  } finally { await page.close() }
}

async function perceptualHash(png: Buffer): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default
    const px = await sharp(png).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
    if (px.length < 72) return null
    let hex = '', nib = 0, c = 0
    for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
      nib = (nib << 1) | (px[r * 9 + col] > px[r * 9 + col + 1] ? 1 : 0)
      if (++c === 4) { hex += nib.toString(16); nib = 0; c = 0 }
    }
    return hex
  } catch { return null }
}

/** Square-crop, stamp with the app's own mark, encode, upload. Returns the public url. */
async function store(src: string, slug: string): Promise<{ url: string; hash: string } | null> {
  try {
    const res = await fetch(src.startsWith('http') ? src : `https://${src}`, { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return null
    const sharp = (await import('sharp')).default
    const img = sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 50_000_000 }).rotate()
    const meta = await img.metadata()
    const side = Math.min(meta.width ?? EDGE, meta.height ?? EDGE, EDGE)
    const png = await img.resize({ width: side, height: side, fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' }).png().toBuffer()
    const hash = await perceptualHash(png)
    if (!hash) return null
    const { markWidth, left, top, region } = watermarkPlacement(side, side)
    let mean: number | null = null
    try { const { channels } = await sharp(png).extract(region).greyscale().stats(); mean = (channels[0]?.mean ?? 0) / 255 } catch {}
    const out = await sharp(png).composite([{ input: watermarkSvg(markWidth, inkForLuminance(mean)).svg, left, top }])
      .webp({ quality: 80 }).toBuffer()
    const path = `affiliate/${slug}-g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-h${hash}.webp`
    const { error } = await storage!.upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) return null
    return { url: `${storageUrl}/storage/v1/object/public/${BUCKET}/${path}`, hash }
  } catch { return null }
}

async function main() {
  const seller = await db.seller.findFirst({ where: { name: 'CellphoneS' }, select: { id: true } })
  if (!seller) { console.error('no CellphoneS storefront'); process.exit(1) }

  // Only products that still have a single image — this job is expensive and must be resumable.
  const rows = (await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, images: true, affiliateUrl: true, externalId: true },
  })).filter((r) => { try { return JSON.parse(r.images || '[]').length <= 1 } catch { return true } })

  const targets = LIMIT ? rows.slice(0, LIMIT) : rows
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${targets.length} products with <=1 image (of ${rows.length})`)
  console.log(`  up to ${MAX_IMAGES} images each, concurrency ${CONCURRENCY}\n`)

  // The merchant page url is inside the affiliate link's `url=` parameter.
  const pageUrlOf = (aff: string | null): string | null => {
    if (!aff) return null
    try { return new URL(aff).searchParams.get('url') } catch { return null }
  }

  const browser = await chromium.launch()
  let done = 0, added = 0, none = 0
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(async (r) => {
      const page = pageUrlOf(r.affiliateUrl)
      if (!page) { none++; return }
      const urls = (await galleryFor(browser, page)).slice(0, MAX_IMAGES + 4)
      done++
      if (!urls.length) { none++; return }
      if (!APPLY) { added += Math.min(urls.length, MAX_IMAGES); return }

      const kept: string[] = []
      const hashes: string[] = []
      for (const u of urls) {
        if (kept.length >= MAX_IMAGES) break
        const s = await store(u, (r.externalId || 'p').replace(/[^a-z0-9]+/gi, '').slice(0, 24))
        if (!s) continue
        if (hashes.some((h) => hammingHex(h, s.hash) <= DUP_DISTANCE)) continue
        hashes.push(s.hash); kept.push(s.url)
      }
      // ⚠️ Never shrink a gallery: if scraping produced less than we already had, keep what we had.
      const existing: string[] = (() => { try { return JSON.parse(r.images || '[]') } catch { return [] } })()
      if (kept.length > existing.length) {
        await db.listing.update({ where: { id: r.id }, data: { images: JSON.stringify(kept) } }).catch(() => {})
        added += kept.length
      }
    }))
    await new Promise((res) => setTimeout(res, 400))
    if (done % 30 === 0) console.log(`  ${done}/${targets.length}  images added=${added}  no-gallery=${none}`)
  }
  await browser.close()
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${done} pages read, ${added} images, ${none} with no gallery`)
  if (galleryErrors.length) {
    const kinds: Record<string, number> = {}
    for (const e of galleryErrors) kinds[e.split('\n')[0].slice(0, 46)] = (kinds[e.split('\n')[0].slice(0, 46)] || 0) + 1
    console.log('  gallery read errors:', JSON.stringify(kinds, null, 1))
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
