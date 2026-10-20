import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { JOB_DM_RULES } from './constants'
import { JOB_DM_TX_OPTS, lockJobDmTeacher } from './consent'

/**
 * THE ONE-TIME INVITE (owner, 2026-10-20 — plan v2 "CONSENT": "Existing teachers get ONE in-app bell invite (once per
 * teacher, daily for new teachers)"). GET /api/cron/job-dms-invite, daily: each live teacher who has never used the job
 * messages switch gets ONE bell row — in the app only, never a web push (the permission was given for messages, not news
 * of a feature: /privacy says "in the app only") — pointing at /teachers/job-messages, where the
 * switch and its notice are. The invite consents to nothing and sends no job — the switch stays OFF until the teacher
 * turns it on there.
 *
 * WHO — a teacher who has never been asked and never answered:
 *   · TeacherProfile status 'live' and its listing live (active + verified) — the teachers the jobs desk can reach once
 *     they opt in (run.ts loadTeachers reads the same); a teacher under review is invited on a later day, once live;
 *   · never the owner's DEMO profile (constants.ts HOME_HIDDEN_TEACHER_LISTING_IDS — not a teacher anyone can hire);
 *   · no TeacherJobDmConsent row, or one with no invite, no grant and no withdrawal (NEVER_ASKED). ⛔ A teacher who switched
 *     it ON already needs no invite; one who switched it OFF made a choice — never a bell over it; an ON under an older
 *     notice is a re-confirmation, a different message — not this one.
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

export const INVITE_TITLE = 'Nhận việc làm phù hợp qua tin nhắn eno · Get matching jobs in eno chat'
export const INVITE_BODY =
  'Mới cho giáo viên: bật lên để eno.vn nhắn cho bạn các việc làm và buổi dạy thay phù hợp với hồ sơ. Nhấn để xem cách hoạt động. · ' +
  'New for teachers: switch it on and eno.vn messages you the jobs and cover lessons that fit your profile. Tap to see how it works.'

/** A row that has never been invited, granted or withdrawn — the only kind the claim may stamp. */
const NEVER_ASKED = { invitedAt: null, optIn: false, optInAt: null, withdrawnAt: null } as const

/** 21:00–08:00 Vietnam time (UTC+7 all year): no invite inside it — a bell and a push at night are a nuisance. */
export function inviteIsQuiet(now: number): boolean {
  const h = new Date(now + 7 * 3_600_000).getUTCHours()
  return h >= JOB_DM_RULES.quietFromHour || h < JOB_DM_RULES.quietToHour
}

/** Who may be invited (above). The selection only: the claim re-checks under the lock. */
export function inviteCandidateWhere(): Prisma.TeacherProfileWhereInput {
  return {
    status: 'live',
    listing: { status: 'active', verified: true },
    NOT: { listingId: { in: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } },
    profile: { OR: [{ teacherJobDmConsent: { is: null } }, { teacherJobDmConsent: { is: NEVER_ASKED } }] },
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
      const claimed = await tx.teacherJobDmConsent.updateMany({ where: { profileId, ...NEVER_ASKED }, data: { invitedAt: now, updatedAt: now } })
      if (claimed.count !== 1) return false
    }
    await tx.notification.create({
      data: { recipientId: profileId, type: JOB_DM_INVITE.type, title: INVITE_TITLE, body: INVITE_BODY, url: JOB_DM_INVITE.url },
    })
    return true
  }, JOB_DM_TX_OPTS)
}
