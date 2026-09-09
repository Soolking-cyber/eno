/**
 * Give imported Tiki listings a real photo gallery instead of the single feed image.
 *
 *   npx tsx scripts/backfill-tiki-gallery.ts                        # DRY RUN
 *   npx tsx scripts/backfill-tiki-gallery.ts --apply                 # the whole storefront
 *   npx tsx scripts/backfill-tiki-gallery.ts --apply --limit 50      # sample the first 50
 *
 * ⛔ `--limit` IS FOR SAMPLING ONLY — IT DOES NOT PAGINATE, AND THERE IS DELIBERATELY NO --skip.
 * Eligibility is "fewer than two images", and a product Tiki has only one photo of NEVER becomes
 * ineligible, so those rows sit at the head of the list forever and `--limit 50` re-selects them
 * on every run. An offset cursor does not fix that either: the eligible SET SHRINKS as rows
 * succeed, so `--skip 50` after a successful `--limit 50` skips fifty rows that were never
 * touched (codex and astra, who caught both halves). The real run is an unbounded `--apply`,
 * which is idempotent and simply resumes.
 *
 * ⛔ RUN THIS ON THE VN BOX, NOT ON A LAPTOP. Measured 2026-09-09: the same request returns
 * clean JSON from 162.4.176.208 and an 18KB HTML bot-challenge page (server: Byte-nginx) from
 * a foreign IP. The challenge answers HTTP **200**, so a naive fetch "succeeds" and then fails
 * to parse — there is no status code to check. That is why every response here must parse as
 * JSON before it counts, and why a run that reports thousands of misses from the wrong host is
 * measuring geography rather than Tiki's catalogue.
 *
 * ⚠️ WHY NOT THE AFFILIATE FEED. AccessTrade's `datafeeds` row carries exactly ONE `image`
 * field — verified field-by-field on a live row — and no other AccessTrade endpoint exposes a
 * gallery (`product_search`, `products`, `datafeeds/detail` all 404; `offers_informations`
 * returns link data). Tiki's own product-detail API is the only source, so the product id has
 * to be recovered from the affiliate link.
 *
 * ⚠️ ORPHANED UPLOADS ARE POSSIBLE AND BOUNDED, NOT UNBOUNDED. Images are hosted before the
 * database write, so a partial gallery, a lost optimistic update, or a killed process leaves
 * objects nothing references. They do not ACCUMULATE across runs, because the storage key is
 * deterministic (`tiki-<productId>-<index>`) and a retry overwrites the same objects rather
 * than minting new ones — the waste is one partial gallery per product that never completed,
 * not one per attempt. Reclaiming them belongs to the StorageTombstone sweep, not here.
 *
 * ⚠️ RUN IT AFTER THE IMPORTER, NOT ALONGSIDE. import-accesstrade.ts is NOT destructive here —
 * it reads `existing.images` and writes the same value back, so a gallery survives a re-import
 * (verified in its refresh set). But it reads and writes in separate statements, so a gallery
 * written between its read and its write is silently replaced by the single feed image. The
 * window is small and the cost is a wasted 5-image upload, so simply do not overlap them.
 *
 * ⚠️ ONE REQUEST PER SECOND, AND THAT NUMBER IS MEASURED, NOT GUESSED. Tiki blocks a burst:
 * 7 requests at ~0.5s spacing tripped the challenge, and it did NOT clear after 45s (it cleared
 * between 60s and 120s). At 1.0s spacing, 12/12 came back clean. Do not lower REQUEST_GAP_MS to
 * make a backfill finish sooner — the failure is silent, it poisons the next run's cooldown, and
 * the whole job then has to wait out a block it caused.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { parseTikiGallery, tikiProductId } from '../src/lib/tiki-gallery'

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
/** ⚠️ Validated, not just parsed: `--gap -1` would remove the throttle this script depends on,
 *  and `--max -1` turns `slice(0, -1)` into "almost the whole gallery" (codex). */
