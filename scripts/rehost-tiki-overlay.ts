/**
 * Re-fetch every Tiki listing's photos CLEAN, for the app-drawn eno.vn mark.
 *
 *   npx tsx scripts/rehost-tiki-overlay.ts --limit 20               # DRY RUN — reads Tiki, writes nothing
 *   npx tsx scripts/rehost-tiki-overlay.ts --apply --limit 5        # sample the top 5 by rank
 *   npx tsx scripts/rehost-tiki-overlay.ts --apply                  # everything, highest rank first
 *
 * Owner, 2026-09-13: "consistent sizing and placement of eno.vn watermark on all images … one has
 * big small other missing". They picked the OVERLAY: photos are stored clean under `affiliate/m/`
 * and the app draws one mark at one size and corner (src/components/marketplace/image-mark.tsx).
 * Every Tiki photo stored before that carries a BURNED mark sized off its own file, so it has to be
 * fetched again from Tiki — a burned mark cannot be removed from the stored bytes.
 *
 * ⛔ RUN ON THE VN BOX. Tiki answers a foreign IP with a 200 HTML bot challenge (see
 * backfill-tiki-gallery.ts, which measured it); parseTikiGallery refuses anything that is not JSON.
 * ⛔ ONE TIKI REQUEST PER SECOND — the same measured floor as backfill-tiki-gallery.ts. Only the
 * HOSTING runs in parallel (`--pool`), behind the throttled API calls, which is what makes 52k
 * listings a ~15h job instead of ~40h.
 *
 * ⚠️ HIGHEST rankScore FIRST, so the listings people actually see are fixed in the first hour.
 * ⚠️ RESUMABLE BY CONSTRUCTION: a listing whose images are all clean imports (isOverlayImageUrl) is not
 * selected, so a killed run simply continues. No checkpoint file to trust or lose.
 * ⛔ NEVER SHRINKS A GALLERY. A replacement is written only when EVERY photo Tiki returned hosted AND
 * there are at least as many as the listing holds now — checked before uploading. A listing whose
 * Tiki gallery got shorter keeps its current photos and is counted as `short`: a stale burned photo is
 * a blemish, a lost photo is data loss. (Measured: every Tiki listing holds <= 5, the --max default.)
 * ⚠️ ORPHANS: a partial upload failure or a lost optimistic write leaves the photos that DID upload
 * unreferenced under affiliate/m/. They are reclaimed with the replaced burned objects by the separate
 * cleanup; the pre-upload `short` check keeps the common case from producing any.
 * ⚠️ THE DRY RUN STILL READS TIKI (one request per listing, same throttle) — it writes nothing, but
 * it is not free. Use --limit to sample.
 * ⛔ OPTIMISTIC WRITE on the images value read at selection, as in backfill-tiki-gallery.ts. Do not run
 * alongside import-accesstrade.ts (it reads and writes images in separate statements). The nightly
 * price refresh and partner-stock cron never write `images` (applyPriceChanges sets price/updatedAt;
 * partner-stock sets price/status), so they are safe to overlap.
 * ⚠️ The old objects are NOT deleted here. They become unreferenced and are reclaimed by a separate,
 * reviewed cleanup — deleting in the same pass would make a bad run unrecoverable.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { parseTikiGallery, tikiProductId } from '../src/lib/tiki-gallery'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
/** A flag that is present must carry a valid integer (the same rule backfill-tiki-gallery.ts learned). */
const num = (name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
  if (!process.argv.includes(`--${name}`)) return fallback
  const n = Number(arg(name))
  if (!Number.isInteger(n) || n < min || n > max) { console.error(`--${name} requires an integer in ${min}..${max}`); process.exit(1) }
  return n
}
const LIMIT = num('limit', 0, 0)
const MAX_IMAGES = num('max', 5, 1, 10)
const REQUEST_GAP_MS = num('gap', 1000, 1000)
const POOL = num('pool', 4, 1, 8)

