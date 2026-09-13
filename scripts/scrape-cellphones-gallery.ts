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
import { makeImageHost } from '../src/lib/host-product-image'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { hammingHex } from '../src/lib/image-hash-url'
import { appendFileSync } from 'node:fs'

/** Merchant category paths, appended as we go. Read by classify-cellphones.ts, offline. */
const CRUMB_FILE = 'data/cellphones-breadcrumbs.jsonl'

/** Consecutive challenge pages. Past the threshold the run stops rather than digging in deeper. */
let blockHits = 0
const BLOCK_LIMIT = 8

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
/**
 * `--overlay` — re-fetch every product whose photos still carry a BURNED mark and store them CLEAN
 * under `affiliate/m/`, for the app-drawn eno.vn mark (owner, 2026-09-13: one size and one corner on
 * every image; see src/components/marketplace/image-mark.tsx). Implies `--refetch`'s "at least as
 * many" rule, selects highest rankScore first, and skips listings already fully on clean photos, so
 * a killed run resumes by construction.
 */
const OVERLAY = process.argv.includes('--overlay')
const REFETCH = process.argv.includes('--refetch') || OVERLAY
/**
 * `--refetch --stale-before <iso>` — re-fetch ONLY the listings whose every stored image predates
 * <iso>, instead of the whole catalogue.
 *
 * ⛔ THIS EXISTS BECAUSE A BARE `--refetch` IS 4x THE WORK IT NEEDS TO BE. The square-crop fix
 * landed 2026-08-25T18:57+07:00 and most of the catalogue was re-fetched after it; measured
 * 2026-08-26, 12,438 of 50,462 stored images still predate it and 2,349 of 9,726 listings hold
 * NOTHING newer. Re-crawling all 9,726 product pages to reach those 2,349 is ~10-15h of requests
 * to someone else's site for ~3h of useful work.
 * ⚠️ ANY stale image selects the listing. A gallery is rewritten whole, so in practice it is all
 * or nothing — but the rule that matches the flag's meaning is "has something old in it".
 * ⚠️ The timestamp is the base36 `Date.now()` in the object path (`…-g-<b36>-<rand>-h<hash>.webp`),
 * which is the only record of WHEN an image was written — the DB stores no per-image date. A path
 * without one predates that naming and is treated as stale; so is an empty gallery, which wants
 * re-fetching for its own reasons.
 * ⚠️ THE CUTOFF IS THE FIX'S COMMIT TIME, AND THAT IS ONLY RIGHT BECAUSE NO PRE-FIX CRAWLER
 * OUTLIVED IT — a live Node process never reloads code, so one still running would have stamped
 * CROPPED images with post-cut times and this filter would skip them forever. Checked by sampling
 * squareness per hour: 15:00-17:00 and 17:00-18:57+07 are 100% square (120 of 120), 18:57-20:00
 * is 78%, and every later window holds that baseline. The transition is sharp at the commit
 * minute. Re-derive this before reusing the flag for a different fix.
 * ⚠️ MEASURED, because `every` looked too strict: a listing is entirely pre-fix or entirely
 * post-fix, never mixed (0 of 9,726 mixed on 2026-08-26). One `db.listing.update` rewrites the
 * whole `images` array, so a visit replaces the gallery rather than appending to it.
 */
