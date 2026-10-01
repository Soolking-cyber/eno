/**
 * Hide Rever.vn reference rentals that Rever itself now shows as let (or that are gone). Owner,
 * 2026-09-30: "leave only apartments that are available, i checked couple have expired or rented out".
 * And, since 2026-10-01, Rever's half of THE 7-DAY RULE (src/lib/apartment-freshness.ts): a row stays live
 * only while Rever shows it updated within FRESH_DAYS — its "Cập nhật" date — AND available.
 *
 *   Check (DRY — database session read-only at the server, writes only the --save / --fresh-out files):
 *     set -a; . ./.env; set +a; npx tsx scripts/retire-rever-rentals.ts [--limit N] [--save <status.jsonl>] [--fresh-out <set.json>]
 *   Write (journal first) — from the saved check, so Rever is not crawled twice:
 *     … scripts/retire-rever-rentals.ts --src <status.jsonl> --journal-dir <durable dir> --apply [--force-mass-revive]
 *   (--src re-judges every saved row with the CURRENT rule and refuses a check older than 24 h.)
 *   Weekly job: check --save --fresh-out → --src --apply → expire-apartment-rentals.ts --fresh <set> → --backstop-days 14.
 *
 * Why this exists rather than `import-rever-rentals.ts --retire`: that path needs a status file with
 * ≥98% coverage of the whole 3,555-row SOURCE scrape, and the crawler that produced it was never
 * committed. This checks exactly the rows that are on eno — one request each, ≥1.5 s apart. There is no
 * new-row import for Rever: it has posted no HCMC rental since 2026-06-12 (measured 2026-10-01).
 *
 * WHAT THE CHECK READS, PER ROW: every apartment-rental row of the Rever seller with a Rever URL that is
 * `active` (may be retired) or in REVIVABLE_STATUSES (may come back) — the listing's OWN badge, and its
 * own "Cập nhật: dd/mm/yyyy" (src/lib/rever-liveness.ts).
 *   · --fresh-out writes the FRESH SET (makeFreshSet): every checked row, of any status, whose Cập nhật —
 *     at the START of that day in Asia/Ho_Chi_Minh, the worst case — is inside the window at the last check
 *     (the set's fetchedAt) AND whose own badge says "Sẵn sàng giao dịch". Rows LIVE when checked that could
 *     not be judged go to `unknown` (kept live); undetermined expired/stale rows stay down and out of it.
 *     ⛔ NOT WRITTEN — exit 3 (COVERAGE_REFUSED: the --save file is still good for --src), and any older
 *     file at that path is removed first — unless every row was checked (no --limit), ≥ REVER_MIN_ANSWERED
 *     of the rows live when checked were judged (or ≤ REVER_UNKNOWN_FLOOR were not — freshSetProblem's own
 *     floor), the check is not MASS-FRESH, and the set passes freshSetProblem. MASS-FRESH (massFreshRefusal:
 *     ≥ 50% of ≥ 20 judged live rows read fresh in one check — a site-wide "Cập nhật" change) refuses the
 *     set, the re-date AND the revival (both rest on that date), in the check and in the --src apply alike:
 *     exit 3, retirements still applied. A mass-retire or mass-revive refusal exits 1 (a site change). Each run needs its own
 *     --save file (one that already holds lines is refused).
 *   · --apply (from --src) does three things (planReverApply, unit-tested): let/gone `active` rows →
 *     'stale' (as before); fresh rows in REVIVABLE_STATUSES → 'active' with postedAt = the Rever date (never
 *     a hidden, removed or sold row); fresh `active` rows whose Rever date is STRICTLY NEWER than postedAt →
 *     postedAt moves to it. A row whose URL or externalId moved since the check is not touched. Wherever
 *     postedAt moves, rankScore is recomputed from that date (reverRepostRank). No re-date under MASS-FRESH
 *     (exit 3; no re-date and no revival — both rest on that date; retirements still applied). Both halves come from ONE
 *     function (reverFreshDecision) over the same saved records, judged at the same instant, so the set
 *     and the revivals can never disagree.
 *
 * ⛔ THE VERDICT COMES FROM THE LISTING'S OWN BADGE, NOT FROM "THE PAGE SAYS Đã thuê" — related-listing
 * cards print that phrase on live pages. See src/lib/rever-liveness.ts.
 * ⛔ STATUS 'stale', NOT 'hidden' (Opus, commit gate): `hide-imageless-imports.ts --restore` re-activates
 * every hidden import row that HAS a photo — every Rever flat has five — so a routine restore would
 * republish the let flats. 'stale' is as invisible publicly (listingIsViewable admits active|sold only)
 * and nothing else sets it, so the rollback cannot revive a row some other process hid either.
 * ⛔ HIDES, NEVER DELETES (`Order` is onDelete:Restrict and six relations cascade), only on a positive
 * signal, and only rows of the Rever seller PINNED BY ID. A run where more than half of the answered
 * live pages look gone is refused whole (massRetireRefusal), and so is one where more than half of the
 * judged expired/stale pages read fresh again (massReviveRefusal): either is a site change, not churn.
 * ⛔ PER WRITE: the PLANNED change is journaled (fsync) first; only once the conditional write has moved
 * the row is its rollback line written — guarded on the state the write created AND on "updatedAt" ≤ the
 * value that write returned (updateManyAndReturn: a row can now cycle stale → active → stale, and an old
 * rollback must not flip a later write back), carrying that page's own ISR tombstone INSERT — and the page
 * tombstoned (tombstonePdps), as it lands. A throw part-way still
 * tombstones every row already changed (finally). The apply refuses before its first write when the
 * database has no next_cache_tag table.
 */
