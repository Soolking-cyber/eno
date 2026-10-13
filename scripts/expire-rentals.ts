/**
 * Expire imported rentals — owner, 2026-10-13: "remove all rental properties that are 7 days older … no older than 7
 * days, remove most of car rental leave only reliable fresh ones same with motorbike rentals maybe 7-10 days old ones".
 * Owner's picks the same day: cars = "Proven + booked in 14 days" (Mioto ≥10 trips, ≥4.8★, ≥5 reviews and a trip since
 * the scrape 14 days earlier; BonbonCar own fleet, ≥3 real photos, ≥4★); motorbikes = "seen in the last 7–10 days".
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/expire-rentals.ts --places-older-than 7                                   # DRY: property rentals by age
 *   npx tsx scripts/expire-rentals.ts --vehicle-ids <ids.txt>                                 # DRY: these vehicle rows
 *   … --journal-dir <durable dir> --expect <N from the dry run> --apply                       # WRITE (journal first)
 *   npx tsx scripts/expire-rentals.ts --rollback <journal.json> [--apply]
 *   npx tsx scripts/expire-rentals.ts --tombstone <journal.json>                               # retry the PDP tombstones
 *   (--vehicle-ids also needs --expect-sha <sha256 printed by its dry run>: the reviewed id list, not just its count)
 *
 * WHAT IT WRITES: active → 'expired' (EXPIRED_STATUS, src/lib/apartment-freshness.ts) — a 404, kept on users' saved
 * lists, and the status every property importer REVIVES when the source shows the ad fresh again (REVIVABLE_STATUSES).
 * ⛔ ONLY an ownerless rental-import storefront's IMPORTED row (affiliateUrl set): never a person's own post, never hidden /
 * removed / sold / stale rows, never a DELETE (Law 122/2025 keeps posted information ≥ 1 year).
 * ⛔ AGE = postedAt, which every property importer keeps at the LATEST date the source showed (a re-list or bump moves it
 * forward); "older than N days" is measured from the moment of the run.
 * ⛔ JOURNAL FIRST, EXACT ROLLBACK: each row's status and updatedAt are read and written to the journal, together with the
 * batch stamp T, BEFORE the write; the write is conditional on both and sets updatedAt = T. --rollback restores 'active'
 * (and the prior updatedAt) only on rows still 'expired' with updatedAt = T — anything touched since is left alone.
 * ⚠️ --apply refuses unless --expect equals the count the run is about to expire (read it from the dry run): a surprise
 * count is a reason to stop, not a reason to write.
 * After the write each page is tombstoned (en/vi, src/lib/pdp-tombstone.ts); category, district and hub pages need the
 * root layout ISR tag and a Cloudflare purge on BOTH zones.
 */
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { RENTAL_IMPORT_SELLERS } from '../src/lib/import-sellers'
import { EXPIRED_STATUS } from '../src/lib/apartment-freshness'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { VEHICLE_SELLERS } from '../src/lib/vehicle-rental-listing'

