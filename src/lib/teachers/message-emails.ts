import { db as defaultDb } from '@/lib/db'
import { liveForSeller } from '@/lib/unread'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { blockedConversationIds } from '@/lib/user-blocks'

type Db = typeof defaultDb
type Reader = Pick<Db, 'conversation' | '$queryRaw'>

/**
 * Message emails to teachers — v2 (owner, 2026-10-12): "maximum 3 reminders 1 hr 24 hours 3 days … no need to bombard with
 * emails. only when necessary and 3 max per 1 notif like school texted you 1 then 24 hours remember to check the new
 * message and 3 days you forgot to reply to the school … duolingo style". It REPLACES v1's "someone new at once, then one
 * reminder a day forever". The cron (/api/cron/teacher-message-emails, every 30 min) runs THIS rule.
 *
 * ⚠️ "SCHOOL" IN THESE COMMENTS (and SchoolRow) = THE THREAD'S BUYER SIDE (Conversation.buyerProfileId), WHOEVER WROTE TO
 * THE TEACHER: any signed-in account since the DM ladder (owner, 2026-10-13 — teachers/constants.ts TEACHER_DM_LIMITS), no
 * longer only a school or company. The emails themselves name no kind of sender (src/lib/emails/teacher-messages.ts).
 *
 * AN EPISODE per thread (one thread per school): it starts at the OLDEST UNREAD school message (the anchor) and gets at most
 * THREE emails, each only while that message is still unread —
 *     1 — an hour after it:   "You have a new message about your teacher profile"
 *     2 — a day after it:     "Remember to check your new message"
 *     3 — three days after:   "You haven’t replied to a message about your teacher profile yet" (and it says it is the
 *                             last email about it)
 * Opening the thread ends the episode. A new one starts when the school writes again after the teacher read, or after
 * the episode's third email (a follow-up is a new notice, not a fourth reminder). Further messages inside an episode ride
 * its remaining emails. A missed slot is never sent late as an extra email: an email records the latest stage due WHEN
 * IT IS CLAIMED (a thread first seen 30 h in gets stage 2 — never stage 1, then stage 2).
 *
 * ⛔ THE BOUNDS, EACH ONE CHECK, EXACT BY CONSTRUCTION (gate round 1, codex + Opus: soft caps and gaps that only applied in
 * some cases let a busy school or a backlog through — so the bounds are now unconditional):
 *   · one email per teacher per run, covering every thread due — each stage's own line, so a third-stage thread always
 *     gets its "last email" wording even beside a new school;
 *   · TEACHER_GAP: an hour between two emails to a teacher (the state row's compare-and-set). Read at the run's start
 *     against the last claim's time, which was taken minutes into ITS run, so on the 30-minute timer the second email
 *     usually lands 90 minutes after the first — kept: a recipient-facing gap is never shortened (codex, review of the
 *     slack that briefly read it as 55 minutes);
 *   · THREAD_GAP: a day between two emails about the same thread, in ANY episode — so a school that writes right after
 *     each read is emailed about at most once a day, and stage 2 lands a day after stage 1 as well as after the message;
 *   · MAX_PER_24H: four per teacher in any 24 h, counted from the thread rows plus the state's last email — exact because
 *     of THREAD_GAP: a row is never moved on within 24 h of its email, so every email of the last 24 h still has a row
 *     holding its claim time. (Two edges, at worst one email over: an email whose every thread was deleted since drops
 *     out unless it was the last; and v1's last reminder, on the v1 → v2 day, if a v2 email followed it.)
 *   · QUIET HOURS: none between 22:00 and 07:00 Vietnam time (the 07:07 run sends what waited) — checked again at every
 *     claim, and a run that reaches 22:00 stops (codex, gate round 2);
 *   · MAX_AGE: a message more than a week old is not news — it never starts an episode, and an episode never runs past
 *     it — so a stale unread message never mutes the school's newer ones (Opus, gate round 3: anchoring on it skipped the
 *     thread for good — measured on production: a thread whose unread window starts at a recalled 10-02 message);
 *   · at most MAX_THREADS_PER_EMAIL threads recorded by one email (the rest ride the next) — a claim's work stays bounded.
 * Names no sender and quotes no message (names are self-declared — src/lib/teachers/notify.ts carries no sender name for
 * the same reason).
 *
 * ⛔ ONE ROW PER THREAD = THE LAST EMAIL ABOUT IT (TeacherMessageEmailThread): `emailedAt` when, and `kind` = the stage it
 * recorded AND ITS EPISODE'S ANCHOR — `first@2026-10-12T08:00:00.000Z` (kindFor/parseKind; no column was added for it —
 * the deploy needs no DDL). The episode is RECORDED, never re-derived (Opus, gate round 2: a follow-up episode's first
 * email, re-derived against the oldest unread message, read as its third and went silent). A row's episode is still
 * current while its anchor is still in the unread window — messages leave the window only when the teacher reads; once
 * closed by its third email, the next episode starts at the oldest message newer than that email.
 * v1's rows carry no anchor ('new' ≡ first, 'reminder' ≡ second): theirs is the window's oldest message if the email is
 * newer than it, credited with the stage already due when it went out — v1's morning reminder about a message already 3
 * days old was its last email (Opus, plan review). ⚠️ THE v1 → v2 DAY: v1's reminder wrote no row for a school it had
 * already emailed about — so a thread whose row is v1's waits a day after the teacher's LAST email as well as after its
 * own (codex, gate rounds 2–3: otherwise a stage 3 lands hours after that reminder). It ends with the thread's next
 * email, which writes a v2 row.
 * ⛔ THE ANCHOR is the sellerUnread-th newest school message, RECALLED ONES INCLUDED: Conversation.sellerUnread counts the
 * school's messages since the teacher last opened the thread (src/lib/messages.ts:998 is its only increment, made for
 * exactly the rows the school sends — every app write of a Message goes through that function; the thread's GET and its
 * hide reset it; only desk threads are ever decremented) and a recall does not decrement it, so the unread window is the
 * last sellerUnread school rows, deleted or not (codex + Opus, plan review: counting standing rows only let a recall move
 * the anchor) — read in ONE statement with the counter (readWindows), so a message landing mid-read cannot shift it. An
 * episode with no standing message from its anchor on is not news.
 *
 * ⛔ ELIGIBLE = WHAT THE INBOX SHOWS AND THE BELL WOULD RING FOR, read at plan time and again inside the claim: sellerUnread >
 * 0 (the teacher is the SELLER side of a teacher thread) over the threads the inbox shows — unread.ts liveForSeller (a
 * deleted thread counts again once the school writes after it), never the support desk, never a blocked pair — of a LIVE
 * teacher (TeacherProfile.status, as notify.ts reads it), and only while the newest standing message is the school's.
 */