const num = (name: string, fallback: number, min: number) => {
  if (!process.argv.includes(`--${name}`)) return fallback
  const raw = arg(name)
  // ⛔ A FLAG THAT IS PRESENT MUST CARRY A VALID VALUE. `--apply --limit` (value omitted, or
  // swallowed by the next flag) and `--limit 0.5` both floored to 0, which is the UNLIMITED
  // sentinel — so an operator asking for a bounded sample silently rewrote the whole storefront
  // (astra). Presence is checked separately from parsing for exactly that reason.
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < min) {
    console.error(`--${name} requires an integer >= ${min}`)
    process.exit(1)
  }
  return n
}
const LIMIT = num('limit', 0, 0)
const STOREFRONT = arg('seller') ?? 'Tiki'
/** Owner, 2026-09-09: "at least 3-5 images not only 1". 5 is the ceiling the PDP gallery shows. */
const MAX_IMAGES = num('max', 5, 1)
/** ⛔ FLOOR OF 1000ms, MATCHING WHAT WAS MEASURED. Accepting `--gap 500` would have allowed
 *  exactly the spacing recorded below as triggering a persistent challenge (astra). */
const REQUEST_GAP_MS = num('gap', 1000, 1000)

const BUCKET = 'listings'
const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null
const hostImage = makeImageHost({ storage, storageUrl: storageUrl!, bucket: BUCKET, edge: 1200, quality: 80 })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The hosted images on a listing row.
 * ⚠️ `JSON.parse` IS NOT ENOUGH — the column is TEXT and `"null"`, `"{}"` and `"5"` all parse
 * cleanly to non-arrays, and `.length` on the result throws. A row like that used to pass the
 * guarded read during selection and then crash the whole run HOURS later, after uploads, at an
 * unguarded `.length` (astra). Anything that is not an array of strings is treated as empty.
 */
