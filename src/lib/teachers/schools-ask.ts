import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { insertMessage } from '@/lib/messages'
import { getOrCreateListinglessThread } from '@/lib/support-thread'
import { rateLimit } from '@/lib/ratelimit'
import { sendPushToProfile } from '@/lib/push'
import { sendMailOnce, mailEnabled } from '@/lib/mail'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { ictDay, ictDayLabel } from '@/lib/digest-schedule'
import { renderSchoolsAsk, schoolsAskChatText, schoolsAskCopy, type SchoolsAskLang } from '@/lib/emails/schools-ask'
import { JOBS_DESK_SELLER_ID, JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } from './job-dms/constants'
import { defaultOnTeacherWhere, jobDmConsented, jobDmLockKey } from './job-dms/consent'
import { abortReason, ensureJobsDeskSeller } from './job-dms/desk'

/**
 * THE SCHOOLS ASK (owner, 2026-11-20: "ask all teacher profiles to rank the schools they worked with … introduce the
 * schools page … in-app message and email, 50 per day out of 90 allowance"; channel = a chat message from eno, wording
 * approved as written — src/lib/emails/schools-ask.ts).
 *
 * WHO: every default-on teacher (live profile, active verified listing, not a hidden demo) whose job messages are ON and
 * not paused — a teacher who switched eno's desk messages off gets nothing from this either, email included (plan review:
 * the conservative reading). Oldest profile first, at most SCHOOLS_ASK.perRun a run, ONCE EVER (the ledger's primary key).
 *
 * THE CHAT MESSAGE goes into the teacher's jobs-desk thread ("Alex · eno.vn", replies land with the operator — desk.ts),
 * never a new thread. Its ledger row is written in the SAME transaction (insertMessage's `alongside`), under the teacher's
 * advisory lock and a guard that re-reads, inside the lock: live, consent on and not paused, not asked yet, and nothing
 * the teacher wrote that eno has not answered (a STOP or a question waiting — plan review 1). The run also processes the
 * desk's pending STOPs first (run.ts processStops is the job DMs' own pass; here we only skip a teacher whose newest desk
 * message is theirs). A crash can lose the message, never send it twice.
 * ⚠️ ACCEPTED, TOLD TO THE OWNER (plan review 2): the ask is one more eno message in the desk thread, so it counts toward
 * the job DMs' "2 until reply" — a teacher who never answers gets one job DM fewer before they pause.
 * It also skips a teacher who got a job DM today (no two desk pushes in a day).
 *
 * THE EMAIL, only with the digest's marketing consent (Profile.weeklyDigestOptIn) and the digest list's unsubscribe link:
 * claimed on the ledger (emailedAt) BEFORE sending, sent with sendMailOnce under the key `schools-ask:<profileId>:<day>` — at
 * worst lost, never doubled; a send Resend proves it refused releases the claim for a later run.
 * ⛔ THE BUDGET IS THE DIGEST'S, SHARED (Resend's daily quota): emails go out only in EMAIL_WINDOW (08:00–08:40 ICT, the
 * timer runs at 08:20), at most SCHOOLS_ASK.emailsPerDay a day; the digest at 08:45 subtracts what this sent today
 * (schoolsAskEmailsToday). A later manual run sends chat messages only. When everyone is asked, the digest has its 90 back.
 */
export const SCHOOLS_ASK = {
  perRun: 50,
  emailsPerDay: 50,
  /** ICT minutes since midnight when emails may go: before the digest (01:45 UTC = 08:45 ICT). */
  emailWindow: { from: 8 * 60, to: 8 * 60 + 40 },
  pushLimit: { key: 'teacher-jobs-notify', perDay: 2 },
} as const

const PUSH_TITLE = 'Alex · eno.vn'

