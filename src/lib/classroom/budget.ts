import 'server-only'
import type { Prisma } from '@/generated/prisma/client'

type Tx = Prisma.TransactionClient

/**
 * THE MINUTE BUDGET (plan: "Budgets are counted from session rows, with no kv counters" — kv_store is UNLOGGED, so a
 * Postgres crash would zero a counter and reopen the spend). Every start, end and sweep takes this lock first, so a start
 * never reads a budget while an end is half-way through releasing its reservation (codex, plan round 2).
 */
export const BUDGET_LOCK = 'eno-classroom-budget'

/**
 * ICT is UTC+7 with no DST: the classroom's day and month turn over at 00:00 in Vietnam. Prisma's DateTime columns are
 * `timestamp(3)` holding UTC with no zone, so a start is read as UTC first, then moved to ICT.
 */
const ICT = "'Asia/Ho_Chi_Minh'"

export type BudgetUse = { dayMinutes: number; monthMinutes: number; teacherMonthMinutes: number }

/**
 * Minutes used, read under the lock. A LIVE session counts its full reservation; an ENDED one counts what it used,
 * rounded up to the minute. Each row counts once, by status — a session cannot be both. Teacher tests count too: they
 * cost the same vendor minutes. ⚠️ A session counts on the ICT day (and month) it STARTED — where its minutes are
 * reserved; one running past midnight spills at most its own 20 minutes into the next day (2a rounds 5–7, codex).
 */
export async function budgetUse(tx: Tx, avatarId: string): Promise<BudgetUse> {
  const rows = await tx.$queryRawUnsafe<{ day: number; month: number; teacher: number }[]>(`
    WITH s AS (
      SELECT "avatarId",
             ("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ICT} AS local_start,
             CASE WHEN "status" = 'live' THEN "reservedMinutes" ELSE CEIL("usedSeconds" / 60.0)::int END AS minutes
        FROM "ClassroomSession"
       WHERE "startedAt" >= (now() AT TIME ZONE 'UTC') - interval '32 days'
    ), now_local AS (SELECT now() AT TIME ZONE ${ICT} AS t)
    SELECT
      COALESCE(SUM(minutes) FILTER (WHERE local_start >= date_trunc('day', (SELECT t FROM now_local))), 0)::int AS day,
      COALESCE(SUM(minutes) FILTER (WHERE local_start >= date_trunc('month', (SELECT t FROM now_local))), 0)::int AS month,
      COALESCE(SUM(minutes) FILTER (WHERE local_start >= date_trunc('month', (SELECT t FROM now_local)) AND "avatarId" = $1), 0)::int AS teacher
    FROM s`, avatarId)
  const r = rows[0] ?? { day: 0, month: 0, teacher: 0 }
  return { dayMinutes: r.day, monthMinutes: r.month, teacherMonthMinutes: r.teacher }
}

export type BudgetCaps = { dayMinutes: number; monthMinutes: number; teacherMonthMinutes: number }

/** Pure: may a session reserving `minutes` start, given what is used and the caps? Names the cap it would break. */
export function budgetRefusal(use: BudgetUse, caps: BudgetCaps, minutes: number): 'day' | 'month' | 'teacher' | null {
  if (use.dayMinutes + minutes > caps.dayMinutes) return 'day'
  if (use.monthMinutes + minutes > caps.monthMinutes) return 'month'
  if (use.teacherMonthMinutes + minutes > caps.teacherMonthMinutes) return 'teacher'
  return null
}
