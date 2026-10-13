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
 * THE DAILY SWEEP (unattended — scripts/apartments-weekly.sh runs it at the end of EVERY daily run, on the days its
 * 66 h gate skips the imports, and alone beside a refresh that still holds the job's lock):
 *   npx tsx scripts/expire-rentals.ts --sweep [--stamps-dir <the job's state dir>] [--journal-dir <durable dir> --apply] [--allow-mass-expiry]
 * = --places-older-than FRESH_DAYS (7) with NO --expect: a day's departures are whatever aged past the window since
 * yesterday. ONE read of the live place rows (each marked old or not), planned per GATE UNIT by src/lib/rental-sweep.ts
 * planSweep (a seller's rows; Muaban's apartments and its other place rows apart). Its one refusal, per unit
 * (sweepRefusal): over 95% of that unit's live rows at once while its last successful refresh (the job's
 * `last-success-<unit>` stamps in --stamps-dir; none = never) is over 4 days old — those rows are HELD BACK, the others
 * still expire, and the run exits 3 (SWEEP_REFUSED_EXIT) so the job alerts; --allow-mass-expiry overrides it. The SWEEP lines it prints are the job's log. A row a refresh changed
 * between the read and the write is left as it is (reported, not a failure). Its journal, --rollback and --tombstone
 * are the ones below.
 * ⚠️ Category and hub pages are not purged by the sweep: /c/rentals fetches live listings client-side (its ISR HTML
 * is first paint, 6 h) and district hubs re-render within a day; each expired PDP is tombstoned at once.
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
 * Each page's ISR tombstones (en/vi, the tags of src/lib/pdp-tombstone.ts) are written IN THE SAME STATEMENT as its
 * row's expiry (since 2026-10-13 — before, right after each chunk), so no crash can leave an expired page cached live;
 * the write refuses up front without the tag table. Category, district and hub pages need the root layout ISR tag and
 * a Cloudflare purge on BOTH zones after a one-off (the daily sweep relies on their own windows).
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { RENTAL_IMPORT_SELLERS } from '../src/lib/import-sellers'
import { EXPIRED_STATUS } from '../src/lib/apartment-freshness'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { pdpTombstoneTags } from '../src/lib/job-listing'
import { VEHICLE_RENTAL_SUBCATS } from '../src/lib/rental-places'
import { SWEEP_DAYS, SWEEP_REFUSED_EXIT, lastImportByUnit, planSweep } from '../src/lib/rental-sweep'
import { VEHICLE_SELLERS } from '../src/lib/vehicle-rental-listing'

const argv = process.argv.slice(2)
const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const APPLY = argv.includes('--apply')
/** The daily sweep: --places-older-than SWEEP_DAYS, unattended (no --expect), guarded by sweepRefusal. */
const SWEEP = argv.includes('--sweep')
const ALLOW_MASS = argv.includes('--allow-mass-expiry')
const PLACES_DAYS = val('--places-older-than') === null ? null : Number(val('--places-older-than'))
const VEHICLE_IDS = val('--vehicle-ids')
const ROLLBACK = val('--rollback')
const RETOMB = val('--tombstone')
const EXPECT_SHA = val('--expect-sha')
const JOURNAL_DIR = val('--journal-dir')
const EXPECT = val('--expect') === null ? null : Number(val('--expect'))
const modes = [SWEEP, PLACES_DAYS !== null, VEHICLE_IDS !== null, ROLLBACK !== null, RETOMB !== null].filter(Boolean).length
if (modes !== 1) { console.error('pick exactly one of --sweep | --places-older-than N | --vehicle-ids <file> | --rollback <journal> | --tombstone <journal>'); process.exit(1) }
if (PLACES_DAYS !== null && !(Number.isInteger(PLACES_DAYS) && PLACES_DAYS >= 1)) { console.error('--places-older-than needs a whole number of days ≥ 1'); process.exit(1) }
/** The 3-day job's state dir: its `last-success-<unit>` stamps say when each seller last imported (the sweep's guard). */
const STAMPS_DIR = val('--stamps-dir')
if ((ALLOW_MASS || argv.includes('--stamps-dir')) && !SWEEP) { console.error('--allow-mass-expiry and --stamps-dir belong to --sweep'); process.exit(1) }
if (argv.includes('--stamps-dir') && STAMPS_DIR === null) { console.error('--stamps-dir needs a value (the job\'s state dir)'); process.exit(1) }
// The sweep is unattended: --apply needs a journal dir, never an --expect count (sweepRefusal guards it instead).
if (APPLY && !ROLLBACK && (!JOURNAL_DIR || (EXPECT === null && !SWEEP))) { console.error(`--apply needs --journal-dir <durable dir>${SWEEP ? '' : ' and --expect <count from the dry run>'}`); process.exit(1) }
if (APPLY && VEHICLE_IDS && !EXPECT_SHA) { console.error('--vehicle-ids --apply needs --expect-sha <sha256 printed by the dry run>'); process.exit(1) }

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
// ⛔ UTC PINNED (commit review): updatedAt/postedAt are timestamp WITHOUT time zone holding UTC, so the stamp and the cutoff
// are computed AT TIME ZONE 'UTC' and the session is pinned to UTC too — a session in ICT would shift both by 7 hours.
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c TimeZone=UTC${APPLY || RETOMB ? '' : ' -c default_transaction_read_only=on'}` }), log: ['warn', 'error'] })

/** A PLACE is a rentals row outside vehicle hire (src/lib/rental-places.ts RENTAL_PLACES — NULL counts as a place). */
const VEHICLE_SUBCATS = VEHICLE_RENTAL_SUBCATS
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

/** The live imported PLACE rows of the rental import sellers — the sweep's and --places-older-than's scope ($1 sellers, $2 vehicle subcats). */
const PLACES_FROM = `FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId"
       WHERE c.slug = 'rentals' AND l.status = 'active' AND ${IMPORTED}
         AND l."sellerId" = ANY($1::text[])
         AND (l."subcategorySlug" IS NULL OR l."subcategorySlug" <> ALL($2::text[]))`
/** The places mode's age in days: the sweep's is SWEEP_DAYS (FRESH_DAYS), never an argument. */
const placesDays = (): number | null => (SWEEP ? SWEEP_DAYS : PLACES_DAYS)

async function candidates(): Promise<Row[]> {
  const days = placesDays()
  if (days !== null) {
    // property = the rentals category minus the vehicle subcategories (RENTAL_PLACES: NULL subcategory counts as a place)
    return db.$queryRawUnsafe<Row[]>(
      `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt", l."postedAt"::text AS "postedAt", l."subcategorySlug" AS subcat, s.name AS seller
       ${PLACES_FROM}
         AND COALESCE(l."postedAt", l."createdAt") < (now() AT TIME ZONE 'UTC') - make_interval(days => $3::int)
       ORDER BY l.id`, RENTAL_SELLERS, VEHICLE_SUBCATS, days)
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

/** The job's success stamps (`last-success-<unit>` in --stamps-dir), as the sweep's guard reads them. */
function readStamps(dir: string): { unit: string; text: string }[] {
  if (!existsSync(dir)) { console.log(`⚠️ --stamps-dir ${dir} does not exist — no import is known for any seller`); return [] }
  return readdirSync(dir).filter((f) => /^last-success-[a-z-]+$/.test(f)).map((f) => ({ unit: f.slice('last-success-'.length), text: readFileSync(join(dir, f), 'utf8') }))
}

/**
 * THE SWEEP, from ONE read of every live place row in scope, each marked old (postedAt past SWEEP_DAYS) or not — so a
 * seller's count of old rows can never exceed its live count, whatever a refresh beside it does — planned per seller
 * (src/lib/rental-sweep.ts planSweep). Prints the SWEEP lines; returns the rows to expire and the sellers held back.
 */
async function sweepRows(): Promise<{ rows: Row[]; heldBack: string[] }> {
  const all = await db.$queryRawUnsafe<(Row & { sellerId: string; old: boolean })[]>(
    `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt", l."postedAt"::text AS "postedAt", l."subcategorySlug" AS subcat, s.name AS seller,
            l."sellerId" AS "sellerId", (COALESCE(l."postedAt", l."createdAt") < (now() AT TIME ZONE 'UTC') - make_interval(days => $3::int)) AS old
     ${PLACES_FROM}
     ORDER BY l.id`, RENTAL_SELLERS, VEHICLE_SUBCATS, SWEEP_DAYS)
  const [{ cutoff }] = await db.$queryRawUnsafe<{ cutoff: string }[]>(`SELECT ((now() AT TIME ZONE 'UTC') - make_interval(days => $1::int))::text AS cutoff`, SWEEP_DAYS)
  const now = Date.now()
  const plan = planSweep({ rows: all, lastImport: lastImportByUnit(STAMPS_DIR ? readStamps(STAMPS_DIR) : [], now), now, allowMass: ALLOW_MASS })
  const name = new Map(all.map((r) => [r.sellerId, r.seller]))
  const label = (g: { unit: string | null; sellerId: string }) => `${name.get(g.sellerId) ?? g.sellerId} [${g.unit ?? 'no refresh unit'}]`
  const held = plan.groups.filter((x) => x.refusal)
  console.log(`\nSWEEP ${new Date(now).toISOString()} — ${plan.expire.length} of ${all.length} live imported place rows have postedAt before ${cutoff} UTC (${SWEEP_DAYS} d) → '${EXPIRED_STATUS}'${held.length ? ` · ${held.length} group(s) HELD BACK` : ''}${ALLOW_MASS ? ' · --allow-mass-expiry' : ''}`)
  for (const g of plan.groups) {
    const last = g.lastImportAt === null ? 'none known' : `${new Date(g.lastImportAt).toISOString()} (${((now - g.lastImportAt) / 86_400_000).toFixed(1)} d ago)`
    console.log(`SWEEP   ${label(g)}: ${g.expire} of ${g.live} past ${SWEEP_DAYS} d · last successful refresh ${last}${g.refusal ? ' · HELD BACK' : ''}`)
  }
  const keep = new Set(plan.expire)
  return {
    rows: all.filter((r) => keep.has(r.id)).map(({ sellerId: _sellerId, old: _old, ...r }) => r),
    heldBack: held.map((g) => `${label(g)} (${g.sellerId}): ${g.refusal}`),
  }
}

async function expire() {
  const days = placesDays()
  const mode = SWEEP ? `places-sweep-${SWEEP_DAYS}d` : days !== null ? `places-older-than-${days}d` : `vehicle-ids:${resolve(VEHICLE_IDS!)}`
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — ${mode}\n`)
  const sweep = SWEEP ? await sweepRows() : null
  const rows = sweep ? sweep.rows : await candidates()
  const by = new Map<string, number>()
  for (const r of rows) by.set(`${r.seller} · ${r.subcat ?? '(none)'}`, (by.get(`${r.seller} · ${r.subcat ?? '(none)'}`) ?? 0) + 1)
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${k}`)
  console.log(`   ${'TOTAL'.padStart(6)}  ${rows.length} active → '${EXPIRED_STATUS}'`)
  if (sweep?.heldBack.length) {
    // ⛔ A seller held back keeps every row — the others' old rows still expire below — and the run exits
    // SWEEP_REFUSED_EXIT so the job alerts.
    for (const h of sweep.heldBack) console.error(`REFUSED (held back): ${h}`)
    process.exitCode = SWEEP_REFUSED_EXIT
  }
  if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --journal-dir <dir>${SWEEP ? '' : ` --expect ${rows.length}`} --apply`); return }
  // The sweep needs no --expect (its guard is sweepRefusal); an operator's --expect is still held to.
  if (EXPECT !== null && rows.length !== EXPECT) { console.error(`\nREFUSED: ${rows.length} rows would expire, --expect says ${EXPECT}. Re-read the dry run.`); process.exitCode = 1; return }
  if (!rows.length) { console.log('\nnothing to expire.'); return }
  // ⛔ Checked BEFORE any write: the tombstones go in the same statement as the expiry, so without the tag table the
  // write would fail anyway — and an expired page must never keep rendering from ISR (expire-apartment-rentals.ts too).
  const [{ t: isrTable }] = await db.$queryRawUnsafe<{ t: string | null }[]>(`select to_regclass('public.next_cache_tag')::text as t`)
  if (!isrTable) throw new Error('no next_cache_tag table on this database — an expired page would keep rendering from ISR; refusing before any write')
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
    const ids = part.map((x) => x.id)
    const tags = ids.flatMap(pdpTombstoneTags)
    const tagIds = ids.flatMap((id) => pdpTombstoneTags(id).map(() => id))
    // ⛔ ONE STATEMENT: each row's expiry and its pages' ISR tombstones (en/vi — the same tags and upsert as
    // src/lib/pdp-tombstone.ts) commit together, for exactly the rows the conditional UPDATE moved. Nothing can die
    // between the two — and the daily sweep never selects an expired row again, so a tombstone owed after a crash
    // would otherwise keep that page cached live for its 30-day ISR life. ⚠️ Its stamp is taken a moment BEFORE the
    // commit, so a page rendered in that moment would outlive it (the cache keeps an entry newer than every stamp of
    // its tags): the same pages are tombstoned once more right after the commit, below.
    const r = await db.$queryRawUnsafe<{ id: string }[]>(
      `WITH moved AS (
         UPDATE "Listing" l SET status = $4, "updatedAt" = $5::timestamp
         FROM unnest($1::text[], $2::text[], $3::text[]) AS j(id, prior, upd)
         WHERE l.id = j.id AND l.status = j.prior AND l."updatedAt"::text = j.upd RETURNING l.id
       ), tombstoned AS (
         INSERT INTO next_cache_tag (tag, stamp, expires_at)
         SELECT t.tag, (extract(epoch from clock_timestamp()) * 1000)::bigint, now() + interval '40 days'
         FROM unnest($6::text[], $7::text[]) AS t(id, tag) JOIN moved ON moved.id = t.id
         ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)
         RETURNING 1
       )
       SELECT id FROM moved`,
      ids, part.map((x) => x.priorStatus), part.map((x) => x.updatedAt), EXPIRED_STATUS, now, tagIds, tags)
    done.push(...r.map((x) => x.id))
    await tombstoneAll(r.map((x) => x.id)) // …and once more after the commit (a crash before it: the in-statement ones stand)
  }
  console.log(`EXPIRED ${done.length} of ${rows.length} (a row changed between the read and the write is skipped).`)
  // The sweep runs beside the refresh by design: a row a refresh re-dated or revived meanwhile is simply not stale any
  // more — reported, never a failure. An operator's one-off is held to every row it read.
  if (done.length !== rows.length && SWEEP) console.log(`${rows.length - done.length} row(s) changed meanwhile (a refresh re-dated or revived them) — left as they are`)
  else if (done.length !== rows.length) { console.error(`INCOMPLETE — ${rows.length - done.length} row(s) changed meanwhile; re-run the dry run.`); process.exitCode = 2 }
  if (SWEEP) console.log('every expired PDP is tombstoned; /c/rentals reads live listings client-side and the hubs re-render on their own ISR window — no purge needed for a daily sweep.')
  else console.log('NEXT: root layout ISR tag (eno:isrtag:_N_T_/layout + _N_T_/[lang]/layout — /c/rentals, district and hub pages) + Cloudflare purge_everything on BOTH zones.')
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
