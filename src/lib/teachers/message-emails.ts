import { db as defaultDb } from '@/lib/db'
import { liveForSeller } from '@/lib/unread'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { blockedConversationIds } from '@/lib/user-blocks'

type Db = typeof defaultDb
type Reader = Pick<Db, 'conversation'>

/**
 * Message emails to teachers (owner, 2026-10-12): "if someone messages the teacher they should receive an email with
 * notification within 1 hour, make it 1 per day so it won't spam … once per day to remind they have unread message and
 * send new email only if someone new messages". The cron (/api/cron/teacher-message-emails, every 30 min) runs THIS rule:
 *
 *   · SOMEONE NEW → an email now. A teacher thread whose school has never triggered an email (no TeacherMessageEmailThread
 *     row), whose newest message is the school's and arrived in the last NEW_WITHIN: email this run, whatever the daily
 *     clock says. A school has exactly one thread per teacher (Conversation @@unique([listingId, buyerProfileId])), so "a
 *     different person" is "a thread not emailed yet".
 *     ⚠️ Older never-emailed threads — the backlog on the day this ships — are NOT "new" (Opus, gate): they go out in the
 *     next morning reminder, not as a blast of "a school sent you a message" at whatever hour the timer first fires.
 *     ⚠️ At most MAX_NEW_PER_24H of these per teacher in any 24 h (Opus, plan review: one run per new school is up to 48 a
 *     day from a swarm of business accounts — the bell caps its rings at 20 for the same reason). Rolling, not per
 *     calendar day (Opus, gate): a per-day cap reset at midnight and mailed the held-back schools at 00:07.
 *   · OTHERWISE, ONCE A DAY, IN THE MORNING → a reminder. Anything still unread, in a run between 08:00 and 11:59 Vietnam
 *     time — the first that finds no email of any kind yet that Vietnam day sends it, so a failed 08:07 run is caught up by
 *     the next (Opus, gate) and it still goes out once. A fixed hour, not "24 h after the last one" (Opus): on a 30-minute timer a
 *     rolling gate drifts later every day and lands reminders at 3 a.m.; a 20 h gate (codex) sends two in one day. The
 *     reminder marks every school it covers as emailed.
 *   · OTHERWISE NOTHING. More messages from a school already emailed about only ever ride the daily reminder.
 *   At most ONE email per teacher per run; it counts every unread thread, names no school and quotes no message (business
 *   names are self-declared — src/lib/teachers/notify.ts carries no sender name for the same reason).
 *   ⚠️ No cap on reminders and no age limit on them: the owner asked for a daily reminder while anything is unread, and the
 *   plan review (codex) refused limits the owner never set. Opening the thread or unsubscribing stops them.
 *
 * ⛔ ELIGIBLE = WHAT THE INBOX SHOWS AND THE BELL WOULD RING FOR, read the same way at plan time and again inside the claim
 * (codex + Opus, gate: a claim that re-checked only "unread" mailed a teacher who had just switched off, blocked the school
 * or read the new thread): Conversation.sellerUnread > 0 (the teacher is the SELLER side of a teacher thread) over the
 * threads the inbox shows — the same deleted-thread predicate (unread.ts liveForSeller: a thread the teacher deleted
 * counts again once the school writes after it), never the support desk, never a blocked pair — of a LIVE teacher
 * (TeacherProfile.status, the teacher's own switch, as notify.ts reads it), and only while the thread's newest standing
 * message is the school's: a recall does not decrement the counter, so a school that sent one message and recalled it
 * would otherwise ghost-email the teacher.
 */
export const MESSAGE_EMAIL_RULES = {
  /** The reminder window, Vietnam hours [from, until): the first run in it sends the day's one reminder. */
  reminderFromHourVn: 8,
  reminderUntilHourVn: 12,
  /** A never-emailed thread is "someone new" only if the school's newest message is this recent. */
  newWithinMs: 48 * 60 * 60 * 1000,
  /** "Someone new" emails per teacher in any 24 h; past it, the new schools ride the next reminder. */
  maxNewPer24h: 8,
  /** One read per run, NEWEST first (codex + Opus, gate): past this, the oldest unread threads miss a reminder — logged. */
  maxThreads: 5000,
  /** Sends per run (Opus, gate round 4): Resend's quota is shared with passwordless sign-in mail — a flood must never
   *  become a sign-in outage. The rest go in the next run, half an hour later. */
  maxSendsPerRun: 200,
} as const

