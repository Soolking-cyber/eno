/**
 * THE ONE-OFF BACKFILL OF THE TEACHER ONBOARDING REDESIGN (owner, 2026-10-08; plan review D1/D4/D7/B8).
 *
 * Production holds TWO teacher profiles (one real teacher, one demo). The redesign keeps ONE data shape in the code
 * (`TeacherProfile.situationVersion`, NULL = not yet migrated) and NO runtime adapter for old rows, so the deploy order
 * is fixed:
 *
 *   1. node scripts/teachers-ddl.mjs                         (the new columns — additive; then scripts/rls-guard.sql)
 *   2. npx tsx scripts/teachers-backfill.ts                  DRY RUN (the default): per row, old → new, the judgement
 *                                                            calls, a hash; writes the reviewed PLAN file. Read-only.
 *   3. the owner reviews every row; re-run with --decide where the proposal is wrong:
 *        --decide <teacherProfileId>=city | abroad | none | elsewhere:<vn-units code>
 *   4. npx tsx scripts/teachers-backfill.ts --apply --plan <plan.json>
 *                                                            applies EXACTLY the reviewed plan — refusing any row whose
 *                                                            hash changed since (a save, the matcher, anything) — then
 *                                                            tombstones the ISR pages (listings + /c/teachers).
 *      ⛔ IT MUST END "NEXT: deploy" AND EXIT 0. Page tombstones that could not be written end it STOP, exit 1 (run
 *      --purge, then deploy — commit gate 2026-10-09). A refused row, or an unmigrated profile the plan does not carry (made
 *      after the dry run), ends it with STOP and exit code 1 (gate review, 2026-10-09): the new code has no adapter for
 *      an unmigrated row, so the deploy waits — dry run again, review, --apply the new plan.
 *   5. deploy (the owner's word); then: npx tsx scripts/teachers-backfill.ts --purge
 *      (the deploy changed how the pages render — tombstone them again) and Cloudflare purge_everything on BOTH zones.
 *   6. re-run the dry run: it must say "nothing to migrate" (a profile the old code created in between is listed).
 *
 *   set -a; . ./.env; set +a   (DIRECT_URL — the BUILD's env, never verify:local's)
 *
 * ⛔ NEVER REWRITES AN EXISTING VALUE (D4): it fills only the new TeacherProfile columns — livesIn, currentProvince,
 * currentDistrictKey, teachAreas, teachLanguages, englishLevel, experienceBand, situationVersion — on a row whose
 * situationVersion is still NULL, and re-projects the Listing's city, district, location, facetTokens and searchText
 * through the SAME builders a save uses (src/lib/teachers/projection.ts). Never status, verified, consent, cover, video
 * or price; the old columns stay exactly as stored, so the old code keeps working until the deploy.
 * ⛔ ONE ROW, ONE TRANSACTION, under the per-account advisory lock every teacher save takes (publish.ts), re-read and
 * re-hashed under it. A journal of every row's old Listing values is written (and fsynced) BEFORE the commit:
 *   rollback = set the eight new columns back to NULL / '{}' and restore the Listing columns from the journal.
 * ⚠️ Accepted residual: a teacher who saves through the OLD code between --apply and the deploy writes the old columns
 * only, and the new code then reads the backfilled answers. With two rows and minutes between the steps, the runbook
 * keeps that window short; the teacher's next save in the new form repairs it.
 */
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import {
  planTeacherBackfill, proposeBackfillDecision, stableStringify, type BackfillDecision, type BackfillPlan, type TeacherRow,
} from '../src/lib/teachers/projection'
import { HCMC_DISTRICT_KEYS, LIVES_IN, isPickableProvince, type LivesIn } from '../src/lib/teachers/places'
import { TEACHERS_CATEGORY_SLUG } from '../src/lib/teachers/constants'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const PURGE = argv.includes('--purge')
const arg = (k: string) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const JOURNAL_DIR = join(homedir(), 'eno-import-journals', 'teachers-backfill')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