export const MESSAGE_EMAIL_RULES = {
  /** When emails 1, 2 and 3 of an episode are due, counted from its anchor. */
  stageAfterMs: [60 * 60 * 1000, 24 * 60 * 60 * 1000, 72 * 60 * 60 * 1000] as const,
  /** TEACHER_GAP: never two emails to the same teacher within this. */
  teacherGapMs: 60 * 60 * 1000,
  /** THREAD_GAP: never two emails about the same thread within this, in any episode. ⛔ ≥ 24 h keeps MAX_PER_24H exact. */
  threadGapMs: 24 * 60 * 60 * 1000,
  /** MAX_PER_24H: emails per teacher in any 24 h, all threads together. */
  maxPer24h: 4,
  /** QUIET HOURS, Vietnam time: no email from quietFromHourVn:00 until quietUntilHourVn:00. */
  quietFromHourVn: 22,
  quietUntilHourVn: 7,
  /** No claim this close to the quiet hours: its send (with retries, ≤ 15 s) must land before 22:00 (codex, gate round 4). */
  quietMarginMs: 5 * 60 * 1000,
  /** Threads one email records: a claim writes one row each inside its transaction, so a backlog never outgrows it. */
  maxThreadsPerEmail: 50,
  /** MAX_AGE: an anchor older than this is not news. */
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** One read per run, NEWEST first: past this, the oldest unread threads wait — logged. */
  maxThreads: 5000,
  /** Sends per run: Resend's quota is shared with passwordless sign-in mail. The rest go in the next run. */
  maxSendsPerRun: 200,
} as const

export type Stage = 1 | 2 | 3
/** What a ledger row's `kind` holds for each stage. */
export const STAGE_KIND = { 1: 'first', 2: 'second', 3: 'third' } as const

/** The stage a ledger row records (0 = none); v1's values read as their v2 equivalents. */
export function stageOf(kind: string | null | undefined): 0 | Stage {
  return kind === 'first' || kind === 'new' ? 1 : kind === 'second' || kind === 'reminder' ? 2 : kind === 'third' ? 3 : 0
}

