import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { getOrCreateListinglessThread } from '@/lib/support-thread'
import { HOME_HIDDEN_TEACHER_LISTING_IDS } from '@/lib/teachers/constants'
import { COVER_CONSENT_VERSION } from './cover'
import { JOBS_DESK_SELLER_ID, JOB_DMS_MODE_KEY } from './job-dms/constants'
import { JOB_DM_ON_VERSIONS, JOB_DM_TX_OPTS, defaultOnTeacherWhere, jobDmConsented, jobDmLockKey, lockJobDmTeacher } from './job-dms/consent'
import { abortReason, ensureJobsDeskSeller, resolveJobsOperatorProfileId } from './job-dms/desk'
import { vnToday } from './job-dms/gates'
import { isQuiet, processStops, readMode, takeJobDmsRunLock } from './job-dms/run'

import {
  ZALO_INVITE_BELL_BODY, ZALO_INVITE_CHAT_BODY, ZALO_INVITE_TITLE, ZALO_INVITE_TYPE, composeCoverZaloInvite,
} from './zalo-invite-copy'

/**
 * THE ONE-TIME "ZALO FOR URGENT COVER" INVITE (owner, 2026-10-28 "yes in their chat, explain where there is urgent cover
 * it's hard to reach the needed person…"; "go", 2026-10-29). Each cover teacher who has not added a Zalo number is told
 * ONCE, in the jobs-desk chat where that is allowed, otherwise by an in-app bell. Run by hand:
 * GET /api/cron/cover-zalo-invite (no timer).
 *
 * WHO (inviteWhere — re-read under the locks before anything is written): a live teacher the desk can reach
 * (defaultOnTeacherWhere: live, listing active + verified, never the demo) with cover lessons ON under the current cover
 * notice, and no Zalo number, no earlier Zalo switch-off (plan review, opus: never an invite over a choice — invite.ts's
 * rule) and no invite yet.
 *
 * CHANNEL (planOf), decided per teacher:
 *   · CHAT — job messages consented (on, current notice or eno's default, not paused), the desk sending live (run.ts
 *     readMode: a crash falls back to 'shadow' — then no chat), and NO desk message waiting for a reply (plan review,
 *     opus: the invite counts toward "two until you reply", and it must never use the last slot and stop the teacher's job
 *     messages), and no jobs or cover message sent today (one of each a day, /privacy). Replies are read first — run.ts processStops, under the run's own lock, so a STOP or a pause typed since
 *     the last run is honoured before this sends (plan review, codex + opus) — and a teacher who wrote after that read is
 *     skipped this time. The bell that points at the message is written in the SAME transaction.
 *   · BELL — otherwise (job messages off or switched off by a STOP, or a desk message already waiting): in the app only,
 *     never a web push.
 *   · SKIPPED — job messages PAUSED (a reply may have asked us to stop: nothing at all until the teacher answers — plan
 *     review, opus), or a reply not yet read. A later run picks them up.
 * ⛔ NEVER TWICE: TeacherPrivate.coverZaloInvitedAt is CLAIMED by a compare-and-set (insert-if-absent, else only while
 * NULL and while no number was ever given or switched off) inside the same transaction as the message or the bell, under
 * the teacher's job-message lock AND the teacher lock that switching cover off takes (zalo.ts — plan review, codex +
 * opus: a cover-off racing the invite must win). Job lock first, then the teacher lock: only job-dms/* takes the first,
 * and none of it holds the second, so the order cannot deadlock.
 * ⚖️ NO JOB-MESSAGE NOTICE BUMP (consent.ts's rule, gate 11a's reasoning): the desk's purpose is messages about jobs and
 * cover lessons — this one tells a teacher with cover lessons on how a school can reach them for urgent cover. Who sends,
 * from where, what it reads (the cover switch, the Zalo field) and where it runs are unchanged; /privacy names it. A bump
 * would switch off every teacher who switched job messages on themselves.
 */
export const COVER_ZALO_INVITE = { maxPerRun: 200 } as const
const PAGE = 100

