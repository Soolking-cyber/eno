/**
 * TEACHER × JOB — does this job fit this teacher, from facts both sides STATED? Pure, deterministic, unit-tested.
 *
 * Owner, 2026-10-20: "accurate location qualification … and salary match if specified if salary in job post is not
 * specified just best match". So:
 *   · a requirement the post does not state never blocks; one it states must be met by what the teacher declared;
 *   · pay is compared only when BOTH sides give a figure (±10 %); otherwise the job is ranked, not refused;
 *   · location uses the same expansion a school's filter does (places.ts workInFilterKeys, cover.ts coverAreaFilterKeys),
 *     so "District 7" reaches a teacher who picked District 7, all of HCMC or anywhere — never one who picked Hanoi.
 * ⛔ NEVER gender, age, race or nationality: posts that ask for them are refused before this (extract.ts denyReason), and
 * "native speaker" is the teacher's OWN englishLevel ('native'), the live Haiku matcher's rule — and the message says
 * the post asks for native speakers, so the teacher decides.
 */
import { ANYWHERE, ONLINE, isHcmcDistrict, workInFilterKeys } from '@/lib/teachers/places'
import { coverAreaFilterKeys } from '@/lib/teachers/cover'
import type { Employment, JobKind, Pay, Requirements, Schedule } from './extract'
import { lessonDateOf, lessonDayOf } from './facts'

/** The teacher columns the gates read (TeacherProfile, never a name or contact field except the first-name greeting). */
export type MatchTeacher = {
  profileId: string
  livesIn: string | null
  currentCity: string
  teachAreas: readonly string[]
  jobTypes: readonly string[]
  ageGroups: readonly string[]
  subjects: readonly string[]
  englishLevel: string | null
  degreeLevel: string | null
  /** certificate TYPES only (tefl, tesol, celta, delta, tkt, pgce, teaching-license, other-cert) */
  certificates: readonly string[]
  yearsExperience: number
  expectedSalaryM: number | null
  /** cover is usable only when ON under the current cover consent (profile.ts / cover.ts COVER_CONSENT_VERSION) */
  coverUsable: boolean
  coverAreas: readonly string[]
  coverSlots: readonly string[]
  coverRateVnd: number | null
}

/** A job from any source, normalised. `key` is the ledger key: 'post:<id>' | 'listing:<id>'. */
export type MatchJob = {
  key: string
  kind: Extract<JobKind, 'job_offer' | 'cover_request'>
  employment: readonly Employment[]
  places: readonly string[]
  pay: Pay | null
  schedule: Schedule | null
  ageGroups: readonly string[]
  subjects: readonly string[]
  requirements: Requirements
  postedAt: Date
}

export type Fit = {
  ok: boolean
  score: number
  /** why it fits — short, for the ledger and the evaluation */
  reasons: string[]
  /** what the message must say (e.g. the post asks for native speakers) or a soft mismatch */
  notes: string[]
  /** the gate that refused it, when !ok */
  blocker: string | null
}

const CERTS_THAT_COUNT: ReadonlySet<string> = new Set(['tefl', 'tesol', 'celta', 'delta', 'pgce', 'teaching-license'])
const DEGREES_THAT_COUNT: ReadonlySet<string> = new Set(['bachelor', 'master', 'phd'])
/** Subjects that need the teacher to have said so — an IELTS class is not a general-English class. */
const HARD_SUBJECTS: ReadonlySet<string> = new Set(['ielts', 'toefl-toeic', 'business-english', 'stem'])

/** The most specific physical places of a job: its HCMC districts if it names any, else its cities/provinces. */
export function specificPlaces(places: readonly string[]): string[] {
  const physical = places.filter((p) => p !== ONLINE)
  const districts = physical.filter(isHcmcDistrict)
  return districts.length ? districts : physical
}

const isOnlineOnly = (job: MatchJob) => job.places.includes(ONLINE) && specificPlaces(job.places).length === 0
/** Also online: a job offered in a place OR online, for a teacher who teaches online (codex, gate 2a). */
const onlineFor = (t: MatchTeacher, job: MatchJob) => isOnlineOnly(job) || (job.places.includes(ONLINE) && t.teachAreas.includes(ONLINE))