const STALE_BEFORE = (() => {
  // ⚠️ `--stale-before=<v>` TOO, not just the space form. `argv.includes('--stale-before')` is
  // false for the equals spelling, so a typo'd flag would fall through to `null` and silently run
  // the FULL 9,726-page crawl with --apply already on — the exact widening these guards exist to
  // stop. Detect the flag by prefix, read the value from either spelling.
  const eq = process.argv.find((a) => a.startsWith('--stale-before='))
  const given = eq != null || process.argv.includes('--stale-before')
  const raw = eq ? eq.slice('--stale-before='.length) : arg('stale-before')
  if (!given) return null
  /**
   * ⛔ EVERY MISUSE HERE EXITS RATHER THAN NARROWING SILENTLY, because each one fails toward a
   * crawl of someone else's site that is either 4x too big or quietly incomplete — and both look
   * like success in the log.
   *  · no value (`--apply --stale-before` with the flag last): `arg()` returns undefined, the
   *    filter short-circuits to true, and you get the full 9,726-page run with --apply already on.
   *  · without `--refetch`: the filter never consults this at all and selects `<= 1 image`
   *    instead, while the banner still prints `--stale-before <date>`.
   *  · no UTC offset: `Date.parse('2026-08-25')` is UTC midnight — 07:00+07, twelve hours BEFORE
   *    the fix landed at 18:57+07. Images written in between then read as fresh, their listings
   *    are skipped, and the smaller target count reads as progress.
   */
  if (!raw || raw.startsWith('--')) { console.error('--stale-before needs an ISO timestamp, e.g. 2026-08-25T18:57:04+07:00'); process.exit(1) }
  if (!REFETCH) { console.error('--stale-before only narrows --refetch; pass both or neither'); process.exit(1) }
  // --overlay selects by "still on burned photos", not by age; combining them silently ignored one.
  if (OVERLAY) { console.error('--stale-before does not apply to --overlay (it selects every listing still on burned photos)'); process.exit(1) }
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) { console.error(`--stale-before: "${raw}" has no UTC offset — pass e.g. 2026-08-25T18:57:04+07:00`); process.exit(1) }
  const t = Date.parse(raw)
  if (Number.isNaN(t)) { console.error(`--stale-before: "${raw}" is not a date`); process.exit(1) }
  // A cutoff in the future marks the whole catalogue stale — the oversized crawl in a new costume.
  if (t > Date.now()) { console.error(`--stale-before: ${raw} is in the future; that selects every listing`); process.exit(1) }
  return t
})()

/** True when ANY image in this listing's gallery predates `cut` — i.e. the gallery needs re-fetching. */
function hasImageOlderThan(images: string | null, cut: number): boolean {
  // ⚠️ `Array.isArray`, not just try/catch. `JSON.parse('null')` does not throw — it returns null,
  // and `.every` on it throws INSIDE `.filter()`, aborting target selection before a single fetch.
  // Measured 0 such rows today; the guard is one line and the failure mode is the whole run.
  let list: unknown
  try { list = JSON.parse(images || '[]') } catch { return true }
  if (!Array.isArray(list) || list.length === 0) return true
  // ⚠️ ANCHORED TO THE FULL GENERATED TAIL, not just `-g-`. Measured across all 50,462 stored
  // paths the anchored and unanchored forms disagree on ZERO — but the loose one reads the FIRST
  // `-g-` anywhere in the URL, so the day a product slug contains one it parses that instead, and
  // an 8-char alphanumeric run is a base36 value past the cutoff. The listing would then be
  // skipped forever, silently keeping its cropped images. Anchoring costs nothing today.
  // A path this cannot read counts as STALE — including one carrying a `?query` a reviewer raised.
  // We build these paths ourselves and none has one, but the direction matters: unreadable means
  // re-fetch, which costs a page view, where the opposite would silently strand a cropped gallery.
  // ⛔ `some`, NOT `every`. They select the IDENTICAL set today (0 mixed galleries, measured), so
  // this costs nothing — but `every` skips a listing the moment ONE image is fresh, stranding the
  // stale ones beside it forever. One update rewrites the whole array so this crawler cannot make
  // a mixed gallery, but an import, a manual edit or a future write path can, and the failure
  // would be silent. `some` re-fetches a gallery that has anything old in it, which is the rule
  // the flag actually means.
  return list.some((u) => {
    const m = typeof u === 'string' ? /-g-([a-z0-9]+)-[a-z0-9]+-h[a-z0-9]+\.webp$/.exec(u) : null
    return !m || parseInt(m[1], 36) < cut
  })
}
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 3)
const MAX_IMAGES = Number(arg('max-images') ?? 6)
const PAUSE_MS = Number(arg('pause') ?? 1200)
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
// Clean hosting for --overlay: same resize, hash and upload path as the importers, no burned mark.
const overlayHost = makeImageHost({ storage, storageUrl: storageUrl ?? '', bucket: BUCKET, edge: EDGE, quality: 80, mark: 'overlay' })

/**
 * ⛔ ONE PAGE VISIT, TWO OUTPUTS. The merchant's own category path lives in the same Nuxt payload
 * as the gallery, so reading it here costs nothing — and crawling someone else's site twice for
 * two fields we could take in one pass would be rude and twice as slow. Learned the hard way: a
 * separate breadcrumb probe run alongside this one got 48 of 160 pages before both were throttled.
 */