/** `--decide <id>=city|abroad|none|elsewhere:<code>` — the owner's answer to "Where are you now?" for one old row. */
function decisionsFromArgs(): Map<string, BackfillDecision> {
  const out = new Map<string, BackfillDecision>()
  argv.forEach((a, i) => {
    if (a !== '--decide') return
    const m = /^([^=\s]+)=(city|abroad|none|elsewhere:(\d{2}))$/.exec(argv[i + 1] ?? '')
    if (!m) throw new Error(`--decide wants <teacherProfileId>=city|abroad|none|elsewhere:<code>, got "${argv[i + 1] ?? ''}"`)
    if (m[3] && !isPickableProvince(m[3])) throw new Error(`elsewhere:${m[3]} is not one of the 27 "somewhere else" provinces (places.ts PROVINCE_PLACES)`)
    const livesIn = m[2] === 'none' ? null : (m[2].split(':')[0] as LivesIn)
    out.set(m[1], { livesIn, ...(m[3] ? { currentProvince: m[3] } : {}) })
  })
  return out
}

/** The hash the owner reviews and --apply re-checks: every column of the row and its Listing, the decision and the plan. */
export const hashOf = (row: TeacherRow, listing: unknown, decision: BackfillDecision, plan: BackfillPlan) =>
  `sha256:${createHash('sha256').update(stableStringify({ row, listing, decision, plan })).digest('hex')}`

const LISTING_COLUMNS = ['id', 'city', 'district', 'location', 'facetTokens', 'searchText', 'status', 'verified'] as const
type ListingRow = { [K in (typeof LISTING_COLUMNS)[number]]: unknown }

/** The Postgres client as this script uses it — `pg.Client` when run, a fake in the unit test (backfill.test.ts). */
export type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }

async function readRow(c: Db, where: string, params: unknown[], lock = false): Promise<{ row: TeacherRow; listing: ListingRow | null }[]> {
  const rows = (await c.query(`select * from "TeacherProfile" where ${where} order by "createdAt"${lock ? ' for update' : ''}`, params)).rows as TeacherRow[]
  const out: { row: TeacherRow; listing: ListingRow | null }[] = []
  for (const row of rows) {
    const l = row.listingId
      ? ((await c.query(`select ${LISTING_COLUMNS.map((k) => `"${k}"`).join(', ')} from "Listing" where id = $1${lock ? ' for update' : ''}`, [row.listingId])).rows[0] as ListingRow | undefined) ?? null
      : null
    out.push({ row, listing: l })
  }
  return out
}

