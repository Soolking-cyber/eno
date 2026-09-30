/**
 * The eno.vn half of the LOCAL teacher matcher (2026-09-30). Two steps around the pipeline's judge:
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/teachers-match.ts export --out ~/eno-lead-pipeline/data/teachers-match-input.json
 *   (cd ~/eno-lead-pipeline && node src/cli/teachersMatch.ts)          # Laya + Gemini 3.8 Flash via agy
 *   npx tsx scripts/teachers-match.ts import --src ~/eno-lead-pipeline/data/teachers-match-output.json \
 *       --csv-dir ~/eno-teacher-matches [--apply]
 *
 * ⛔ THE EXPORT CARRIES NO CONTACT DATA. Teacher phone/email never leave eno.vn's database for the
 * judge (and so never reach Gemini). They appear ONLY in the local staff CSV, and only for teachers
 * who ticked "our staff may call me" (staffContactOptIn) — the others are listed with their profile
 * link, which is public anyway.
 * ⛔ The CSV is personal data: it stays on this machine (never a shared sheet), and rows older than 90
 * days are deleted by the import (VN PDP Law 91/2025 — keep only what the purpose needs).
 */
import 'dotenv/config'
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  MATCH_IO_VERSION, csvCell, parseMatchOutput, provinceToCitySlug, type MatchInput, type MatchJob, type MatchTeacher,
} from '../src/lib/teachers/match-io'

const argv = process.argv
const cmd = argv[2]
const arg = (k: string) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const APPLY = argv.includes('--apply')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })
const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/\/+$/, '')
const CSV_RETENTION_DAYS = 90

async function doExport() {
  const out = arg('--out')
  if (!out) throw new Error('--out <file> is required')
  const teachers = await db.teacherProfile.findMany({
    where: { status: 'live', listing: { status: 'active', verified: true } },
    select: {
      id: true, updatedAt: true, headline: true, bio: true, nationality: true, nativeSpeaker: true, currentCity: true,
      preferredCities: true, openToOnline: true, subjects: true, ageGroups: true, jobTypes: true, yearsExperience: true,
      degreeLevel: true, degreeMajor: true, certificates: true, expectedSalaryM: true, availableFrom: true,
    },
  })
  const jobs = await db.listing.findMany({
    where: { status: 'active', verified: true, category: { slug: 'jobs' }, subcategorySlug: 'teaching' },
    select: { id: true, title: true, description: true, city: true, salaryM: true, attributes: true, affiliateUrl: true, postedAt: true },
    orderBy: { postedAt: 'desc' },
    take: 2000,
  })
  const input: MatchInput = {
    version: MATCH_IO_VERSION,
    generatedAt: new Date().toISOString(),
    teachers: teachers.map((t): MatchTeacher => ({
      id: t.id, updatedAt: t.updatedAt.toISOString(), headline: t.headline, bio: t.bio, nationality: t.nationality,
      nativeSpeaker: t.nativeSpeaker, currentCity: t.currentCity, cities: t.preferredCities, openToOnline: t.openToOnline,
      subjects: t.subjects, ageGroups: t.ageGroups, jobTypes: t.jobTypes, yearsExperience: t.yearsExperience,
      degreeLevel: t.degreeLevel, degreeMajor: t.degreeMajor,
      certificates: (Array.isArray(t.certificates) ? t.certificates : []).map((c) => String((c as { type?: unknown })?.type ?? '')).filter(Boolean),
      expectedSalaryM: t.expectedSalaryM, availableFrom: t.availableFrom?.toISOString().slice(0, 10) ?? null,
    })),
    jobs: jobs.map((j): MatchJob => {
      const attrs = (() => { try { return JSON.parse(j.attributes ?? '{}') as Record<string, unknown> } catch { return {} } })()
      return {
        id: j.id, title: j.title, description: j.description.slice(0, 3000), city: provinceToCitySlug(j.city), cityName: j.city,
        salaryM: j.salaryM, pay: typeof attrs.salaryText === 'string' ? attrs.salaryText : null, linked: !!j.affiliateUrl,
        url: `${APP}/listings/${j.id}`, postedAt: j.postedAt.toISOString(),
      }
    }),
  }
  writeFileSync(out, JSON.stringify(input, null, 1))
  console.log(`export: ${input.teachers.length} teachers × ${input.jobs.length} teaching jobs → ${out}`)
}

