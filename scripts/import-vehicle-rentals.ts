/**
 * HCMC vehicle rentals → eno REFERENCE LISTINGS: Mioto + BonbonCar cars, and five motorbike shops.
 * Owner, 2026-09-27/28: Mioto and BonbonCar granted permission to reuse listings + photos; the bike
 * shops are "scrape for now"; scope "focus on hcmc". The pure rules (what is imported, at what price
 * and unit, which photos) live in src/lib/vehicle-rental-listing.ts and are unit-tested there.
 *
 * TWO STAGES, PHOTOS FIRST. Both DRY by default; `--apply` writes.
 *
 *   # 1. re-host the selected LOCAL photos into our bucket, recording each in a manifest
 *   set -a; . ./.env; set +a; npx tsx scripts/import-vehicle-rentals.ts --stage photos \
 *     --mioto ~/mioto_rentals_vn --bonbon ~/bonboncar_rentals_vn --bikes ~/motorbike_rentals_vn \
 *     --manifest ~/eno-import-journals/vehicle-photos.jsonl [--apply] [--limit N] [--only mioto,janmotorbike]
 *   # 2. upsert the rows — only those whose EVERY selected photo is in the manifest
 *   … --stage import (same sources + --manifest) [--apply] [--gone <file>] [--vnd-per-usd N]
 *
 * ⛔ WHY PHOTOS FIRST. The Rever import went live hotlinking photo.rever.vn and was re-hosted a day
 * later by a second script that had to rewrite `images` with raw SQL. Here a row is only CREATED once
 * its photos are already ours, so no listing is ever public pointing at a partner's CDN, the eno.vn
 * mark renders from the first request (the overlay only fires under `listings/affiliate/m/`), and
 * `images` can stay create-only with nothing to rewrite afterwards.
 * ⚠️ THE COST: a later change to the photo SELECTION (a plate-blur pass, a new filter) does not reach
 * rows that already exist — `images` is create-only here exactly as in the Rever importer. Changing
 * the photos of live rows is attach-rever-photos.ts's shape of job (conditional raw-SQL rewrite with a
 * journal), not a re-import. The `beforeUpload` hook below is where a blur pass slots in BEFORE the
 * first run, which is the cheap moment to decide it.
 *
 * ⛔ THE MARK IS NEVER BURNED IN. makeImageHost({ mark: 'overlay' }) stores the photo clean with the
 * ink + size in its filename; the app draws the mark. See the eno-watermark-never-burn rule.
 *
 * ⚠️ PREVIEW WITHOUT PRODUCTION. `--storage-dir <dir>` swaps Supabase for a filesystem adapter that
 * writes the same paths under <dir>; serve <dir> statically and point NEXT_PUBLIC_SUPABASE_URL at that
 * server for the stage, the import and the build, against a scratch database. It is refused unless
 * NEXT_PUBLIC_SUPABASE_URL is loopback, so a preview manifest can never hold production-looking urls,
 * and the import refuses any manifest url outside `${NEXT_PUBLIC_SUPABASE_URL}/…/listings/affiliate/m/`.
 */
