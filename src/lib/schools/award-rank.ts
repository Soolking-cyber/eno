/**
 * The pure half of the Teachers' Choice awards (awards.ts does the I/O): the window, and how a category is
 * ranked. Kept free of the database so a test can pin every rule.
 */
import { AWARD_MIN_REVIEWS, AWARD_MIN_VOTERS, AWARD_PLACES } from './constants'
import { wilsonLower } from './logic'

const ICT_OFFSET_MS = 7 * 3_600_000

/** An award year is Saigon's calendar year: [1 Jan 00:00, next 1 Jan 00:00) in Asia/Ho_Chi_Minh, as UTC instants. */
export function awardWindow(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1) - ICT_OFFSET_MS), end: new Date(Date.UTC(year + 1, 0, 1) - ICT_OFFSET_MS) }
}

/** The award year open at `now` (Saigon's calendar year; Vietnam keeps no daylight saving). */
export function currentAwardYear(now: Date = new Date()): number {
  return new Date(now.getTime() + ICT_OFFSET_MS).getUTCFullYear()
}

export type Tally = { schoolId: string; name: string; up: number; down: number; reviews: number }
export type Standing = Tally & { voters: number; score: number }

/**
 * ⛔ A MAJORITY, NOT JUST VOLUME (diff review): enough voters and reviews, AND more of its voters recommend it than
 * not — otherwise the only qualifier in a thin category, 2 up and 9 down, would be named the teachers' choice.
 */
export const qualifies = (t: Tally) => t.up + t.down >= AWARD_MIN_VOTERS && t.reviews >= AWARD_MIN_REVIEWS && t.up > t.down

/**
 * A category's qualified schools, best first: the Wilson lower bound (95%) of the up-share — the board's own
 * "Top rated" score, so a school cannot win on a few friendly votes — then more voters, then the name.
 */
export function rankCategory(tallies: Tally[]): Standing[] {
  return tallies
    .filter(qualifies)
    // Clamped: the bound's floating point can land a hair outside [0, 1], and the table's CHECK refuses that.
    .map((t) => ({ ...t, voters: t.up + t.down, score: Math.min(1, Math.max(0, wilsonLower(t.up, t.down))) }))
    .sort((a, b) => b.score - a.score || b.voters - a.voters || a.name.localeCompare(b.name))
}

/** The places awarded: the top AWARD_PLACES qualified schools, ranked 1.. */
export function placesOf<T extends Standing>(ranked: T[]): (T & { rank: number })[] {
  return ranked.slice(0, AWARD_PLACES).map((s, i) => ({ ...s, rank: i + 1 }))
}
