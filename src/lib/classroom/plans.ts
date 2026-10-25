/**
 * WHAT A SESSION WORKS ON (owner: "ai can adjust next practice to help student improve their mistakes and teacher can have
 * a look and adjust the next sessions prompt"). Pure helpers — the shape of a plan, the first plan of a seat, and which
 * plan the next session uses. Server code reads and writes the rows (sessions.ts, feedback.ts, the plan route).
 *
 * The loop: a session ends → its report drafts the NEXT plan (status draft, source ai) → the teacher may edit or approve it
 * (source teacher, status approved) → the next session snapshots it (status used). ⛔ A TEACHER'S PLAN IS NEVER
 * OVERWRITTEN BY THE AI: a new AI draft replaces only an untouched AI draft (the optimistic `updatedAt` check in the
 * writer). And a student never waits for the teacher: an untouched draft is used as it is.
 */
import type { Level } from './constants'

export type PlanFocus = {
  /** One-line aims ("Ask and answer about weekend plans"). */
  goals: string[]
  /** Words the avatar works into the talk and gets the learner to use. */
  focusWords: string[]
  /** Mistakes from earlier sessions to bring back ("past tense -ed", "the 'th' sound"). */
  recycle: string[]
  /** Short sentences for the repeat-after-me warm-up — the KNOWN references that make pronunciation scores reliable. */
  drill: string[]
}

export const PLAN_LIMITS = { brief: 600, item: 120, goals: 4, focusWords: 10, recycle: 5, drill: 3 } as const

/** A drill sentence: starts with a letter, letters/digits/basic punctuation only, at most 80 characters. */
export const DRILL_RE = /^[A-Za-z][A-Za-z0-9 ,.'?!-]{1,79}$/

/**
 * Whitespace collapsed and TYPOGRAPHIC apostrophes made plain — an iPhone's Smart Punctuation turns "I'm" into "I’m" (core
 * review, opus), and a teacher's sentence must not vanish for it. Double quotes (any kind) are dropped: a spoken
 * sentence has none, and DRILL_RE refuses them (round 3, opus). Checked with DRILL_RE after this.
 */
export function speakable(s: string): string {
  return s.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D"]/g, '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim()
}

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? [...new Set(v.map((x) => clip(x, max)).filter(Boolean))].slice(0, n) : [])

/** Any stored or submitted focus → a valid one. Never throws. */
export function parseFocus(v: unknown): PlanFocus {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    goals: list(o.goals, PLAN_LIMITS.goals, PLAN_LIMITS.item),
    focusWords: list(o.focusWords, PLAN_LIMITS.focusWords, 40),
    recycle: list(o.recycle, PLAN_LIMITS.recycle, PLAN_LIMITS.item),
    // A drill sentence is spoken and then scored word by word: short, plain, no symbols that do not read aloud. Checked
    // WHOLE and BEFORE the cap — a too-long sentence is dropped, never cut into a fragment, and never crowds out a good one.
    drill: Array.isArray(o.drill)
      ? [...new Set(o.drill.filter((x): x is string => typeof x === 'string').map(speakable))]
        .filter((x) => DRILL_RE.test(x)).slice(0, PLAN_LIMITS.drill)
      : [],
  }
}

export function cleanBrief(v: unknown): string {
  return clip(v, PLAN_LIMITS.brief)
}

/** The first session of a seat — no report to build on yet, so a get-to-know-you talk pitched at the seat's level. */
export function firstPlan(level: Level, greeting: string, avatarName: string): { brief: string; focus: PlanFocus; openingLine: string } {
  const beginner = level === 'A1' || level === 'A2'
  return {
    brief: beginner
      ? 'First conversation: get to know each other. Ask about the learner’s day, favourite food and what they like to do. Short, simple questions; present simple tense.'
      : 'First conversation: get to know each other. Talk about the learner’s week, interests and plans, and ask follow-up questions that make them explain and give reasons.',
    focus: { goals: [beginner ? 'Answer simple questions in full sentences' : 'Give reasons and examples'], focusWords: [], recycle: [], drill: [] },
    openingLine: clip(greeting, 300) || `Hi! I'm ${avatarName}. It's nice to meet you. How are you today?`,
  }
}

export type PlanRow = { id: string; source: string; status: string; brief: string; focus: unknown; openingLine: string; updatedAt: Date; fromSessionId?: string | null }

/**
 * Which plan the next session runs on: the newest one not yet used — a teacher's (approved) before an AI draft written
 * earlier or later, since the teacher has spoken. Null = none yet (the seat's first session → firstPlan).
 */
export function pickPlan(rows: readonly PlanRow[]): PlanRow | null {
  const open = rows.filter((r) => r.status !== 'used')
  const teacher = open.filter((r) => r.status === 'approved').sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  if (teacher.length) return teacher[0]
  return open.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
}