import 'dotenv/config'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { APARTMENT_SUBCAT, REVIVABLE_STATUSES, freshSetProblem, makeFreshSet } from '../src/lib/apartment-freshness'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import {
  isrTombstoneSql, massReviveRefusal, parseSavedCheck, planReverApply, readReverPage, reverFreshDecision, reverRepostRank, sqlLiteral,
  updatedAtGuardSql, type ReverCheckRecord, type ReverPageRead,
} from '../src/lib/rever-liveness'
import { massRetireRefusal } from './muaban-net-map'

const SELLER_ID = 'cmub0wead0000zrq418bqq27m' // Rever.vn — pinned by id; Seller.name is user-settable
const UA = 'Mozilla/5.0 (compatible; eno-property-import/1.0; +https://eno.vn)'
const DELAY_MS = 1500

const FLAGS = new Set(['--apply', '--force-mass-revive'])
const VALUED = new Set(['--limit', '--save', '--src', '--journal-dir', '--fresh-out'])
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) continue
  if (VALUED.has(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); i++; continue }
  throw new Error(`unknown argument "${a}"`)
}
const str = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const FORCE_MASS_REVIVE = argv.includes('--force-mass-revive')
const LIMIT = str('--limit') === null ? null : Number(str('--limit'))
if (LIMIT !== null && !(Number.isInteger(LIMIT) && LIMIT > 0)) throw new Error(`--limit must be a positive integer, got ${str('--limit')}`)
const SAVE = str('--save')
const SRC = str('--src')
const MAX_SRC_AGE_H = 24
/** Exit code: the check ran and saved, but --fresh-out could not prove coverage, or the check is MASS-FRESH (re-date
 *  refused too) — apartments-weekly.sh's COVERAGE_REFUSED. The --save file is whole per row: --src may still apply it. */
const COVERAGE_REFUSED = 3
const JOURNAL_DIR = str('--journal-dir')
const FRESH_OUT = str('--fresh-out')
/** Rows checked: the live ones (may be retired) and the ones the 7-day rule may bring back. */
const CHECKED_STATUSES = ['active', ...REVIVABLE_STATUSES]

/** A created, renamed or removed name is durable only once its DIRECTORY entry is on disk. */
function fsyncDir(dir: string) {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** Append one line, fsync'd — and, the first time, the directory entry of the new file too. */
function recordDurably(file: string, line: string) {
  const created = !existsSync(file)
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  if (created) fsyncDir(dirname(file))
}

/** tmp + fsync + rename + fsync of the directory: a reader (or a crash) sees the old file or the whole new one. */
function writeAtomically(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  try {
    const fd = openSync(tmp, 'w')
    try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, file)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* never created, or already renamed */ }
    throw e
  }
  fsyncDir(dirname(file))
}

function ensureJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.rever-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}

/** ⛔ Only ever request Rever itself (codex, commit gate): the URL comes from the database, and a
 *  malformed or repointed row must not turn this operator script into a fetch of an arbitrary host. */
const isReverUrl = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'rever.vn' || x.hostname === 'www.rever.vn') } catch { return false } }

const NO_ANSWER: ReverPageRead = { verdict: 'unknown', http: 0, label: null, updated: null }