export function inviteWhere(): Prisma.TeacherProfileWhereInput {
  return {
    ...defaultOnTeacherWhere(),
    coverOpen: true,
    coverConsentVersion: COVER_CONSENT_VERSION,
    OR: [{ private: { is: null } }, { private: { is: { coverZalo: null, coverZaloWithdrawnAt: null, coverZaloInvitedAt: null } } }],
  }
}

export type InvitePlan = 'chat' | 'bell' | 'paused'
type Candidate = {
  teacherProfileId: string
  profileId: string
  firstName: string | null
  consent: { optIn: boolean; noticeVersion: string | null; pausedAt: Date | null } | null
}

/**
 * `take` teachers to tell, oldest profile first, leaving out the ones this run already looked at. A run reads PAGE after
 * page this way (commit review, codex + opus: the paused, the held and the failed stay eligible — always reading the first
 * page would stall the queue behind them; an offset would skip one whenever a teacher left the set meanwhile), and stops
 * once it has told maxPerRun.
 */
export async function loadCandidates(take: number, seen: ReadonlySet<string> = new Set()): Promise<Candidate[]> {
  const rows = await db.teacherProfile.findMany({
    where: seen.size ? { AND: [inviteWhere(), { id: { notIn: [...seen] } }] } : inviteWhere(),
    select: { id: true, profileId: true, fullName: true, profile: { select: { teacherJobDmConsent: { select: { optIn: true, noticeVersion: true, pausedAt: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  })
  return rows.map((r) => ({ teacherProfileId: r.id, profileId: r.profileId, firstName: r.fullName || null, consent: r.profile.teacherJobDmConsent ?? null }))
}

/**
 * Desk messages since the teacher last wrote there (0 with no thread), whether the desk ever wrote (the intro), and
 * whether a jobs or cover message already went today (commit review, codex: /privacy promises at most one of each a day —
 * the invite never rides a third message onto such a day; that teacher gets the bell).
 */
async function deskState(profileId: string, operatorId: string): Promise<{ unanswered: number; deskWrote: boolean; sentToday: boolean }> {
  const sentToday = (await db.teacherJobDmDay.count({ where: { profileId, day: vnToday(new Date()) } })) > 0
  const rows = await db.$queryRaw<{ unanswered: number; desk_wrote: boolean }[]>`
    select
      (select count(*)::int from "Message" m
        where m."conversationId" = c.id and m."senderProfileId" = ${operatorId}::uuid and m."deletedAt" is null
          and m."createdAt" > coalesce((select max(t."createdAt") from "Message" t where t."conversationId" = c.id
                                         and t."senderProfileId" = ${profileId}::uuid and t."deletedAt" is null), 'epoch'::timestamp)) as unanswered,
      exists (select 1 from "Message" d where d."conversationId" = c.id and d."senderProfileId" = ${operatorId}::uuid) as desk_wrote
    from "Conversation" c
    where c."buyerProfileId" = ${profileId}::uuid and c."sellerId" = ${JOBS_DESK_SELLER_ID} and c."listingId" is null
    limit 1`
  return { unanswered: rows[0]?.unanswered ?? 0, deskWrote: rows[0]?.desk_wrote ?? false, sentToday }
}

/** Which way this teacher is told. Pure but for the desk read; the send re-checks everything under its locks. */
export function planOf(c: Pick<Candidate, 'consent'>, a: { live: boolean; unanswered: number; sentToday?: boolean }): InvitePlan {
  if (c.consent?.optIn && c.consent.pausedAt) return 'paused'
  return jobDmConsented(c.consent) && a.live && a.unanswered === 0 && !a.sentToday ? 'chat' : 'bell'
}

const demoIds = (): string[] => [...HOME_HIDDEN_TEACHER_LISTING_IDS]

/**
 * THE CLAIM, as SQL (both paths): insert the private row if there is none, else stamp it only while never invited and no
 * number was ever given or switched off. One row returned = claimed. ⛔ An existing row's `updatedAt` is LEFT AS IT IS
 * (commit review, opus: the teacher's download dates their contact details by it — telling them about Zalo changed none);
 * a new row needs one (NOT NULL, no default).
 */
const claimCte = (teacherProfileId: string, now: Date) => Prisma.sql`
  insert into "TeacherPrivate" ("teacherProfileId", "coverZaloInvitedAt", "updatedAt") values (${teacherProfileId}, ${now}, ${now})
  on conflict ("teacherProfileId") do update set "coverZaloInvitedAt" = excluded."coverZaloInvitedAt"
   where "TeacherPrivate"."coverZaloInvitedAt" is null and "TeacherPrivate"."coverZalo" is null and "TeacherPrivate"."coverZaloWithdrawnAt" is null
  returning 1`

export type SendResult = 'chat' | 'bell' | 'paused' | 'held' | 'gone'

/**
 * CHAT: one batch — the two locks, the guard (division by zero aborts it — SQLSTATE 22012), the claim (the same, on 0
 * rows), the bell, then the message (insertMessage runs `alongside` before its insert). Any failure rolls back all of it:
 * a message is never without its claim or its bell, a claim never without its message. 'held' = something changed since
 * the plan (a reply, a switch, a number, cover off) — nothing written; a later run decides again.
 */
export async function inviteInChat(c: Candidate, operatorId: string, repliesReadAt: Date, now: Date): Promise<SendResult> {
  const { deskWrote } = await deskState(c.profileId, operatorId)
  await ensureJobsDeskSeller()
  const existing = await db.conversation.findFirst({ where: { buyerProfileId: c.profileId, sellerId: JOBS_DESK_SELLER_ID, listingId: null }, select: { id: true } })
  const thread = await getOrCreateListinglessThread(db, { buyerProfileId: c.profileId, sellerId: JOBS_DESK_SELLER_ID, sellerProfileId: operatorId })
  const convo = { id: thread.id, buyerProfileId: c.profileId, sellerProfileId: operatorId, listingId: null, sellerId: JOBS_DESK_SELLER_ID }
  const alongside: Prisma.PrismaPromise<unknown>[] = [
    db.$executeRaw`select set_config('lock_timeout', '3000ms', true)`,
    db.$executeRaw`select pg_advisory_xact_lock(hashtext(${jobDmLockKey(c.profileId)}))`,
    db.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + c.profileId}))`,
    db.$queryRaw`select 1 / (case when
        -- the desk still sending live (run.ts readMode's own key — commit review, codex: a switch to 'shadow' mid-run)
        exists (select 1 from kv_store v where v.key = ${JOB_DMS_MODE_KEY} and v.value = to_jsonb('live'::text)
                  and (v.expires_at is null or v.expires_at > now()))
        and exists (select 1 from "TeacherJobDmConsent" k where k."profileId" = ${c.profileId}::uuid and k."optIn"
                  -- the versions jobDmConsented() counts, the same list (commit review, opus: never two lists)
                  and k."noticeVersion" = any(${[...JOB_DM_ON_VERSIONS]}::text[]) and k."pausedAt" is null)
        and exists (select 1 from "TeacherProfile" tp join "Listing" l on l.id = tp."listingId"
                     where tp.id = ${c.teacherProfileId} and tp."profileId" = ${c.profileId}::uuid and tp.status = 'live'
                       and tp."coverOpen" and tp."coverConsentVersion" = ${COVER_CONSENT_VERSION}
                       and l.status = 'active' and l.verified and not (tp."listingId" = any(${demoIds()}::text[])))
        and (select count(*) from "Message" m where m."conversationId" = ${thread.id} and m."senderProfileId" = ${operatorId}::uuid
               and m."deletedAt" is null
               and m."createdAt" > coalesce((select max(t."createdAt") from "Message" t where t."conversationId" = ${thread.id}
                                              and t."senderProfileId" = ${c.profileId}::uuid and t."deletedAt" is null), 'epoch'::timestamp)) = 0
        and not exists (select 1 from "Message" r where r."conversationId" = ${thread.id} and r."senderProfileId" = ${c.profileId}::uuid
                          and r."createdAt" >= ${repliesReadAt} and r."deletedAt" is null)
        and not exists (select 1 from "TeacherJobDmDay" j where j."profileId" = ${c.profileId}::uuid and j.day = ${vnToday(now)})
      then 1 else 0 end) as ok`,
    db.$queryRaw`with c as (${claimCte(c.teacherProfileId, now)}) select 1 / (select count(*)::int from c) as ok`,
    db.notification.create({ data: { recipientId: c.profileId, type: ZALO_INVITE_TYPE, title: ZALO_INVITE_TITLE, body: ZALO_INVITE_CHAT_BODY, url: `/messages/${thread.id}`, conversationId: thread.id } }),
    // ⛔ IT IS THAT DAY'S COVER-LESSON MESSAGE (commit review, codex, rounds 5–7: /privacy promises at most one jobs and one
    // cover message a day — without a day row, a reply after the invite let the same day's run send both). Its key
    // (one per teacher, day and kind) also aborts the batch on a second.
    db.teacherJobDmDay.create({ data: { profileId: c.profileId, day: vnToday(now), kind: 'cover', conversationId: thread.id } }),
  ]
  try {
    await insertMessage(convo, operatorId, composeCoverZaloInvite({ firstName: c.firstName, first: !deskWrote }), { alongside })
    return 'chat'
  } catch (e) {
    // A thread this call opened and that holds nothing goes again — no empty desk thread is left behind (desk.ts's rule).
    if (!existing) await db.conversation.deleteMany({ where: { id: thread.id, messages: { none: {} } } }).catch((x) => console.error('[cover-zalo-invite] empty thread left', thread.id, x))
    if (abortReason(e)) return 'held'
    throw e
  }
}

/**
 * BELL: one transaction — the two locks, the WHO again, "not paused" and "no reply since the read" again, the claim, the
 * bell. 'gone' = no longer a candidate, or invited meanwhile. Throws on a database error — then nothing was written.
 */
export async function inviteByBell(c: Candidate, repliesReadAt: Date, now: Date): Promise<SendResult> {
  return db.$transaction(async (tx) => {
    await lockJobDmTeacher(tx, c.profileId)
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + c.profileId}))`
    const tp = await tx.teacherProfile.findFirst({ where: { id: c.teacherProfileId, profileId: c.profileId, ...inviteWhere() }, select: { id: true } })
    if (!tp) return 'gone' as const
    const k = await tx.teacherJobDmConsent.findUnique({ where: { profileId: c.profileId }, select: { optIn: true, pausedAt: true } })
    if (k?.optIn && k.pausedAt) return 'paused' as const
    // A reply written in the desk thread since the replies were read waits for the next read (commit review, codex: it
    // may be a STOP) — the same rule as the chat path's guard.
    const replied = await tx.message.count({ where: { senderProfileId: c.profileId, deletedAt: null, createdAt: { gte: repliesReadAt }, conversation: { buyerProfileId: c.profileId, sellerId: JOBS_DESK_SELLER_ID, listingId: null } } })
    if (replied) return 'held' as const
    const claimed = await tx.$queryRaw<{ n: number }[]>`with c as (${claimCte(c.teacherProfileId, now)}) select count(*)::int as n from c`
    if ((claimed[0]?.n ?? 0) !== 1) return 'gone' as const
    await tx.notification.create({ data: { recipientId: c.profileId, type: ZALO_INVITE_TYPE, title: ZALO_INVITE_TITLE, body: ZALO_INVITE_BELL_BODY, url: '/teachers/cover-zalo' } })
    return 'bell' as const
  }, JOB_DM_TX_OPTS)
}

/** `left` = still to be told after the run (the paused and the held among them): run it again later for those. */
export type InviteRun = {
  dryRun: boolean
  eligible: number
  chat: number
  bell: number
  paused: number
  held: number
  failed: number
  left?: number
  live?: boolean
  stopped?: 'quiet' | 'busy' | 'no-operator' | 'lock-error' | 'stops-failed'
}

/**
 * One run. `dryRun`: counts who WOULD be told and how — nothing read-and-written (no reply is processed, so a teacher whose
 * reply is not yet read is counted by their plan), nothing claimed, nothing sent. Without it: under the job-messages run's
 * own lock, replies first, then at most maxPerRun teachers; none 21:00–08:00 Vietnam time (checked before each teacher);
 * one teacher's error never stops the run (counted `failed`).
 */
export async function runCoverZaloInvite(opts: { dryRun: boolean; now?: Date }): Promise<InviteRun> {
  const now = opts.now ?? new Date()
  const eligible = await db.teacherProfile.count({ where: inviteWhere() })
  const res: InviteRun = { dryRun: opts.dryRun, eligible, chat: 0, bell: 0, paused: 0, held: 0, failed: 0 }
  const operatorId = await resolveJobsOperatorProfileId()
  if (!operatorId) return { ...res, stopped: 'no-operator' }

  if (opts.dryRun) {
    const live = (await readMode()) === 'live'
    res.live = live
    const seen = new Set<string>()
    for (;;) {
      const page = await loadCandidates(PAGE, seen)
      for (const c of page) {
        seen.add(c.teacherProfileId)
        res[planOf(c, { live, ...(await deskState(c.profileId, operatorId)) })]++
      }
      if (page.length < PAGE) break
    }
    return { ...res, left: eligible }
  }
  if (isQuiet(now)) return { ...res, stopped: 'quiet' }

  let release: (() => Promise<void>) | null
  try { release = await takeJobDmsRunLock(now) } catch { return { ...res, stopped: 'lock-error', failed: 1 } }
  if (!release) return { ...res, stopped: 'busy' }
  try {
    // Replies as of this moment: STOPs and pauses since the last job-messages run are honoured before anything is sent.
    const repliesReadAt = new Date()
    const { pending, failed } = await processStops(operatorId, now)
    // ⛔ A reply that could not be read for a STOP stops the whole run (commit review, opus: its teacher would read as
    // "wrote last, nothing waiting" and get the chat). Red; run it again.
    if (failed) return { ...res, failed, stopped: 'stops-failed' }
    // The desk's mode under the lock — and again before each chat (commit review, codex: a switch to 'shadow' mid-run).
    res.live = (await readMode()) === 'live'
    // Every teacher looked at is left out of the next page, told or not.
    const seen = new Set<string>()
    outer: for (;;) {
      const page = await loadCandidates(PAGE, seen)
      for (const c of page) {
        seen.add(c.teacherProfileId)
        if (res.chat + res.bell >= COVER_ZALO_INVITE.maxPerRun) break outer
        if (isQuiet(new Date())) { res.stopped = 'quiet'; break outer }
        let out: SendResult
        if (pending.has(c.profileId)) out = 'held'
        else {
          try {
            const live = (await readMode()) === 'live'
            const plan = planOf(c, { live, ...(await deskState(c.profileId, operatorId)) })
            out = plan === 'paused' ? 'paused' : plan === 'chat' ? await inviteInChat(c, operatorId, repliesReadAt, new Date()) : await inviteByBell(c, repliesReadAt, new Date())
          } catch (e) {
            res.failed++
            // Ids and an error CODE only — never a message, which can quote a query.
            console.error('[cover-zalo-invite] teacher failed — run continues', { profileId: c.profileId, error: (e as { code?: string })?.code ?? (e as Error)?.name })
            continue
          }
        }
        if (out === 'chat' || out === 'bell') res[out]++
        else if (out === 'paused') res.paused++
        else if (out === 'held') res.held++
      }
      if (page.length < PAGE) break
    }
    // Who is still to be told — counted, not guessed (commit review, opus: the paused and the held are still owed it).
    res.left = await db.teacherProfile.count({ where: inviteWhere() })
    return res
  } finally {
    await release()
  }
}
