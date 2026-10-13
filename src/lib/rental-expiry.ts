/**
 * THE PURE HALF OF scripts/expire-rentals.ts — its argument rules and its one write statement, out of the script so
 * both are unit-tested: the rules on their own (src/lib/rental-expiry.test.ts), the statement EXECUTED in PGlite
 * against fixture rows (2026-10-13 review: until then it had only been run by hand on a scratch Postgres).
 * The script's modes and guarantees are documented in its header; nothing here opens a database.
 */
import { pdpTombstoneTags } from './job-listing'

export type ExpireRentalsArgs = {
  apply: boolean
  /** The daily sweep (--sweep): --places-older-than SWEEP_DAYS, unattended, guarded per gate unit. */
  sweep: boolean
  allowMass: boolean
  placesDays: number | null
  vehicleIds: string | null
  rollback: string | null
  retomb: string | null
  expectSha: string | null
  journalDir: string | null
  /** NaN when given but not a number — the write then refuses (the count can never equal it). */
  expect: number | null
  /** The 3-day job's state dir: its `last-success-<unit>` stamps (the sweep's guard). */
  stampsDir: string | null
}

const FLAGS = new Set(['--apply', '--sweep', '--allow-mass-expiry'])
const VALUED = new Set(['--places-older-than', '--vehicle-ids', '--rollback', '--tombstone', '--expect-sha', '--journal-dir', '--expect', '--stamps-dir'])

/**
 * The script's arguments, or why they are refused — every refusal it had before 2026-10-13, now with an unknown
 * argument refused too (a typo like `--allow-mass-expire` must not silently mean "not allowed", nor `--journal`
 * a dry run that looks like a write), and an option given twice (only the first would count — the second silently
 * ignored).
 */
export function parseExpireRentalsArgs(argv: readonly string[]): { ok: true; args: ExpireRentalsArgs } | { ok: false; error: string } {
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (FLAGS.has(a) || VALUED.has(a)) {
      if (seen.has(a)) return { ok: false, error: `${a} is given twice — say it once` }
      seen.add(a)
    }
    if (FLAGS.has(a)) continue
    if (VALUED.has(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
        if (a === '--stamps-dir') return { ok: false, error: '--stamps-dir needs a value (the job\'s state dir)' }
        // Falls through to the rule that names what is missing (a mode with no value is no mode).
        continue
      }
      i++
      continue
    }
    return { ok: false, error: `unknown argument "${a}"` }
  }
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const has = (f: string) => argv.includes(f)
  const placesRaw = val('--places-older-than')
  const expectRaw = val('--expect')
  const args: ExpireRentalsArgs = {
    apply: has('--apply'),
    sweep: has('--sweep'),
    allowMass: has('--allow-mass-expiry'),
    placesDays: placesRaw === null ? null : Number(placesRaw),
    vehicleIds: val('--vehicle-ids'),
    rollback: val('--rollback'),
    retomb: val('--tombstone'),
    expectSha: val('--expect-sha'),
    journalDir: val('--journal-dir'),
    expect: expectRaw === null ? null : Number(expectRaw),
    stampsDir: val('--stamps-dir'),
  }
  const modes = [args.sweep, args.placesDays !== null, args.vehicleIds !== null, args.rollback !== null, args.retomb !== null].filter(Boolean).length
  if (modes !== 1) return { ok: false, error: 'pick exactly one of --sweep | --places-older-than N | --vehicle-ids <file> | --rollback <journal> | --tombstone <journal>' }
  if (args.placesDays !== null && !(Number.isInteger(args.placesDays) && args.placesDays >= 1)) return { ok: false, error: '--places-older-than needs a whole number of days ≥ 1' }
  if ((args.allowMass || has('--stamps-dir')) && !args.sweep) return { ok: false, error: '--allow-mass-expiry and --stamps-dir belong to --sweep' }
  if (has('--stamps-dir') && args.stampsDir === null) return { ok: false, error: '--stamps-dir needs a value (the job\'s state dir)' }
  // The sweep is unattended: --apply needs a journal dir, never an --expect count (sweepRefusal guards it instead).
  if (args.apply && !args.rollback && (!args.journalDir || (args.expect === null && !args.sweep))) {
    return { ok: false, error: `--apply needs --journal-dir <durable dir>${args.sweep ? '' : ' and --expect <count from the dry run>'}` }
  }
  if (args.apply && args.vehicleIds && !args.expectSha) return { ok: false, error: '--vehicle-ids --apply needs --expect-sha <sha256 printed by the dry run>' }
  return { ok: true, args }
}

/**
 * ⛔ THE ONE WRITE: each row's expiry and its pages' ISR tombstones (en/vi — the tags and the upsert of
 * src/lib/pdp-tombstone.ts) in ONE statement, so they commit together, for exactly the rows the conditional UPDATE
 * moved. A row moves only while its status AND updatedAt are still what the read (and the journal) recorded, and it
 * is stamped updatedAt = the batch stamp — what --rollback matches on. $1 ids · $2 prior statuses · $3 prior
 * updatedAt (::text, as read) · $4 the new status · $5 the batch stamp · $6/$7 the (id, tag) pairs. Returns the
 * moved ids. (expireStatementParams builds the seven in this order.)
 */
export const EXPIRE_WITH_TOMBSTONES_SQL = `WITH moved AS (
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
       SELECT id FROM moved`

/** EXPIRE_WITH_TOMBSTONES_SQL's seven parameters, for one chunk of journal rows. */
export function expireStatementParams(part: readonly { id: string; priorStatus: string; updatedAt: string }[], status: string, stamp: string): [string[], string[], string[], string, string, string[], string[]] {
  const ids = part.map((x) => x.id)
  return [
    ids, part.map((x) => x.priorStatus), part.map((x) => x.updatedAt), status, stamp,
    ids.flatMap((id) => pdpTombstoneTags(id).map(() => id)), ids.flatMap(pdpTombstoneTags),
  ]
}