async function check(url: string): Promise<ReverPageRead> {
  if (!isReverUrl(url)) return NO_ANSWER
  try {
    // ⛔ REDIRECTS ARE NOT FOLLOWED (codex, commit gate): following one would reach a host the guard above
    // never saw. A live Rever listing answers 200 directly; any 3xx is saved as http 0 — no evidence — so
    // the --src re-judge can never read a redirect's landing page as 'gone' (or its date as fresh).
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (res.status === 429) throw new Error(`HTTP 429 at ${url} — rate limited; stopping`)
    if (res.status >= 300 && res.status < 400) return NO_ANSWER
    return readReverPage(res.status, res.status === 200 ? await res.text() : '')
  } catch (e) {
    if (e instanceof Error && e.message.includes('429')) throw e
    return NO_ANSWER
  }
}

async function main() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  if (APPLY && !SRC) throw new Error('--apply writes only from a saved check: --src <status.jsonl> (run the dry check with --save first)')
  if (SRC && SAVE) throw new Error('--src re-reads a saved check; it cannot also --save one')
  if (FRESH_OUT && SRC) throw new Error('--fresh-out is written by the check run that reads Rever, not by --src (the apply rebuilds the same decision from the saved check)')
  if (FRESH_OUT && LIMIT) throw new Error('--fresh-out needs every row checked — it cannot be written by a --limit run')
  if (SRC && LIMIT) throw new Error('--limit with --src would apply a whole saved check to only part of the rows — the guards are computed over all of it')
  if (FRESH_OUT && SAVE && resolve(FRESH_OUT) === resolve(SAVE)) throw new Error('--fresh-out and --save name the same file: the set would overwrite the saved check the apply needs')
  // ⛔ ONE CHECK PER --save FILE. --save appends, and --src keeps the latest line per id: a second run into
  // the same file would leave the apply judging a MERGE of two runs — at a different instant, over other
  // rows — than the fresh set this run writes from memory. A new file each run keeps the two identical.
  if (SAVE && existsSync(SAVE) && statSync(SAVE).size > 0) throw new Error(`--save ${SAVE} already holds a check — give each run its own file`)
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null
  const freshOut = FRESH_OUT ? resolve(FRESH_OUT) : null
  // A run that ends up refusing must not leave last run's set at this path for the expiry to pick up.
  if (freshOut && existsSync(freshOut)) { unlinkSync(freshOut); fsyncDir(dirname(freshOut)) }
  // The saved check is parsed before any DB session: an old or undated file is refused outright.
  let saved: ReverCheckRecord[] | null = null
  if (SRC) {
    try { saved = parseSavedCheck(readFileSync(SRC, 'utf8'), Date.now(), MAX_SRC_AGE_H) } catch (e) { throw new Error(`${SRC}: ${e instanceof Error ? e.message : e}`) }
  }

  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true } })
    if (!seller || seller.name !== 'Rever.vn' || seller.ownerId) throw new Error(`seller ${SELLER_ID} is not the ownerless Rever.vn reference seller — refusing`)

    const rows = await db.listing.findMany({
      // APARTMENTS ONLY — the owner's scope ("leave only apartments that are available"); codex + Opus
      // both caught the first cut sweeping Rever's houses and offices too.
      where: { sellerId: SELLER_ID, status: { in: CHECKED_STATUSES }, subcategorySlug: APARTMENT_SUBCAT, affiliateUrl: { not: null } },
      select: {
        id: true, externalId: true, status: true, affiliateUrl: true, subcategorySlug: true, title: true,
        postedAt: true, rankScore: true, sellerTrustScore: true, featured: true, views: true, contactCount: true,
      },
      orderBy: { createdAt: 'asc' },
      ...(LIMIT ? { take: LIMIT } : {}),
    })
    const nActive = rows.filter((r) => r.status === 'active').length
    console.log(`${SRC ? 'retire/revive' : 'check'}${' '.repeat(SRC ? 5 : 12)}${rows.length} Rever apartment rows (${nActive} active, ${rows.length - nActive} ${REVIVABLE_STATUSES.join('/')})${SRC ? '' : `, ≥${DELAY_MS} ms apart, UA "${UA}"`}`)

    // The check: one GET per row, each saved (fsync) as it lands. --src: the saved check instead.
    let records: ReverCheckRecord[]
    if (saved) {
      records = saved
      console.log(`saved check       ${saved.length} rows from ${SRC}`)
    } else {
      records = []
      for (const [i, r] of rows.entries()) {
        const v = await check(r.affiliateUrl!)
        const rec: ReverCheckRecord = {
          id: r.id, externalId: r.externalId, status: r.status, url: r.affiliateUrl!,
          http: v.http, label: v.label, verdict: v.verdict, updated: v.updated, checkedAt: new Date().toISOString(),
          postedAt: r.postedAt.toISOString(),
        }
        records.push(rec)
        if (SAVE) recordDurably(SAVE, JSON.stringify(rec))
        if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length}`)
        await new Promise((ok) => setTimeout(ok, DELAY_MS))
      }
    }

    const scope = saved
      ? `saved check ${SRC}`
      : `every Rever.vn apartment row on eno with a Rever URL (seller ${SELLER_ID}, pinned by id) — ${nActive} active + ${rows.length - nActive} ${REVIVABLE_STATUSES.join('/')}${LIMIT ? `, ⚠️ --limit ${LIMIT}` : ', no --limit'}`
    const decision = reverFreshDecision(records, scope)
    const plan = planReverApply(rows, records, decision)
    const { hide, revive, repost, tally, down } = plan

    console.log(`\nactive verdicts   ${JSON.stringify(tally)}`)
    const bySub: Record<string, number> = {}
    for (const h of hide) bySub[h.row.subcategorySlug ?? '(none)'] = (bySub[h.row.subcategorySlug ?? '(none)'] ?? 0) + 1
    console.log(`would hide        ${hide.length}  by subcategory ${JSON.stringify(bySub)}`)
    for (const h of hide.slice(0, 15)) console.log(`  ${h.verdict.padEnd(7)} ${h.url}`)
    console.log(`${REVIVABLE_STATUSES.join('/').padEnd(18)}${JSON.stringify(down)}`)
    console.log(`would revive      ${revive.length}${plan.reviveRefused ? ` — ⛔ ${plan.reviveRefused} REFUSED (mass-fresh)` : ''}`)
    for (const x of revive.slice(0, 15)) console.log(`  ${x.row.status.padEnd(7)} Cập nhật ${x.sourceDate.toISOString()}  ${x.url}`)
    console.log(`would re-date     ${repost.length}  (active rows Rever shows updated after their postedAt)${plan.repostRefused ? ` — ⛔ ${plan.repostRefused} REFUSED (mass-fresh)` : ''}`)
    if (plan.untouched) console.log(`untouched         ${plan.untouched}  (no record in the check)`)
    console.log(`fresh decision    ${decision.items.length} fresh, ${decision.unknown.length} live undetermined, judged at ${decision.fetchedAt?.toISOString() ?? '—'} — ${decision.complete ? 'COMPLETE' : 'NOT complete'}`)
    console.log(`coverage          ${decision.coverage}`)
    console.log(`mass-fresh        ${decision.counts.liveFresh}/${decision.counts.liveJudged} judged live rows fresh — ${decision.massFresh ? 'REFUSED' : 'ok'}`)
    if (decision.massFresh) {
      // Not a throw: the retirements are per-row badge evidence, mass-guarded below, and still apply.
      console.error(`⛔ FRESH SET, RE-DATE AND REVIVAL REFUSED: ${decision.massFresh}`)
      process.exitCode = COVERAGE_REFUSED
    }

    const refusal = massRetireRefusal(hide.length, plan.answered)
    if (refusal) throw new Error(refusal)
    const reviveRefusal = massReviveRefusal(revive.length, plan.reviveJudged)
    if (reviveRefusal && !FORCE_MASS_REVIVE) throw new Error(reviveRefusal)

    if (freshOut) {
      // ⛔ THE SET IS THE ONLY EVIDENCE THE EXPIRY ACTS ON: every row checked, ≥98% of the live ones judged
      // (or ≤ 5 undetermined), not mass-fresh, and the set passes the same validation the expiry will run on
      // it — or nothing is written, and the
      // run exits COVERAGE_REFUSED (3), the code every apartment source uses for "read the source, could not
      // prove coverage": the --save file is still whole per row, so its retirements and revivals (per-row
      // evidence, mass-guarded above — and no revival at all under mass-fresh) may be applied; only the
      // expiry must be skipped.
      const set = decision.fetchedAt ? makeFreshSet(SELLER_ID, decision.fetchedAt, decision.coverage, decision.items, decision.unknown) : null
      const why = records.length !== rows.length ? `${records.length} of ${rows.length} rows were checked`
        : decision.massFresh ? decision.massFresh
        : !decision.complete || !set ? `the check is not complete: ${decision.coverage}`
        : freshSetProblem(JSON.parse(JSON.stringify(set)), Date.now(), SELLER_ID)
      if (why || !set) {
        console.error(`⛔ FRESH SET NOT WRITTEN (${freshOut}): ${why}`)
        process.exitCode = COVERAGE_REFUSED
      } else {
        writeAtomically(freshOut, JSON.stringify(set, null, 1) + '\n')
        console.log(`fresh set         ${freshOut} (${set.items.length} items, ${set.unknown?.length ?? 0} undetermined)`)
      }
    }
    if (!APPLY) { console.log('\nDRY RUN — nothing hidden, revived or re-dated. Re-run with --src <status.jsonl> --journal-dir <durable dir> --apply.'); return }
    if (!hide.length && !revive.length && !repost.length) { console.log('\nnothing to hide, revive or re-date'); return }

    // ⛔ Checked BEFORE the first write (as expire-apartment-rentals.ts does): without the tag table a
    // retired page keeps rendering, and a revived one keeps its cached 404, for up to 30 days.
    const [{ t: isrTable }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
    if (!isrTable) throw new Error('no next_cache_tag table on this database — changed pages would keep their ISR copy for 30 days; refusing before any write')

    const now = Date.now()
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `rever-retired-rows-${stamp}.jsonl`)
    const ROLLBACK = join(journalDir!, `rever-retired-rows-${stamp}.rollback.sql`)
    const FRESH_JOURNAL = join(journalDir!, `rever-fresh-rows-${stamp}.jsonl`)
    const FRESH_ROLLBACK = join(journalDir!, `rever-fresh-rows-${stamp}.rollback.sql`)
    console.log(`retire journal    ${JOURNAL}\nrollback          ${ROLLBACK}\nfresh journal     ${FRESH_JOURNAL}\nrollback          ${FRESH_ROLLBACK}`)
    const lit = sqlLiteral
    const SELLER = lit(SELLER_ID)
    const ts = (d: Date) => lit(d.toISOString())

    // EVERY WRITE, IN THE SAME ORDER: journal the PLANNED change (fsync) → the conditional write → only if
    // it moved the row, its rollback line (guarded on the state the write created, carrying that page's
    // own ISR tombstone) → the tombstone for that page, AS IT LANDS. An id whose write landed but whose
    // tombstone did not is still in `untombstoned` when anything throws, and the finally writes it then.
    const untombstoned = new Set<string>()
    const tombstone = async (ids: string[]) => {
      const r = await tombstonePdps(db, ids)
      if (r.startsWith('SKIPPED')) throw new Error(`ISR tombstone ${r}`)
      for (const id of ids) untombstoned.delete(id)
    }
    const retiredIds: string[] = []
    const revivedIds: string[] = []
    let redated = 0
    try {
      for (const h of hide) {
        const r = h.row
        recordDurably(JOURNAL, JSON.stringify({ action: 'retire', id: r.id, externalId: r.externalId, oldStatus: r.status, url: h.url, verdict: h.verdict, at: new Date().toISOString() }))
        // Tombstone BEFORE the write as well as after (as the expiry does): re-rendering a still-live page is
        // harmless, and a process killed between the write and the second tombstone has invalidated it already.
        await tombstonePdps(db, [r.id])
        // The URL is part of the condition: a row repointed after the check is not judged by the old verdict (codex).
        const res = await db.listing.updateManyAndReturn({
          where: { id: r.id, sellerId: SELLER_ID, status: 'active', subcategorySlug: APARTMENT_SUBCAT, affiliateUrl: h.url },
          data: { status: 'stale' },
          select: { id: true, updatedAt: true },
        })
        if (res.length !== 1) continue
        untombstoned.add(r.id)
        retiredIds.push(r.id)
        // "updatedAt" ≤ this write's: a row retired, revived and retired AGAIN is not flipped back by this file.
        recordDurably(ROLLBACK, `UPDATE "Listing" SET status='active' WHERE id=${lit(r.id)} AND "sellerId"=${SELLER} AND status='stale' AND ${updatedAtGuardSql(res[0].updatedAt)};\n${isrTombstoneSql([r.id])}`)
        await tombstone([r.id])
      }
      console.log(`hidden            ${retiredIds.length} of ${hide.length}`)

      // REVIVAL — a row Rever shows updated inside the window and available again. The write is conditional
      // on the row still holding the status and URL it was planned from, so a row a moderator touched
      // meanwhile (or one that went hidden/removed/sold) is never overridden by this check.
      for (const x of revive) {
        const r = x.row
        const newPostedAt = x.sourceDate
        const newRankScore = reverRepostRank(r, newPostedAt, now)
        recordDurably(FRESH_JOURNAL, JSON.stringify({
          action: 'revive', id: r.id, externalId: r.externalId, oldStatus: r.status, oldPostedAt: r.postedAt.toISOString(), oldRankScore: r.rankScore,
          newPostedAt: newPostedAt.toISOString(), newRankScore, url: x.url, at: new Date().toISOString(),
        }))
        await tombstonePdps(db, [r.id])
        const res = await db.listing.updateManyAndReturn({
          where: { id: r.id, sellerId: SELLER_ID, status: r.status, subcategorySlug: APARTMENT_SUBCAT, affiliateUrl: x.url },
          data: { status: 'active', postedAt: newPostedAt, rankScore: newRankScore },
          select: { id: true, updatedAt: true },
        })
        if (res.length !== 1) continue
        untombstoned.add(r.id)
        revivedIds.push(r.id)
        recordDurably(FRESH_ROLLBACK, `UPDATE "Listing" SET status=${lit(r.status)}, "postedAt"=${ts(r.postedAt)}, "rankScore"=${r.rankScore} WHERE id=${lit(r.id)} AND "sellerId"=${SELLER} AND status='active' AND "postedAt"=${ts(newPostedAt)} AND ${updatedAtGuardSql(res[0].updatedAt)};\n${isrTombstoneSql([r.id])}`)
        await tombstone([r.id])
      }
      console.log(`revived           ${revivedIds.length} of ${revive.length}${plan.reviveRefused ? ` (${plan.reviveRefused} refused: mass-fresh — exit ${COVERAGE_REFUSED})` : ''}`)

      // RE-DATE — live rows Rever shows updated after their postedAt: postedAt follows the source, so the
      // expiry's postedAt backstop never takes a row Rever keeps re-touching. Only ever moves FORWARD. The
      // PDP prints "Posted … ago" from postedAt, so the page is tombstoned too.
      for (const x of repost) {
        const r = x.row
        const newPostedAt = x.sourceDate
        const newRankScore = reverRepostRank(r, newPostedAt, now)
        recordDurably(FRESH_JOURNAL, JSON.stringify({
          action: 'redate', id: r.id, externalId: r.externalId, oldStatus: r.status, oldPostedAt: r.postedAt.toISOString(), oldRankScore: r.rankScore,
          newPostedAt: newPostedAt.toISOString(), newRankScore, url: x.url, at: new Date().toISOString(),
        }))
        const res = await db.listing.updateManyAndReturn({
          where: { id: r.id, sellerId: SELLER_ID, status: 'active', subcategorySlug: APARTMENT_SUBCAT, affiliateUrl: x.url, postedAt: { lt: newPostedAt } },
          data: { postedAt: newPostedAt, rankScore: newRankScore },
          select: { id: true, updatedAt: true },
        })
        if (res.length !== 1) continue
        untombstoned.add(r.id)
        redated++
        recordDurably(FRESH_ROLLBACK, `UPDATE "Listing" SET "postedAt"=${ts(r.postedAt)}, "rankScore"=${r.rankScore} WHERE id=${lit(r.id)} AND "sellerId"=${SELLER} AND status='active' AND "postedAt"=${ts(newPostedAt)} AND ${updatedAtGuardSql(res[0].updatedAt)};\n${isrTombstoneSql([r.id])}`)
        await tombstone([r.id])
      }
      console.log(`re-dated          ${redated} of ${repost.length}${plan.repostRefused ? ` (${plan.repostRefused} refused: mass-fresh — exit ${COVERAGE_REFUSED})` : ''}`)
    } finally {
      // A throw anywhere above (a DB error, a full disk) must not leave a page that already changed on its old ISR copy.
      if (untombstoned.size) {
        const ids = [...untombstoned]
        try { console.error(`ISR tombstones    after an interruption: ${await tombstonePdps(db, ids)}`) }
        catch (e) { console.error(`⛔ ISR tombstones NOT written for ${ids.length} changed rows (${e instanceof Error ? e.message : e}): ${ids.join(' ')} — run node scripts/purge-isr-listings.mjs`) }
      }
    }
    const changed = retiredIds.length + revivedIds.length + redated
    console.log(`ISR tombstones    ${changed ? `${changed} pages × en/vi, each as its write landed (retire/revive: before it too)` : 'none needed'}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