/** The latest stage due for an episode anchored at `anchor` (0 = too early). */
export function dueStage(anchor: Date, now: number): 0 | Stage {
  const age = now - anchor.getTime()
  const [a, b, c] = MESSAGE_EMAIL_RULES.stageAfterMs
  return age >= c ? 3 : age >= b ? 2 : age >= a ? 1 : 0
}

/** Vietnam is UTC+7 all year (no daylight saving). */
export const vnHour = (now: number) => new Date(now + 7 * 60 * 60 * 1000).getUTCHours()
export const isQuietHour = (now: number) => {
  const h = vnHour(now)
  return h >= MESSAGE_EMAIL_RULES.quietFromHourVn || h < MESSAGE_EMAIL_RULES.quietUntilHourVn
}
/** What every send decision reads: the quiet hours, or about to be — so no claim's send crosses 22:00. */
export const quietSoon = (now: number) => isQuietHour(now) || isQuietHour(now + MESSAGE_EMAIL_RULES.quietMarginMs)

export type ThreadLedger = { emailedAt: Date; kind: string }
/** A school row of the unread window. */
export type SchoolRow = { createdAt: Date; deletedAt: Date | null }

/** What a ledger row's `kind` holds: the stage it recorded and its episode's anchor (v1 rows: the stage name only). */
export const kindFor = (stage: Stage, anchor: Date) => `${STAGE_KIND[stage]}@${anchor.toISOString()}`
export function parseKind(kind: string | null | undefined): { stage: 0 | Stage; anchor: Date | null } {
  const [name, at] = (kind ?? '').split('@')
  const t = at ? Date.parse(at) : NaN
  return { stage: stageOf(name), anchor: Number.isFinite(t) ? new Date(t) : null }
}

/** MAX_AGE: the window without the messages more than a week old — they are not news. */
export const freshWindow = (window: SchoolRow[], now: number) => window.filter((m) => now - m.createdAt.getTime() <= MESSAGE_EMAIL_RULES.maxAgeMs)

/** The thread's current episode: its anchor and the stage it has reached (0 = no email yet). */
export type Episode = { anchor: Date; stage: 0 | Stage }

/**
 * The thread's current episode, from its unread window (newest first, recalled rows included), its row (the header) and
 * the time: the row's own episode while its anchor is still unread, fresh and short of its third email; otherwise a new one.
 * null = nothing to email about (no standing message from the anchor on).
 * ⛔ "THE TEACHER READ SINCE" IS DECIDED ON THE WHOLE WINDOW — MAX_AGE trims only what can START an episode (Opus, gate
 * round 4: deciding it on the trimmed window read an aged-out anchor as a read and sent a fourth "last email" on day 7).
 * A closed episode (its third email) — or one that went stale while it stalled (opted out, capped) — is followed only by
 * a message newer than its last email: what that email covered never starts another.
 */
export function episodeOf(window: SchoolRow[], row: ThreadLedger | null | undefined, now: number): Episode | null {
  const oldest = window.at(-1)
  if (!oldest) return null
  const fresh = freshWindow(window, now)
  const start = (rows: SchoolRow[]): Episode | null => (rows.length ? { anchor: rows.at(-1)!.createdAt, stage: 0 } : null)
  let ep: Episode | null
  if (!row) ep = start(fresh)
  else {
    const { stage, anchor } = parseKind(row.kind)
    // v2: the anchor left the window (it restarts after a read). v1 (no anchor): the email predates the oldest unread.
    const readSince = anchor ? anchor.getTime() < oldest.createdAt.getTime() : row.emailedAt.getTime() <= oldest.createdAt.getTime()
    if (readSince) ep = start(fresh)
    else {
      const at = anchor ?? oldest.createdAt
      // v1's rows are credited with the stage already due when they went out (the header).
      const reached = (anchor ? stage : Math.max(stage, dueStage(oldest.createdAt, row.emailedAt.getTime()))) as 0 | Stage
      ep = reached < 3 && now - at.getTime() <= MESSAGE_EMAIL_RULES.maxAgeMs
        ? { anchor: at, stage: reached }
        : start(fresh.filter((m) => m.createdAt.getTime() > row.emailedAt.getTime()))
    }
  }
  return ep && window.some((m) => m.deletedAt === null && m.createdAt.getTime() >= ep!.anchor.getTime()) ? ep : null
}

