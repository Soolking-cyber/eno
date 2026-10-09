/**
 * The eno.vn half of the LOCAL teacher matcher (2026-09-30), run since 2026-10-08 by the owner's daily /teachers skill
 * through ~/eno-lead-pipeline scripts/teachers-daily.sh — a DRY RUN first, the owner approves the plan, then apply, then
 * the send (scripts/teachers-send.sh starts the box's email unit). Every stdout line below is parsed by the pipeline
 * (src/teachers/runFiles.ts), which fails CLOSED on any other shape — the builders live in src/lib/teachers/match-io.ts
 * and match-emails.ts, where match-io.test.ts / match-emails.test.ts pin them:
 *
 *   set -a; . ./.env; set +a                    # in a subshell — the scripts never source .env into your shell
 *   npx tsx scripts/teachers-match.ts check
 *       → "check: schema ok" · exit 3 schema drift (P2022 / 42703 — prod needs scripts/teachers-ddl.mjs) · exit 4 unreachable
 *   npx tsx scripts/teachers-match.ts export --out <run>/input.json
 *       → ONE JSON line: {"export":{"teachers","jobs"},"byConsent":{"current","otherVersion","none"},"consentVersion","consentRule"}
 *   (cd ~/eno-lead-pipeline && node src/cli/teachersMatch.ts --no-leads --in <run>/input.json --out <run>/output.json …)
 *        # the judge: Claude Haiku 5.5 (Anthropic) at medium effort, through the owner's Claude subscription
 *   npx tsx scripts/teachers-match.ts import --src <run>/output.json --csv-dir ~/eno-teacher-matches --plan-out <run>/import-plan.json
 *       → the DRY RUN: the plan file {import, byConsent, csvRows, email:{rules,teachers,…}, purge, sample}; nothing written
 *   npx tsx scripts/teachers-match.ts import --src <run>/output.json --csv-dir ~/eno-teacher-matches --run-id <planId> --apply
 *       → "import: …", "staff list: N rows → <file>", and ONE JSON line {applied, import, byConsent, csv, purge}
 *   npx tsx scripts/teachers-match.ts email-plan
 *       → ONE JSON line {rules, teachers, jobs, …}: what the send would mail now — the cron's own rule
 *
 * ⛔ ONLY TEACHERS OPTED IN UNDER THE CURRENT AI NOTICE (src/lib/teachers/profile.ts aiMatchConsented — plan review D5/E1)
 * are exported, written back or put on the staff list; consent and liveness are re-checked at write time.
 * ⛔ THE EXPORT CARRIES NO NAME AND NO CONTACT DATA: phone, email, photo, video and CV are never selected for it, and the
 * name only to take its words out of the free text (match-io.ts toMatchTeacher) — none of it reaches the AI judge.
 * Phone/email appear ONLY in the local staff CSV, and only for teachers who allowed staff calls under the current notice.
 * ⛔ ONLY CLAUDE HAIKU 5.5 VERDICTS LAND: an output with any pair not judged by it under the v2 prompt is refused whole
 * (exit 3) — an old-wrapper output (Gemini via agy, the Opus fallback) never reaches the database.
 * ⛔ The CSV is personal data: it stays on this machine (never a shared sheet). Files older than 90 days are deleted by
 * the import, and so are match rows about FB leads and the reject samples — and, at any age, every row of a teacher
 * whose two opt-ins are both off (VN PDP Law 91/2025 — keep only what the purpose needs; match-io.ts retentionWheres).
 * ⛔ THE CSV IS WRITTEN AS `<file>.pending` BEFORE THE DATABASE WRITE AND RENAMED AFTER IT COMMITS (match-io.ts
 * withStaffList): never lost to a crash after the commit, never a list that looks applied when the write failed.
 * ⛔ ONLY LIVE TEACHING JOBS (match-io.ts TEACHING_JOB_WHERE) are exported, and the import re-applies the same set: a
 * pair naming any other listing is never written.
 * ⚠️ stdout carries ONLY the lines above (never console.log — match-io.test.ts holds this file to it); diagnostics go to
 * stderr. Exit: 0 ok · 1 a failure · 3 refused (schema drift; an output not judged by Claude Haiku 5.5 v2) · 4 the
 * database is unreachable (the tunnel).
 */
import { config } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  EXISTING_MATCH_SELECT, EXPORT_JOB_SELECT, EXPORT_TEACHER_SELECT, IMPORT_LISTING_SELECT, IMPORT_TEACHER_SELECT, JUDGE_MODEL,
  JUDGE_PROMPT_VERSION, MATCH_CHECK_SELECT, MATCH_RETENTION_DAYS, STAFF_LIST_FILE, TEACHING_JOB_WHERE, applyOutputLines,
  buildMatchExport, checkFailure, csvCell, importPlanDoc, parseMatchOutput, planMatchImport, retentionWheres, staffListLine,
  withStaffList,
} from '../src/lib/teachers/match-io'
import { MATCH_EMAIL_RULES, emailPlanLine, loadCooling, loadPendingMatchRows, planMatchEmails } from '../src/lib/teachers/match-emails'