const argv = process.argv.slice(2)
const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const APPLY = argv.includes('--apply')
const PLACES_DAYS = val('--places-older-than') === null ? null : Number(val('--places-older-than'))
const VEHICLE_IDS = val('--vehicle-ids')
const ROLLBACK = val('--rollback')
const RETOMB = val('--tombstone')
const EXPECT_SHA = val('--expect-sha')
const JOURNAL_DIR = val('--journal-dir')
const EXPECT = val('--expect') === null ? null : Number(val('--expect'))
const modes = [PLACES_DAYS !== null, VEHICLE_IDS !== null, ROLLBACK !== null, RETOMB !== null].filter(Boolean).length
if (modes !== 1) { console.error('pick exactly one of --places-older-than N | --vehicle-ids <file> | --rollback <journal> | --tombstone <journal>'); process.exit(1) }
if (PLACES_DAYS !== null && !(Number.isInteger(PLACES_DAYS) && PLACES_DAYS >= 1)) { console.error('--places-older-than needs a whole number of days ≥ 1'); process.exit(1) }
if (APPLY && !ROLLBACK && (!JOURNAL_DIR || EXPECT === null)) { console.error('--apply needs --journal-dir <durable dir> and --expect <count from the dry run>'); process.exit(1) }
if (APPLY && VEHICLE_IDS && !EXPECT_SHA) { console.error('--vehicle-ids --apply needs --expect-sha <sha256 printed by the dry run>'); process.exit(1) }

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
// ⛔ UTC PINNED (commit review): updatedAt/postedAt are timestamp WITHOUT time zone holding UTC, so the stamp and the cutoff
// are computed AT TIME ZONE 'UTC' and the session is pinned to UTC too — a session in ICT would shift both by 7 hours.
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c TimeZone=UTC${APPLY || RETOMB ? '' : ' -c default_transaction_read_only=on'}` }), log: ['warn', 'error'] })

const VEHICLE_SUBCATS = ['car-rental', 'motorbike-rental']
/** --vehicle-ids is for CARS only (owner 2026-10-13: motorbikes are judged by "still listed in the last 7–10 days", a
 *  different rule the recurring job applies) — a motorbike id in the file is refused, not skipped. */
const VEHICLE_IDS_SUBCATS = ['car-rental']
/** --vehicle-ids touches only the CAR import storefronts (src/lib/vehicle-rental-listing.ts VEHICLE_SELLERS). */
const CAR_SELLERS = [VEHICLE_SELLERS.mioto.id, VEHICLE_SELLERS.bonboncar.id]
const RENTAL_SELLERS = [...RENTAL_IMPORT_SELLERS]
type Row = { id: string; status: string; updatedAt: string; postedAt: string | null; subcat: string | null; seller: string }
type Journal = { kind: 'rental-expiry'; mode: string; createdAt: string; stamp: string; rows: { id: string; priorStatus: string; updatedAt: string; postedAt: string | null; subcat: string | null; seller: string }[] }
const IMPORTED = `s."ownerId" IS NULL AND l."affiliateUrl" IS NOT NULL`
const CHUNK = 500
const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, i * CHUNK + CHUNK))

async function candidates(): Promise<Row[]> {
  if (PLACES_DAYS !== null) {
    // property = the rentals category minus the vehicle subcategories (RENTAL_PLACES: NULL subcategory counts as a place)
    return db.$queryRawUnsafe<Row[]>(
      `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt", l."postedAt"::text AS "postedAt", l."subcategorySlug" AS subcat, s.name AS seller
       FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId"
       WHERE c.slug = 'rentals' AND l.status = 'active' AND ${IMPORTED}
         AND l."sellerId" = ANY($1::text[])
         AND (l."subcategorySlug" IS NULL OR l."subcategorySlug" <> ALL($2::text[]))
         AND COALESCE(l."postedAt", l."createdAt") < (now() AT TIME ZONE 'UTC') - make_interval(days => $3::int)
       ORDER BY l.id`, RENTAL_SELLERS, VEHICLE_SUBCATS, PLACES_DAYS)
  }
  const lines = readFileSync(VEHICLE_IDS!, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const bad = lines.filter((s) => !/^c[a-z0-9]{20,30}$/.test(s))
  if (bad.length) throw new Error(`id file has ${bad.length} malformed line(s), e.g. "${bad[0]}" — refusing (nothing is silently dropped)`)
  const ids = [...new Set(lines)].sort()
  if (ids.length !== lines.length) throw new Error(`id file has ${lines.length - ids.length} duplicate id(s) — refusing`)
  if (ids.length === 0) throw new Error('id file is empty — refusing')
  const sha = createHash('sha256').update(ids.join('\n')).digest('hex')
  console.log(`id file sha256 (sorted ids): ${sha}`)
  if (APPLY && sha !== EXPECT_SHA) throw new Error(`id file sha256 ${sha} ≠ --expect-sha ${EXPECT_SHA}: not the list the dry run showed — refusing`)
  // ⛔ REFUSE, never skip: every id must be an ACTIVE, ownerless, imported car row of a car import storefront — a motorbike,
  // a person's post, another seller or an already-retired row in the reviewed file means the file is wrong.
  const out: Row[] = []
  const strays: string[] = []
  for (const part of chunks(ids)) {
    strays.push(...(await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT l.id FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId"
       WHERE l.id = ANY($1::text[]) AND NOT COALESCE(l.status = 'active' AND ${IMPORTED} AND c.slug = 'rentals' AND l."subcategorySlug" = ANY($2::text[]) AND l."sellerId" = ANY($3::text[]), false)`,
      part, VEHICLE_IDS_SUBCATS, CAR_SELLERS)).map((x) => x.id))
  }
  if (strays.length) throw new Error(`${strays.length} id(s) in the file are not active imported car rows of Mioto/BonbonCar (e.g. ${strays[0]}) — refusing`)
  let existing = 0
  for (const part of chunks(ids)) existing += (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "Listing" WHERE id = ANY($1::text[])`, part))[0].n
  if (existing !== ids.length) throw new Error(`${ids.length - existing} id(s) in the file match no listing — refusing`)
  for (const part of chunks(ids)) {
    out.push(...await db.$queryRawUnsafe<Row[]>(
      `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt", l."postedAt"::text AS "postedAt", l."subcategorySlug" AS subcat, s.name AS seller
       FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId"
       WHERE l.id = ANY($1::text[]) AND l.status = 'active' AND ${IMPORTED} AND c.slug = 'rentals' AND l."subcategorySlug" = ANY($2::text[]) AND l."sellerId" = ANY($3::text[])`, part, VEHICLE_IDS_SUBCATS, CAR_SELLERS))
  }
  console.log(`id file: ${ids.length} ids → ${out.length} still active ownerless imported car rows`)
  return out
}

async function tombstoneAll(ids: string[]) {
  const msg = await tombstonePdps(db, ids)
  console.log(`PDP tombstones: ${msg}`)
  const written = Number(/^(\d+) tags/.exec(msg)?.[1] ?? NaN)
  if (ids.length && written !== ids.length * 2) throw new Error(`tombstones incomplete (${msg}) — re-run them: the journal lists every id`)
}

async function expire() {
  const mode = PLACES_DAYS !== null ? `places-older-than-${PLACES_DAYS}d` : `vehicle-ids:${resolve(VEHICLE_IDS!)}`
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — ${mode}\n`)
  const rows = await candidates()
  const by = new Map<string, number>()
  for (const r of rows) by.set(`${r.seller} · ${r.subcat ?? '(none)'}`, (by.get(`${r.seller} · ${r.subcat ?? '(none)'}`) ?? 0) + 1)
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${k}`)
  console.log(`   ${'TOTAL'.padStart(6)}  ${rows.length} active → '${EXPIRED_STATUS}'`)
  if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --journal-dir <dir> --expect ${rows.length} --apply`); return }
  if (rows.length !== EXPECT) { console.error(`\nREFUSED: ${rows.length} rows would expire, --expect says ${EXPECT}. Re-read the dry run.`); process.exitCode = 1; return }
  if (!rows.length) { console.log('\nnothing to expire.'); return }
  const [{ now }] = await db.$queryRawUnsafe<{ now: string }[]>(`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')::text AS now`)
  const journal: Journal = { kind: 'rental-expiry', mode, createdAt: new Date().toISOString(), stamp: now, rows: rows.map((r) => ({ id: r.id, priorStatus: r.status, updatedAt: r.updatedAt, postedAt: r.postedAt, subcat: r.subcat, seller: r.seller })) }
  mkdirSync(resolve(JOURNAL_DIR!), { recursive: true })
  const path = join(resolve(JOURNAL_DIR!), `rental-expiry-${mode.startsWith('places') ? 'places' : 'vehicles'}-${journal.createdAt.replace(/[:.]/g, '-')}.json`)
  // ⛔ ON DISK — fsynced, file and directory — BEFORE A SINGLE ROW CHANGES: each chunk below commits on its own.
  const fd = openSync(path, 'wx'); writeSync(fd, JSON.stringify(journal, null, 1)); fsyncSync(fd); closeSync(fd)
  const dfd = openSync(resolve(JOURNAL_DIR!), 'r'); fsyncSync(dfd); closeSync(dfd)
  console.log(`\njournal written: ${path} (${rows.length} rows, stamp ${now})`)
  console.log(`ROLLBACK: npx tsx scripts/expire-rentals.ts --rollback ${path} --apply`)
  console.log(`TOMBSTONE RETRY: npx tsx scripts/expire-rentals.ts --tombstone ${path}`)
  const done: string[] = []
  for (const part of chunks(journal.rows)) {
    const r = await db.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE "Listing" l SET status = $4, "updatedAt" = $5::timestamp
       FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd)
       WHERE l.id = j.id AND l.status = j.prior AND l."updatedAt"::text = j.upd RETURNING l.id`,
      part.map((x) => x.id), part.map((x) => x.priorStatus), part.map((x) => x.updatedAt), EXPIRED_STATUS, now)
    done.push(...r.map((x) => x.id))
    await tombstoneAll(r.map((x) => x.id)) // per chunk, right after its write: a crash later leaves no written row untombstoned
  }
  console.log(`EXPIRED ${done.length} of ${rows.length} (a row changed between the read and the write is skipped).`)
  if (done.length !== rows.length) { console.error(`INCOMPLETE — ${rows.length - done.length} row(s) changed meanwhile; re-run the dry run.`); process.exitCode = 2 }
  console.log('NEXT: root layout ISR tag (eno:isrtag:_N_T_/layout + _N_T_/[lang]/layout — /c/rentals, district and hub pages) + Cloudflare purge_everything on BOTH zones.')
}

/** Re-write the tombstones of every journal id (a tombstone only forces a re-render — right after an expiry AND after a rollback). */
async function retombstone(path: string) {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Journal
  if (j.kind !== 'rental-expiry' || !Array.isArray(j.rows)) { console.error(`${path} is not a rental-expiry journal`); process.exit(1) }
  for (const part of chunks(j.rows.map((r) => r.id))) await tombstoneAll(part)
  console.log(`tombstoned ${j.rows.length} pages (en/vi)`)
}

async function rollback(path: string) {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Journal
  if (j.kind !== 'rental-expiry' || !Array.isArray(j.rows) || !j.stamp) { console.error(`${path} is not a rental-expiry journal`); process.exit(1) }
  const badRow = j.rows.find((r) => !/^c[a-z0-9]{20,30}$/.test(r.id) || r.priorStatus !== 'active' || !r.updatedAt)
  if (badRow || new Set(j.rows.map((r) => r.id)).size !== j.rows.length) { console.error(`${path}: a malformed or duplicate journal row — refusing`); process.exit(1) }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — rollback of ${j.rows.length} rows expired at ${j.stamp} (${j.mode})`)
  const restored: string[] = []
  let restorable = 0
  for (const part of chunks(j.rows)) {
    const args = [part.map((x) => x.id), part.map((x) => x.priorStatus), part.map((x) => x.updatedAt), EXPIRED_STATUS, j.stamp] as const
    const where = `l.id = j.id AND l.status = $4 AND l."updatedAt" = $5::timestamp`
    restorable += (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "Listing" l, unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) WHERE ${where}`, ...args))[0].n
    if (APPLY) {
      const back = (await db.$queryRawUnsafe<{ id: string }[]>(`UPDATE "Listing" l SET status = j.prior, "updatedAt" = j.upd::timestamp FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd) WHERE ${where} RETURNING l.id`, ...args)).map((x) => x.id)
      restored.push(...back)
      await tombstoneAll(back) // per chunk, right after its write (a crash later: --tombstone <journal> covers every id)
    }
  }
  console.log(`  ${restorable} still exactly as the expiry left them → restorable · ${j.rows.length - restorable} changed since → LEFT ALONE`)
  if (!APPLY) { console.log('DRY RUN — nothing written.'); return }
  console.log(`RESTORED ${restored.length}. NEXT: root layout ISR tag + Cloudflare purge_everything on BOTH zones.`)
}

;(ROLLBACK ? rollback(ROLLBACK) : RETOMB ? retombstone(RETOMB) : expire())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
