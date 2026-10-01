/**
 * The 7-day rule for imported APARTMENT rentals — the write half. Owner, 2026-10-01: "we need only 7 days
 * old apartments fetched weekly, remove else, only new active apartments" → chose: live only while the
 * source shows the ad posted OR RE-POSTED within 7 days; apartments only; refreshed weekly. The rule and
 * every per-source date are in src/lib/apartment-freshness.ts.
 *
 *   DRY (read-only session):
 *     set -a; . ./.env; set +a; npx tsx scripts/expire-apartment-rentals.ts --seller <id> --fresh <set.json> --state-dir <dir>
 *   WRITE (journal first):   … --journal-dir <durable dir> --apply
 *   BACKSTOP (no fetch):     … --seller <id> --backstop-days 14 [--journal-dir … --state-dir … --apply]
 *
 * WHAT IT DOES: every `active` apartment-rental row of ONE ownerless rental import seller (pinned by id),
 * with an affiliateUrl, whose externalId is NOT in the source step's fresh set → EXPIRED_STATUS. Rows the
 * step could not judge (`unknown`) stay. Then per-id ISR tombstones, so the page stops rendering now.
 *
 * ⛔ STRICTLY active → expired. Never touches hidden (moderation, imageless, a source's own gone signal),
 * removed (the compliance tombstone), sold or stale rows; never DELETEs (Law 122/2025 keep ≥1 year).
 * ⛔ THE FRESH SET IS RE-VALIDATED HERE, never trusted from its writer (freshSetProblem): wrong seller,
 * over a day old, not claiming complete coverage, an item outside the window or of another source's id
 * space — refused. And planExpiry refuses a set that shrank under MIN_SHARE of the largest of the last
 * BASELINE_RUNS applied sets (read from --state-dir), or one that would take EVERY live row of a source
 * that is not tiny — the two shapes a blocked crawl produces. --force overrides both, for an operator
 * holding independent evidence (the 2026-10-01 one-off cleanup).
 * ⛔ BACKSTOP — ONLY FOR A SOURCE THAT STOPPED REFRESHING, AND ROW BY ROW. A source whose step keeps
 * failing (a Cloudflare challenge, the Mac asleep) would otherwise keep last week's rows forever.
 * --backstop-days N acts only when the state file shows no applied fresh set for more than
 * BACKSTOP_MISSED_DAYS (the weekly refresh was missed), and then expires the live rows whose postedAt is
 * older than N days. Both halves matter: the importers keep postedAt at the LATEST source date they have
 * seen (create, revival, an update whose source date is newer), so while refreshes succeed postedAt is
 * NOT an age signal on its own (a row kept fresh by the weekly set may still carry an older postedAt from
 * before that rule) — the normal expiry handles those weeks. No state file = refused, never "never".
 * ⚠️ Prisma updateMany, so updatedAt moves — wanted: stale-noindex.ts counts departures by it, and imported
 * rows are never in the listing sitemaps (sitemap.ts filters affiliateUrl), so nothing reorders there.
 */
import 'dotenv/config'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { RENTAL_IMPORT_SELLERS } from '../src/lib/import-sellers'
import { APARTMENT_SUBCAT, EXPIRED_STATUS, baselineOf, freshSetProblem, planExpiry, type FreshSet } from '../src/lib/apartment-freshness'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { pdpTombstoneTags } from '../src/lib/job-listing'

const FLAGS = new Set(['--apply', '--force', '--allow-no-isr'])
const VALUED = new Set(['--seller', '--fresh', '--state-dir', '--journal-dir', '--backstop-days'])
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) continue
  if (VALUED.has(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); i++; continue }
  throw new Error(`unknown argument "${a}"`)
}
const str = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const FORCE = argv.includes('--force')
const ALLOW_NO_ISR = argv.includes('--allow-no-isr')
const SELLER = str('--seller')
const FRESH = str('--fresh')
const STATE_DIR = str('--state-dir')
const JOURNAL_DIR = str('--journal-dir')
const BACKSTOP_DAYS = str('--backstop-days') === null ? null : Number(str('--backstop-days'))
const BATCH = 500
const DAY_MS = 86_400_000
/** A weekly refresh plus a day of slack: past this, the source has missed a run. */
const BACKSTOP_MISSED_DAYS = 8