function storedImages(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Up to `MAX_IMAGES` gallery URLs, or null if Tiki did not answer with usable JSON. */
async function fetchGallery(pid: string, spid: string | null): Promise<string[] | null> {
  const url = `https://api.tiki.vn/product-detail/api/v1/products/${pid}?platform=web${spid ? `&spid=${spid}` : ''}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://tiki.vn/' },
      signal: AbortSignal.timeout(25_000),
    })
    // ⛔ NOT `res.ok`. The bot challenge is served as 200 text/html, so the status proves
    // nothing — parseTikiGallery decides by parsing. See src/lib/tiki-gallery.ts.
    return parseTikiGallery(await res.text(), MAX_IMAGES, pid)
  } catch {
    return null
  }
}

async function main() {
  const seller = await db.seller.findFirst({ where: { name: STOREFRONT }, select: { id: true, name: true } })
  if (!seller) { console.error(`storefront "${STOREFRONT}" not found`); process.exit(1) }

  // Only listings that actually need it: fewer than two hosted images. A listing already
  // carrying a gallery is left alone so a re-run is cheap and cannot re-upload what it did last
  // time.
  //
  // ⛔ `--limit` BOUNDS ELIGIBLE ROWS, NOT SCANNED ROWS. Taking LIMIT rows and THEN filtering
  // meant `--apply --limit 50` re-selected the same oldest 50 on every run, found them already
  // enriched, and did nothing — while thousands of later rows waited forever. Bounded reruns are
  // the documented way to use this, so they have to actually advance (codex and astra).
  const need: { id: string; images: string; affiliateUrl: string | null; externalId: string | null }[] = []
  let scanned = 0
  const PAGE = 2000
  for (let skip = 0; ; skip += PAGE) {
    const page = await db.listing.findMany({
      where: { sellerId: seller.id, affiliateUrl: { not: null } },
      select: { id: true, images: true, affiliateUrl: true, externalId: true },
      // ⚠️ TIE-BROKEN BY id. A bulk import stamps thousands of rows with the same createdAt, and
      // offset pagination over a non-unique sort has no stable order — rows land on two pages or
      // on none, so a storefront past one page is silently processed incompletely (codex).
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
      skip,
    })
    if (page.length === 0) break
    scanned += page.length
    for (const r of page) {
      if (storedImages(r.images).length >= 2) continue
      // ⛔ THE RAW VALUE, NOT A NORMALISED ONE. The optimistic update matches on this string, so
      // storing `r.images || '[]'` for a row whose column actually holds `''` guarantees a
      // zero-row update — the script would re-upload the same five images on every run and
      // report a race that never happened (astra).
      need.push(r)
      if (LIMIT && need.length >= LIMIT) break
    }
    if (LIMIT && need.length >= LIMIT) break
    if (page.length < PAGE) break
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${seller.name}: scanned ${scanned}, ${need.length} with <2 images`)
  console.log(`up to ${MAX_IMAGES} images each, ${REQUEST_GAP_MS}ms between Tiki requests → ~${Math.round((need.length * REQUEST_GAP_MS) / 3_600_000 * 10) / 10}h\n`)

  let enriched = 0, noId = 0, blocked = 0, thin = 0, uploadFail = 0, raced = 0, consecutiveBlocked = 0
  for (const [n, row] of need.entries()) {
    const pid = tikiProductId(row.affiliateUrl)
    if (!pid) { noId++; continue }

    const gallery = await fetchGallery(pid, row.externalId)
    await sleep(REQUEST_GAP_MS)

    if (gallery === null) {
      blocked++
      consecutiveBlocked++
      // ⛔ BACK OFF HARD RATHER THAN GRINDING. Once the challenge is up every further request
      // is wasted AND keeps the block alive; the measured recovery window is 60-120s, so wait
      // past it. Grinding through a block is how a run reports "Tiki has no images".
      if (consecutiveBlocked >= 5) {
        console.log(`  … ${consecutiveBlocked} blocked in a row at ${n}/${need.length} — cooling down 180s`)
        await sleep(180_000)
        consecutiveBlocked = 0
      }
      continue
    }
    consecutiveBlocked = 0

    // One image is what we already have; only a real gallery is worth the upload cost.
    if (gallery.length < 2) { thin++; continue }

    if (!APPLY) { enriched++; continue }

    const slug = `tiki-${pid}`
    const hosted: string[] = []
    for (const [i, src] of gallery.entries()) {
      const url = await hostImage(src, `${slug}-${i}`)
      if (url) hosted.push(url)
    }
    // ⛔ ALL OR NOTHING, WHICH IS SIMPLER THAN IT IS STRICT. A partial set is not a smaller
    // version of a good gallery — it is an ARBITRARY subset, and counting images cannot tell
    // whether it still contains the cover the card and PDP hero use. An earlier attempt guarded
    // "index 0 hosted", but parseTikiGallery filters rejected URLs BEFORE returning, so index 0
    // is not necessarily Tiki's cover (astra). Rather than reason about which shot survived:
    // write only a gallery that hosted completely, and leave the row eligible for a later run.
    if (hosted.length !== gallery.length) { uploadFail++; continue }
    // ⛔ NEVER REPLACE A GOOD SINGLE IMAGE WITH A SHORTER SET. If hosting mostly failed, the
    // listing keeps what it had — a write here is only an improvement if it strictly adds.
    // (Tiki's gallery[0] IS the cover, so the replacement is a superset in content even though
    // the hosted URLs differ.)
    const current = storedImages(row.images)
    if (hosted.length <= current.length) { uploadFail++; continue }

    // ⛔ OPTIMISTIC WRITE. `need` is read up front and this loop runs for hours, so `row.images`
    // is stale by the time we get here. An unconditional update would let this script replace a
    // NEWER five-image gallery — written by a re-import or a second run — with its own two, and
    // the `hosted.length > current.length` guard above cannot see it because it compares against
    // the stale value too. Match the value we actually read, or leave the row alone (codex and
    // astra, reviewing this script).
    const { count } = await db.listing.updateMany({
      where: { id: row.id, images: row.images },
      data: { images: JSON.stringify(hosted) },
    })
    if (count === 0) { raced++; continue }
    enriched++

    if (enriched % 25 === 0) {
      console.log(`  ${n + 1}/${need.length}  enriched=${enriched} blocked=${blocked} thin=${thin} noId=${noId}`)
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${enriched} listings given a gallery`)
  console.log(`  ${thin} had <2 images at Tiki, ${blocked} blocked/unreachable, ${noId} no product id, ${uploadFail} upload shortfall, ${raced} changed underneath us`)
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
