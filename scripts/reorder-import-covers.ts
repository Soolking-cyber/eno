/**
 * EXISTING IMPORTED RENTALS: LEAD WITH THE PHOTO THE PORTAL'S BURNED-IN STAMP SHOWS LEAST.
 *
 * The importers' --cover-by-mark (src/lib/import-photo-mark.ts) only affects rows they create; `images`
 * is create-only there, so the ~19k rows already live keep the source's order. This script re-orders
 * their stored galleries with the same rule — nothing is uploaded, deleted or re-encoded: the same
 * URLs, another first one.
 *
 * Run (DRY by default — the database session is READ-ONLY; it GETs eno's own stored photos and writes
 * only the review files):
 *   set -a; . ./.env; set +a; npx tsx scripts/reorder-import-covers.ts \
 *     [--seller <id>[,<id>…]] [--limit N] [--out <dir>]
 *   … --from-feed <rows.json>   no database at all: rows from a saved GET of /api/listings (its
 *                                `listings`, or a bare array of rows); the sheet shows the file's first 48
 * Write (a loopback SCRATCH database only — see ⛔ 1):
 *   COVER_REORDER_SCRATCH=1 DATABASE_URL=<scratch> DIRECT_URL=<scratch> npx tsx scripts/reorder-import-covers.ts --apply [--seller …] [--limit N] [--out <dir>]
 *
 * SCOPE: the active rows of the rentals category owned by --seller (default RENTAL_IMPORT_SELLERS), the
 * newest --limit N per seller. ⛔ ONLY THOSE ARE EVER WRITTEN (apply.sql and --apply). The /c/rentals
 * head rows past --limit are planned too, but only so the sheet shows them — never written.
 *
 * What a dry run writes to --out (default: a fresh folder under the OS temp dir):
 *   sheet.html     the first 48 /c/rentals covers, before and after, cropped square like a card
 *   apply.sql      the guarded UPDATEs, for review — and for the owner to run on production with psql
 *   rollback.sql   their exact inverse
 * and prints every row it would change, with the stamp score before and after.
 *
 * ⛔ 1. --apply IS REFUSED UNLESS THE DATABASE IS A LOOPBACK SCRATCH COPY, and the production tunnel is
 *    loopback too — at :5433. Four checks, all before a photo is read (src/lib/cover-reorder.ts):
 *    COVER_REORDER_SCRATCH=1 must be set; the URL must be loopback with no `?host=`/`?port=`/`?hostaddr=`
 *    (isScratchDbUrl); its (database, port) must not be production's as .env names it, nor :5433, nor
 *    "postgres" on :5432 (scratchRefusal); and once connected, the SERVER's own current_database() and
 *    inet_server_port() pass the same test (prodLikeRefusal). Production is the owner's call and runs
 *    from apply.sql, reviewed — this script only writes that file, never executes it.
 * ⛔ 2. RAW SQL, SO `updatedAt` STAYS PUT (sitemap.xml orders by it), and every UPDATE matches the value
 *    it replaces: a row whose photos changed since the plan is skipped, never overwritten.
 * ⛔ 3. A SELLER WITH NO CENTRED STAMP MOVES NOTHING. Each seller's stamp is learnt from its own stored
 *    photos; a seller where none is found (Batdongsan's agency marks sit in corners) is reported and
 *    left alone, as is any row whose photos cannot all be read.
 * ⚠️ 4. The sheet's 48 rows in DB mode are the page's OWN query (src/app/[lang]/c/[category]/(index)/
 *    page.tsx: verified, active, the rentals category, rankScore desc then id desc, 48) — not the
 *    /api/listings head, which is seller-diversified and differs. In --from-feed mode they are the
 *    file's first 48, in its order.
 * ⚠️ 5. AFTER A PRODUCTION RUN: `node scripts/purge-isr-listings.mjs` (listing pages are ISR for 30
 *    days and bake the first photo into their markup and og:image). Feeds pick it up within a minute.
 */