// ⚠️ QUIET: dotenv 17 prints "injected env…" to STDOUT, which the pipeline would have to skip.
config({ quiet: true })

const argv = process.argv
const cmd = argv[2]
const arg = (k: string) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const APPLY = argv.includes('--apply')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })
const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/\/+$/, '')

/** A refusal with its exit code: 3 = a precondition (schema drift, a foreign judge), 4 = the database is unreachable. */
class Refusal extends Error {
  constructor(message: string, readonly exit: 3 | 4) { super(message) }
}
const out = (line: string) => { process.stdout.write(`${line}\n`) }
/** Today in Vietnam — the pipeline's day folders and the CSV name use the same calendar. */
const vnDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
/** The live-teacher population every count and export reads: a live profile with a live, verified listing. */
const liveTeacher = () => ({ status: 'live', listing: { status: 'active', verified: true } })

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function doExport() {
  const outFile = arg('--out')
  if (!outFile) throw new Error('--out <file> is required')
  const [opted, notOptedIn, jobs] = await Promise.all([
    // ⛔ No phone, email, photo, video or CV column — the name ONLY for toMatchTeacher to take it out of the free text.
    db.teacherProfile.findMany({
      where: { ...liveTeacher(), OR: [{ matchEmailOptIn: true }, { staffContactOptIn: true }] },
      select: EXPORT_TEACHER_SELECT,
      orderBy: { id: 'asc' },
    }),
    // The rest of the live teachers are COUNTED for the declaration, never read.
    db.teacherProfile.count({ where: { ...liveTeacher(), matchEmailOptIn: false, staffContactOptIn: false } }),
    db.listing.findMany({
      // THE job set (listingType 'job': a teacher's "wanted" post in the jobs category is not a job) — the import and the
      // email rule re-apply the same where.
      where: TEACHING_JOB_WHERE,
      select: EXPORT_JOB_SELECT,
      orderBy: { postedAt: 'desc' },
      take: 2000,
    }),
  ])
  // ⛔ THE GATE (profile.ts aiMatchConsented) is applied inside: only `current` teachers reach the file.
  const { input, declaration } = buildMatchExport({ opted, notOptedIn, jobs, origin: APP, generatedAt: new Date() })
  // Bios are personal data: 0600, like everything else in the plan folder.
  writeFileSync(outFile, JSON.stringify(input, null, 1), { mode: 0o600 })
  console.error(`export: ${declaration.export.teachers} teachers × ${declaration.export.jobs} teaching jobs → ${outFile}`)
  out(JSON.stringify(declaration))
}