export function ictMinutes(now: Date): number {
  const ict = new Date(now.getTime() + 7 * 3_600_000)
  return ict.getUTCHours() * 60 + ict.getUTCMinutes()
}
export function inEmailWindow(now: Date): boolean {
  const m = ictMinutes(now)
  return m >= SCHOOLS_ASK.emailWindow.from && m < SCHOOLS_ASK.emailWindow.to
}
export function langOf(locale: string | null | undefined): SchoolsAskLang {
  return (locale ?? '').toLowerCase().startsWith('vi') ? 'vi' : 'en'
}
/** The name to greet: the first word, or for a Vietnamese reader the LAST (the given name: "Nguyễn Văn An" → "An"). */
export function firstNameOf(displayName: string | null | undefined, lang: SchoolsAskLang = 'en'): string | null {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean)
  const f = (lang === 'vi' ? words[words.length - 1] : words[0]) ?? ''
  return f && f.length <= 40 && !/[@<>]/.test(f) ? f : null
}

/** Whether the ledger exists: the DDL (scripts/teacher-schools-ask.sql) runs before the first run. */
export async function schoolsAskReady(): Promise<boolean> {
  const r = await db.$queryRaw<{ ok: boolean }[]>`select to_regclass('public."TeacherSchoolsAsk"') is not null as ok`
  return !!r[0]?.ok
}

/** Emails this campaign sent (claimed) today, Vietnam time — what the digest leaves out of its cap. 0 before the DDL. */
export async function schoolsAskEmailsToday(now: Date): Promise<number> {
  if (!(await schoolsAskReady())) return 0
  const start = new Date(ictDay(now) * 86_400_000 - 7 * 3_600_000)
  const r = await db.$queryRaw<{ n: bigint }[]>`select count(*)::bigint as n from "TeacherSchoolsAsk" where "emailedAt" >= ${start}`
  return Number(r[0]?.n ?? 0)
}

type Candidate = { profileId: string; email: string | null; displayName: string | null; locale: string | null; emailOk: boolean }