import 'dotenv/config'
import { parse as parseDotenv } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { HOST_EDGE } from '../src/lib/import-photo-check'
import {
  COVER_CANDIDATES, MARK_SEED_ROWS, MARK_VISIBLE, fetchStoredImage, markScore, markTemplate, markWindowOf,
  type MarkTemplate, type MarkWindow,
} from '../src/lib/import-photo-mark'
import { RENTAL_IMPORT_SELLERS } from '../src/lib/import-sellers'
import {
  contactSheetHtml, parseGallery, prodIdentityFrom, prodLikeRefusal, reorderChanges, reorderedGallery, reorderSql, scratchRefusal, type SheetEntry,
} from '../src/lib/cover-reorder'

// ─── Arguments ──────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
/** ⛔ AN UNKNOWN FLAG IS AN ERROR — `--aply` must not quietly mean "dry run", nor `--limt 5` "all rows". */
const FLAGS = new Set(['--apply', '--force'])
const VALUED = new Set(['--seller', '--limit', '--out', '--from-feed'])
for (let i = 0; i < argv.length; i++) {
  if (FLAGS.has(argv[i])) continue
  if (VALUED.has(argv[i])) {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} needs a value`)
    i++; continue
  }
  throw new Error(`unknown argument "${argv[i]}"`)
}
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null }
const APPLY = argv.includes('--apply')
const FROM_FEED = str('--from-feed')
// Omitted = every row. An explicit --limit must be ≥ 1: `--limit 0` used to read as "no limit" (codex, 2026-09-29).
const LIMIT_RAW = str('--limit')
const LIMIT = LIMIT_RAW == null ? 0 : Number(LIMIT_RAW)
if (!Number.isSafeInteger(LIMIT) || LIMIT < 0 || (LIMIT_RAW != null && LIMIT < 1)) throw new Error('--limit must be a positive integer (omit it for every row)')
const SELLERS: string[] = str('--seller')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [...RENTAL_IMPORT_SELLERS]
const OUT = resolve(str('--out') ?? join(tmpdir(), `eno-cover-reorder-${new Date().toISOString().replace(/[:.]/g, '-')}`))
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
/** ⛔ 1. Production as the repo's own env files name it — read from the files, not process.env, which a
 *  scratch run overrides. */
const PROD = prodIdentityFrom(['.env', '.env.local'].filter((f) => existsSync(f)).flatMap((f) => {
  const env = parseDotenv(readFileSync(f))
  return [env.DATABASE_URL, env.DIRECT_URL]
}))
const HEAD = 48

type Row = { id: string; sellerId: string; title: string | null; images: string }

// ─── Photos ─────────────────────────────────────────────────────────────────────────────────
let fetched = 0
/** One stored photo's window, or null (not eno's own copy, not fetched, not decodable). */
function readWindow(url: string): Promise<MarkWindow | null> {
  /** ⛔ Only eno's own stored copies are fetched — a URL of any other shape is never requested. */
  if (!isOverlayImageUrl(url)) return Promise.resolve(null)
  return fetchStoredImage(url).then((b) => { fetched++; return b ? markWindowOf(b, HOST_EDGE) : null })
}
/**
 * ⚠️ ONLY THE CURRENT SELLER'S SEED WINDOWS ARE KEPT — the one set read twice (to learn the stamp, then
 * to score those rows); a failure is kept as null. Every other window is scored and dropped: they are
 * ~30 KB each, and a memo of every URL held ~1 GB of them on a full 19k-row run. Reset per seller.
 */
const seedWindows = new Map<string, MarkWindow | null>()
const windowOf = (url: string): Promise<MarkWindow | null> =>
  seedWindows.has(url) ? Promise.resolve(seedWindows.get(url) ?? null) : readWindow(url)
/** For reading only (seeds, the sheet): a gallery that is not all strings contributes nothing. */
const urlsOf = (json: string): string[] => parseGallery(json) ?? []
/** At most `n` at a time — gentle on our own storage, and a 19k-row run still finishes. */
async function mapLimit<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) { const i = next++; out[i] = await f(xs[i]) }
  }))
  return out
}

/**
 * One row's plan. The 2nd and 3rd photos are read only when the cover's stamp shows enough to act on
 * (coverByMark would keep the order otherwise) — most rows cost one GET.
 */
type Plan = { row: Row; images: string[]; after: string[]; scores: (number | null)[]; move: ReturnType<typeof reorderedGallery>['move']; why: string }
async function planRow(row: Row, t: MarkTemplate | null): Promise<Plan> {
  const parsed = parseGallery(row.images)
  /** ⛔ Anything but an array of strings is left exactly as stored (parseGallery). */
  if (!parsed) return { row, images: [], after: [], scores: [], move: null, why: 'gallery is not a list of URLs — left alone' }
  const images = parsed
  const scores: (number | null)[] = images.map(() => null)
  if (!t) return { row, images, after: images, scores, move: null, why: 'no centred stamp learnt for this seller' }
  scores[0] = images.length ? markScore(await windowOf(images[0]), t) : null
  if (scores[0] !== null && scores[0] >= MARK_VISIBLE) {
    for (let i = 1; i < Math.min(COVER_CANDIDATES, images.length); i++) scores[i] = markScore(await windowOf(images[i]), t)
  }
  const g = reorderedGallery(images, scores)
  return { row, images, after: g.after, scores, move: g.move, why: g.why }
}

// ─── Rows ───────────────────────────────────────────────────────────────────────────────────
function openDb(write: boolean) {
  if (!DB_URL) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ./.env; set +a` first (or use --from-feed)')
  return new PrismaClient({
    /** ⛔ A dry run is read-only AT THE DATABASE: any write it reached would fail, not land. */
    adapter: new PrismaPg(write ? { connectionString: DB_URL } : { connectionString: DB_URL, options: '-c default_transaction_read_only=on' }),
    log: ['warn', 'error'],
  })
}
type Db = ReturnType<typeof openDb>
const ROW_SELECT = { id: true, sellerId: true, title: true, images: true } as const

