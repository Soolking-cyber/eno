import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { HOME_HIDDEN_TEACHER_LISTING_IDS, TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { CHECK_IN_EVERY_DAYS, CHECK_IN_TITLE, CHECK_IN_TYPE, CHECK_IN_URL, checkInBody } from './check-in-copy'

/**
 * THE TEACHERS' WEEKLY CHECK-IN — the server half (owner, 2026-10-27; why, and the words: ./check-in-copy.ts).
 *
 *   · ASKING (sendTeacherCheckIns, run by GET /api/cron/daily-reminders): each live teacher — profile 'live', listing
 *     active + verified, never the owner's demo — whose profile is a week old, who has not said "yes" within a week and
 *     was not asked within a week, and who has not switched reminders off (Profile.dailyReminderOptIn, the same opt-out
 *     as the goods reminder), gets ONE bell row pointing at /teachers/check-in. In the app only, never a web push (the
 *     job-messages invite's rule: a push permission was given for messages). Ignoring it changes nothing.
 *   · ANSWERING "yes" (confirmTeacherCheckIn, POST /api/teachers/me/check-in): stamps the listing's
 *     availabilityConfirmedAt — the week's answer — and, while cover is on, coverConfirmedAt (the cover card's
 *     "Confirmed on"). It never changes a status, never relists, and never moves postedAt (the profile's place in lists
 *     and its "posted" date stay as they are). "Hide my profile" is the existing Visibility switch, behind a confirm.
 *
 * ⛔ ONE BELL A WEEK, EVEN UNDER A DOUBLE RUN: the selection is re-checked under the teacher's lock (the saves' own
 * 'teacher:'+profileId advisory lock) and the row written in that transaction, so two runs can produce one bell, never two.
 */

const DAY_MS = 86_400_000
/** Bells per run; the rest wait for the next day's run (oldest profiles first). */
export const CHECK_IN_MAX_PER_RUN = 300

/**
 * A week ago, LESS 12 HOURS: the bell row and a "yes" are written a little after the run's `now`, so a strict seven days
 * would skip a teacher at next week's same cron hour by milliseconds and ask them on day 8 (opus, gate) — the goods
 * reminder's 20-hour window for a daily nudge, scaled to a week.
 */
const weekAgo = (now: Date) => new Date(now.getTime() - CHECK_IN_EVERY_DAYS * DAY_MS + 12 * 3_600_000)

/**
 * Who is due this week — the selection only: the claim re-checks it under the lock. Live profile; its listing live
 * (active + verified), a teacher's, never the demo; a week old; no "yes" and no bell within a week; reminders on.
 * Returned under `where` (a filter, never a write payload — compliance/public-state-writes.test.ts reads it so).
 */
export function checkInDue(now: Date): { where: Prisma.TeacherProfileWhereInput } {
  const since = weekAgo(now)
  return {
    where: {
      status: 'live',
      createdAt: { lt: since },
      listing: {
        is: {
          status: 'active',
          verified: true,
          listingType: TEACHER_LISTING_TYPE,
          id: { notIn: [...HOME_HIDDEN_TEACHER_LISTING_IDS] },
          OR: [{ availabilityConfirmedAt: null }, { availabilityConfirmedAt: { lt: since } }],
        },
      },
      profile: { dailyReminderOptIn: true, notifications: { none: { type: CHECK_IN_TYPE, createdAt: { gt: since } } } },
    },
  }
}

/** Ask every due teacher, at most CHECK_IN_MAX_PER_RUN a run. Bell rows written; a failed claim is logged and skipped. */
export async function sendTeacherCheckIns(now = new Date()): Promise<{ notified: number; pushed: number }> {
  const due = await db.teacherProfile.findMany({
    where: checkInDue(now).where,
    select: { profileId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: CHECK_IN_MAX_PER_RUN,
  })
  let notified = 0
  for (const { profileId } of due) {
    try {
      if (await claimAndAsk(profileId, now)) notified++
    } catch (e) {
      console.error('[cron] teacher check-in failed for', profileId, e)
    }
  }
  return { notified, pushed: 0 }
}

/** The selection, again, under the teacher's lock, and the bell row in the same transaction. True only when it asked. */
export async function claimAndAsk(profileId: string, now = new Date()): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findFirst({
      where: { profileId, ...checkInDue(now).where },
      select: { jobTypes: true, coverOpen: true },
    })
    if (!tp) return false
    await tx.notification.create({
      data: { recipientId: profileId, type: CHECK_IN_TYPE, title: CHECK_IN_TITLE, body: checkInBody(tp), url: CHECK_IN_URL },
    })
    return true
  })
}

/** What the check-in page shows: the profile's offer and whether it is live — no contact data, nothing private. */
export type CheckInView = {
  teacher: boolean
  /** profile 'live' and its listing active + verified: what schools can find */
  live: boolean
  /** the teacher's own Visibility switch is off */
  hidden: boolean
  jobTypes: string[]
  coverOpen: boolean
  coverSlots: string[]
  /** the last "yes" (ISO), or null */
  confirmedAt: string | null
}

export async function checkInView(profileId: string): Promise<CheckInView> {
  const tp = await db.teacherProfile.findUnique({
    where: { profileId },
    select: { status: true, jobTypes: true, coverOpen: true, coverSlots: true, listing: { select: { status: true, verified: true, availabilityConfirmedAt: true } } },
  })
  if (!tp) return { teacher: false, live: false, hidden: false, jobTypes: [], coverOpen: false, coverSlots: [], confirmedAt: null }
  return {
    teacher: true,
    live: tp.status === 'live' && tp.listing?.status === 'active' && tp.listing.verified === true,
    hidden: tp.status === 'hidden',
    jobTypes: tp.jobTypes,
    coverOpen: tp.coverOpen,
    coverSlots: tp.coverOpen ? tp.coverSlots : [],
    confirmedAt: tp.listing?.availabilityConfirmedAt?.toISOString() ?? null,
  }
}

export type CheckInResult =
  | { ok: true; confirmedAt: string; cover: boolean }
  | { ok: false; error: 'teacher_profile_missing' | 'teacher_profile_not_live' }

/**
 * "Yes, I'm still available": the week's answer is recorded — nothing else moves. Only on a LIVE profile: a hidden or
 * held one is not "available" to anyone, and this is never a way back for it (that is the Visibility switch, behind
 * its gates).
 */
export async function confirmTeacherCheckIn(profileId: string, now = new Date()): Promise<CheckInResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: { id: true, status: true, coverOpen: true, listingId: true } })
    if (!tp) return { ok: false, error: 'teacher_profile_missing' } as const
    const stamped = tp.status === 'live' && tp.listingId
      ? (await tx.listing.updateMany({
          where: { id: tp.listingId, listingType: TEACHER_LISTING_TYPE, status: 'active', verified: true },
          data: { availabilityConfirmedAt: now },
        })).count
      : 0
    if (stamped !== 1) return { ok: false, error: 'teacher_profile_not_live' } as const
    if (tp.coverOpen) await tx.teacherProfile.update({ where: { id: tp.id }, data: { coverConfirmedAt: now } })
    return { ok: true, confirmedAt: now.toISOString(), cover: tp.coverOpen } as const
  })
}