// ── import ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function doImport() {
  const src = arg('--src')
  const csvDir = arg('--csv-dir')
  const planOut = arg('--plan-out')
  const runId = arg('--run-id')
  if (!src || !csvDir) throw new Error('--src <file> and --csv-dir <dir> are required')
  if (runId && !/^[A-Za-z0-9_-]{1,64}$/.test(runId)) throw new Error('--run-id takes letters, digits, - and _ only')
  const output = parseMatchOutput(JSON.parse(readFileSync(src, 'utf8')))
  const pairs = output.pairs.filter((p) => p.teacherProfileId)
  const listingIds = [...new Set(pairs.map((p) => p.listingId))]
  const teacherIds = [...new Set(pairs.map((p) => p.teacherProfileId!))]
  const [listings, teachers, existing] = await Promise.all([
    // ⛔ The export's job set, re-applied (gate review, 2026-10-08): a pair naming any other listing is never written —
    // planMatchImport checks the rows again (isTeachingJob).
    db.listing.findMany({ where: { id: { in: listingIds }, ...TEACHING_JOB_WHERE }, select: IMPORT_LISTING_SELECT }),
    db.teacherProfile.findMany({ where: { id: { in: teacherIds }, ...liveTeacher() }, select: IMPORT_TEACHER_SELECT }),
    teacherIds.length
      ? db.teacherJobMatch.findMany({ where: { teacherProfileId: { in: teacherIds }, listingId: { in: listingIds } }, select: EXISTING_MATCH_SELECT })
      : Promise.resolve([]),
  ])
  const now = new Date()
  const plan = planMatchImport({ output, listings, teachers, existing, now, origin: APP })
  // ⛔ ONLY CLAUDE HAIKU 5.5 UNDER THE v2 PROMPT LANDS — the whole output is refused otherwise, nothing is written.
  if (plan.foreign) throw new Refusal(`import: ${plan.foreign} of ${output.pairs.length} pairs were not judged by ${JUDGE_MODEL} under ${JUDGE_PROMPT_VERSION} — refusing the output`, 3)
  // What the retention deletes (match-io.ts retentionWheres): counted in the plan the owner approves, deleted on --apply.
  const R = retentionWheres(now, MATCH_EMAIL_RULES.cooldownMs)

  if (!APPLY) {
    if (planOut) {
      // What the send would mail after this apply: the matches already waiting plus this run's new ones (email consent
      // under the current notice), through the cron's own rule — the cooldown read first, as the cron reads it.
      const cooling = await loadCooling(db, now.getTime())
      const email = planMatchEmails([...(await loadPendingMatchRows(db, now.getTime(), cooling)), ...plan.newEmailRows], cooling)
      const purge = {
        leadRows: await db.teacherJobMatch.count({ where: R.leadRows }),
        rejectSamples: await db.teacherJobMatch.count({ where: R.rejectSamples }),
        withdrawn: await db.teacherJobMatch.count({ where: R.withdrawn }),
      }
      writeFileSync(planOut, JSON.stringify(importPlanDoc(plan, email, purge), null, 1), { mode: 0o600 })
    }
    const s = plan.summary
    out(`import: ${s.pairs} pairs, ${s.stillLive} still live and consented, ${s.new} new (${s.newMatches} matches) — DRY RUN, pass --apply`)
    return
  }

  // ⛔ THE STAFF LIST IS WRITTEN FIRST — once the rows are saved, a re-run sees every pair as known and would never
  // produce that day's list again (Opus, commit gate 09-30) — BUT AS `.pending`, renamed only after the transaction below
  // commits (withStaffList; gate review, 2026-10-08 — codex): a failed write never leaves a list that looks applied.
  mkdirSync(csvDir, { recursive: true, mode: 0o700 })
  let csv: { file: string; rows: number } | null = null
  let list: { file: string; body: string | null } | null = null
  if (plan.staffRows.length) {
    const header = ['date', 'score', 'who', 'teacher_name', 'teacher_phone', 'teacher_email', 'teacher_profile', 'staff_may_call',
      'job_title', 'job_city', 'job_link', 'employer', 'employer_phone', 'apply_at_source', 'reasons', 'concerns', 'staff_status', 'staff_notes']
    const rows = plan.staffRows.map((p) => {
      const l = plan.listingOf(p)
      const t = plan.teacherOf(p)
      return [
        vnDay(now), Math.round(p.score), 'eno teacher', t.fullName, t.private?.phone ?? '', t.private?.email ?? '',
        t.listingId ? `${APP}/listings/${t.listingId}` : '', 'yes',
        l.title, l.city, `${APP}/listings/${l.id}`, l.seller.name,
        // A school's own post: its storefront number (staff call the school). A linked posting: none — apply at source.
        l.affiliateUrl ? '' : l.seller.phone ?? '', l.affiliateUrl ?? '',
        p.reasons.join(' · '), p.concerns.join(' · '), '', '',
      ].map(csvCell).join(',')
    })
    // Named by the run and OVERWRITTEN: re-applying a plan never adds a second copy of the day's list, and a run with no
    // staff rows writes no file at all (so it can never replace a list with an empty one).
    const file = join(csvDir, `teacher-matches-${vnDay(now)}-${runId ?? now.getTime()}.csv`)
    list = { file, body: [header.map(csvCell).join(','), ...rows].join('\n') + '\n' }
    csv = { file, rows: rows.length }
  } else if (runId) {
    // No new staff rows — but a re-applied run may find its own `.pending` (withStaffList promotes it after the commit).
    const file = join(csvDir, `teacher-matches-${vnDay(now)}-${runId}.csv`)
    if (existsSync(`${file}.pending`)) {
      list = { file, body: null }
      csv = { file, rows: Math.max(0, readFileSync(`${file}.pending`, 'utf8').trim().split('\n').length - 1) }
    }
  }

  try {
    await withStaffList(
      list,
      { write: (f, body) => writeFileSync(f, body, { mode: 0o600 }), rename: (from, to) => renameSync(from, to), exists: (f) => existsSync(f) },
      () => db.$transaction([
        // An unused pre-v2 verdict on a re-judged pair goes — guarded again, in case it was emailed or worked on since.
        db.teacherJobMatch.deleteMany({ where: { id: { in: plan.supersede }, emailedAt: null, staffStatus: null } }),
        // skipDuplicates: a pair is judged ONCE — a later run never rewrites its score, staff status or emailedAt.
        db.teacherJobMatch.createMany({
          data: plan.fresh.map((p) => ({
            teacherProfileId: p.teacherProfileId, leadId: null, listingId: p.listingId, score: Math.round(p.score),
            reasons: p.reasons, concerns: p.concerns, decision: p.decision, modelVersions: p.modelVersions,
          })),
          skipDuplicates: true,
        }),
      ]),
    )
  } catch (e) {
    // The list stays `.pending` — unconfirmed, never mistaken for an applied one; re-running the apply (the same --run-id)
    // overwrites it and renames it once the write commits.
    if (csv) console.error(`staff list NOT confirmed — ${csv.file}.pending: the apply stopped before its rename (error below)`)
    throw e
  }
  console.error(staffListLine(csv))
  // ONE statement: it does not bump @updatedAt (the pipeline's seen-cache key, the JSON-LD dateModified) and reads nothing
  // back (the 10-08 P2022 on videoOnRequest came from an update that returned the whole row).
  const touched = [...new Set(plan.fresh.map((p) => p.teacherProfileId))]
  if (touched.length) await db.$executeRaw`UPDATE "TeacherProfile" SET "lastMatchedAt" = ${now} WHERE "id" IN (${Prisma.join(touched)})`

  // Retention: personal data the purpose no longer needs is deleted, not archived — the AI's verdicts about FB users who
  // never signed up, the reject samples, everything about a teacher who switched both opt-ins off, and the staff lists
  // (an unconfirmed `.pending` one too).
  const purge = {
    leadRows: (await db.teacherJobMatch.deleteMany({ where: R.leadRows })).count,
    rejectSamples: (await db.teacherJobMatch.deleteMany({ where: R.rejectSamples })).count,
    withdrawn: (await db.teacherJobMatch.deleteMany({ where: R.withdrawn })).count,
    csvFiles: 0,
  }
  if (existsSync(csvDir)) {
    for (const f of readdirSync(csvDir)) {
      const full = join(csvDir, f)
      if (STAFF_LIST_FILE.test(f) && now.getTime() - statSync(full).mtimeMs > MATCH_RETENTION_DAYS * 86_400_000) { unlinkSync(full); purge.csvFiles++ }
    }
  }
  for (const line of applyOutputLines({ summary: plan.summary, byConsent: plan.byConsent, csv, purge })) out(line)
}