export function fit(t: MatchTeacher, job: MatchJob, now: Date): Fit {
  const reasons: string[] = []
  const notes: string[] = []
  const no = (blocker: string): Fit => ({ ok: false, score: 0, reasons, notes, blocker })
  const cover = job.kind === 'cover_request'
  const online = onlineFor(t, job)

  // ── 1. The kind of work ───────────────────────────────────────────────────────────────────────────────────────────
  if (cover) {
    if (!t.coverUsable) return no('not-open-for-cover')
  } else {
    const types = new Set(t.jobTypes)
    const wanted = job.employment.filter((e) => e !== 'cover' && e !== 'online')
    if (wanted.length) {
      const okType = wanted.some((e) => (e === 'full_time' && types.has('fulltime')) || (e === 'part_time' && (types.has('parttime') || types.has('private'))) || (e === 'private' && types.has('private')))
      if (!okType) return no(`job-type:${wanted.join('+')}`)
    } else if (!types.has('fulltime') && !types.has('parttime') && !types.has('private')) {
      return no('not-job-seeking')
    }
  }

  // ── 2. Where ───────────────────────────────────────────────────────────────────────────────────────────────────────
  if (online) {
    if (!t.teachAreas.includes(ONLINE)) return no('not-online')
    reasons.push('online')
  } else {
    const places = specificPlaces(job.places)
    if (!places.length) return no('no-place')
    // ⚠️ Abroad applies to work IN a place: an online job — a cover lesson too — is open to an online teacher wherever
    // they live (the "online" branch above; codex, gate 2b, asked — online platforms hire teachers abroad).
    const abroad = t.livesIn === 'abroad'
    if (abroad) {
      const fullTime = job.employment.includes('full_time')
      if (cover || !fullTime || !job.requirements.abroadOk || job.requirements.inVietnam) return no('teacher-abroad')
    }
    if (cover) {
      const hit = places.find((p) => coverAreaFilterKeys(p).some((k) => t.coverAreas.includes(k)))
      if (!hit) return no('cover-area')
      reasons.push(isHcmcDistrict(hit) ? 'district' : 'city')
    } else {
      const hit = places.find((p) => workInFilterKeys(p).some((k) => t.teachAreas.includes(k)))
      if (!hit) return no('place')
      const exact = t.teachAreas.includes(hit)
      reasons.push(exact && isHcmcDistrict(hit) ? 'district' : t.teachAreas.includes(ANYWHERE) && !exact ? 'anywhere' : 'city')
    }
    if (job.requirements.inVietnam && t.livesIn !== 'city' && t.livesIn !== 'elsewhere') return no('must-be-in-vietnam')
  }

  // ── 3. When (cover) ────────────────────────────────────────────────────────────────────────────────────────────────
  if (cover && job.schedule) {
    const { part, date } = job.schedule
    // A time and no day ("cover at 6pm") is for the day facts.ts reads it as — never "any day" (opus, gate 2a) — and one
    // too close to read a day for is refused here too, not left to decide() (opus, gate 2b).
    const day = job.schedule.day ?? (part ? lessonDayOf(job.postedAt, part, job.schedule.hour ?? null) : null)
    if (part && !job.schedule.day && !date && !day) return no('cover-too-late')
    // …and a day read from an older post is checked against today as a dated one is (opus, gate 2c).
    if (!date && !job.schedule.day && part) {
      const d = lessonDateOf(job.postedAt, part, job.schedule.hour ?? null)
      if (d && d < vnToday(now)) return no('cover-in-the-past')
    }
    if (date && date < vnToday(now)) return no('cover-in-the-past')
    if (day || part) {
      const slots = t.coverSlots
      const okSlot = slots.some((s) => (!day || s.startsWith(`${day}-`)) && (!part || s.endsWith(`-${part}`)))
      if (!okSlot) return no('cover-slot')
      reasons.push('free-then')
    }
  }

  // ── 4. Requirements the post states ────────────────────────────────────────────────────────────────────────────────
  const r = job.requirements
  const native = t.englishLevel === 'native'
  if (r.native === 'required') {
    if (!native) return no('native')
    notes.push('native-asked')
  } else if (r.native === 'preferred' && !native) notes.push('native-preferred')
  const degree = !!t.degreeLevel && DEGREES_THAT_COUNT.has(t.degreeLevel)
  if (r.degree === 'required' && !degree) return no('degree')
  if (r.degree === 'preferred' && !degree) notes.push('degree-preferred')
  const cert = t.certificates.some((c) => CERTS_THAT_COUNT.has(c))
  if (r.tefl === 'required' && !cert) return no('certificate')
  if (r.tefl === 'preferred' && !cert) notes.push('certificate-preferred')
  if (r.minYears !== null && t.yearsExperience < r.minYears) return no('experience')

  if (job.ageGroups.length && t.ageGroups.length) {
    if (!job.ageGroups.some((a) => t.ageGroups.includes(a))) return no('age-group')
    reasons.push('age-group')
  }
  const hard = job.subjects.filter((s) => HARD_SUBJECTS.has(s))
  if (hard.length) {
    if (!hard.some((s) => t.subjects.includes(s))) return no(`subject:${hard.join('+')}`)
    reasons.push('subject')
  } else if (job.subjects.some((s) => s !== 'general-english' && t.subjects.includes(s))) reasons.push('subject')

  // ── 5. Pay — only when both sides state it ─────────────────────────────────────────────────────────────────────────
  let payKnown = false
  if (job.pay) {
    if (job.pay.unit === 'month' && !cover && t.expectedSalaryM) {
      payKnown = true
      if (job.pay.max < 0.9 * t.expectedSalaryM * 1_000_000) return no('pay-below-expectation')
      reasons.push('pay')
    } else if (job.pay.unit === 'hour' && cover && t.coverRateVnd) {
      // The teacher's cover rate is their floor for COVER lessons only — a long-term part-time job paid by the hour is
      // not refused by it (no profile field states an hourly floor for those).
      payKnown = true
      if (job.pay.max < 0.9 * t.coverRateVnd) return no('pay-below-rate')
      reasons.push('pay')
    }
  }

  // ── Score: ranks the jobs that passed; it never makes a refused one pass ───────────────────────────────────────────
  let score = 60
  if (reasons.includes('district')) score += 10
  if (reasons.includes('subject')) score += 8
  if (reasons.includes('age-group')) score += 8
  if (reasons.includes('pay')) score += 8
  if (reasons.includes('free-then')) score += 6
  if (!payKnown) score -= 6
  const ageH = (now.getTime() - job.postedAt.getTime()) / 3_600_000
  if (ageH < 24) score += 4
  score -= 4 * notes.filter((n) => n.endsWith('-preferred')).length
  return { ok: true, score: Math.max(1, Math.min(100, score)), reasons, notes, blocker: null }
}

/** Today's Vietnam date, YYYY-MM-DD. */
export function vnToday(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}
