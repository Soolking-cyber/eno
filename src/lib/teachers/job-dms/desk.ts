import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { getOrCreateListinglessThread } from '@/lib/support-thread'
import { rateLimit } from '@/lib/ratelimit'
import { sendPushToProfile } from '@/lib/push'
import { JOBS_DESK_NAME, JOBS_DESK_SELLER_ID, JOB_DM_NOTICE_VERSION, JOB_DM_RULES } from './constants'
import { jobDmLockKey } from './consent'

/**
 * THE JOBS DESK — who sends Alex's messages, and the one function that sends one.
 *
 * The thread is LISTING-LESS (one per teacher, the partial unique index Conversation_support_thread_key), its Seller the
 * unowned desk 'eno-jobs-desk' named "Alex · eno.vn", its sellerProfileId the OPERATOR — the person whose /messages inbox
 * the teachers' replies land in (the rental desk's pattern and default: support@eno.forum, which the owner reads).
 * ⛔ WHY NOT THE TEACHER'S OWN LISTING THREAD: there eno would be a "school" — the DM ladder (≤30 new teachers a day),
 * "2 until reply", the ring, three reminder emails and the Share-my-contact strip all fire against eno itself. A desk
 * thread has none of them, so this module enforces its OWN bounds (below), each inside the message's transaction.
 */

export function jobsOperatorEmail(): string {
  return (process.env.JOBS_DESK_OPERATOR_EMAIL || process.env.RENTAL_CHECK_OPERATOR_EMAIL || 'support@eno.forum').trim().toLowerCase()
}

/** The operator's Profile id; null REFUSES the run (a message nobody can answer is worse than none). */
export async function resolveJobsOperatorProfileId(): Promise<string | null> {
  const email = jobsOperatorEmail()
  if (!email) return null
  const p = await db.profile.findUnique({ where: { email }, select: { id: true } })
  return p?.id ?? null
}

let deskEnsured = false
/** The desk Seller row, created lazily (only id and name are NOT NULL without a default — rental-check/desk.ts). */
export async function ensureJobsDeskSeller(): Promise<void> {
  if (deskEnsured) return
  await db.seller.createMany({ data: [{ id: JOBS_DESK_SELLER_ID, name: JOBS_DESK_NAME }], skipDuplicates: true })
  deskEnsured = true
}

export type SendOutcome =
  | { sent: true; conversationId: string; messageId: string }
  | { sent: false; reason: 'duplicate' | 'held' }

/**
 * ⛔ THE ATOMIC SEND. Everything that must hold for a message to go out is re-asserted INSIDE its batch transaction
 * (insertMessage's `alongside`, run before the insert — dm-quota.ts teacherUnansweredGuard is the precedent):
 *   1. a per-teacher transaction-scoped advisory lock, so two runs never interleave for one teacher;
 *   2. the guard — consent ON under the current notice, the teacher profile still live, and fewer than
 *      JOB_DM_RULES.unansweredMax desk messages since the teacher last wrote — aborting the batch by division by zero
 *      (SQLSTATE 22012) when any fails;
 *   3. the ledger: a TeacherJobDmDay row (one per teacher, day and kind — a second message of that kind today violates
 *      the key) and one TeacherJobDm row per job (a job already sent violates its key). Either violation (P2002) rolls
 *      back the WHOLE batch, message included.
 * So a crash, a retry or a parallel run can produce at worst NO message — never two, and never a message with no
 * ledger row. The bell and push run only AFTER the commit, best-effort: a missing bell is the failure mode, not a
 * duplicate message.
 */
export async function sendJobDm(a: {
  teacherProfileId: string
  operatorId: string
  kind: 'jobs' | 'cover'
  day: string
  text: string
  jobs: readonly { key: string; score: number; reasons: readonly string[] }[]
}): Promise<SendOutcome> {
  // A cheap pre-check of the guard below, so a teacher who switched off or went hidden since the run planned does not
  // get an empty "Alex · eno.vn" thread (codex + opus, gate 3a). The guard inside the batch stays the one that counts.
  const consent = await db.teacherJobDmConsent.findUnique({ where: { profileId: a.teacherProfileId }, select: { optIn: true, noticeVersion: true } })
  if (!consent?.optIn || consent.noticeVersion !== JOB_DM_NOTICE_VERSION) return { sent: false, reason: 'held' }
  await ensureJobsDeskSeller()
  const existing = await db.conversation.findFirst({ where: { buyerProfileId: a.teacherProfileId, sellerId: JOBS_DESK_SELLER_ID, listingId: null }, select: { id: true } })
  const thread = await getOrCreateListinglessThread(db, { buyerProfileId: a.teacherProfileId, sellerId: JOBS_DESK_SELLER_ID, sellerProfileId: a.operatorId })
  const convo = { id: thread.id, buyerProfileId: a.teacherProfileId, sellerProfileId: a.operatorId, listingId: null, sellerId: JOBS_DESK_SELLER_ID }
  const alongside: Prisma.PrismaPromise<unknown>[] = [
    db.$executeRaw`select pg_advisory_xact_lock(hashtext(${jobDmLockKey(a.teacherProfileId)}))`,
    db.$queryRaw`select 1 / (case when
        exists (select 1 from "TeacherJobDmConsent" c where c."profileId" = ${a.teacherProfileId}::uuid and c."optIn" and c."noticeVersion" = ${JOB_DM_NOTICE_VERSION})
        and exists (select 1 from "TeacherProfile" tp where tp."profileId" = ${a.teacherProfileId}::uuid and tp.status = 'live')
        and (select count(*) from "Message" m
               where m."conversationId" = ${thread.id} and m."senderProfileId" = ${a.operatorId}::uuid
                 and m."createdAt" > coalesce((select max(t."createdAt") from "Message" t
                                               where t."conversationId" = ${thread.id} and t."senderProfileId" = ${a.teacherProfileId}::uuid), 'epoch'::timestamp)
            ) < ${JOB_DM_RULES.unansweredMax}::int
      then 1 else 0 end) as ok`,
    db.teacherJobDmDay.create({ data: { profileId: a.teacherProfileId, day: a.day, kind: a.kind, conversationId: thread.id } }),
    ...a.jobs.map((j) => db.teacherJobDm.create({
      data: { profileId: a.teacherProfileId, jobKey: j.key, mode: 'live', kind: a.kind, day: a.day, conversationId: thread.id, score: j.score, reasons: [...j.reasons] },
    })),
  ]
  try {
    const m = await insertMessage(convo, a.operatorId, a.text, { alongside })
    await ringTeacher(a.teacherProfileId, thread.id)
    return { sent: true, conversationId: thread.id, messageId: m.id }
  } catch (e) {
    const why = abortReason(e)
    // A thread this call opened and that holds nothing goes again — no empty desk thread is left behind.
    if (!existing) await db.conversation.deleteMany({ where: { id: thread.id, messages: { none: {} } } }).catch(() => undefined)
    if (why) return { sent: false, reason: why }
    throw e
  }
}