/**
 * ⚠️ 4 in the header: the first 48 cards /c/rentals renders — the page's own query, verbatim in its
 * filter and order. (The page also scopes by edition; that only ever excludes the visa desk's rows,
 * which are never rentals.)
 */
async function rentalsCategoryId(db: Db): Promise<string> {
  const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true } })
  if (!category) throw new Error('no `rentals` category')
  return category.id
}
async function rentalsHead(db: Db, categoryId: string): Promise<Row[]> {
  return db.listing.findMany({
    where: { categoryId, verified: true, status: 'active' },
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], take: HEAD, select: ROW_SELECT,
  })
}

/** --from-feed: a saved /api/listings response (or a bare array of its rows). */
function feedRows(file: string): Row[] {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw as { listings?: unknown }).listings
  if (!Array.isArray(list)) throw new Error(`${file}: expected an /api/listings response ({ listings: [...] }) or an array of its rows`)
  return list.map((l: { id?: unknown; sellerId?: unknown; title?: unknown; images?: unknown }) => {
    if (typeof l.id !== 'string' || typeof l.sellerId !== 'string' || !Array.isArray(l.images)) throw new Error(`${file}: a row without id/sellerId/images`)
    return { id: l.id, sellerId: l.sellerId, title: typeof l.title === 'string' ? l.title : null, images: JSON.stringify(l.images) }
  })
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (APPLY && FROM_FEED) throw new Error('--apply writes a database; --from-feed reads none. Drop one.')
  /** ⛔ 1. Before the database is opened or a single photo is read. */
  const refusal = APPLY ? scratchRefusal(DB_URL, process.env.COVER_REORDER_SCRATCH, PROD) : null
  if (refusal) {
    throw new Error(`--apply is for a loopback SCRATCH database only — refused: ${refusal}. For production, review apply.sql from a dry run and run it with psql.`)
  }
  // ⛔ NEVER OVERWRITE A PREVIOUS RUN'S rollback.sql WITHOUT --force (codex, gate 2026-09-29): it is the only way
  // back from an applied reorder, and a reused --out directory would silently replace it.
  if (!process.argv.includes('--force') && ['apply.sql', 'rollback.sql'].some((f) => existsSync(join(OUT, f)))) {
    console.error(`${OUT} already holds apply.sql/rollback.sql from an earlier run — pick another --out, or pass --force to replace them.`)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })

  const db = FROM_FEED ? null : openDb(APPLY)
  if (APPLY) {
    /** ⛔ 1. What the SERVER says it is — no URL spelling can fake this. Before any row or photo is read. */
    const [who] = await db!.$queryRaw<{ db: string; port: number | null }[]>`SELECT current_database() AS db, inet_server_port() AS port`
    const serverRefusal = !who || who.port === null ? 'the server reports no TCP port (a Unix socket?)' : prodLikeRefusal(who.db, String(who.port), PROD)
    if (serverRefusal) { await db!.$disconnect(); throw new Error(`--apply refused after connecting: ${serverRefusal}`) }
    console.log(`scratch database  ${who.db} on port ${who.port} (server-reported; not production's ${PROD.names.join('/')} on ${PROD.ports.join('/')})`)
  }
  let head: Row[], rowsBySeller: Map<string, Row[]>
  if (FROM_FEED) {
    const all = feedRows(FROM_FEED)
    head = all.slice(0, HEAD)
    rowsBySeller = new Map(SELLERS.map((s) => [s, all.filter((r) => r.sellerId === s).slice(0, LIMIT || undefined)]))
  } else {
    const categoryId = await rentalsCategoryId(db!)
    head = await rentalsHead(db!, categoryId)
    rowsBySeller = new Map()
    for (const s of SELLERS) {
      /** ⛔ The rentals category and active rows only — a seller's listing elsewhere is never in scope. */
      rowsBySeller.set(s, await db!.listing.findMany({
        where: { sellerId: s, categoryId, status: 'active' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMIT || undefined, select: ROW_SELECT,
      }))
    }
  }

  console.log(`mode              ${APPLY ? 'APPLY — SCRATCH DATABASE (loopback, not :5433)' : FROM_FEED ? `DRY RUN from ${FROM_FEED} (no database)` : 'DRY RUN (database session read-only)'}`)
  console.log(`scope             ${FROM_FEED ? 'rows of the feed file' : 'active rows of the rentals category'} owned by ${SELLERS.join(', ')}${LIMIT ? ` · at most ${LIMIT} per seller (--limit) written` : ''}`)
  console.log(`rule              lead with the photo among the first ${COVER_CANDIDATES} where the stamp shows clearly least (src/lib/import-photo-mark.ts)`)

  /**
   * ⛔ `inScope` IS WHAT MAY BE WRITTEN: each seller's rows, --limit applied. The head's rows of the same
   * sellers past --limit are planned too, so the sheet is complete — and only displayed (reorderChanges).
   */
  const inScope = new Set([...rowsBySeller.values()].flat().map((r) => r.id))
  const plans = new Map<string, Plan>()
  const templates = new Map<string, MarkTemplate | null>()
  for (const s of SELLERS) {
    const own = rowsBySeller.get(s) ?? []
    const sheetOnly = head.filter((h) => h.sellerId === s && !inScope.has(h.id))
    const rows = [...own, ...sheetOnly]
    /** ⛔ 3. The seller's own stamp, from its first MARK_SEED_ROWS rows (different ads, first photos). */
    const seed = rows.slice(0, MARK_SEED_ROWS).flatMap((r) => urlsOf(r.images).slice(0, COVER_CANDIDATES))
    seedWindows.clear()
    await mapLimit([...new Set(seed)], 6, async (u) => { seedWindows.set(u, await readWindow(u)) })
    const got = markTemplate(seed.map((u) => seedWindows.get(u)).filter((w): w is MarkWindow => !!w))
    templates.set(s, got.template)
    console.log(`  ${s.padEnd(30)} ${own.length} rows in scope${sheetOnly.length ? ` (+${sheetOnly.length} /c/rentals head rows, sheet only)` : ''} · stamp ${got.template ? `learnt (${got.template.strokes} px, ${got.template.strokeWidth} px wide, snr ${got.snr.toFixed(1)}, ${got.pool} photos)` : `none — ${got.why} (${got.pool} photos${got.snr !== null ? `, snr ${got.snr.toFixed(1)}` : ''}); its rows stay as they are`}`)
    let done = 0
    for (const p of await mapLimit(rows, 6, async (r) => {
      const p = await planRow(r, got.template)
      if (++done % 500 === 0) console.log(`    ${done}/${rows.length} scored (${fetched} photos read)`)
      return p
    })) plans.set(p.row.id, p)
  }
  seedWindows.clear()

  // ─── The before/after list ───────────────────────────────────────────────────────────────
  const moved = [...plans.values()].filter((p) => p.move)
  const { changes, outOfScope } = reorderChanges(
    [...plans.values()].map((p) => ({ id: p.row.id, oldJson: p.row.images, after: p.after, moved: !!p.move })), inScope,
  )
  console.log(`\n── rows whose cover would change: ${changes.length} of ${inScope.size} in scope${outOfScope ? ` (+${outOfScope} head rows past --limit, on the sheet only, NOT written)` : ''} ──`)
  for (const p of moved) {
    console.log(`  ${p.row.id}${inScope.has(p.row.id) ? '' : ' [sheet only]'}  ${p.row.sellerId.padEnd(30)} cover: photo 1 → photo ${p.move!.from + 1}   stamp ${p.move!.was.toFixed(2)} → ${p.move!.now.toFixed(2)}   ${p.images[0]} → ${p.after[0]}`)
  }
  const why = [...plans.values()].filter((p) => !p.move).reduce<Record<string, number>>((a, p) => { a[p.why] = (a[p.why] ?? 0) + 1; return a }, {})
  console.log(`unchanged         ${JSON.stringify(why)}`)
  console.log(`photos read       ${fetched} (eno's own storage, GET)`)

  // ─── The review files ────────────────────────────────────────────────────────────────────
  const entries: SheetEntry[] = head.map((h) => {
    const p = plans.get(h.id)
    const imgs = urlsOf(h.images)
    return {
      id: h.id, sellerId: h.sellerId, title: h.title,
      before: imgs[0] ?? null, after: (p?.after ?? imgs)[0] ?? null,
      move: p?.move ?? null, why: p ? p.why : 'not an import in scope',
    }
  })
  const stamp = new Date().toISOString()
  const sql = reorderSql(changes, stamp)
  writeFileSync(join(OUT, 'sheet.html'), contactSheetHtml(entries, {
    title: `/c/rentals — first ${entries.length} covers, before and after`,
    lines: [
      `${stamp} · ${FROM_FEED ? `rows from ${FROM_FEED}, first ${HEAD} in its order` : `the first ${HEAD} rows /c/rentals renders (its own query), from the database`}`,
      `Rule: among a row's first ${COVER_CANDIDATES} photos, lead with the one where the portal's burned-in stamp shows clearly least (src/lib/import-photo-mark.ts). Nothing is uploaded or deleted; the same photos, another first one.`,
    ],
  }))
  writeFileSync(join(OUT, 'apply.sql'), sql.apply)
  writeFileSync(join(OUT, 'rollback.sql'), sql.rollback)
  console.log(`\nreview            ${join(OUT, 'sheet.html')}\nstatements        ${join(OUT, 'apply.sql')} (${changes.length} guarded UPDATEs)\nrollback          ${join(OUT, 'rollback.sql')}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written to any database.')
    await db?.$disconnect()
    return
  }

  // ─── APPLY (scratch only — checked above, before anything was read) ──────────────────────
  /** ⛔ 2. The same guarded UPDATE as apply.sql, parameterised, in one transaction. */
  const counts = await db!.$transaction(changes.map((c) => db!.$executeRaw`UPDATE "Listing" SET images = ${c.newJson} WHERE id = ${c.id} AND images = ${c.oldJson} AND "categoryId" = (SELECT id FROM "Category" WHERE slug = 'rentals') AND status = 'active'`))
  const written = counts.reduce((a, n) => a + n, 0)
  console.log(`\nAPPLIED on the scratch database: ${written} of ${changes.length} rows re-ordered (${changes.length - written} had changed since the plan and were skipped).`)
  console.log(`ROLLBACK: psql -v ON_ERROR_STOP=1 "$DIRECT_URL" -f ${join(OUT, 'rollback.sql')}`)
  await db!.$disconnect()
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
