/**
 * The classroom's pure rules about TIME and AGE — what the server enforces and the UI explains, in one place. No DB.
 */
import { ADULT_AGE, CHILD_ASSENT_AGE, LIMITS, SPATIUS_CHILD_AGE } from './constants'

const ICT_OFFSET_MS = 7 * 3_600_000

/** 00:00 ICT of the day `now` falls on, as a UTC instant. Vietnam has no DST. */
export function ictDayStart(now: Date): Date {
  const local = new Date(now.getTime() + ICT_OFFSET_MS)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() - ICT_OFFSET_MS)
}

/** Monday 00:00 ICT of the week `now` falls in, as a UTC instant — the practice week. */
export function ictWeekStart(now: Date): Date {
  const day = ictDayStart(now)
  const weekday = new Date(day.getTime() + ICT_OFFSET_MS).getUTCDay() // 0 = Sunday
  const back = (weekday + 6) % 7
  return new Date(day.getTime() - back * 86_400_000)
}

/**
 * ⛔ A BIRTH YEAR IS AN AGE RANGE, NOT AN AGE (plan review of the core commit, codex + opus): a child born in December 2013
 * is 12 until December 2026. So every rule picks the end of the range that PROTECTS the child — the YOUNGEST they could be
 * for the under-13 rule, the tutor's age band and the "a child, not an adult" check; the OLDEST they could be for asking
 * their own yes (assent from 7: ask whenever they might be 7).
 */
export function ageRange(birthYear: number, now: Date): { min: number; max: number } {
  const max = new Date(now.getTime() + ICT_OFFSET_MS).getUTCFullYear() - birthYear
  return { min: Math.max(0, max - 1), max }
}

export type AgeBand = 'child-young' | 'child' | 'teen' | 'adult'

/**
 * How the tutor talks to a learner: 'child-young' (under 10: very short, very simple), 'child' (10–12), 'teen' (13–17),
 * 'adult'. A `self` learner is an adult (eno's Terms: account holders are 18+).
 */
export function ageBand(kind: 'self' | 'child', birthYear: number | null, now: Date): AgeBand {
  if (kind === 'self' || birthYear == null) return 'adult'
  const age = ageRange(birthYear, now).min // the younger band when unsure: simpler words are never unsafe
  if (age < 10) return 'child-young'
  if (age < SPATIUS_CHILD_AGE) return 'child'
  if (age < ADULT_AGE) return 'teen'
  return 'adult'
}

/**
 * A child birth year the join form accepts: a child who is CERTAINLY 3 or older (round 7, codex: "3–17" means the youngest
 * possible age is 3) and may still be 17 — a year that could still be a 17-year-old is a child, the side with more
 * protections. An adult practises as themselves.
 */
export function childBirthYearOk(birthYear: number, now: Date): boolean {
  if (!Number.isInteger(birthYear)) return false
  const { min } = ageRange(birthYear, now)
  return min >= 3 && min < ADULT_AGE
}

/** From this age a child gives their own yes on the assent screen. */
export function needsAssent(kind: 'self' | 'child', birthYear: number | null, now: Date): boolean {
  return kind === 'child' && birthYear != null && ageRange(birthYear, now).max >= CHILD_ASSENT_AGE
}

/** Possibly under 13 → no animated avatar until Spatius's written OK (Spatius Terms §11), and the 10-minute cap. */
export function under13(kind: 'self' | 'child', birthYear: number | null, now: Date): boolean {
  return kind === 'child' && birthYear != null && ageRange(birthYear, now).min < SPATIUS_CHILD_AGE
}

/** The minutes a session actually gets: the seat's setting, capped for an under-13. */
export function effectiveMinutes(seatMinutes: number, kind: 'self' | 'child', birthYear: number | null, now: Date): number {
  return under13(kind, birthYear, now) ? Math.min(seatMinutes, LIMITS.childUnder13Minutes) : seatMinutes
}

export type StartRefusal = 'week_limit' | 'day_limit'

/**
 * May a learner start a session now? Pure. (The one-live-session rule and the budget are the database's and budget.ts's.)
 * `spokenThisWeek` / `spokenToday` count the sessions the learner SPOKE in (core review, opus: a start that died at once
 * — the mic refused — is not practice and must not spend the day); `startsToday` counts every start, spoken in or not,
 * so a retry is allowed but not an endless one (each start is billed time at Spatius).
 * ⛔ THE WEEK FIRST (core review, codex): with the week used up, "tomorrow" would be a promise the next start breaks — the
 * refusal names the day practice really opens again.
 */
export function frequencyRefusal(spokenThisWeek: number, spokenToday: number, sessionsPerWeek: number, startsToday = 0): StartRefusal | null {
  if (spokenThisWeek >= sessionsPerWeek) return 'week_limit'
  if (spokenToday >= LIMITS.sessionsPerDay || startsToday >= LIMITS.startsPerDay) return 'day_limit'
  return null
}

/** When the learner may practise next, after a refusal: tomorrow 00:00 ICT, or next Monday 00:00 ICT. */
export function nextPracticeAt(refusal: StartRefusal, now: Date): Date {
  return refusal === 'day_limit'
    ? new Date(ictDayStart(now).getTime() + 86_400_000)
    : new Date(ictWeekStart(now).getTime() + 7 * 86_400_000)
}