/** P2002 (a ledger key) → 'duplicate'; the guard's division by zero (P2010 / 22012) → 'held'; anything else → null. */
export function abortReason(e: unknown): 'duplicate' | 'held' | null {
  const x = e as { code?: unknown; meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } } | null
  if (x?.code === 'P2002') return 'duplicate'
  if (x?.code === 'P2010') {
    const c = x.meta?.driverAdapterError?.cause
    const code = c?.code ?? c?.originalCode
    if (code === '22012') return 'held'
    if (code === '23505') return 'duplicate'
  }
  return null
}

/**
 * Persisted copy is a bilingual composite (notify.ts's idiom: stored server-side, where tr() cannot run; the bell
 * machine-translates the 'teacher_jobs' type for the other languages — notification-text.ts MACHINE_TRANSLATABLE).
 */
const RING_TITLE = 'Việc làm phù hợp với bạn · Jobs that match your profile'
const RING_BODY = 'Alex · eno.vn đã gửi cho bạn việc làm mới. · Alex from eno.vn sent you new jobs.'

/** One bell + web push per job message, at most two a day (one jobs, one cover). Best-effort, after the commit. */
async function ringTeacher(teacherProfileId: string, conversationId: string): Promise<void> {
  try {
    const cap = await rateLimit('teacher-jobs-notify', teacherProfileId, 2, '1 d')
    if (!cap.success) return
    await db.notification.create({ data: { recipientId: teacherProfileId, type: 'teacher_jobs', title: RING_TITLE, body: RING_BODY, conversationId } })
    await sendPushToProfile(teacherProfileId, { title: RING_TITLE, body: RING_BODY, url: `/messages/${conversationId}`, tag: `convo-${conversationId}` })
  } catch (e) {
    console.error('[job-dms] ring', e)
  }
}

const STOP_ACK = 'Got it — no more job messages from us. You can switch them back on any time at https://eno.vn/teachers/job-messages'

/**
 * A teacher's STOP, read from the desk thread: the withdrawal and its acknowledgement are ONE transaction (codex, gates
 * 3a + 3b: an ack that failed after the withdrawal had committed was never retried). The batch takes the teacher's lock
 * (consent.ts jobDmLockKey — the one sendJobDm takes first, so a message already on its way goes out BEFORE the
 * withdrawal and none after it), flips the switch as a compare-and-set that aborts the batch when there was nothing to
 * flip (SQLSTATE 22012 — a re-run or a parallel run sends nothing), then inserts the ack. Any failure rolls back both,
 * and the next run, still seeing the STOP and the switch ON, tries again.
 * ⚠️ The ack bypasses the send guard on purpose (the consent is OFF by then); it is still one message, once per STOP.
 */
export async function honourStop(teacherProfileId: string, operatorId: string, conversationId: string, now: Date): Promise<boolean> {
  const alongside: Prisma.PrismaPromise<unknown>[] = [
    db.$executeRaw`select pg_advisory_xact_lock(hashtext(${jobDmLockKey(teacherProfileId)}))`,
    db.$queryRaw`with w as (
        update "TeacherJobDmConsent" set "optIn" = false, "withdrawnAt" = ${now}, "updatedAt" = ${now}
         where "profileId" = ${teacherProfileId}::uuid and "optIn" returning 1)
      select 1 / (select count(*)::int from w) as ok`,
  ]
  try {
    await insertMessage({ id: conversationId, buyerProfileId: teacherProfileId, sellerProfileId: operatorId, listingId: null, sellerId: JOBS_DESK_SELLER_ID }, operatorId, STOP_ACK, { alongside })
  } catch (e) {
    if (abortReason(e) === 'held') return false // nothing to withdraw: already off
    throw e
  }
  console.info('[job-dms] withdrawn', { profileId: teacherProfileId, why: 'stop_reply' })
  return true
}