export type UnreadTeacherThread = {
  conversationId: string
  /** The teacher's Profile.id — Conversation.sellerProfileId of their teacher thread. */
  teacherProfileId: string
  unread: number
  /** The last `unread` school rows, newest first, recalled ones included. */
  window: SchoolRow[]
}

export type TeacherEmailState = { lastEmailAt: Date | null; optedOutAt: Date | null }

/** `anchor`: the episode the plan computed the stage for — the claim drops the thread if it moved (a read then a new message). */
export type PlannedThread = { conversationId: string; stage: Stage; prev: ThreadLedger | null; anchor: Date }
export type PlannedMessageEmail = {
  teacherProfileId: string
  /** The threads this email is about, each with the stage due at plan time and the row the plan read. */
  due: PlannedThread[]
  /** Every unread thread of this teacher (the email's "in all" count). */
  threadIds: string[]
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

/** Ten at a time: an unbounded fan-out over thousands of rows would time the pool out. */
async function inChunks<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += 10) out.push(...(await Promise.all(items.slice(i, i + 10).map(fn))))
  return out
}

/**
 * The eligible unread threads among `extra` (all of them, or the ids a claim re-checks), with the rule's halves a query
 * cannot hold — the newest standing message must be the school's, no blocked pair, a standing message in the unread
 * window — each with that window (readWindows: one statement), NEWEST first.
 */
async function readEligible(
  client: Reader, extra: object, take: number, opts: { blocked?: Set<string> } = {},
): Promise<{ rows: UnreadTeacherThread[]; truncated: boolean }> {
  const found = await client.conversation.findMany({
    where: eligibleWhere(extra),
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, sellerUnread: true,
      messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { senderProfileId: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take,
  })
  const live = found.filter((r) => r.sellerProfileId && r.sellerProfileId !== r.buyerProfileId && r.messages[0]?.senderProfileId === r.buyerProfileId)
  // The inbox hides a thread with a blocked person (either direction). The claim passes the set it read BEFORE its
  // transaction: blockedConversationIds uses the global client, and a second connection from inside an interactive
  // transaction can wait forever on a pool of one.
  const teachers = [...new Set(live.map((r) => r.sellerProfileId!))]
  const hiddenBy = new Map(await inChunks(teachers, async (t) => [t, opts.blocked ?? new Set(await blockedConversationIds(t))] as const))
  const visible = live.filter((r) => !hiddenBy.get(r.sellerProfileId!)?.has(r.id))
  const windows = await readWindows(client, visible.map((r) => r.id))
  const rows = visible.map((r): UnreadTeacherThread | null => {
    const base = { conversationId: r.id, teacherProfileId: r.sellerProfileId!, unread: r.sellerUnread }
    const window = windows.get(r.id) ?? []
    // Every unread message recalled (or read since the first statement): not news.
    return window.some((m) => m.deletedAt === null) ? { ...base, window } : null
  })
  return { rows: rows.filter((r): r is UnreadTeacherThread => r !== null), truncated: found.length === take }
}

/**
 * The unread windows of these threads: per thread its last sellerUnread school rows, RECALLED ONES INCLUDED, newest first —
 * in ONE statement per 500 threads, the counter read in the same statement as the rows (a message landing between two
 * reads would shift a window by one). Read-only.
 */
async function readWindows(client: Pick<Db, '$queryRaw'>, ids: string[]): Promise<Map<string, SchoolRow[]>> {
  const out = new Map<string, SchoolRow[]>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = await client.$queryRaw<{ conversationId: string; createdAt: Date; deletedAt: Date | null }[]>`
      SELECT w."conversationId", w."createdAt", w."deletedAt" FROM (
        SELECT m."conversationId", m."createdAt", m."deletedAt", c."sellerUnread",
               row_number() OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt" DESC, m."id" DESC) AS rn
        FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
        WHERE m."conversationId" = ANY(${chunk}) AND m."senderProfileId" = c."buyerProfileId"
      ) w
      WHERE w.rn <= w."sellerUnread"
      ORDER BY w."conversationId", w.rn`
    for (const r of rows) out.set(r.conversationId, [...(out.get(r.conversationId) ?? []), { createdAt: r.createdAt, deletedAt: r.deletedAt }])
  }
  return out
}