/**
 * ⛔ THE BROWSER CAN DIE MID-RUN AND TAKE THE WHOLE JOB WITH IT. At concurrency 4 this crashed
 * after 60 of 9,726 products with "browser.newPage: Target page, context or browser has been
 * closed" — chromium went away and every subsequent call threw, so a job measured in hours ended
 * silently in its first minute. A crawl this long has to treat a dead browser as weather, not as
 * an error: the caller hands in a holder, and a closed browser is relaunched once and retried.
 */
type BrowserHolder = { b: Browser }
let relaunches = 0
/**
 * ⛔ ONE RELAUNCH AT A TIME, AND ONLY BY WHOEVER SAW THE BROWSER DIE.
 * The first version let every worker in the batch recover independently: when chromium died all
 * of them entered the catch, each closed `holder.b` and launched a replacement — so a late worker
 * would close a sibling's FRESH browser, that sibling's retry would throw "has been closed", and
 * the run would die exactly as before, now with two or three orphaned chromiums. Three reviewers
 * found the race independently.
 * Capturing the dead handle makes "is this still the browser I saw fail?" answerable, and the
 * shared promise makes the relaunch happen once while everyone else simply waits for it.
 */
let relaunching: Promise<void> | null = null

async function relaunch(holder: BrowserHolder, dead: Browser): Promise<void> {
  if (holder.b !== dead) return // somebody already replaced it; nothing to do
  if (!relaunching) {
    relaunching = (async () => {
      relaunches++
      console.error(`  browser died — relaunching (#${relaunches})`)
      try { await dead.close() } catch { /* already gone */ }
      holder.b = await chromium.launch()
    })().finally(() => { relaunching = null })
  }
  await relaunching
}