// ── email-plan ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Counts only: what the send would mail right now — the SAME functions the cron route calls. */
async function doEmailPlan() {
  const now = Date.now()
  const cooling = await loadCooling(db, now)
  out(JSON.stringify(emailPlanLine(planMatchEmails(await loadPendingMatchRows(db, now, cooling), cooling))))
}

// ── check ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The tunnel answers (select 1, within 15 s — else exit 4), then ONE read per model of every column the export, the
 * import, the email plan and the cron read or filter on (match-io.ts MATCH_CHECK_SELECT): the local Prisma client against
 * PRODUCTION, so a column this checkout has and prod lacks stops the run with exit 3 before anything is judged.
 */
async function doCheck() {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      db.$queryRaw`select 1`,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Refusal('check: no answer from the database within 15 s — the tunnel?', 4)), 15_000) }),
    ])
  } catch (e) {
    throw e instanceof Refusal ? e : new Refusal(`check: the database is unreachable (${checkFailure(e).code}) — the tunnel?`, 4)
  } finally {
    clearTimeout(timer)
  }
  const S = MATCH_CHECK_SELECT
  try {
    await db.teacherProfile.findFirst({ select: S.teacherProfile })
    await db.teacherPrivate.findFirst({ select: S.teacherPrivate })
    await db.teacherJobMatch.findFirst({ select: S.teacherJobMatch })
    await db.listing.findFirst({ select: S.listing })
    await db.category.findFirst({ select: S.category })
    await db.seller.findFirst({ select: S.seller })
    await db.profile.findFirst({ select: S.profile })
  } catch (e) {
    const f = checkFailure(e)
    throw new Refusal(f.exit === 3
      ? `check: schema drift (${f.code}) — production lacks a column this checkout reads: run scripts/teachers-ddl.mjs and scripts/rls-guard.sql there first (owner's word)`
      : `check: the database failed a read (${f.code}) — the tunnel?`, f.exit)
  }
  out('check: schema ok')
}

const COMMANDS: Record<string, () => Promise<void>> = { check: doCheck, export: doExport, import: doImport, 'email-plan': doEmailPlan }
const run = COMMANDS[cmd ?? '']
;(run ? run() : Promise.reject(new Error('usage: teachers-match.ts check | export --out <file> | import --src <file> --csv-dir <dir> [--plan-out <file>] [--run-id <id>] [--apply] | email-plan')))
  .catch((e) => {
    if (e instanceof Refusal) {
      console.error(e.message)
      // An unreachable database can hang a disconnect: leave at once.
      if (e.exit === 4) process.exit(4)
      process.exitCode = e.exit
      return
    }
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