/** Everyone the ask may still reach, oldest first (the guard re-checks each inside the lock). */
export async function schoolsAskCandidates(now: Date, excludedEmails: readonly string[]): Promise<Candidate[]> {
  const rows = await db.teacherProfile.findMany({
    where: defaultOnTeacherWhere(),
    select: {
      profileId: true,
      profile: { select: { email: true, displayName: true, locale: true, weeklyDigestOptIn: true, teacherJobDmConsent: { select: { optIn: true, noticeVersion: true, pausedAt: true } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const ids = rows.map((r) => r.profileId)
  if (!ids.length) return []
  const today = ictDayLabel(ictDay(now))
  const [asked, dmToday, waiting] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`select "profileId"::text as id from "TeacherSchoolsAsk" where "profileId" = any(${ids}::uuid[])`,
    db.teacherJobDmDay.findMany({ where: { profileId: { in: ids }, day: today }, select: { profileId: true } }),
    // The teacher wrote last in their desk thread: a STOP or a question eno has not answered yet.
    db.$queryRaw<{ id: string }[]>`
      select c."buyerProfileId"::text as id from "Conversation" c
       where c."buyerProfileId" = any(${ids}::uuid[]) and c."sellerId" = ${JOBS_DESK_SELLER_ID} and c."listingId" is null
         and (select m."senderProfileId" from "Message" m where m."conversationId" = c.id and m."deletedAt" is null
               order by m."createdAt" desc limit 1) = c."buyerProfileId"`,
  ])
  const skip = new Set([...asked.map((r) => r.id), ...dmToday.map((r) => r.profileId), ...waiting.map((r) => r.id)])
  const excluded = new Set(excludedEmails.map((e) => e.toLowerCase()))
  return rows
    .filter((r) => !skip.has(r.profileId) && jobDmConsented(r.profile?.teacherJobDmConsent) && !excluded.has((r.profile?.email ?? '').toLowerCase()))
    .map((r) => ({
      profileId: r.profileId,
      email: r.profile?.email ?? null,
      displayName: r.profile?.displayName ?? null,
      locale: r.profile?.locale ?? null,
      emailOk: !!r.profile?.email && !!r.profile?.weeklyDigestOptIn,
    }))
}

type SchoolStats = { schools: number; reviewed: boolean }
export async function schoolStats(): Promise<SchoolStats> {
  const r = await db.$queryRaw<{ schools: bigint; reviews: bigint }[]>`
    select (select count(*) from "School" where status = 'active')::bigint as schools,
           (select count(*) from "SchoolReview" where status = 'published')::bigint as reviews`
  return { schools: Number(r[0]?.schools ?? 0), reviewed: Number(r[0]?.reviews ?? 0) > 0 }
}

/** Post the ask into the teacher's desk thread, its ledger row in the same transaction. */
export async function sendSchoolsAskMessage(t: Candidate, operatorId: string, stats: SchoolStats, origin: string): Promise<'sent' | 'held'> {
  await ensureJobsDeskSeller()
  const existing = await db.conversation.findFirst({ where: { buyerProfileId: t.profileId, sellerId: JOBS_DESK_SELLER_ID, listingId: null }, select: { id: true } })
  const thread = await getOrCreateListinglessThread(db, { buyerProfileId: t.profileId, sellerId: JOBS_DESK_SELLER_ID, sellerProfileId: operatorId })
  const convo = { id: thread.id, buyerProfileId: t.profileId, sellerProfileId: operatorId, listingId: null, sellerId: JOBS_DESK_SELLER_ID }
  const copy = schoolsAskCopy({ lang: langOf(t.locale), firstName: firstNameOf(t.displayName, langOf(t.locale)), schools: stats.schools, reviewed: stats.reviewed, origin })
  const alongside: Prisma.PrismaPromise<unknown>[] = [
    db.$executeRaw`select set_config('lock_timeout', '3000ms', true)`,
    db.$executeRaw`select pg_advisory_xact_lock(hashtext(${jobDmLockKey(t.profileId)}))`,
    db.$queryRaw`select 1 / (case when
        exists (select 1 from "TeacherJobDmConsent" c where c."profileId" = ${t.profileId}::uuid and c."optIn"
                  and (c."noticeVersion" = ${JOB_DM_NOTICE_VERSION} or c."noticeVersion" = ${JOB_DM_DEFAULT_ON}) and c."pausedAt" is null)
        and exists (select 1 from "TeacherProfile" tp where tp."profileId" = ${t.profileId}::uuid and tp.status = 'live')
        and not exists (select 1 from "TeacherSchoolsAsk" a where a."profileId" = ${t.profileId}::uuid)
        and coalesce((select m."senderProfileId" from "Message" m where m."conversationId" = ${thread.id} and m."deletedAt" is null
                       order by m."createdAt" desc limit 1) <> ${t.profileId}::uuid, true)
      then 1 else 0 end) as ok`,
    db.$executeRaw`insert into "TeacherSchoolsAsk" ("profileId", "conversationId") values (${t.profileId}::uuid, ${thread.id})`,
  ]
  try {
    await insertMessage(convo, operatorId, schoolsAskChatText(copy), { alongside })
  } catch (e) {
    if (!existing) await db.conversation.deleteMany({ where: { id: thread.id, messages: { none: {} } } }).catch((c) => logError(c, { op: 'schools-ask.empty-thread' }))
    // The job DMs' own classifier: the ledger's key (P2002) or the guard's division by zero → held; anything else (a lock
    // timeout, a bad cast) is a real failure the run counts and reports (gate, 2026-11-20).
    if (abortReason(e)) return 'held'
    throw e
  }
  // Best-effort, after the commit: the push names the desk; the message itself shows in Messages.
  try {
    const cap = await rateLimit(SCHOOLS_ASK.pushLimit.key, t.profileId, SCHOOLS_ASK.pushLimit.perDay, '1 d')
    if (cap.success) await sendPushToProfile(t.profileId, { title: PUSH_TITLE, body: copy.subject, url: `/messages/${thread.id}`, tag: `convo-${thread.id}` })
  } catch (e) {
    console.error('[schools-ask] push', e)
  }
  return 'sent'
}

/** Email one asked teacher: claim, send once, release only on a proven refusal. */
export async function emailSchoolsAsk(t: Candidate, stats: SchoolStats, origin: string): Promise<'sent' | 'skipped' | 'refused' | 'unknown' | 'stop'> {
  if (!t.emailOk || !t.email || !mailEnabled()) return 'skipped'
  const token = mintUnsubscribeToken(t.profileId)
  if (!token) return 'skipped'
  const claimed = await db.$executeRaw`update "TeacherSchoolsAsk" set "emailedAt" = now() where "profileId" = ${t.profileId}::uuid and "emailedAt" is null`
  if (claimed !== 1) return 'skipped'
  const copy = schoolsAskCopy({ lang: langOf(t.locale), firstName: firstNameOf(t.displayName, langOf(t.locale)), schools: stats.schools, reviewed: stats.reviewed, origin })
  const unsubscribeUrl = `${origin}/unsubscribe?token=${encodeURIComponent(token)}`
  const { subject, html, text } = renderSchoolsAsk(copy, { origin, unsubscribeUrl })
  const r = await sendMailOnce(
    { to: t.email, subject, html, text, headers: { 'List-Unsubscribe': `<${origin}/api/unsubscribe?token=${encodeURIComponent(token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } },
    // The day in the key: a crash-retry the same morning is the same request; a send released after a proven refusal (rate
    // limit, quota) is retried on a later day under a NEW key, never answered from Resend's 24 h memory of the refusal.
    { idempotencyKey: `schools-ask:${t.profileId}:${ictDayLabel(ictDay(new Date()))}` },
  )
  if (r.outcome === 'sent') return 'sent'
  if (r.outcome === 'refused') {
    // Release the claim only when a LATER run can succeed (a rate limit or the day's quota); a refusal of THIS message (a bad
    // address, a validation error) keeps it — tried once, never every morning forever (gate, 2026-11-20).
    if (RETRYABLE.has(r.name ?? '')) await db.$executeRaw`update "TeacherSchoolsAsk" set "emailedAt" = null where "profileId" = ${t.profileId}::uuid`
    return r.stopRun ? 'stop' : 'refused'
  }
  return 'unknown'
}

const RETRYABLE = new Set(['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded'])

/**
 * Asked teachers whose email is still owed (a rate limit or the quota released it), oldest ask first — under the SAME rules
 * as a new ask (gate, 2026-11-20): live, desk messages on and not paused, not an excluded address, and nothing they wrote
 * that eno has not answered (a STOP since the ask stops the email too).
 */
export async function schoolsAskEmailsOwed(excludedEmails: readonly string[]): Promise<Candidate[]> {
  const rows = await db.$queryRaw<{ id: string; email: string | null; displayName: string | null; locale: string | null }[]>`
    select a."profileId"::text as id, p.email, p."displayName", p.locale
      from "TeacherSchoolsAsk" a
      join "Profile" p on p.id = a."profileId"
      join "TeacherProfile" tp on tp."profileId" = a."profileId" and tp.status = 'live'
      join "TeacherJobDmConsent" c on c."profileId" = a."profileId" and c."optIn" and c."pausedAt" is null
                                  and (c."noticeVersion" = ${JOB_DM_NOTICE_VERSION} or c."noticeVersion" = ${JOB_DM_DEFAULT_ON})
     where a."emailedAt" is null and p."weeklyDigestOptIn" and p.email is not null
       and lower(p.email) <> all(${excludedEmails.map((e) => e.toLowerCase())}::text[])
       and coalesce((select m."senderProfileId" from "Message" m where m."conversationId" = a."conversationId" and m."deletedAt" is null
                      order by m."createdAt" desc limit 1) <> a."profileId", true)
     order by a."sentAt" asc`
  return rows.map((r) => ({ profileId: r.id, email: r.email, displayName: r.displayName, locale: r.locale, emailOk: !!r.email }))
}
