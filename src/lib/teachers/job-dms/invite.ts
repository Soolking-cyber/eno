import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { JOB_DM_DEFAULT_ON, JOB_DM_RULES } from './constants'
import { JOB_DM_TX_OPTS, defaultOnTeacherWhere, lockJobDmTeacher } from './consent'

/**
 * THE ONE-TIME NOTICE (owner, 2026-10-20 — plan v2: "Existing teachers get ONE in-app bell invite (once per teacher, daily
 * for new teachers)"; since 2026-10-21 job messages are ON by default — constants.ts JOB_DM_DEFAULT_ON — so it tells the
 * teacher they are on and where to switch them off). GET /api/cron/job-dms-invite, daily: each live teacher not yet told
 * gets ONE bell row — in the app only, never a web push (the permission was given for messages, not news of a feature:
 * /privacy says "in the app only") — pointing at /teachers/job-messages, where the switch and its notice are. It sends no
 * job and switches nothing: eno's default-on is consent.ts enrolDefaultOn's (each run).
 *
 * WHO — a teacher who has never been asked and never answered:
 *   · TeacherProfile status 'live' and its listing live (active + verified) — the teachers the jobs desk can reach once
 *     they opt in (run.ts loadTeachers reads the same); a teacher under review is invited on a later day, once live;
 *   · never the owner's DEMO profile (constants.ts HOME_HIDDEN_TEACHER_LISTING_IDS — not a teacher anyone can hire);
 *   · no TeacherJobDmConsent row, or one never told (NOT_TOLD): no invite, no withdrawal, and no switch-on of the
 *     teacher's own — none, or eno's default. ⛔ A teacher who switched it ON themselves already knows; one who switched
 *     it OFF made a choice — never a bell over it.
 * ⛔ NEVER TWICE: `invitedAt` is CLAIMED FIRST — a compare-and-set (insert-if-absent, else an update WHERE never asked),
 * under the teacher's job-DM lock (consent.ts) — and the bell row is written in the SAME transaction: claim and bell
 * commit together or not at all, so a re-run, a parallel run or a crash can produce at worst no invite, never two, and
 * never a claim without its bell. (No web push follows: see above.) A missing bell is the failure, never a
 * second bell.
 * Persisted copy is a BILINGUAL COMPOSITE (notify.ts's idiom: stored server-side, where tr() cannot run). eno's own words
 * only — notification-text.ts lets the bell machine-translate this type, and the bell titles it in the reader's language.
 */
export const JOB_DM_INVITE = {
  type: 'teacher_jobs_invite',
  url: '/teachers/job-messages',
  /** invites per run; the rest wait for the next day's run (oldest profiles first) */
  maxPerRun: 200,
} as const

export const INVITE_TITLE = 'Việc làm phù hợp qua tin nhắn eno · Matching jobs in eno chat'
export const INVITE_BODY =
  'Mới cho giáo viên: eno.vn nhắn cho bạn các việc làm và buổi dạy thay phù hợp với hồ sơ. Nhấn để xem cách hoạt động hoặc tắt. · ' +
  'New for teachers: eno.vn messages you the jobs and cover lessons that fit your profile. Tap to see how it works or to switch it off.'

/** A row never told — no invite, no withdrawal, no switch-on of the teacher's own — the only kind the claim may stamp. */
const NOT_TOLD = { invitedAt: null, withdrawnAt: null, OR: [{ noticeVersion: null }, { noticeVersion: JOB_DM_DEFAULT_ON }] } satisfies Prisma.TeacherJobDmConsentWhereInput

/** 21:00–08:00 Vietnam time (UTC+7 all year): no invite inside it — a bell and a push at night are a nuisance. */
export function inviteIsQuiet(now: number): boolean {
  const h = new Date(now + 7 * 3_600_000).getUTCHours()
  return h >= JOB_DM_RULES.quietFromHour || h < JOB_DM_RULES.quietToHour
}

/** Who may be invited (above). The selection only: the claim re-checks under the lock. */
export function inviteCandidateWhere(): Prisma.TeacherProfileWhereInput {
  return {
    ...defaultOnTeacherWhere(),
    profile: { OR: [{ teacherJobDmConsent: { is: null } }, { teacherJobDmConsent: { is: NOT_TOLD } }] },
  }
}

export async function countInviteCandidates(): Promise<number> {
  return db.teacherProfile.count({ where: inviteCandidateWhere() })
}

/** The next `take` teachers to invite, oldest profile first — a run cut short carries on where it stopped. */
export async function loadInviteCandidates(take: number): Promise<string[]> {
  const rows = await db.teacherProfile.findMany({
    where: inviteCandidateWhere(),
    select: { profileId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  })
  return rows.map((r) => r.profileId)
}

/**
 * Claim the teacher's one invite and write its bell, in one transaction. True ONLY for the call that invited; false when
 * the teacher was invited meanwhile, used the switch meanwhile, or is no longer live (a profile hidden since the
 * selection is not rung). Throws on a database error — then nothing was written.
 */
export async function claimAndInvite(profileId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockJobDmTeacher(tx, profileId)
    // The whole selection, again, under the lock: live, with an active verified listing, never the demo one (codex, 5a).
    const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: { status: true, listingId: true, listing: { select: { status: true, verified: true } } } })
    if (tp?.status !== 'live' || tp.listing?.status !== 'active' || tp.listing.verified !== true) return false
    if (tp.listingId && (HOME_HIDDEN_TEACHER_LISTING_IDS as readonly string[]).includes(tp.listingId)) return false
    const now = new Date()
    // ⛔ THE CLAIM: insert the row if there is none (ON CONFLICT DO NOTHING) — else stamp it only while never asked.
    const inserted = await tx.teacherJobDmConsent.createMany({ data: [{ profileId, invitedAt: now, updatedAt: now }], skipDuplicates: true })
    if (inserted.count !== 1) {
      const claimed = await tx.teacherJobDmConsent.updateMany({ where: { profileId, ...NOT_TOLD }, data: { invitedAt: now, updatedAt: now } })
      if (claimed.count !== 1) return false
    }
    await tx.notification.create({
      data: { recipientId: profileId, type: JOB_DM_INVITE.type, title: INVITE_TITLE, body: INVITE_BODY, url: JOB_DM_INVITE.url },
    })
    return true
  }, JOB_DM_TX_OPTS)
}