/** ISR tombstones — the importers' SQL (cache-handler.cjs reads them; DB clock; greatest() never moves one back). */
async function tombstone(c: Db, listingIds: string[]): Promise<string> {
  const langs = ['en', 'vi'] // src/lib/lang-variant.ts LANG_VARIANTS
  const tags = [
    // each listing page, both languages (src/lib/job-listing.ts pdpTombstoneTags)
    ...listingIds.flatMap((id) => langs.map((l) => `eno:isrtag:_N_T_/${l}/listings/${id}`)),
    // the category and its district pages — a teacher's district and location show there (D7)
    ...langs.map((l) => `eno:isrtag:_N_T_/${l}/c/${TEACHERS_CATEGORY_SLUG}`),
    ...HCMC_DISTRICT_KEYS.flatMap((d) => langs.map((l) => `eno:isrtag:_N_T_/${l}/c/${TEACHERS_CATEGORY_SLUG}/${d}`)),
  ]
  const { rows } = await c.query(`select to_regclass('public.next_cache_tag')::text as t`)
  if (!rows[0].t) return `SKIPPED: no next_cache_tag table in this database (${tags.length} tags not written)`
  await c.query(
    `insert into next_cache_tag (tag, stamp, expires_at)
     select t, (extract(epoch from clock_timestamp()) * 1000)::bigint, now() + interval '40 days' from unnest($1::text[]) as t
     on conflict (tag) do update set
       stamp = greatest(next_cache_tag.stamp, excluded.stamp),
       expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
    [tags],
  )
  return `${tags.length} tags tombstoned (effective where the app reads tombstones: ENO_ISR_PG=1, see scripts/purge-isr-listings.mjs)`
}

const show = (v: unknown) => (v === null || v === undefined ? 'NULL' : Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v))
const tokenSet = (t: unknown) => new Set(typeof t === 'string' ? t.split('|').filter(Boolean) : [])

function printRow(row: TeacherRow, listing: ListingRow | null, decision: BackfillDecision, proposed: boolean, plan: BackfillPlan, hash: string) {
  console.log(`\n── ${row.id}  (${row.fullName}; listing ${listing ? `${listing.id}, ${listing.status}${listing.verified ? '' : ', NOT verified'}` : 'none'}) ──`)
  console.log(`  decision    livesIn ${show(decision.livesIn)}${decision.currentProvince ? ` (province ${decision.currentProvince})` : ''}${proposed ? '   ← PROPOSED, confirm or --decide' : '   ← decided'}`)
  const p = plan.profile
  console.log('  new columns (the old ones stay exactly as stored):')
  console.log(`    teachAreas          ${show(row.teachAreas)} → ${show(p.teachAreas)}     (old preferredCities ${show(row.preferredCities)}, openToOnline ${show(row.openToOnline)}, coverOpen ${show(row.coverOpen)}, coverAreas ${show(row.coverAreas)}, jobTypes ${show(row.jobTypes)})`)
  console.log(`    livesIn             ${show(row.livesIn)} → ${show(p.livesIn)}     (old currentCity ${show(row.currentCity)})`)
  console.log(`    currentProvince     ${show(row.currentProvince)} → ${show(p.currentProvince)}`)
  console.log(`    currentDistrictKey  ${show(row.currentDistrictKey)} → ${show(p.currentDistrictKey)}     (old currentDistrict ${show(row.currentDistrict)})`)
  console.log(`    englishLevel        ${show(row.englishLevel)} → ${show(p.englishLevel)}     (old nativeSpeaker ${show(row.nativeSpeaker)})`)
  console.log(`    experienceBand      ${show(row.experienceBand)} → ${show(p.experienceBand)}     (old yearsExperience ${show(row.yearsExperience)})`)
  console.log(`    teachLanguages      ${show(row.teachLanguages)} → ${show(p.teachLanguages)}     (subjects ${show(row.subjects)}; languages kept: ${show(row.languages)}; ageGroups kept: ${show(row.ageGroups)})`)
  console.log(`    situationVersion    ${show(row.situationVersion)} → ${p.situationVersion}`)
  if (listing && plan.listing) {
    console.log('  listing (re-projected — never status / verified):')
    for (const k of ['city', 'district', 'location'] as const) console.log(`    ${k.padEnd(18)}  ${show(listing[k])} → ${show(plan.listing[k])}`)
    const before = tokenSet(listing.facetTokens)
    const after = tokenSet(plan.listing.facetTokens)
    console.log(`    facetTokens  - ${[...before].filter((x) => !after.has(x)).join(' ') || '(none)'}`)
    console.log(`                 + ${[...after].filter((x) => !before.has(x)).join(' ') || '(none)'}`)
    const wb = new Set(String(listing.searchText ?? '').split(' '))
    const wa = new Set(plan.listing.searchText.split(' '))
    console.log(`    searchText   - ${[...wb].filter((w) => !wa.has(w)).join(' ') || '(none)'}`)
    console.log(`                 + ${[...wa].filter((w) => !wb.has(w)).join(' ') || '(none)'}`)
  }
  for (const f of plan.flags) console.log(`  ⚠ ${f}`)
  console.log(`  hash        ${hash}`)
}

export type PlanFile = { generatedAt: string; rows: { id: string; profileId: string; decision: BackfillDecision; hash: string; plan: BackfillPlan }[] }

/** The apply's journal: one line per row, flushed to disk BEFORE that row's commit. */
export type Journal = { append(entry: Record<string, unknown>): void; close(): void }
const fileJournal = (path: string): Journal => {
  const fd = openSync(path, 'wx')
  let open = true
  return {
    append: (entry) => { writeSync(fd, `${JSON.stringify(entry)}\n`); fsyncSync(fd) },
    close: () => { if (open) { open = false; closeSync(fd) } },
  }
}

/**
 * --apply: EXACTLY the reviewed plan, one row per transaction. Returns the exit code — 0 only when every unmigrated
 * profile is migrated now; the lines it prints end with the runbook's next step.
 * ⛔ FAILS CLOSED (gate review, 2026-10-09). A row whose hash moved since the dry run is refused — and the run then ENDS
 * WITH STOP AND EXIT 1, never "NEXT: deploy": it used to log the refusal, carry on, exit 0 and print the deploy step, and
 * the new code (no adapter for an unmigrated row) would have gone live over that teacher. The same STOP when an
 * unmigrated profile is still there that the plan does not carry (made after the dry run).
 * ⛔ THE ROWS ALREADY COMMITTED ARE TOMBSTONED WHATEVER HAPPENS NEXT (`finally`): a failure on row N used to skip the
 * tombstones of rows 1…N-1, whose pages then kept their stale ISR copies, and a re-run cannot see them (they are
 * migrated). The journal is closed there too.
 */
export async function applyReviewedPlan(
  c: Db, reviewed: PlanFile, category: { name: string; nameVi: string | null }, journal: Journal, log: (line: string) => void = console.log,
): Promise<number> {
  const listings: string[] = []
  const refused: string[] = []
  let tombstoneFailed = false
  let applied = 0
  let skipped = 0
  try {
    for (const r of reviewed.rows) {
      await c.query('begin')
      try {
        await c.query(`set local lock_timeout = '5s'`)
        // The same lock every teacher save takes (publish.ts: hashtext('teacher:' + profileId)) — then re-read under it.
        await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`teacher:${r.profileId}`])
        const [cur] = await readRow(c, `id = $1 and "situationVersion" is null`, [r.id], true)
        if (!cur) { await c.query('rollback'); skipped++; log(`skip ${r.id}: already migrated, or gone`); continue }
        const plan = planTeacherBackfill(cur.row, category, r.decision, !!cur.listing)
        const hash = hashOf(cur.row, cur.listing, r.decision, plan)
        if (hash !== r.hash) { await c.query('rollback'); refused.push(r.id); log(`REFUSED ${r.id}: the row changed since the reviewed dry run (${r.hash} → ${hash})`); continue }
        // The journal FIRST, fsynced: the old Listing values and the new columns, so a rollback has everything it needs.
        journal.append({ id: r.id, at: new Date().toISOString(), hash, listingBefore: cur.listing, profileAfter: plan.profile, listingAfter: plan.listing })
        const p = plan.profile
        const u = await c.query(
          `update "TeacherProfile" set "livesIn" = $2, "currentProvince" = $3, "currentDistrictKey" = $4, "teachAreas" = $5::text[],
             "teachLanguages" = $6::text[], "englishLevel" = $7, "experienceBand" = $8, "situationVersion" = $9
           where id = $1 and "situationVersion" is null`,
          [r.id, p.livesIn, p.currentProvince, p.currentDistrictKey, p.teachAreas, p.teachLanguages, p.englishLevel, p.experienceBand, p.situationVersion],
        )
        if (u.rowCount !== 1) throw new Error(`${r.id}: profile update touched ${u.rowCount} rows`)
        if (cur.listing && plan.listing) {
          const l = await c.query(
            `update "Listing" set city = $2, district = $3, location = $4, "facetTokens" = $5, "searchText" = $6 where id = $1`,
            [cur.listing.id, plan.listing.city, plan.listing.district, plan.listing.location, plan.listing.facetTokens, plan.listing.searchText],
          )
          if (l.rowCount !== 1) throw new Error(`${r.id}: listing update touched ${l.rowCount} rows`)
        }
        await c.query('commit')
        applied++
        if (cur.listing) listings.push(String(cur.listing.id))
        log(`applied ${r.id}`)
      } catch (e) {
        await c.query('rollback').catch(() => {})
        throw e
      }
    }
  } finally {
    journal.close()
    if (listings.length) {
      try {
        log(await tombstone(c, listings))
      } catch (e) {
        tombstoneFailed = true
        log(`⚠ the ISR tombstones of ${listings.length} migrated listing(s) were NOT written (${e instanceof Error ? e.message : String(e)}) — run --purge before anything else`)
      }
    }
  }
  // Every unmigrated profile now — a refused one, and any the old code made after the dry run (not in the plan).
  const left = (await c.query(`select id from "TeacherProfile" where "situationVersion" is null order by "createdAt"`)).rows.map((x) => String(x.id))
  const unplanned = left.filter((id) => !refused.includes(id))
  log(`${applied} applied · ${skipped} skipped (already migrated, or gone) · ${refused.length} refused · ${unplanned.length} unmigrated and not in the plan`)
  if (refused.length || left.length) {
    log(`STOP — do NOT deploy. Unmigrated: ${left.join(', ')}${refused.length ? ` (refused: ${refused.join(', ')})` : ''}.`)
    log('The new code has no adapter for an unmigrated row: run the dry run again, review those rows, then --apply the new plan.')
    return 1
  }
  // ⛔ NOT "NEXT: deploy" WHEN THE TOMBSTONES FAILED (commit gate, 2026-10-09 — codex): the rows are migrated, but their
  // pages keep the ISR copies the old projection rendered, and the runbook reads exit 0 as "go".
  if (tombstoneFailed) {
    log('STOP — the rows are migrated, but their page tombstones were NOT written: run --purge first (it tombstones every teacher page), then deploy.')
    return 1
  }
  log('NEXT: deploy on the owner\'s word; then --purge, Cloudflare purge_everything on BOTH zones, and the dry run again.')
  return 0
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) { console.error('Set DIRECT_URL (the build env; see the header).'); process.exit(1) }
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const cat = (await c.query(`select name, "nameVi" from "Category" where slug = $1`, [TEACHERS_CATEGORY_SLUG])).rows[0]
    if (!cat) throw new Error('teachers category row missing')
    const category = { name: cat.name as string, nameVi: (cat.nameVi as string | null) ?? null }

    if (PURGE) {
      // After the deploy: every teacher page renders with the new code — tombstone them all again.
      const ids = (await c.query(`select "listingId" from "TeacherProfile" where "listingId" is not null`)).rows.map((r) => r.listingId as string)
      console.log(await tombstone(c, ids))
      console.log('NEXT: Cloudflare purge_everything on BOTH zones (eno.vn and eno.forum share the rows).')
      return
    }

    if (!APPLY) {
      // ── DRY RUN: read-only by construction ──
      await c.query('begin read only')
      const decisions = decisionsFromArgs()
      const todo = await readRow(c, `"situationVersion" is null`, [])
      const done = (await c.query(`select count(*)::int as n from "TeacherProfile" where "situationVersion" is not null`)).rows[0].n as number
      const file: PlanFile = { generatedAt: new Date().toISOString(), rows: [] }
      for (const { row, listing } of todo) {
        const explicit = decisions.get(String(row.id))
        const decision = explicit ?? proposeBackfillDecision(row)
        const plan = planTeacherBackfill(row, category, decision, !!listing)
        const hash = hashOf(row, listing, decision, plan)
        printRow(row, listing, decision, !explicit, plan, hash)
        file.rows.push({ id: String(row.id), profileId: String(row.profileId), decision, hash, plan })
      }
      for (const id of decisions.keys()) if (!todo.some((x) => x.row.id === id)) console.log(`\n⚠ --decide ${id}: no unmigrated profile with that id`)
      await c.query('rollback')
      console.log(`\n${todo.length} to migrate · ${done} already migrated (skipped — this script never rewrites a migrated row)`)
      if (!todo.length) { console.log('nothing to migrate'); return }
      const out = arg('--out') ?? join(JOURNAL_DIR, `plan-${stamp}.json`)
      mkdirSync(dirname(out), { recursive: true })
      const fd = openSync(out, 'wx')
      writeSync(fd, JSON.stringify(file, null, 1)); fsyncSync(fd); closeSync(fd)
      console.log(`plan written: ${out}\nReview EVERY row above (the ⚠ lines are judgement calls). Then: npx tsx scripts/teachers-backfill.ts --apply --plan ${out}`)
      return
    }

    // ── APPLY: exactly the reviewed plan ──
    if (argv.includes('--decide')) throw new Error('--apply takes its decisions from the reviewed plan file — re-run the dry run with --decide instead')
    const planPath = arg('--plan')
    if (!planPath) throw new Error('--apply needs --plan <the plan file the dry run wrote>')
    const reviewed = JSON.parse(readFileSync(planPath, 'utf8')) as PlanFile
    for (const r of reviewed.rows) {
      if (r.decision.livesIn !== null && !(LIVES_IN as readonly string[]).includes(r.decision.livesIn)) throw new Error(`${r.id}: bad decision in the plan file`)
    }
    const journalPath = join(JOURNAL_DIR, `apply-${stamp}.jsonl`)
    mkdirSync(JOURNAL_DIR, { recursive: true })
    console.log(`journal: ${journalPath}`)
    // Exit code 1 unless every unmigrated profile is migrated now — the deploy step reads it (applyReviewedPlan).
    process.exitCode = await applyReviewedPlan(c, reviewed, category, fileJournal(journalPath))
  } finally {
    await c.end()
  }
}

// Imported by the unit test (src/lib/teachers/backfill.test.ts); only a direct run touches the database.
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