const BUCKET = 'listings'
const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null
const host = makeImageHost({ storage, storageUrl: storageUrl ?? '', bucket: BUCKET, edge: 1200, quality: 80, mark: 'overlay' })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Anything that is not an array of strings is treated as empty (the column is TEXT). */
function storedImages(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
async function fetchGallery(pid: string, spid: string | null): Promise<string[] | null> {
  const url = `https://api.tiki.vn/product-detail/api/v1/products/${pid}?platform=web${spid ? `&spid=${spid}` : ''}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://tiki.vn/' }, signal: AbortSignal.timeout(25_000) })
    return parseTikiGallery(await res.text(), MAX_IMAGES, pid)
  } catch { return null }
}

type Row = { id: string; images: string; affiliateUrl: string | null; externalId: string | null }

async function main() {
  const seller = await db.seller.findFirst({ where: { name: 'Tiki', ownerId: null }, select: { id: true } })
  if (!seller) { console.error('no Tiki storefront'); process.exit(1) }

  // Every id up front, in rank order, so rows that become overlay mid-run cannot shift a page.
  const rows: Row[] = []
  for (let skip = 0; ; skip += 5000) {
    const page = await db.listing.findMany({
      where: { sellerId: seller.id, affiliateUrl: { not: null } },
      select: { id: true, images: true, affiliateUrl: true, externalId: true },
      orderBy: [{ rankScore: 'desc' }, { id: 'asc' }],
      take: 5000,
      skip,
    })
    for (const r of page) {
      const imgs = storedImages(r.images)
      if (imgs.length > 0 && imgs.every(isOverlayImageUrl)) continue
      rows.push(r)
    }
    if (page.length < 5000) break
  }
  const todo = LIMIT ? rows.slice(0, LIMIT) : rows
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — Tiki: ${rows.length} listings still on burned photos; processing ${todo.length}`)
  console.log(`1 Tiki request / ${REQUEST_GAP_MS}ms, hosting pool ${POOL} → ~${Math.round(todo.length * (REQUEST_GAP_MS + 150) / 36e5 * 10) / 10}h\n`)

  let replaced = 0, noId = 0, blocked = 0, empty = 0, short = 0, uploadFail = 0, raced = 0, consecutiveBlocked = 0
  const inflight = new Set<Promise<void>>()
  const started = Date.now()

  const hostAndWrite = async (row: Row, pid: string, gallery: string[]) => {
    const got = await Promise.all(gallery.map((src, i) => host.detailed(src, `tiki-${pid}-${i}`)))
    if (got.some((g) => !g)) { uploadFail++; return }
    const urls = got.map((g) => g!.url)
    const { count } = await db.listing.updateMany({ where: { id: row.id, images: row.images }, data: { images: JSON.stringify(urls) } })
    if (count === 0) { raced++; return }
    replaced++
  }

  for (const [n, row] of todo.entries()) {
    const pid = tikiProductId(row.affiliateUrl)
    if (!pid) { noId++; continue }
    const gallery = await fetchGallery(pid, row.externalId)
    await sleep(REQUEST_GAP_MS)
    if (gallery === null) {
      blocked++
      if (++consecutiveBlocked >= 5) {
        console.log(`  … ${consecutiveBlocked} blocked in a row at ${n}/${todo.length} — cooling down 180s`)
        await sleep(180_000)
        consecutiveBlocked = 0
      }
      continue
    }
    consecutiveBlocked = 0
    if (gallery.length === 0) { empty++; continue }
    // Decided BEFORE any upload, so a gallery that could never be written leaves no objects behind.
    if (gallery.length < storedImages(row.images).length) { short++; continue }
    if (!APPLY) { replaced++; continue }

    const p: Promise<void> = hostAndWrite(row, pid, gallery).catch((e) => { uploadFail++; console.error(`  ${row.id}: ${String(e).slice(0, 120)}`) })
      .finally(() => { inflight.delete(p) })
    inflight.add(p)
    if (inflight.size >= POOL) await Promise.race(inflight)

    if ((n + 1) % 100 === 0) {
      const mins = (Date.now() - started) / 60000
      console.log(`  ${n + 1}/${todo.length} (${mins.toFixed(1)}min)  replaced=${replaced} short=${short} blocked=${blocked} empty=${empty} noId=${noId} uploadFail=${uploadFail} raced=${raced}`)
    }
  }
  await Promise.all(inflight)

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${replaced} listings ${APPLY ? 'now on clean photos' : 'would be re-fetched'}`)
  console.log(`  ${short} Tiki gallery shorter than ours (kept), ${empty} no photos at Tiki, ${blocked} blocked/unreachable, ${noId} no product id, ${uploadFail} upload failures, ${raced} changed underneath us`)
  if (APPLY && replaced) console.log(`\n⚠️  PDPs cache for 30 days in ISR — run scripts/purge-isr-listings.mjs so the new photos show.`)
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