import { readFileSync, existsSync, statSync, openSync, writeSync, fsyncSync, closeSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { invokedDirectly } from '../src/lib/cli-entry'
import { createHash } from 'node:crypto'
import {
  VEHICLE_SELLERS, SHOP_KEYS, stageMioto, stageBonbon, stageShopBike, miotoOwnerBlock, usableTranslation,
  type StagedVehicle, type StageResult, type SellerKey, type Fx, type StageDeps,
} from '../src/lib/vehicle-rental-listing'
import { VND_PER_USD_BAND, vndPerUsdFrom } from '../src/lib/honeycomb-listing'
import { browseRankScore } from '../src/lib/ranking-formula'
// ⛔ Every importer screens a row before it writes it — banned words + advertising-banned goods.
import { ImportScreen } from '../src/lib/import-screen'

const argv = process.argv
const APPLY = argv.includes('--apply')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] ? argv[i + 1] : d
}
const expand = (p: string | null) => (p ? resolvePath(p.replace(/^~(?=\/|$)/, homedir())) : null)
const STAGE = str('--stage', 'import')
const MIOTO = expand(str('--mioto'))
const BONBON = expand(str('--bonbon'))
const BIKES = expand(str('--bikes'))
const MANIFEST = expand(str('--manifest'))
const STORAGE_DIR = expand(str('--storage-dir'))
const GONE = expand(str('--gone'))
const LIMIT = Number(str('--limit', '0'))
const ONLY = str('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const FX_OVERRIDE = str('--vnd-per-usd')
const CONCURRENCY = Math.max(1, Math.min(8, Number(str('--concurrency', '4'))))
/** A scrape older than this cannot be applied: prices and availability both come from it. */
const MAX_AGE_DAYS = 7

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const BUCKET = 'listings'
const HOSTED_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/affiliate/m/`

type Row = Record<string, any>
type Manifest = Map<string, string>

// ── Loading + staging ────────────────────────────────────────────────────────────────────────────

const fileOk = (abs: string) => { try { return statSync(abs).size > 0 } catch { return false } }
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

async function usdRate(): Promise<Fx | null> {
  if (FX_OVERRIDE) {
    const v = Number(FX_OVERRIDE)
    if (!(v >= VND_PER_USD_BAND.min && v <= VND_PER_USD_BAND.max)) throw new Error(`--vnd-per-usd ${FX_OVERRIDE} is outside ${VND_PER_USD_BAND.min}–${VND_PER_USD_BAND.max}`)
    return { vndPerUsd: v, source: '--vnd-per-usd' }
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(15_000) })
    const json = await res.json()
    const v = vndPerUsdFrom(json)
    /** ⛔ FAIL CLOSED: no plausible rate → USD rows are dropped (counted as usdNoRate), never guessed. */
    return v === null ? null : { vndPerUsd: v, source: `open.er-api.com USD base, ${(json as { time_last_update_utc?: string }).time_last_update_utc ?? '?'}` }
  } catch { return null }
}

/** The `Translation` table's key: sha1 of the EXACT text, no trim or normalisation (src/lib/translate.ts hash()). */
const translationHash = (t: string) => createHash('sha1').update(t).digest('hex')

/**
 * ⛔ READ-ONLY LOOKUP OF ALREADY-CACHED TRANSLATIONS, NEVER A TRANSLATOR CALL. The weekly job runs
 * unattended over ~6,400 rows; a paid call in here would bill on every changed owner text, every week.
 * Rows are written by the translation fill, insert-only, keyed exactly like translate.ts. A text with no
 * row keeps today's wording (src/lib/vehicle-rental-listing.ts usableTranslation).
 * Only the import stage reads it: the photo stage never looks at descriptions, and needs no database.
 */
export async function readCachedTranslations(wanted: { text: string; target: 'en' | 'vi' }[]): Promise<StageDeps['cached']> {
  const byTarget = new Map<'en' | 'vi', Set<string>>()
  for (const w of wanted) if (w.text) (byTarget.get(w.target) ?? byTarget.set(w.target, new Set()).get(w.target)!).add(translationHash(w.text))
  if (!byTarget.size) return () => null
  const found = new Map<string, string>()
  let db: { $disconnect(): Promise<void>; translation: { findMany(a: object): Promise<{ hash: string; value: string }[]> } } | null = null
  /**
   * ⛔ A FAILED LOOKUP FAILS THE IMPORT; IT IS NOT A MISS. Read as "nothing cached", one bad week would
   * rewrite every composed English description back to the labelled Vietnamese, and the next week
   * would flip them all again (review). The weekly job then reports "import stage FAILED", and the
   * prices wait a week. The import's own reads go to the same database, so they would most likely
   * have failed anyway.
   */
  try {
    const { PrismaClient } = await import('../src/generated/prisma/client')
    const { PrismaPg } = await import('@prisma/adapter-pg')
    // Short timeouts: a dead or stalled database fails this run in seconds, not after the OS gives up.
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 }), log: ['warn', 'error'] })
    for (const [target, set] of byTarget) {
      const hashes = [...set]
      for (let i = 0; i < hashes.length; i += 1000) {
        const rows = await db!.translation.findMany({ where: { target, hash: { in: hashes.slice(i, i + 1000) } }, select: { hash: true, value: true } })
        for (const r of rows) found.set(`${target} ${r.hash}`, r.value)
      }
    }
  } catch (e) {
    throw new Error(`cached translations unreadable — refusing to stage descriptions without them: ${(e as Error).message.slice(0, 200)}`)
  } finally {
    await db?.$disconnect().catch(() => {})
  }
  return (t, target) => found.get(`${target} ${translationHash(t)}`) ?? null
}

export async function stageAll(): Promise<{ rows: StagedVehicle[]; drops: Record<string, Record<string, number>>; fx: Fx | null }> {
  const drops: Record<string, Record<string, number>> = {}
  const rows: StagedVehicle[] = []
  const tally = (src: string, res: StageResult) => {
    if (res.ok) {
      if (ONLY && !ONLY.includes(res.row.seller)) return
      rows.push(res.row)
      return
    }
    const d = (drops[src] ??= {})
    d[res.reason] = (d[res.reason] ?? 0) + 1
  }

  const miotoSrc: Row[] = MIOTO ? readJson(join(MIOTO, 'all_rentals.json')) : []
  // The blocks each row would look up, computed by the SAME functions the stage uses.
  const wanted = miotoSrc.map((r) => ({ text: miotoOwnerBlock(r), target: 'en' as const }))
  const cached = STAGE === 'import' ? await readCachedTranslations(wanted) : undefined
  const hits = cached ? wanted.filter((w) => usableTranslation({ cached }, w.text, w.target)).length : 0
  console.log(`  cached translations   ${cached ? `${hits} of ${wanted.filter((w) => w.text).length} owner/shop blocks` : 'not read (photo stage)'}`)

  if (MIOTO) {
    const src = miotoSrc
    const manifest: Record<string, { sha1?: (string | null)[] }> = readJson(join(MIOTO, 'state', 'images_manifest.json'))
    // sha1s on MORE THAN ONE car anywhere in the scrape (not only HCMC): a shared shot is a fleet's
    // stock image — a leaflet in a seat pocket sat on 118 cars — not a photo of any one car.
    const carsBySha = new Map<string, number>()
    for (const m of Object.values(manifest)) for (const h of new Set(m.sha1 ?? [])) if (h) carsBySha.set(h, (carsBySha.get(h) ?? 0) + 1)
    const shared = new Set([...carsBySha].filter(([, n]) => n > 1).map(([h]) => h))
    const deps = { resolve: (rel: string) => join(MIOTO, rel), fileOk, cached, sharedSha1: shared, sha1Of: (id: string) => manifest[id]?.sha1 ?? [] }
    for (const r of src) tally('mioto', stageMioto(r, deps))
    console.log(`  mioto shared images   ${shared.size} sha1s appear on >1 car (dropped)`)
  }
  if (BONBON) {
    const src: Row[] = readJson(join(BONBON, 'all_rentals.json'))
    for (const r of src) tally('bonboncar', stageBonbon(r, { resolve: (rel) => join(BONBON, rel), fileOk }))
  }
  let fx: Fx | null = null
  if (BIKES) {
    fx = await usdRate()
    const src: Row[] = readJson(join(BIKES, 'all_rentals.json'))
    for (const r of src) {
      if (!(SHOP_KEYS as readonly string[]).includes(r.shop)) continue // other shops/cities: out of scope, not a drop
      tally(r.shop, stageShopBike(r, { resolve: (rel) => join(BIKES, rel), fileOk, fx }))
    }
  }
  return { rows: LIMIT ? rows.slice(0, LIMIT) : rows, drops, fx }
}

function report(rows: StagedVehicle[], drops: Record<string, Record<string, number>>, fx: Fx | null) {
  const bySeller = new Map<string, number>()
  for (const r of rows) bySeller.set(r.seller, (bySeller.get(r.seller) ?? 0) + 1)
  console.log(`  staged                ${rows.length}${LIMIT ? ` (--limit ${LIMIT})` : ''}`)
  for (const [s, n] of bySeller) console.log(`    ${s.padEnd(18)} ${n}`)
  console.log(`  dropped               ${JSON.stringify(drops)}`)
  console.log(`  USD rate              ${fx ? `${fx.vndPerUsd} ₫/$ (${fx.source})` : BIKES ? 'NONE — USD-priced bikes dropped' : '(no bike source)'}`)
  console.log(`  photos selected       ${rows.reduce((n, r) => n + r.photos.length, 0)}`)
}

// ── Manifest (durable, append-only) ──────────────────────────────────────────────────────────────

function loadManifest(file: string): Manifest {
  const m: Manifest = new Map()
  if (!existsSync(file)) return m
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const e = JSON.parse(line); if (e.local && e.url) m.set(e.local, e.url) } catch { /* a torn last line from a kill -9 */ }
  }
  return m
}
/** Append + fsync THE APPEND HANDLE before moving on (attach-rever-photos.ts has why). */
function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}

// ── Stage 1: photos ──────────────────────────────────────────────────────────────────────────────

/**
 * The hook a plate-blur pass would fill (undecided as of 2026-09-28). It gets the ORIGINAL bytes and
 * returns the bytes to upload; identity today. ⚠️ Decide it before the first `--apply`: rows are
 * created with whatever this produced, and `images` is create-only afterwards.
 */
async function beforeUpload(buf: Buffer, _ctx: { externalId: string; local: string }): Promise<Buffer> {
  return buf
}

async function photos(rows: StagedVehicle[]) {
  if (!MANIFEST) throw new Error('--manifest <file.jsonl> is required')
  if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required (it is the prefix every stored url is built from)')
  let storage: import('../src/lib/host-product-image').ProductImageStorage | null = null
  if (STORAGE_DIR) {
    const host = new URL(SUPABASE_URL).hostname
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(`--storage-dir is for PREVIEW: NEXT_PUBLIC_SUPABASE_URL must be loopback (got ${SUPABASE_URL}), or the manifest would hold urls that look like production`)
    }
    storage = {
      async upload(path, body) {
        const abs = join(STORAGE_DIR, 'storage/v1/object/public', BUCKET, path)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, body)
        return { error: null }
      },
    }
  } else if (process.env.SUPABASE_SECRET_KEY) {
    const { createClient } = await import('@supabase/supabase-js')
    storage = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }).storage.from(BUCKET)
  }
  if (APPLY && !storage) throw new Error('storage unavailable — set SUPABASE_SECRET_KEY, or --storage-dir for a preview')
  const { makeImageHost } = await import('../src/lib/host-product-image')
  const host = makeImageHost({ storage, storageUrl: SUPABASE_URL, bucket: BUCKET, edge: 1600, quality: 82, mark: 'overlay' })

  const done = loadManifest(MANIFEST)
  const todo = rows.filter((r) => r.photos.some((p) => !done.has(p.local)))
  const pending = todo.reduce((n, r) => n + r.photos.filter((p) => !done.has(p.local)).length, 0)
  console.log(`  manifest              ${MANIFEST} (${done.size} photos already hosted)`)
  console.log(`  rows needing photos   ${todo.length} (${pending} uploads)`)
  console.log(`  storage               ${STORAGE_DIR ? `LOCAL ${STORAGE_DIR} (preview)` : storage ? `supabase ${SUPABASE_URL}` : 'none'}`)
  console.log(`  mode                  ${APPLY ? 'APPLY — UPLOADS' : 'DRY RUN'}`)
  if (!APPLY) { console.log('\n  DRY RUN — nothing uploaded. Re-run with --apply.'); return }
  mkdirSync(dirname(MANIFEST), { recursive: true })

  const stat = { rowsComplete: 0, rowsIncomplete: 0, uploaded: 0, failed: 0 }
  let next = 0
  async function worker() {
    for (;;) {
      const r = todo[next++]
      if (!r) return
      let complete = true
      const slug = r.externalId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      for (const p of r.photos) {
        if (done.has(p.local)) continue
        try {
          const buf = await beforeUpload(readFileSync(p.local), { externalId: r.externalId, local: p.local })
          const url = await host.fromBuffer(buf, slug)
          if (!url || !url.startsWith(HOSTED_PREFIX)) { complete = false; stat.failed++; continue }
          recordDurably(MANIFEST!, JSON.stringify({ externalId: r.externalId, local: p.local, url, at: new Date().toISOString() }))
          done.set(p.local, url)
          stat.uploaded++
        } catch (e) {
          complete = false; stat.failed++
          console.warn(`  ! ${r.externalId} ${p.local}: ${(e as Error).message.slice(0, 120)}`)
        }
      }
      if (complete) stat.rowsComplete++; else stat.rowsIncomplete++
      const n = stat.rowsComplete + stat.rowsIncomplete
      if (n % 100 === 0) console.log(`  ${n}/${todo.length} rows · ${stat.uploaded} photos`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\n${JSON.stringify(stat)}`)
  console.log(`  ⚠️ A failed upload leaves that row out of the import (all-or-nothing); re-run this stage to retry.`)
}

