/**
 * TEACHER JOB DMs (owner, 2026-10-20) — the shared constants. "Hi, this is Alex from eno.vn, we've found these jobs that
 * match your profile …": job and cover-lesson posts from Facebook groups, LinkedIn job alerts, posts the outreach team
 * forwards and eno.vn's own teaching listings, matched on the box (rules decide; Laya's answers are recorded) and sent in
 * eno chat from the jobs desk.
 *
 * ⛔ IMPORT-FREE (like rental-check/desk-ids.ts): edition-scope.ts and the chat UI read these ids, and neither may pick up
 * a server module through this file.
 */

/**
 * THE JOBS DESK — the counterpart of every job-DM thread: an UNOWNED Seller (never a storefront, no listings), with the
 * operator Profile as the thread's sellerProfileId so teachers' replies land in that person's /messages inbox (the
 * rental-desk pattern, src/lib/rental-check/desk.ts). Teachers live on eno.vn only, so there is ONE desk and it is
 * marketplace-only: eno.forum hides it (edition-scope.ts).
 */
export const JOBS_DESK_SELLER_ID = 'eno-jobs-desk'
/** What the teacher sees as the thread's name (the desk Seller's name). */
export const JOBS_DESK_NAME = 'Alex · eno.vn'

/**
 * The consent notice the "Message me matching jobs" switch is given under (TeacherJobDmConsent.noticeVersion). An opt-in
 * counts only under THIS version: change what the notice says is used, by whom or where, and bump it in the same change
 * (an older opt-in then stops counting until the teacher switches it on again — finish-step.tsx's AI-notice rule).
 */
export const JOB_DM_NOTICE_VERSION = '2026-10-20'

export const JOB_DM_RULES = {
  /** at most this many jobs in one message */
  jobsPerDm: 5,
  /** one JOBS message and one COVER message per teacher per Vietnam day, at most */
  perDayPerKind: 1,
  /**
   * ⛔ /privacy: "an account can send a teacher at most two messages until the teacher replies" — the jobs desk is an
   * account. Desk messages since the teacher's last message in the thread; at the cap the desk waits for a reply.
   */
  unansweredMax: 2,
  /** sends per run (the cron runs every 30 minutes in the daytime) */
  maxDmsPerRun: 60,
  /** a regular job is offered only this long after it was posted */
  jobFreshDays: 5,
  /** a cover request without a date is offered only this long after it was posted */
  coverUndatedHours: 30,
  /** no message 21:00–08:00 Vietnam time (a run inside this window stops with `quiet`) */
  quietFromHour: 21,
  quietToHour: 8,
  /** ExternalJobPost rows older than this are deleted (the post text is third-party content) */
  retentionDays: 30,
  /** a purged post's shell (source, key, signature — no content) stops it being stored and sent again; gone after this */
  shellDays: 180,
  /** a PAUSE nobody lifted becomes a withdrawal after this many days — the consent record then says what happened */
  pauseToWithdrawDays: 14,
} as const

/** kv_store key of the send mode. kv_store is UNLOGGED: after a crash the key is gone and the mode falls back to shadow. */
export const JOB_DMS_MODE_KEY = 'job-dms:mode'
export type JobDmsMode = 'shadow' | 'live'

export type JobSource = 'fb' | 'linkedin' | 'intake'
export const JOB_SOURCES: readonly JobSource[] = ['fb', 'linkedin', 'intake']

/** ExternalJobPost.status — new (not read yet) → ready | held | dropped; expired after its lifetime. */
export type JobPostStatus = 'new' | 'ready' | 'held' | 'dropped' | 'expired'
