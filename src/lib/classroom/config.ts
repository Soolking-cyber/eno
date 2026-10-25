import 'server-only'
import { db } from '@/lib/db'
import { isStaffProfile } from '@/lib/user-blocks'
import { logError } from '@/lib/log'

/**
 * eno Classroom — THE RUNTIME SWITCH and the minute budgets (plan: "Ships dark, then staff, then the 5 pilot teachers").
 * A copy of the calls switch (src/lib/calls/server/config.ts), for the same reasons:
 *
 *   off        nobody (the default, and what a missing table or row means)
 *   staff      the eno team only (ADMIN_EMAILS) — their seats' learners follow them
 *   allowlist  the team plus the teachers whose ACCOUNT ids (Profile.id) are in `cohort` (the pilot) — and their learners
 *   all        every teacher with a TeacherProfile
 *
 * ⚠️ A DB ROW, NOT AN ENV VAR — "off within a minute, no rebuild". The row lives in classroom_config
 * (scripts/classroom-ddl.mjs), LOGGED, so a Postgres crash cannot quietly undo a kill the way an UNLOGGED kv key would.
 * ⚠️ FAILS CLOSED. An unreadable row, a missing table or a value this build does not know reads as 'off'.
 * ⚠️ LEARNERS FOLLOW THEIR TEACHER: the mode admits TEACHERS; a learner may practise when the seat's teacher is admitted.
 * So switching a pilot teacher out stops their class too, and no learner can be admitted on their own.
 */
export type ClassroomMode = 'off' | 'staff' | 'allowlist' | 'all'

export interface ClassroomConfig {
  mode: ClassroomMode
  cohort: ReadonlySet<string>
  /** Learner-minutes the whole classroom may use per ICT day / per calendar month, and one teacher's class per month. */
  dayMinutes: number
  monthMinutes: number
  teacherMonthMinutes: number
  /** Spatius's written OK for animated avatars with under-13s (Terms §11). False = voice-only for them. */
  spatiusChildrenOk: boolean
  /** The row was READ (present or absent). False only when the read itself failed — the sweep must not act on a blip. */
  readOk: boolean
  /** The sweep stamped swept_at within SWEEP_FRESH_S. Without it nothing ends abandoned sessions or builds their reports,
   *  so classroomOpenFor admits NOBODY (2a round 3, codex) — the stored mode is kept: it is the sweep's kill signal. */
  sweptOk: boolean
}

export const CLASSROOM_OFF: ClassroomConfig = Object.freeze({
  mode: 'off', cohort: new Set<string>(), dayMinutes: 0, monthMinutes: 0, teacherMonthMinutes: 0, spatiusChildrenOk: false, readOk: false, sweptOk: false,
})

const MODES: ReadonlySet<string> = new Set(['off', 'staff', 'allowlist', 'all'])
/** How long one process trusts its read. Session starts and turns re-check it; the sweep is the backstop. */
export const CONFIG_CACHE_MS = 30_000
/** The switch may leave 'off' only while the sweep runs: classroom_config.swept_at no older than this (the calls rule). */
export const SWEEP_FRESH_S = 900

type Row = {
  mode: string; cohort: string[] | null; day_minutes: number; month_minutes: number; teacher_month_minutes: number
  spatius_children_ok: boolean; swept_ok?: boolean | null
}

const nonNegative = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)

/** Pure: a row (or its absence) → the config this build obeys. Exported for tests. */
export function configFromRow(row: Row | null | undefined): ClassroomConfig {
  if (!row || !MODES.has(row.mode)) return { ...CLASSROOM_OFF, readOk: true }
  return {
    mode: row.mode as ClassroomMode,
    cohort: new Set((row.cohort ?? []).filter((id) => typeof id === 'string')),
    dayMinutes: nonNegative(row.day_minutes),
    monthMinutes: nonNegative(row.month_minutes),
    teacherMonthMinutes: nonNegative(row.teacher_month_minutes),
    spatiusChildrenOk: row.spatius_children_ok === true,
    readOk: true,
    sweptOk: row.swept_ok === true,
  }
}

let cached: { at: number; value: ClassroomConfig } | null = null

/** The switch, cached for CONFIG_CACHE_MS per process. Never throws. */
export async function readClassroomConfig(now = Date.now()): Promise<ClassroomConfig> {
  if (cached && now - cached.at < CONFIG_CACHE_MS) return cached.value
  let value: ClassroomConfig
  try {
    const rows = await db.$queryRaw<Row[]>`
      SELECT mode, cohort::text[] AS cohort, day_minutes, month_minutes, teacher_month_minutes, spatius_children_ok,
             swept_at > now() - make_interval(secs => ${SWEEP_FRESH_S}) AS swept_ok
      FROM public.classroom_config WHERE id = 1`
    value = configFromRow(rows[0])
  } catch (e) {
    // 42P01 (no table) is the normal state of a database scripts/classroom-ddl.mjs has not reached — as good as a read.
    const missing = e instanceof Error && /42P01|classroom_config" does not exist/.test(e.message)
    if (!missing) logError(e, { op: 'classroom.config' })
    value = { ...CLASSROOM_OFF, readOk: missing }
  }
  cached = { at: now, value }
  return value
}

/** Forget the cached row — tests, and every place that must act on the row as it is NOW (the sweep, a session start). */
export function resetClassroomConfigCache(): void {
  cached = null
}

/** May this TEACHER run a class, by the switch alone? Pure over its inputs, so the decision table is testable. */
export function modeAdmitsTeacher(config: ClassroomConfig, teacherAccountId: string, isStaff: boolean): boolean {
  switch (config.mode) {
    case 'off': return false
    case 'staff': return isStaff
    case 'allowlist': return isStaff || config.cohort.has(teacherAccountId)
    case 'all': return true
  }
}

/**
 * The switch, read and applied for one teacher account (Profile.id — the id the cohort holds). The staff lookup runs only
 * in the modes that need it. A learner's check passes their SEAT'S TEACHER's profile id here.
 */
export async function classroomOpenFor(teacherAccountId: string, opts: { fresh?: boolean } = {}): Promise<{ open: boolean; config: ClassroomConfig }> {
  if (opts.fresh) resetClassroomConfigCache()
  const config = await readClassroomConfig()
  if (config.mode === 'off' || !config.sweptOk) return { open: false, config }
  const isStaff = config.mode === 'all' ? false : await isStaffProfile(teacherAccountId)
  return { open: modeAdmitsTeacher(config, teacherAccountId, isStaff), config }
}

/** "The sweep is running" — stamped by every run of /api/cron/classroom-sweep. */
export async function stampClassroomSweep(): Promise<void> {
  await db.$executeRaw`
    INSERT INTO public.classroom_config (id, swept_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET swept_at = now()`
}

/** Has the sweep run within SWEEP_FRESH_S? False when it never has — or when the table is not there yet. */
export async function classroomSweepIsFresh(): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<{ ok: boolean | null }[]>`
      SELECT swept_at > now() - make_interval(secs => ${SWEEP_FRESH_S}) AS ok FROM public.classroom_config WHERE id = 1`
    return rows[0]?.ok === true
  } catch {
    return false
  }
}