async function doImport() {
  const src = arg('--src')
  const csvDir = arg('--csv-dir')
  if (!src || !csvDir) throw new Error('--src <file> and --csv-dir <dir> are required')
  const outp = parseMatchOutput(JSON.parse(readFileSync(src, 'utf8')))
  const listingIds = [...new Set(outp.pairs.map((p) => p.listingId))]
  const teacherIds = [...new Set(outp.pairs.flatMap((p) => (p.teacherProfileId ? [p.teacherProfileId] : [])))]
  const [liveListings, liveTeachers] = await Promise.all([
    db.listing.findMany({ where: { id: { in: listingIds }, status: 'active', verified: true }, select: { id: true, title: true, affiliateUrl: true, city: true, seller: { select: { name: true, phone: true } } } }),
    db.teacherProfile.findMany({
      where: { id: { in: teacherIds }, status: 'live' },
      select: { id: true, fullName: true, listingId: true, staffContactOptIn: true, private: { select: { phone: true, email: true } } },
    }),
  ])
  const L = new Map(liveListings.map((l) => [l.id, l]))
  const T = new Map(liveTeachers.map((t) => [t.id, t]))
  // A job or a teacher that went away between export and import is skipped, never written.
  const usable = outp.pairs.filter((p) => L.has(p.listingId) && (!p.teacherProfileId || T.has(p.teacherProfileId)))
  const existing = await db.teacherJobMatch.findMany({
    where: { listingId: { in: listingIds } },
    select: { teacherProfileId: true, leadId: true, listingId: true },
  })
  const key = (p: { teacherProfileId?: string | null; leadId?: string | null; listingId: string }) => `${p.teacherProfileId ?? ''}|${p.leadId ?? ''}|${p.listingId}`
  const seen = new Set(existing.map(key))
  const fresh = usable.filter((p) => !seen.has(key(p)))
  const freshMatches = fresh.filter((p) => p.decision === 'match')
  console.log(`import: ${outp.pairs.length} pairs, ${usable.length} still live, ${fresh.length} new (${freshMatches.length} matches)${APPLY ? '' : ' — DRY RUN, pass --apply'}`)
  if (!APPLY) return

  // ⛔ THE STAFF LIST IS WRITTEN FIRST: once the rows are saved, a re-run sees every pair as known and
  // would never produce that day's list again (Opus, commit gate 09-30).
  const now = new Date()
  // ── The LOCAL staff list: one CSV per run, matches only ──────────────────────────────────────
  mkdirSync(csvDir, { recursive: true, mode: 0o700 })
  const header = ['date', 'score', 'who', 'teacher_name', 'teacher_phone', 'teacher_email', 'teacher_profile', 'staff_may_call',
    'job_title', 'job_city', 'job_link', 'employer', 'employer_phone', 'apply_at_source', 'reasons', 'concerns', 'staff_status', 'staff_notes']
  const rows = freshMatches.map((p) => {
    const l = L.get(p.listingId)!
    const t = p.teacherProfileId ? T.get(p.teacherProfileId)! : null
    const mayCall = !!t?.staffContactOptIn
    return [
      now.toISOString().slice(0, 10), p.score, t ? 'eno teacher' : 'FB job seeker',
      t?.fullName ?? p.lead?.excerpt.slice(0, 80) ?? '',
      mayCall ? t?.private?.phone ?? '' : '', mayCall ? t?.private?.email ?? '' : '',
      t?.listingId ? `${APP}/listings/${t.listingId}` : p.lead?.url ?? '', t ? (mayCall ? 'yes' : 'NO — profile link only') : 'FB post only',
      l.title, l.city, `${APP}/listings/${l.id}`, l.seller.name,
      // A school's own post: its storefront number (staff call the school). A linked posting: none — apply at source.
      l.affiliateUrl ? '' : l.seller.phone ?? '', l.affiliateUrl ?? '',
      p.reasons.join(' · '), p.concerns.join(' · '), '', '',
    ].map(csvCell).join(',')
  })
  const file = join(csvDir, `teacher-matches-${now.toISOString().slice(0, 10)}-${now.getTime()}.csv`)
  writeFileSync(file, [header.map(csvCell).join(','), ...rows].join('\n') + '\n', { mode: 0o600 })
  console.log(`staff list: ${rows.length} rows → ${file}`)
  // skipDuplicates: a pair is judged ONCE — a later run never rewrites its score, staff status or emailedAt.
  await db.teacherJobMatch.createMany({
    data: fresh.map((p) => ({
      teacherProfileId: p.teacherProfileId ?? null, leadId: p.leadId ?? null, listingId: p.listingId, score: Math.round(p.score),
      reasons: p.reasons, concerns: p.concerns, decision: p.decision, modelVersions: p.modelVersions,
    })),
    skipDuplicates: true,
  })
  for (const t of new Set(fresh.flatMap((p) => (p.teacherProfileId ? [p.teacherProfileId] : [])))) {
    await db.teacherProfile.update({ where: { id: t }, data: { lastMatchedAt: now } })
  }

  // Retention: personal data older than the purpose needs is deleted, not archived.
  for (const f of readdirSync(csvDir)) {
    const full = join(csvDir, f)
    if (/^teacher-matches-.*\.csv$/.test(f) && now.getTime() - statSync(full).mtimeMs > CSV_RETENTION_DAYS * 86400_000) unlinkSync(full)
  }
}

;(cmd === 'export' ? doExport() : cmd === 'import' ? doImport() : Promise.reject(new Error('usage: teachers-match.ts export|import …')))
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
