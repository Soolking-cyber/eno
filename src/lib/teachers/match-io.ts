/**
 * The eno.vn side of the LOCAL teacher matcher (owner, 2026-09-30: "our matching algorithm should use
 * local laya model and local gemini 3.8 flash model through agy"). Pure record shapes + mapping, shared
 * by scripts/teachers-match.ts and its tests. The judging itself runs in ~/eno-lead-pipeline
 * (src/cli/teachersMatch.ts), which never sees a teacher's phone or email.
 *
 *   eno.vn export  →  teachers-match-input.json   (teachers + live teaching jobs, NO contact data)
 *   pipeline judge →  teachers-match-output.json  (pairs: teacher|lead × listing, score, reasons)
 *   eno.vn import  →  TeacherJobMatch rows + the LOCAL staff list (CSV, contact only for opted-in teachers)
 */
import { CITY_PROVINCE } from '@/lib/teachers/profile'

export const MATCH_IO_VERSION = 1
/** A pair the judge scored at or above this — and called a match — is a match (uncalibrated; v1). */
export const MATCH_MIN_SCORE = 70

export type MatchTeacher = {
  id: string // TeacherProfile.id
  updatedAt: string
  headline: string
  bio: string
  nationality: string
  nativeSpeaker: boolean
  currentCity: string // workIn slug
  cities: string[] // preferred workIn slugs (may include 'anywhere' / 'online')
  openToOnline: boolean
  subjects: string[]
  ageGroups: string[]
  jobTypes: string[]
  yearsExperience: number
  degreeLevel: string | null
  degreeMajor: string | null
  certificates: string[]
  expectedSalaryM: number | null
  availableFrom: string | null
}

export type MatchJob = {
  id: string // Listing.id
  title: string
  description: string
  city: string | null // workIn slug, when the province maps to one
  cityName: string | null
  salaryM: number | null
  pay: string | null
  linked: boolean // an imported posting (apply at source) vs a school's own post on eno.vn
  url: string
  postedAt: string
}

export type MatchInput = { version: number; generatedAt: string; teachers: MatchTeacher[]; jobs: MatchJob[] }

export type MatchPair = {
  teacherProfileId?: string
  leadId?: string
  listingId: string
  score: number
  match: boolean
  reasons: string[]
  concerns: string[]
  decision: 'match' | 'reject_sample'
  modelVersions: Record<string, string>
  /** FB job-seeker leads only: where staff find the person (no contact data exists for them). */
  lead?: { url: string | null; excerpt: string }
}
export type MatchOutput = { version: number; generatedAt: string; pairs: MatchPair[] }

/** Listing.city (a vn-units province name) → the teacher `workIn` slug, where one maps back. */
export function provinceToCitySlug(province: string | null | undefined): string | null {
  if (!province) return null
  // CITY_PROVINCE is many-to-one (Bình Dương, Vũng Tàu → Hồ Chí Minh); the canonical slug wins.
  const canonical: Record<string, string> = { 'Hồ Chí Minh': 'ho-chi-minh-city', 'An Giang': 'phu-quoc' }
  if (canonical[province]) return canonical[province]
  const hit = Object.entries(CITY_PROVINCE).find(([, p]) => p === province)
  return hit ? hit[0] : null
}

/** Validate the pipeline's output before anything is written. Throws on a shape it does not know. */
export function parseMatchOutput(raw: unknown): MatchOutput {
  const o = raw as MatchOutput
  if (!o || o.version !== MATCH_IO_VERSION || !Array.isArray(o.pairs)) throw new Error('teachers-match: unknown output shape')
  for (const p of o.pairs) {
    if (!!p.teacherProfileId === !!p.leadId) throw new Error('teachers-match: a pair must name exactly one of teacher / lead')
    if (typeof p.listingId !== 'string' || !Number.isFinite(p.score)) throw new Error('teachers-match: bad pair')
    if (p.decision !== 'match' && p.decision !== 'reject_sample') throw new Error('teachers-match: bad decision')
    if (p.decision === 'match' && (!p.match || p.score < MATCH_MIN_SCORE)) throw new Error('teachers-match: a "match" below the bar')
  }
  return o
}

/** One CSV cell, quoted, with formula-injection neutralised (a leading = + - @ opens a formula in Sheets/Excel). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