const VN_OFFSET_MS = 7 * 60 * 60 * 1000 // Vietnam is UTC+7 all year (no DST)
const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight in Vietnam, as a UTC instant, of the Vietnam day `now` falls in. */
export function vnDayStart(now: number): number {
  return Math.floor((now + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS
}

/** The hour of the day in Vietnam (0–23). */
export function vnHour(now: number): number {
  return new Date(now + VN_OFFSET_MS).getUTCHours()
}

export type UnreadTeacherThread = {
  conversationId: string
  /** The teacher's Profile.id — Conversation.sellerProfileId of their teacher thread. */
  teacherProfileId: string
  unread: number
  /** When the school's newest standing message arrived. */
  lastSchoolMessageAt: Date
}

export type TeacherEmailState = { lastEmailAt: Date | null; optedOutAt: Date | null }

export type PlannedMessageEmail = {
  teacherProfileId: string
  kind: 'new' | 'reminder'
  /** Every unread thread the email counts. */
  threadIds: string[]
  /** The never-emailed threads this email marks as emailed (TeacherMessageEmailThread). */
  newThreadIds: string[]
  /** The state the plan read: the claim moves lastEmailAt only from exactly this (compare-and-set). */
  hadState: boolean
  prevLastEmailAt: Date | null
}

/** The eligibility rule's database half — built per call (unread.ts explains why never at module scope). */
const eligibleWhere = (extra: object) => ({
  AND: [
    extra,
    { sellerUnread: { gt: 0 } },
    { sellerProfileId: { not: null } },
    { sellerId: { not: SUPPORT_SELLER_ID } },
    { listing: { listingType: TEACHER_LISTING_TYPE } },
    // The teacher's own switch, read as the bell reads it (notify.ts) — never a listing read.
    { sellerProfile: { is: { teacherProfile: { is: { status: 'live' } } } } },
    liveForSeller(),
  ],
})

/**
 * The eligible unread threads among `extra` (all of them, or the ids a claim re-checks), with the rule's two halves that
 * a query cannot hold: the newest standing message must be the school's, and no blocked pair. NEWEST first.
 */
async function readEligible(
  client: Reader, extra: object, take: number, blocked?: Set<string>,
): Promise<{ rows: UnreadTeacherThread[]; truncated: boolean }> {
  const found = await client.conversation.findMany({
    where: eligibleWhere(extra),
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, sellerUnread: true,
      messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { senderProfileId: true, createdAt: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take,
  })
  const byTeacher = new Map<string, typeof found>()
  for (const r of found) {
    if (!r.sellerProfileId || r.sellerProfileId === r.buyerProfileId || r.messages[0]?.senderProfileId !== r.buyerProfileId) continue
    byTeacher.set(r.sellerProfileId, [...(byTeacher.get(r.sellerProfileId) ?? []), r])
  }
  // The inbox hides a thread with a blocked person (either direction), so the email never counts one. The claim passes the
  // set it read BEFORE its transaction (Opus, gate): blockedConversationIds uses the global client, and asking it for a
  // second connection inside an interactive transaction can wait forever on a pool of one. Read in parallel (codex, gate).
  const hiddenBy = new Map<string, Set<string>>()
  const teachers = [...byTeacher.keys()]
  // Ten at a time (Opus, gate round 5): an unbounded fan-out over thousands of teachers would time the pool out.
  for (let i = 0; i < teachers.length; i += 10) {
    const chunk = teachers.slice(i, i + 10)
    for (const [t, set] of await Promise.all(chunk.map(async (t) => [t, blocked ?? new Set(await blockedConversationIds(t))] as const))) hiddenBy.set(t, set)
  }
  const rows: UnreadTeacherThread[] = []
  for (const [teacherProfileId, list] of byTeacher) {
    const hidden = hiddenBy.get(teacherProfileId)!
    for (const r of list) {
      if (!hidden.has(r.id)) rows.push({ conversationId: r.id, teacherProfileId, unread: r.sellerUnread, lastSchoolMessageAt: r.messages[0].createdAt })
    }
  }
  return { rows, truncated: found.length === take }
}

/** Every eligible unread teacher thread, newest first. Read-only. */
export async function loadUnreadTeacherThreads(db: Db = defaultDb): Promise<UnreadTeacherThread[]> {
  const { rows, truncated } = await readEligible(db, {}, MESSAGE_EMAIL_RULES.maxThreads)
  if (truncated) console.error('[teacher-message-emails] read capped at', MESSAGE_EMAIL_RULES.maxThreads, 'threads — the oldest miss a reminder this run')
  return rows
}

/**
 * How many "someone new" emails each teacher got in the last 24 h: the distinct claim times among their thread rows (every
 * email that marked a school as emailed stamped its rows with its own claim time). Read-only.
 */
export async function loadNewEmailsLast24h(db: Db, teacherIds: string[], now: number): Promise<Map<string, number>> {
  if (!teacherIds.length) return new Map()
  const rows = await db.teacherMessageEmailThread.groupBy({
    by: ['profileId', 'emailedAt'],
    // Only the "someone new" emails count (codex, gate): a reminder that marks the backlog emailed must not use a slot.
    where: { profileId: { in: teacherIds }, kind: 'new', emailedAt: { gt: new Date(now - DAY_MS) } },
  })
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.profileId, (counts.get(r.profileId) ?? 0) + 1)
  return counts
}

/** The rule, as a pure function of what was read — the cron's dry run counts exactly this. */
export function planMessageEmails(
  threads: UnreadTeacherThread[],
  states: Map<string, TeacherEmailState>,
  emailedThreadIds: Set<string>,
  newEmailsLast24h: Map<string, number>,
  now: number,
): PlannedMessageEmail[] {
  const byTeacher = new Map<string, UnreadTeacherThread[]>()
  for (const t of threads) byTeacher.set(t.teacherProfileId, [...(byTeacher.get(t.teacherProfileId) ?? []), t])
  const today = vnDayStart(now)
  const hour = vnHour(now)
  const reminderRun = hour >= MESSAGE_EMAIL_RULES.reminderFromHourVn && hour < MESSAGE_EMAIL_RULES.reminderUntilHourVn
  const plan: PlannedMessageEmail[] = []
  for (const [teacherProfileId, list] of byTeacher) {
    const state = states.get(teacherProfileId)
    if (state?.optedOutAt) continue
    const threadIds = list.map((t) => t.conversationId)
    const neverEmailed = list.filter((t) => !emailedThreadIds.has(t.conversationId))
    const fresh = neverEmailed.filter((t) => now - t.lastSchoolMessageAt.getTime() <= MESSAGE_EMAIL_RULES.newWithinMs)
    const last = state?.lastEmailAt?.getTime() ?? null
    const capped = (newEmailsLast24h.get(teacherProfileId) ?? 0) >= MESSAGE_EMAIL_RULES.maxNewPer24h
    const kind = fresh.length && !capped ? 'new' : reminderRun && (last === null || last < today) ? 'reminder' : null
    if (!kind) continue
    plan.push({
      teacherProfileId, kind, threadIds,
      // A "new" email marks the fresh schools; a reminder marks every school it tells the teacher about.
      newThreadIds: (kind === 'new' ? fresh : neverEmailed).map((t) => t.conversationId),
      hadState: !!state, prevLastEmailAt: state?.lastEmailAt ?? null,
    })
  }
  return plan
}

const LOST = Symbol('lost')

/** What a claim actually covers, read inside it — the email counts THIS, never the plan (codex, gate). */
export type ClaimedMessageEmail = { threads: number; newThreads: number }

/**
 * ⛔ CLAIM BEFORE SENDING, AS ONE TRANSACTION (codex, plan review): win the teacher's state row — create it, or move
 * `lastEmailAt` from exactly the value the plan read, never past an opt-out — then re-read the WHOLE eligibility rule for
 * every thread the email is about: a teacher who switched off, read a thread, blocked a school, or a school that recalled
 * its message since the plan is not counted, and its thread is not marked emailed (codex + Opus, gate). A "new" email needs
 * at least one of its new schools still eligible; a reminder, any thread. Then record exactly the eligible never-emailed
 * threads, stamped with this claim's time and kind. Any step that finds another run (or a read, or an unsubscribe) got
 * there first rolls the whole claim back and the teacher is skipped. Two overlapping runs: exactly one wins.
 */
export async function claimMessageEmail(db: Db, e: PlannedMessageEmail, claimAt: Date): Promise<ClaimedMessageEmail | null> {
  // Read before the transaction — see readEligible: never a second connection from inside it.
  const blocked = new Set(await blockedConversationIds(e.teacherProfileId))
  try {
    return await db.$transaction(async (tx) => {
      if (e.hadState) {
        const moved = await tx.teacherMessageEmailState.updateMany({
          where: { profileId: e.teacherProfileId, lastEmailAt: e.prevLastEmailAt, optedOutAt: null },
          data: { lastEmailAt: claimAt, updatedAt: claimAt },
        })
        if (moved.count !== 1) throw LOST
      } else {
        // A concurrent create (another run, or the unsubscribe page) makes this a unique violation: rolled back, skipped.
        await tx.teacherMessageEmailState.create({ data: { profileId: e.teacherProfileId, lastEmailAt: claimAt, updatedAt: claimAt } })
      }
      const still = new Set((await readEligible(tx, { id: { in: e.threadIds }, sellerProfileId: e.teacherProfileId }, e.threadIds.length, blocked)).rows.map((r) => r.conversationId))
      const newIds = e.newThreadIds.filter((id) => still.has(id))
      if (!still.size || (e.kind === 'new' && !newIds.length)) throw LOST
      if (newIds.length) {
        const made = await tx.teacherMessageEmailThread.createMany({
          data: newIds.map((conversationId) => ({ conversationId, profileId: e.teacherProfileId, emailedAt: claimAt, kind: e.kind })),
          skipDuplicates: true,
        })
        if (made.count !== newIds.length) throw LOST
      }
      return { threads: still.size, newThreads: newIds.length }
    })
  } catch (err) {
    if (err === LOST || (err as { code?: string })?.code === 'P2002') return null
    throw err
  }
}

/**
 * Undo a claim after Resend REFUSED the send (nothing went out), so a later run tries again. ⛔ CONDITIONAL ON THE CLAIM
 * BEING OURS (codex): `lastEmailAt` goes back only if it still holds this claim's time, and only the thread rows stamped
 * with it are removed — a later run's claim is never erased. A claim whose send was UNCLEAR is never released.
 */
export async function releaseMessageEmail(db: Db, e: PlannedMessageEmail, claimAt: Date): Promise<void> {
  await db.$transaction([
    db.teacherMessageEmailState.updateMany({ where: { profileId: e.teacherProfileId, lastEmailAt: claimAt }, data: { lastEmailAt: e.prevLastEmailAt } }),
    db.teacherMessageEmailThread.deleteMany({ where: { conversationId: { in: e.newThreadIds }, emailedAt: claimAt } }),
  ])
}

/** The cron's answer: eno-cron.sh prints only the first 200 bytes. */
export function messageEmailResult(r: { teachers: number; sent: number; failed: number; invalid: number; unknown: number; skipped: number; stopped?: string | null; left?: number }) {
  return {
    // The send ceiling is a planned pause, not a failure: the next run carries on.
    ok: r.failed === 0 && r.invalid === 0 && (!r.stopped || r.stopped === 'ceiling'), teachers: r.teachers, sent: r.sent, failed: r.failed, invalid: r.invalid, unknown: r.unknown, skipped: r.skipped,
    ...(r.stopped ? { stopped: r.stopped.slice(0, 40), left: r.left ?? 0 } : {}),
  }
}