// ── Stage 2: import ──────────────────────────────────────────────────────────────────────────────

async function importRows(rows: StagedVehicle[]) {
  if (!MANIFEST) throw new Error('--manifest <file.jsonl> is required')
  // Without it HOSTED_PREFIX is a bare path and every row is dropped as "foreign url" — say so instead.
  if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required (the prefix every hosted url is checked against)')
  const hosted = loadManifest(MANIFEST)
  /**
   * ⛔ A PREVIEW MANIFEST NEVER REACHES A REAL DATABASE. With NEXT_PUBLIC_SUPABASE_URL on loopback the
   * manifest's urls are localhost; written into production they would publish verified rows with
   * images nobody can load, and `images` is create-only. So a loopback storage url requires a loopback
   * database that is not the :5433 production tunnel (a reviewer's catch).
   */
  const dbUrl = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgres://none')
  const loop = (h: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)
  if (SUPABASE_URL && loop(new URL(SUPABASE_URL).hostname) && (!loop(dbUrl.hostname) || dbUrl.port === '5433')) {
    throw new Error(`preview storage (${SUPABASE_URL}) with a non-scratch database (${dbUrl.host}) — refusing`)
  }

  /**
   * ⛔ ALL-OR-NOTHING PER LISTING, AND ONLY OUR OWN URLS. A row goes in only when every photo its
   * selection names is in the manifest under the bucket prefix the overlay mark requires. A partly
   * hosted row would be created with a short gallery that `images` (create-only) could never repair.
   */
  const ready: { row: StagedVehicle; images: string[] }[] = []
  let notHosted = 0, foreign = 0
  // The database is opened BEFORE the screen, which looks up a refused row's existing listing (a live
  // banned row is hidden on --apply; a live ambiguous one is refreshed and listed for review).
  const { PrismaClient } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }), log: ['warn', 'error'] })
  // ⛔ THE try OPENS WITH THE CONNECTION: the screen below already queries, and a throw there must
  // still reach the `finally` that disconnects.
  try {
  const screen = new ImportScreen('vehicle-rentals', { db, sellerIds: Object.values(VEHICLE_SELLERS).map((v) => v.id) })
  for (const row of rows) {
    const images = row.photos.map((p) => hosted.get(p.local))
    if (images.some((u) => !u)) { notHosted++; continue }
    if (images.some((u) => !u!.startsWith(HOSTED_PREFIX))) { foreign++; continue }
    // ⛔ CONTENT SCREEN BEFORE ANY WRITE (src/lib/import-screen.ts): a refused row is never created; an
    // existing live one is hidden on --apply (banned) or refreshed and listed for review (ambiguous).
    if (!(await screen.check({ title: row.title, titleVi: row.titleVi, description: row.description, descriptionVi: row.descriptionVi, category: 'rentals', subcategory: row.subcategorySlug, merchant: row.seller, extraTexts: [row.location], externalId: row.externalId, url: row.affiliateUrl }))) continue
    ready.push({ row, images: images as string[] })
  }
  screen.report()

  /**
   * ⛔ A STALE SCRAPE REFUSES THE WRITE. Price and availability both come from the scrape, so a
   * month-old one republishes cars sold or re-priced since. Measured from the RECORDS' own
   * `scraped_at`, not file mtimes (a copy resets an mtime; the Rever importer's header has why).
   */
  const oldest = new Map<string, number>()
  for (const { row } of ready) {
    const t = Date.parse(row.scrapedAt)
    const age = Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : Infinity
    oldest.set(row.seller, Math.max(oldest.get(row.seller) ?? 0, age))
  }

    const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
    if (!category) throw new Error('no `rentals` category — cannot place these rows')
    const used = [...new Set(ready.map((r) => r.row.seller))] as SellerKey[]

    console.log(`  hosted + ready        ${ready.length}   (not fully hosted ${notHosted} · foreign url ${foreign})`)
    for (const s of used) console.log(`    ${s.padEnd(18)} ${ready.filter((r) => r.row.seller === s).length}  (scrape age ≤ ${(oldest.get(s) ?? 0).toFixed(1)}d)`)
    console.log(`  category              ${category.name} (${category.id})`)
    console.log(`  database              ${new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgres://?').host}`)
    console.log(`  mode                  ${APPLY ? 'APPLY — WRITES' : 'DRY RUN'}`)
    const sample = ready[0]?.row
    if (sample) console.log(`\n── sample ──\n  ${sample.title}\n  ${sample.titleVi}\n  ${sample.price} ${sample.priceUnit} · ${sample.district ?? '-'} · ${sample.attributes} ${sample.facetTokens ?? ''}\n  -> ${sample.affiliateUrl}`)

    const stale = [...oldest].filter(([, d]) => d > MAX_AGE_DAYS)
    if (APPLY && stale.length) throw new Error(`scrape too old for ${stale.map(([s, d]) => `${s} (${d.toFixed(1)}d)`).join(', ')} — re-scrape before --apply`)
    if (!APPLY) { console.log('\n  DRY RUN — nothing written. Re-run with --apply.'); return }

    /**
     * ⛔ SELLERS: PINNED BY ID, NAME-CHECKED, AND NEVER OWNED. A seller row with an owner means a real
     * account would receive every enquiry and could edit rows it never posted; a name mismatch means
     * the id is someone else's shop. Either refuses the whole run before a single listing is written.
     */
    const trustOf = new Map<SellerKey, number>()
    for (const key of used) {
      const want = VEHICLE_SELLERS[key]
      const s = await db.seller.findUnique({ where: { id: want.id }, select: { name: true, ownerId: true, verified: true, verifiedSeller: true, officialPartner: true, trustScore: true } })
      trustOf.set(key, s?.trustScore ?? 100)
      if (s && s.name !== want.name) throw new Error(`seller ${want.id} is named "${s.name}", expected "${want.name}" — refusing`)
      if (s?.ownerId) throw new Error(`seller ${want.id} has ownerId ${s.ownerId} — a real account owns it; refusing`)
      // A badge on an import seller would tell buyers we vetted a shop we only link to (import-honeycomb-com-vn.ts does the same).
      if (s && (s.verified || s.verifiedSeller || s.officialPartner)) throw new Error(`seller ${want.id} carries a trust badge — refusing to attach unvetted imported rows to it`)
      if (!s) {
        // verified:false — the badge must never imply we vetted them; no owner, no human behind it.
        await db.seller.create({ data: { id: want.id, name: want.name, verified: false, verifiedSeller: false, officialPartner: false } })
      }
    }
    // ⛔ Live rows the content screen refused as banned are hidden only now, past the storefront refusals.
    await screen.applyHides()

    /**
     * ⛔ AN UNCHANGED ROW IS NOT WRITTEN. `updatedAt` is `@updatedAt`, so every Prisma update stamps
     * it — and the listing sitemaps publish it as `<lastmod>` (sitemaps/[file]/route.ts). The weekly
     * job re-runs this stage over ~6,400 rows; writing them all would tell Google every vehicle page
     * changed every Monday, and a site whose lastmod is always "now" gets its lastmod ignored for
     * the pages that really did change. So: read the stored refreshable fields first, and update
     * only a row where one of them differs. (USD-priced shop rows still move with the exchange
     * rate — that is a real price change.)
     */
    const MUTABLE_KEYS = ['title', 'titleVi', 'description', 'descriptionVi', 'price', 'priceUnit', 'currency', 'negotiable',
      'listingType', 'categoryId', 'subcategorySlug', 'sellerId', 'location', 'district', 'city', 'lat', 'lng',
      'attributes', 'facetTokens', 'affiliateUrl', 'searchText'] as const
    type Stored = Record<(typeof MUTABLE_KEYS)[number], unknown> & { externalId: string | null; status: string }
    const stored = new Map<string, Stored>()
    const sellerIds = used.map((s) => VEHICLE_SELLERS[s].id)
    for (const r of await db.listing.findMany({
      where: { sellerId: { in: sellerIds }, externalId: { not: null } },
      select: { externalId: true, status: true, ...Object.fromEntries(MUTABLE_KEYS.map((k) => [k, true])) },
    }) as unknown as Stored[]) {
      stored.set(`${r.sellerId}|${r.externalId}`, r)
    }

    let created = 0, updated = 0, unchanged = 0
    for (const { row, images } of ready) {
      const sellerId = VEHICLE_SELLERS[row.seller].id
      /**
       * Refreshed on every run: texts, price + unit, facets, place, link. ⛔ NOT status / verified /
       * images — a moderator's hide must survive a re-run, and the photos are owned by stage 1.
       */
      const mutable = {
        title: row.title, titleVi: row.titleVi, description: row.description, descriptionVi: row.descriptionVi,
        price: row.price, priceUnit: row.priceUnit, currency: '₫',
        negotiable: false,
        listingType: 'rent',
        categoryId: category.id,
        subcategorySlug: row.subcategorySlug,
        sellerId,
        location: row.location, district: row.district, city: row.city,
        lat: row.lat, lng: row.lng,
        attributes: row.attributes, facetTokens: row.facetTokens,
        affiliateUrl: row.affiliateUrl,
        searchText: row.searchText,
      }
      const prev = stored.get(`${sellerId}|${row.externalId}`)
      // ⛔ A TOMBSTONE IS LEFT AS IT IS (src/lib/listing-removed.ts): a listing a moderator or admin REMOVED keeps its externalId, so this SKU lands on it — refreshing its text, price or photos would rewrite the record kept as evidence (Law 122/2025). Not refreshed, not recreated.
      if (prev?.status === 'removed') { unchanged++; continue }
      if (prev && MUTABLE_KEYS.every((k) => Object.is(prev[k] ?? null, (mutable as Record<string, unknown>)[k] ?? null))) {
        unchanged++
        if ((created + updated + unchanged) % 250 === 0) console.log(`  ${created + updated + unchanged}/${ready.length}`)
        continue
      }
      const res = await db.listing.upsert({
        where: { sellerId_externalId: { sellerId, externalId: row.externalId } },
        // ⛔ verified:true IS THE PUBLICATION GATE, not a trust badge (import-rever-rentals.ts).
        // postedAt + rankScore are CREATE-ONLY and come from the SOURCE's date (see StagedVehicle.postedAt);
        // the nightly recompute keeps ranking them from that date afterwards.
        create: {
          ...mutable, externalId: row.externalId, status: 'active', verified: true, images: JSON.stringify(images),
          postedAt: row.postedAt,
          rankScore: browseRankScore({ sellerTrustScore: trustOf.get(row.seller) ?? 100, postedAt: row.postedAt, featured: false }),
        },
        update: mutable,
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
      if ((created + updated + unchanged) % 250 === 0) console.log(`  ${created + updated + unchanged}/${ready.length}`)
    }

    /**
     * Retirement: ONLY on a positive signal — a file of externalIds a status check confirmed gone
     * (delisted, 404). Never "absent from this run": filters and --only/--limit make absence mean
     * nothing. 'hidden', never 'sold' (the sold page would claim it sold through us). ONE-WAY: status
     * is create-only, so a car that comes back needs a manual un-hide.
     */
    let retired = 0
    if (GONE) {
      const gone = readFileSync(GONE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      const res = await db.listing.updateMany({
        where: { sellerId: { in: Object.values(VEHICLE_SELLERS).map((s) => s.id) }, status: 'active', externalId: { in: gone } },
        data: { status: 'hidden' },
      })
      retired = res.count
    }
    console.log(`\ncreated ${created}   updated ${updated}   unchanged ${unchanged} (not written)   retired ${retired}`)
    console.log(`\nROLLBACK (soft, reversible — takes every row off every public surface):`)
    console.log(`  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" IN (${used.map((s) => `'${VEHICLE_SELLERS[s].id}'`).join(', ')}) AND status <> 'removed';`)
    console.log(`  -- hard DELETE is NOT paste-safe: Order is onDelete:Restrict and six relations Cascade.`)
  } finally {
    await db.$disconnect()
  }
}

async function main() {
  if (!MIOTO && !BONBON && !BIKES) throw new Error('pass at least one of --mioto <dir> --bonbon <dir> --bikes <dir>')
  if (ONLY) for (const k of ONLY) if (!(k in VEHICLE_SELLERS)) throw new Error(`--only ${k}: not one of ${Object.keys(VEHICLE_SELLERS).join(', ')}`)
  const { rows, drops, fx } = await stageAll()
  report(rows, drops, fx)
  if (STAGE === 'photos') await photos(rows)
  else if (STAGE === 'import') await importRows(rows)
  else throw new Error(`--stage ${STAGE}: expected photos | import`)
}

if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