/** Every eligible unread teacher thread with its window, newest first. Read-only. */
export async function loadUnreadTeacherThreads(db: Db = defaultDb): Promise<UnreadTeacherThread[]> {
  const { rows, truncated } = await readEligible(db, {}, MESSAGE_EMAIL_RULES.maxThreads)
  if (truncated) console.error('[teacher-message-emails] read capped at', MESSAGE_EMAIL_RULES.maxThreads, 'threads — the oldest wait for a later run')
  return rows
}

/**
 * The emails each teacher got in the last 24 h: the distinct claim times their thread rows hold. Read-only. EXACT because
 * of THREAD_GAP (the header) — and the plan reads the one exception, a v1 reminder no row holds, from the state row.
 */
export async function loadEmailsLast24h(db: Db, teacherIds: string[], now: number): Promise<Map<string, Set<number>>> {
  if (!teacherIds.length) return new Map()
  const rows = await db.teacherMessageEmailThread.groupBy({
    by: ['profileId', 'emailedAt'],
    where: { profileId: { in: teacherIds }, emailedAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } },
  })
  const times = new Map<string, Set<number>>()
  for (const r of rows) times.set(r.profileId, (times.get(r.profileId) ?? new Set()).add(r.emailedAt.getTime()))
  return times
}

/** The rule, as a pure function of what was read — the cron's dry run counts exactly this. */
export function planMessageEmails(
  threads: UnreadTeacherThread[],
  ledger: Map<string, ThreadLedger>,
  states: Map<string, TeacherEmailState>,
  emailsLast24h: Map<string, Set<number>>,
  now: number,
): PlannedMessageEmail[] {
  if (quietSoon(now)) return []
  const R = MESSAGE_EMAIL_RULES
  const byTeacher = new Map<string, UnreadTeacherThread[]>()
  for (const t of threads) byTeacher.set(t.teacherProfileId, [...(byTeacher.get(t.teacherProfileId) ?? []), t])
  const plan: PlannedMessageEmail[] = []
  for (const [teacherProfileId, list] of byTeacher) {
    const state = states.get(teacherProfileId)
    if (state?.optedOutAt) continue
    const last = state?.lastEmailAt?.getTime()
    if (last !== undefined && now - last < R.teacherGapMs) continue
    const times = new Set(emailsLast24h.get(teacherProfileId) ?? [])
    if (last !== undefined && now - last < R.threadGapMs) times.add(last) // the last email counts, rows or not
    if (times.size >= R.maxPer24h) continue
    const due: PlannedThread[] = []
    for (const t of list) {
      const row = ledger.get(t.conversationId) ?? null
      if (row && now - row.emailedAt.getTime() < R.threadGapMs) continue
      // The v1 → v2 day (the header): a v1 row's thread also waits a day after the teacher's last email.
      if (row && !parseKind(row.kind).anchor && last !== undefined && now - last < R.threadGapMs) continue
      const ep = episodeOf(t.window, row, now)
      if (!ep) continue
      const target = dueStage(ep.anchor, now)
      if (target > ep.stage) due.push({ conversationId: t.conversationId, stage: target as Stage, prev: row, anchor: ep.anchor })
    }
    if (!due.length) continue
    plan.push({ teacherProfileId, due: due.slice(0, R.maxThreadsPerEmail), threadIds: list.map((t) => t.conversationId), hadState: !!state, prevLastEmailAt: state?.lastEmailAt ?? null })
  }
  return plan
}

const LOST = Symbol('lost')

/** What a claim actually covers, read inside it — the email renders THIS, never the plan. */
export type ClaimedMessageEmail = {
  /** Threads per stage, as recorded. */
  counts: Record<Stage, number>
  unreadThreads: number
  applied: PlannedThread[]
}

/**
 * ⛔ CLAIM BEFORE SENDING, AS ONE TRANSACTION: win the teacher's state row — create it, or move `lastEmailAt` from exactly
 * the value the plan read, never past an opt-out — then re-read the WHOLE eligibility rule for every unread thread of the
 * teacher with its window (a thread read, blocked or recalled since the plan is neither counted nor recorded), keep only
 * the due threads whose episode is still the plan's — none at all in (or about to be in) the quiet hours — and record each
 * at the stage due NOW, with its anchor: a new
 * row, or the plan's row moved on CONDITIONALLY (its emailedAt and kind unchanged since the read). Any step that finds
 * another run (or a read, or an unsubscribe) got there first rolls the whole claim back and the teacher is skipped.
 */