type RunRecord = { at: string; freshCount: number; expired: number; kept: number; mode: 'fresh' | 'backstop' }
type State = { sellerId: string; runs: RunRecord[] }

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}
function tmpRoots() {
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  return roots
}
function ensureDurableDir(dir: string, flag: string): string {
  const abs = resolve(dir)
  const problem = journalDirProblem(abs, tmpRoots())
  if (problem) throw new Error(problem.replace('--journal-dir', flag))
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.expire-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}
const stateFile = (dir: string, seller: string) => join(dir, `${seller}.json`)
function readState(dir: string, seller: string): State | null {
  const f = stateFile(dir, seller)
  if (!existsSync(f)) return null
  const s = JSON.parse(readFileSync(f, 'utf8')) as State
  if (s.sellerId !== seller || !Array.isArray(s.runs)) throw new Error(`${f} is not this seller's state file`)
  return s
}
/** Write-then-rename, fsync'd: a crash leaves the old state or the new one, never half of one. */
function writeState(dir: string, s: State) {
  const f = stateFile(dir, s.sellerId)
  const tmp = `${f}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try { writeSync(fd, JSON.stringify(s, null, 1) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, f)
  // The rename is durable only once the DIRECTORY entry is on disk.
  const dfd = openSync(dir, 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}

async function main() {
  if (!SELLER || !(RENTAL_IMPORT_SELLERS as readonly string[]).includes(SELLER)) throw new Error(`--seller must be one of ${RENTAL_IMPORT_SELLERS.join(', ')}`)
  const backstop = BACKSTOP_DAYS !== null
  if (backstop === Boolean(FRESH)) throw new Error('pass exactly one of --fresh <set.json> or --backstop-days <N>')
  if (backstop && (!Number.isInteger(BACKSTOP_DAYS) || BACKSTOP_DAYS! < 8)) throw new Error('--backstop-days must be an integer ≥ 8 (the 7-day window plus at least a day)')
  if (backstop && !STATE_DIR) throw new Error('--backstop-days needs --state-dir: it acts only when the state shows a missed refresh')
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  // A fresh-mode apply without state would run with no share guard AND leave no baseline for next week.
  if (APPLY && !backstop && !STATE_DIR) throw new Error('--apply needs --state-dir <durable dir> (the share-guard baseline lives there)')
  const journalDir = APPLY ? ensureDurableDir(JOURNAL_DIR!, '--journal-dir') : null
  const stateDir = STATE_DIR ? (APPLY ? ensureDurableDir(STATE_DIR, '--state-dir') : resolve(STATE_DIR)) : null
  const now = Date.now()

  let set: FreshSet | null = null
  if (FRESH) {
    const raw = JSON.parse(readFileSync(FRESH, 'utf8'))
    const problem = freshSetProblem(raw, now, SELLER)
    if (problem) throw new Error(`fresh set ${FRESH} refused: ${problem}`)
    set = raw as FreshSet
  }
  // One run per seller at a time: two runs would each read, mutate and rename their own copy of the state.
  if (APPLY && stateDir) {
    const lock = join(stateDir, `${SELLER}.lock`)
    // ⛔ NO AUTOMATIC TAKEOVER: no pid-based takeover is race-free (two runs can both judge a lock stale).
    // A lock that exists refuses, loudly, naming its holder. scripts/apartments-weekly.sh — the one scheduled
    // instance (launchd never starts a second) — clears locks whose pid is dead at its own start, so a run
    // killed by SIGKILL blocks nothing past the next week; a reused pid surfaces as a failed, notified run.
    try {
      const fd = openSync(lock, 'wx')
      try { writeSync(fd, String(process.pid)); fsyncSync(fd) } finally { closeSync(fd) }
    } catch {
      let holder = '?'
      try { holder = readFileSync(lock, 'utf8').trim() || '?' } catch { /* gone meanwhile */ }
      throw new Error(`${lock} exists (pid ${holder}) — another run for this seller is in progress, or one died: if no such process is running, delete the file`)
    }
    const release = () => { try { if (readFileSync(lock, 'utf8').trim() === String(process.pid)) unlinkSync(lock) } catch { /* already gone */ } }
    process.on('exit', release)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { release(); process.exit(130) })
  }
  const state = stateDir ? readState(stateDir, SELLER) : null
  // ⛔ MONOTONIC: an older set applied after a newer one would expire rows the newer crawl found.
  const lastFreshAt = state?.runs.filter((r) => r.mode === 'fresh').at(-1)?.at
  if (set && lastFreshAt && Date.parse(set.fetchedAt) <= Date.parse(lastFreshAt)) throw new Error(`fresh set fetched ${set.fetchedAt} is not newer than the last applied one (${lastFreshAt}) — refusing to go back in time`)

  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    const seller = await db.seller.findUnique({ where: { id: SELLER }, select: { name: true, ownerId: true } })
    if (!seller) throw new Error(`seller ${SELLER} does not exist`)
    if (seller.ownerId) throw new Error(`seller ${SELLER} (${seller.name}) is owned by an account — refusing to expire a real shop's rows`)

    const active = await db.listing.findMany({
      where: { sellerId: SELLER, subcategorySlug: APARTMENT_SUBCAT, status: 'active', affiliateUrl: { not: null } },
      select: { id: true, externalId: true, postedAt: true }, orderBy: { id: 'asc' },
    })

    let expire: string[]
    let keptCount: number
    if (set) {
      const freshIds = set.items.map((i) => i.externalId)
      let knownInDb = 0
      for (let i = 0; i < freshIds.length; i += 1000) {
        knownInDb += await db.listing.count({ where: { sellerId: SELLER, externalId: { in: freshIds.slice(i, i + 1000) } } })
      }
      const plan = planExpiry({
        active,
        fresh: new Set(freshIds),
        unknown: new Set(set.unknown ?? []),
        baseline: state ? baselineOf(state.runs.filter((r) => r.mode === 'fresh').map((r) => r.freshCount)) : null,
        knownInDb,
        force: FORCE,
      })
      console.log(`known in db       ${knownInDb} of the set's ${freshIds.length} ids are rows of this seller (any status)`)
      console.log(`seller            ${seller.name} (${SELLER})`)
      console.log(`fresh set         ${set.items.length} items, ${(set.unknown ?? []).length} undetermined, fetched ${set.fetchedAt}`)
      console.log(`coverage          ${set.coverage}`)
      console.log(`live apartments   ${active.length} → keep ${plan.keep}${plan.noExternalId ? ` (${plan.noExternalId} without an externalId)` : ''}, expire ${plan.expire.length}`)
      if (!stateDir) console.log('⚠️ NO --state-dir — the share guard has no baseline this run')
      else if (!state) console.log('⚠️ no state file yet — the share guard has no baseline this run (the first applied run writes one)')
      if (plan.refusal) throw new Error(`REFUSED: ${plan.refusal}`)
      expire = plan.expire
      keptCount = plan.keep
    } else {
      if (!state) throw new Error(`no state file for ${SELLER} in ${stateDir ?? '(no --state-dir)'} — the backstop will not read a missing history as "never refreshed"`)
      const lastFresh = state.runs.filter((r) => r.mode === 'fresh').at(-1)
      const missed = lastFresh ? (now - Date.parse(lastFresh.at)) / DAY_MS : Infinity
      if (missed <= BACKSTOP_MISSED_DAYS) {
        console.log(`seller            ${seller.name} (${SELLER})\nBACKSTOP          last applied fresh set ${lastFresh!.at} (${missed.toFixed(1)} days ago) — refreshing normally, nothing to do`)
        return
      }
      const cutoff = new Date(now - BACKSTOP_DAYS! * DAY_MS)
      const old = active.filter((r) => r.postedAt < cutoff)
      expire = old.map((r) => r.id)
      keptCount = active.length - old.length
      console.log(`seller            ${seller.name} (${SELLER})`)
      console.log(`BACKSTOP          no applied fresh set for ${missed === Infinity ? 'ever' : `${missed.toFixed(1)} days`}; ${old.length} of ${active.length} live apartments have postedAt before ${cutoff.toISOString()} (${BACKSTOP_DAYS} days) → expire`)
    }

    if (!APPLY) { console.log('\nDRY RUN — nothing changed. Re-run with --journal-dir <durable dir> --apply.'); return }
    if (!expire.length) console.log('nothing to expire')
    // ⛔ Checked BEFORE any write: without the tag table an expired PDP keeps rendering from ISR for 30 days.
    const [{ t: isrTable }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
    if (expire.length && !isrTable && !ALLOW_NO_ISR) throw new Error('no next_cache_tag table on this database — expired pages would keep rendering from ISR; pass --allow-no-isr only on a scratch copy')

    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `apartments-expired-${SELLER}-${stamp}.ids`)
    const ROLLBACK = join(journalDir!, `apartments-expired-${SELLER}-${stamp}.rollback.sql`)
    if (expire.length) console.log(`journal           ${JOURNAL}`)
    const CHANGED = join(journalDir!, `apartments-expired-${SELLER}-${stamp}.changed.ids`)
    const changed: string[] = []
    for (let i = 0; i < expire.length; i += BATCH) {
      const ids = expire.slice(i, i + BATCH)
      // The PLANNED ids first (fsync) — enough to find and repair a batch a crash cut in half.
      recordDurably(JOURNAL, ids.join('\n'))
      // Tombstone BEFORE the write as well as after: re-rendering a still-active page is harmless, and if
      // the process dies between the write and the second tombstone the pages are already invalidated.
      await tombstonePdps(db, ids)
      // …AndReturn: exactly the rows THIS write moved (a row that left 'active' meanwhile is not one).
      const moved = (await db.listing.updateManyAndReturn({
        where: { id: { in: ids }, sellerId: SELLER, subcategorySlug: APARTMENT_SUBCAT, status: 'active' },
        data: { status: EXPIRED_STATUS },
        select: { id: true, updatedAt: true },
      }))
      if (!moved.length) continue
      // updateMany stamps one updatedAt on every row it moves; a LATER change (a revival, another run's
      // expiry) moves it forward, so the rollback below cannot undo anything that happened after this run.
      const stampedAt = new Date(Math.max(...moved.map((r) => r.updatedAt.getTime()))).toISOString()
      // The rollback names only the rows this run moved, so it can never revive one another run expired.
      const movedIds = moved.map((r) => r.id)
      recordDurably(CHANGED, movedIds.join('\n'))
      // …and carries its own tombstones: a row brought back keeps a cached 404 for 30 days otherwise.
      const lit = (x: string) => `'${x.replace(/'/g, "''")}'`
      const tags = movedIds.flatMap(pdpTombstoneTags).map(lit).join(',')
      recordDurably(ROLLBACK, `UPDATE "Listing" SET status='active' WHERE status='${EXPIRED_STATUS}' AND "sellerId"=${lit(SELLER)} AND "updatedAt" <= ${lit(stampedAt)} AND id IN (${movedIds.map(lit).join(',')});\n` +
        `INSERT INTO next_cache_tag (tag, stamp, expires_at) SELECT t, (extract(epoch from clock_timestamp())*1000)::bigint, now() + interval '40 days' FROM unnest(ARRAY[${tags}]) AS t ON CONFLICT (tag) DO UPDATE SET stamp = greatest(next_cache_tag.stamp, excluded.stamp), expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at);`)
      // After: a page rendered in the gap between the first tombstone and the write is invalidated too.
      await tombstonePdps(db, movedIds)
      changed.push(...movedIds)
    }
    const done = changed.length
    console.log(`marked ${EXPIRED_STATUS}    ${done} of ${expire.length}${done ? `   (exact ids: ${CHANGED}; rollback: ${ROLLBACK})` : ''}`)
    console.log(`ISR tombstones    ${done ? `${done} pages × en/vi, before and after each batch` : 'none needed'}${isrTable ? '' : ' — SKIPPED, no tag table (--allow-no-isr)'}`)

    if (stateDir && (set || done)) {
      const next: State = state ?? { sellerId: SELLER, runs: [] }
      next.runs.push({ at: set ? set.fetchedAt : new Date(now).toISOString(), freshCount: set ? set.items.length : 0, expired: done, kept: keptCount, mode: set ? 'fresh' : 'backstop' })
      next.runs = next.runs.slice(-20)
      writeState(stateDir, next)
      console.log(`state             ${stateFile(stateDir, SELLER)} (${next.runs.length} runs)`)
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