async function pageDataFor(holder: BrowserHolder, url: string): Promise<{ gallery: string[]; crumbs: string[] }> {
  let page
  const dead = holder.b
  try {
    page = await holder.b.newPage({ viewport: { width: 1280, height: 900 } })
  } catch (e) {
    if (!/closed|crash/i.test(String(e))) throw e
    await relaunch(holder, dead)
    page = await holder.b.newPage({ viewport: { width: 1280, height: 900 } })
  }
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2600)
    /**
     * ⛔ DETECT THE BLOCK, DO NOT CRAWL THROUGH IT. Running this at concurrency 5 alongside a
     * second crawler got us CAPTCHA-walled: every page returned HTTP 200 with a 6KB challenge and
     * no __NUXT__, which the gallery selectors read as "this product has no images". A blocked run
     * looks EXACTLY like a successful run over a site with no galleries, so it has to be checked
     * explicitly — and then stopped, because continuing only deepens the block.
     */
    const blocked = await page.evaluate(`(function () {
      return !window.__NUXT__ && document.documentElement.innerHTML.length < 20000
    })()`) as boolean
    if (blocked) { blockHits++; return { gallery: [], crumbs: [] } }
    await page.evaluate(() => document.querySelector('.gallery-slide, .box-gallery')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(2600)
    /**
     * ⛔ PASSED AS A STRING, NOT A FUNCTION, AND THAT IS THE ONLY THING THAT WORKS HERE.
     * tsx/esbuild rewrites any function it can name — including `const grab = () => …` — into a
     * call to its `__name` helper, which does not exist in the browser context. The callback then
     * dies with "ReferenceError: __name is not defined" and a silent catch reported it as "no
     * gallery" on pages that visibly had five images. A string expression is never transpiled.
     */
    const gallery = await page.evaluate(`(() => {
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

    /**
     * CellphoneS's own category path — the authority on what a product IS.
     * ⚠️ AND THE REASON IT MATTERS: `Phụ kiện > Ốp lưng > iPhone > iPhone 15 Pro Max` is a CASE FOR
     * an iPhone, not an iPhone. Classifying from the title matched the device name first and filed
     * 69% of "phones" as accessories. Their breadcrumb says which it is; a keyword never can.
     */
    const crumbs = await page.evaluate(`(() => {
      var n = window.__NUXT__
      var f = n && n.fetch && n.fetch['product-detail:0']
      var bc = f && f.breadcrumbsArr
      if (!bc || !bc.length) return []
      var out = []
      for (var i = 0; i < bc.length; i++) if (bc[i] && bc[i].name) out.push(String(bc[i].name).trim())
      return out
    })()`) as string[]
    return { gallery, crumbs }
  } catch (e) {
    // ⚠️ A SILENT `catch { return [] }` HERE READS AS "this product has no gallery" AND IS A LIE.
    // The first run reported 6/6 with no gallery on pages that visibly had five images.
    galleryErrors.push((e as Error).message.slice(0, 70))
    return { gallery: [], crumbs: [] }
  } finally { await page.close() }
}


/**
 * Fetch, resize, hash and upload one gallery photo CLEAN, for the app-drawn eno.vn mark. Returns the
 * public url and the dHash of the stored photo.
 *
 * ⛔ EVERY MODE HOSTS CLEAN SINCE 2026-09-13, NOT ONLY --overlay. The burned-mark pipeline that lived
 * here was deleted rather than kept behind the flag: a plain `--refetch` would otherwise re-stamp a
 * listing the overlay run had already migrated, bringing back exactly the per-file mark sizes the owner
 * reported (a reviewer's catch). The resize, EXIF handling and dHash now live in makeImageHost, which
 * uses the same 9x8 difference hash this file computed, so DUP_DISTANCE keeps its meaning.
 */
async function store(src: string, slug: string): Promise<{ url: string; hash: string | null } | null> {
  return overlayHost.detailed(src.startsWith('http') ? src : `https://${src}`, `cellphones-${slug}`)
}

async function main() {
  // ⛔ `ownerId: null` — Seller.name is not unique and this job rewrites the images column in bulk.
  const seller = await db.seller.findFirst({ where: { name: 'CellphoneS', ownerId: null }, select: { id: true } })
  if (!seller) { console.error('no CellphoneS storefront'); process.exit(1) }

  /**
   * Only products that still have a single image — this job is expensive and must be resumable.
   *
   * ⛔ `--refetch` TAKES EVERY PRODUCT INSTEAD, and exists for one reason: every image stored before
   * 2026-08-25 was CROPPED TO A CENTRE SQUARE. The old resize computed `side = min(w, h, EDGE)` and
   * used `fit: 'cover'`, so a 1080x272 banner was reduced to 272x272 — 75% of the pixels thrown
   * away, text sliced through the middle (owner: "most products have broken bad looking images").
   * The pipeline is fixed, but a fixed pipeline does not repair files already written.
   */
  const rows = (await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, images: true, affiliateUrl: true, externalId: true },
    // Highest rank first, so the photos people actually see are fixed first (matters for --overlay,
    // which is a ~10h crawl; harmless ordering for the other modes).
    orderBy: [{ rankScore: 'desc' }, { id: 'asc' }],
  })).filter((r) => {
    if (OVERLAY) {
      try {
        const list = JSON.parse(r.images || '[]')
        return !(Array.isArray(list) && list.length > 0 && list.every((u) => typeof u === 'string' && isOverlayImageUrl(u)))
      } catch { return true }
    }
    if (REFETCH) return STALE_BEFORE == null || hasImageOlderThan(r.images, STALE_BEFORE)
    try { return JSON.parse(r.images || '[]').length <= 1 } catch { return true }
  })

  const targets = LIMIT ? rows.slice(0, LIMIT) : rows
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}${REFETCH ? ' --refetch' : ''}${STALE_BEFORE != null ? ` --stale-before ${new Date(STALE_BEFORE).toISOString()}` : ''} — ${targets.length} products ${REFETCH ? 're-fetching uncropped' : 'with <=1 image'} (of ${rows.length})`)
  console.log(`  up to ${MAX_IMAGES} images each, concurrency ${CONCURRENCY}\n`)

  // The merchant page url is inside the affiliate link's `url=` parameter.
  const pageUrlOf = (aff: string | null): string | null => {
    if (!aff) return null
    try { return new URL(aff).searchParams.get('url') } catch { return null }
  }

  const holder: BrowserHolder = { b: await chromium.launch() }
  let done = 0, added = 0, none = 0, crumbed = 0, short = 0
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(async (r) => {
      const page = pageUrlOf(r.affiliateUrl)
      if (!page) { none++; return }
      const data = await pageDataFor(holder, page)
      const urls = data.gallery.slice(0, MAX_IMAGES + 4)
      done++
      // Appended as JSONL so a killed run keeps everything it already learned — the classifier
      // reads this file offline and can be re-run without touching the merchant's site again.
      if (data.crumbs.length && r.externalId) {
        appendFileSync(CRUMB_FILE, JSON.stringify({ externalId: r.externalId, crumbs: data.crumbs }) + '\n')
        crumbed++
      }
      if (!urls.length) { none++; return }
      blockHits = 0 // a real page resets the streak
      if (!APPLY) { added += Math.min(urls.length, MAX_IMAGES); return }

      const kept: string[] = []
      const hashes: string[] = []
      let hostFailed = false
      for (const u of urls) {
        if (kept.length >= MAX_IMAGES) break
        const s = await store(u, (r.externalId || 'p').replace(/[^a-z0-9]+/gi, '').slice(0, 24))
        if (!s) { hostFailed = true; continue }
        // A photo whose hash could not be computed is kept as distinct — fail open, as countDistinctAngles does.
        if (s.hash && hashes.some((h) => hammingHex(h, s.hash!) <= DUP_DISTANCE)) continue
        if (s.hash) hashes.push(s.hash)
        kept.push(s.url)
      }
      /**
       * ⚠️ NEVER SHRINK A GALLERY. If scraping produced less than we already had, keep what we had.
       * ⛔ UNDER --refetch THE RULE LOOSENS TO "AT LEAST AS MANY", NOT "AT LEAST ONE". Replacing is
       * the point — the stored files are the cropped ones — but `kept.length > 0` would let a page
       * that timed out on four of six images rewrite a six-image gallery down to two, and those
       * four URLs would be gone. CellphoneS throttles (BLOCK_LIMIT exists for that), so a partial
       * scrape is a normal event, not an edge case. Two reviewers caught this independently.
       * A shortfall is logged so it can be picked up by a second pass.
       */
      const existing: string[] = (() => { try { const v = JSON.parse(r.images || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })()
      // Under --overlay the rule is strict — at least as many as the listing holds, not capped at the
      // max: a reviewer showed the cap lets a gallery above the limit shrink to it. Measured: no
      // CellphoneS listing holds more than 6, the --max-images default.
      const enough = OVERLAY ? kept.length >= existing.length : kept.length >= Math.min(existing.length, MAX_IMAGES)
      if (REFETCH && kept.length > 0 && !enough) short++
      // ⛔ UNDER --overlay A HOSTING FAILURE REFUSES THE WRITE. Counting survivors is not enough: with
      // [A, B] stored and [A, B, C] scraped, a failed B still leaves two, "enough" — and B is gone
      // (a reviewer's worked example). Duplicates skipped by hash are not failures.
      if (OVERLAY && hostFailed) { short++; return }
      if (kept.length > existing.length || (REFETCH && enough && kept.length > 0)) {
        // ⛔ OPTIMISTIC under --overlay: this crawl runs for hours, so match the images value read at
        // selection rather than overwriting whatever an importer wrote since.
        if (OVERLAY) {
          const res = await db.listing.updateMany({ where: { id: r.id, images: r.images }, data: { images: JSON.stringify(kept) } })
            .catch((e: unknown) => { console.error(`  ${r.id}: write failed — ${String(e).slice(0, 120)}`); return null })
          if (res && res.count > 0) added += kept.length
          else if (res) console.log(`  ${r.id}: images changed underneath us — kept theirs`)
        } else {
          await db.listing.update({ where: { id: r.id }, data: { images: JSON.stringify(kept) } }).catch(() => {})
          added += kept.length
        }
      }
    }))
    // ⚠️ A REAL PAUSE BETWEEN BATCHES. This is thousands of requests to someone else's shop; the
    // job is measured in hours either way, and being throttled costs far more than waiting.
    await new Promise((res) => setTimeout(res, PAUSE_MS))
    if (blockHits >= BLOCK_LIMIT) {
      console.error(`\n⛔ STOPPING: ${blockHits} challenge pages in a row — cellphones.com.vn is rate-limiting us.`)
      console.error('   Wait for it to lift, then re-run; the job is resumable and keeps what it has.')
      break
    }
    if (done % 30 === 0) console.log(`  ${done}/${targets.length}  images added=${added}  no-gallery=${none}${short ? `  short(kept old)=${short}` : ''}`)
  }
  await holder.b.close()
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${done} pages read, ${added} images, ${crumbed} breadcrumb paths -> ${CRUMB_FILE}, ${none} with no gallery`)
  if (galleryErrors.length) {
    const kinds: Record<string, number> = {}
    for (const e of galleryErrors) kinds[e.split('\n')[0].slice(0, 46)] = (kinds[e.split('\n')[0].slice(0, 46)] || 0) + 1
    console.log('  gallery read errors:', JSON.stringify(kinds, null, 1))
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