export async function claimMessageEmail(db: Db, e: PlannedMessageEmail, claimAt: Date): Promise<ClaimedMessageEmail | null> {
  if (quietSoon(claimAt.getTime())) return null
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
      const { rows } = await readEligible(tx, { id: { in: e.threadIds }, sellerProfileId: e.teacherProfileId }, e.threadIds.length, { blocked })
      const still = new Map(rows.map((r) => [r.conversationId, r]))
      // ⛔ Same thread AND same episode as the plan (codex + Opus, plan review): a read then a new message between the plan
      // and this claim moves the anchor, and the plan's stage (say 3) would be recorded for a brand-new episode. The stage
      // is the one due NOW — a threshold crossed since the plan is a jump, never a second email a day later.
      const applied = e.due.flatMap((d) => {
        const r = still.get(d.conversationId)
        // MAX_AGE at claim time too: an episode that aged out since the plan no longer matches.
        const ep = r ? episodeOf(r.window, d.prev, claimAt.getTime()) : null
        if (!ep || ep.anchor.getTime() !== d.anchor.getTime()) return []
        return [{ ...d, stage: Math.max(d.stage, dueStage(d.anchor, claimAt.getTime())) as Stage }]
      })
      if (!applied.length) throw LOST
      const fresh = applied.filter((d) => !d.prev)
      if (fresh.length) {
        const made = await tx.teacherMessageEmailThread.createMany({
          data: fresh.map((d) => ({ conversationId: d.conversationId, profileId: e.teacherProfileId, emailedAt: claimAt, kind: kindFor(d.stage, d.anchor) })),
          skipDuplicates: true,
        })
        if (made.count !== fresh.length) throw LOST
      }
      for (const d of applied.filter((x) => x.prev)) {
        const moved = await tx.teacherMessageEmailThread.updateMany({
          where: { conversationId: d.conversationId, emailedAt: d.prev!.emailedAt, kind: d.prev!.kind },
          data: { emailedAt: claimAt, kind: kindFor(d.stage, d.anchor) },
        })
        if (moved.count !== 1) throw LOST
      }
      const counts: Record<Stage, number> = { 1: 0, 2: 0, 3: 0 }
      for (const d of applied) counts[d.stage]++
      return { counts, unreadThreads: still.size, applied }
    }, { timeout: 20_000 }) // a few statements — never hostage to the 5 s default on a loaded box
  } catch (err) {
    if (err === LOST || (err as { code?: string })?.code === 'P2002') return null
    throw err
  }
}

/**
 * Undo a claim after Resend REFUSED the send (nothing went out), so a later run tries again. ⛔ CONDITIONAL ON THE CLAIM
 * BEING OURS: `lastEmailAt` goes back only if it still holds this claim's time; a row this claim created is removed and a
 * row it moved on is put back, each only while it still holds this claim's time — a later run's claim is never erased.
 */
export async function releaseMessageEmail(db: Db, e: PlannedMessageEmail, claimAt: Date, applied: PlannedThread[]): Promise<void> {
  await db.$transaction([
    db.teacherMessageEmailState.updateMany({ where: { profileId: e.teacherProfileId, lastEmailAt: claimAt }, data: { lastEmailAt: e.prevLastEmailAt } }),
    db.teacherMessageEmailThread.deleteMany({ where: { conversationId: { in: applied.filter((d) => !d.prev).map((d) => d.conversationId) }, emailedAt: claimAt } }),
    ...applied.filter((d) => d.prev).map((d) => db.teacherMessageEmailThread.updateMany({
      where: { conversationId: d.conversationId, emailedAt: claimAt },
      data: { emailedAt: d.prev!.emailedAt, kind: d.prev!.kind },
    })),
  ])
}

/** Planned pauses, not failures: the send ceiling and the quiet hours — the next run carries on. */
export const RUN_PAUSES = new Set(['ceiling', 'quiet'])

/** The cron's answer: eno-cron.sh prints only the first 200 bytes. */
export function messageEmailResult(r: { teachers: number; sent: number; failed: number; invalid: number; unknown: number; skipped: number; stopped?: string | null; left?: number }) {
  return {
    ok: r.failed === 0 && r.invalid === 0 && (!r.stopped || RUN_PAUSES.has(r.stopped)), teachers: r.teachers,
    sent: r.sent, failed: r.failed, invalid: r.invalid, unknown: r.unknown, skipped: r.skipped,
    ...(r.stopped ? { stopped: r.stopped.slice(0, 40), left: r.left ?? 0 } : {}),
  }
}
