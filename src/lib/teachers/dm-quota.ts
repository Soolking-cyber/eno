import 'server-only'
import { ipv6Prefix64 } from '@/lib/ip-key'
import { createHash, createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logInfo } from '@/lib/log'
import { PHONE_OTP_ENABLED } from '@/lib/auth-policy'
import { canMessage } from '@/lib/compliance/account-state'
import { verificationStatusForDecision } from '@/lib/compliance/recompute-verification'
import { isBusinessVerified, verificationView, type VerificationFacts } from '@/lib/business-verification'
import { vnDay } from '@/lib/signup-prompt'
import {
  TEACHER_DM_IP_POOL, TEACHER_DM_LIMITS, TEACHER_LISTING_TYPE, TEACHER_UNANSWERED_MAX,
  type TeacherDmNext, type TeacherDmTier,
} from '@/lib/teachers/constants'
import type { Prisma } from '@/generated/prisma/client'
import { teacherDmLock } from './dm-lock'

/**
 * ⛔ THE TEACHER DM LADDER (owner, 2026-10-13 — teachers/constants.ts TEACHER_DM_LIMITS): how many NEW teachers an
 * account may start a chat with per Vietnam day. One module so the route that opens a thread, the quota endpoint the
 * profile page asks and the tests all read the same rules.
 *
 * THE TIER is derived on every request — never from a cache a sweep has not refreshed:
 *   · identity status from identity_verifications (verificationStatusForDecision: a passport that lapsed this morning
 *     is expired now, not after a sweep); `revoked` (canMessage false) is 0 and outranks everything;
 *   · business = accountType 'business' + the seller's "Business verified" badge live (isBusinessVerified: stamped
 *     identity hash unchanged, window open, tax registry verified) + the identity check live — the owner's order, "KYC
 *     … then register as business and go through business kyc", and the owner's 2026-08-31 rule that a person
 *     verifies before their business. ⛔ NOT officialPartner: a partner flag is not a business KYC (codex, plan review).
 *
 * THE COUNT is the threads that EXIST — distinct teacher listings this account opened a thread on since 00:00 Vietnam
 * time — not limiter hits: a refused attempt, at any gate, creates no row and so spends nothing; a hidden thread still
 * counts (DELETE only stamps buyerDeletedAt). ⚠️ The row and its first message are two transactions: a thread whose
 * message then fails to land keeps the row and the slot, and the retry uses that thread — and rings, as a first contact
 * (openerAgainst `empty`). Not atomic, like every first contact on the site; accepted. ratelimit()'s '1 d' was the wrong tool: it counts refused attempts,
 * cannot be read without spending and slides on 07:00 slots (rate-limit-pg.mjs).
 *
 * ⛔ ATOMIC: openTeacherThread re-reads the thread and recounts under a per-account advisory lock, in the transaction that
 * creates the row — two taps at once cannot pass the cap. The tier is re-derived just BEFORE that transaction, not
 * inside it: its reads go through the shared client, and a second pool connection taken while the transaction holds one
 * could starve the pool (10 connections) under concurrent opens (tests agent, 2026-10-13). Re-derived there, a revocation
 * after the route's early check is still seen; one landing in the milliseconds before the commit is accepted.
 *
 * THROWAWAY ACCOUNTS (owner: "Phone later + IP pool"): while phone sign-in is off (PHONE_OTP_ENABLED false) the
 * unverified accounts on one internet connection share TEACHER_DM_IP_POOL new chats a day — a hashed, day-scoped
 * kv_store counter raised in the same transaction, under a second advisory lock taken AFTER the account's (one order,
 * no cycle). Once phone sign-in is back, an unverified account without a confirmed phone gets 0 and the pool stops.
 * ⚠️ Accepted: a carrier NAT can put strangers on one address (an IPv6 subscriber is its /64); the refusal then offers the
 * identity check, which lifts the pool entirely.
 */

export type TeacherDmReason = 'limit' | 'pool' | 'phone' | 'revoked'

export type TeacherDmTierInfo = {
  tier: TeacherDmTier
  limit: number
  /** What raises the limit — the refusal's button. 'tomorrow' at the top rung, 'none' for revoked. */
  next: TeacherDmNext
  nextLimit: number | null
  /** PHONE_OTP_ENABLED and an unverified account with no confirmed phone: nothing until one is added. */
  needsPhone: boolean
  /** The unverified rung while phone sign-in is off: the connection's shared pool also applies. */
  pooled: boolean
}

export type TeacherDmStanding = TeacherDmTierInfo & {
  used: number
  remaining: number
  resetAt: string
  reason: TeacherDmReason | null
  hasThread: boolean
  /** That thread's id, when there is one: the teacher page's Message button goes back into it (2026-10-21). */
  threadId?: string
}

const DAY_MS = 86_400_000

/** The Vietnam calendar day `now` falls in: [start, resetAt), and its YYYY-MM-DD. */
export function vnDayWindow(now: Date): { day: string; start: Date; resetAt: Date } {
  const day = vnDay(now.getTime())
  const start = new Date(`${day}T00:00:00+07:00`)
  return { day, start, resetAt: new Date(start.getTime() + DAY_MS) }
}

/**
 * The day's pool key for a client address — hashed, so no address is kept.
 * ⛔ AN IPv6 CLIENT IS ITS /64 (opus, gate 2026-10-13): a subscriber holds a whole /64 and can rotate within it at will, so
 * keying the full address gave a fresh pool per address. IPv4 is the address. ⛔ NO ADDRESS IS ONE SHARED POOL, never no
 * pool: a missing one is a fault, and it must not lift the brake. It cannot cap the site: every /api request carries the
 * edge proof or proxy.ts refuses it with a 403 before any route runs, and both zones inject the proof on every request
 * (client-ip.ts, checked 2026-08-28) — so clientIp's shared 'off-edge' / 'anon' units are reached only off the edge.
 */
export function poolKeyFor(ip: string | null | undefined, day: string): string {
  const a = (ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  // An IPv4 address in IPv6 dress (::ffff:a.b.c.d) is that IPv4 address — its /64 is all zeros, shared by every one.
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a)
  const unit = !a || a === 'unknown' ? 'unknown' : v4 ? v4[1] : a.includes(':') ? ipv6Prefix64(a) : a
  return `teacher-dm-ip:${day}:${poolDigest(`teacher-dm-pool:${day}:${unit}`)}`
}

/**
 * ⛔ KEYED, NEVER A BARE HASH (Opus, gate 2026-10-13): there are only 2³² IPv4 addresses, so a plain SHA-256 of one is
 * reversed by trying them all — and /privacy says the address itself is never kept. An HMAC under a server secret that
 * never sits in the database: auth/handoff.ts's key (IDENTITY_HASH_PEPPER, else SUPABASE_SECRET_KEY — both set in
 * production), domain-separated by the 'teacher-dm-pool:' prefix. With neither (a bare local run) it degrades to an
 * unkeyed digest rather than refusing: the brake still works, it only loses the secrecy.
 */
function poolDigest(input: string): string {
  const key = process.env.IDENTITY_HASH_PEPPER || process.env.SUPABASE_SECRET_KEY
  return (key ? createHmac('sha256', key).update(input) : createHash('sha256').update(input)).digest('hex').slice(0, 32)
}

// ipv6Prefix64 moved to ip-key.ts (security review item 14) — re-exported so every existing importer keeps working.
export { ipv6Prefix64 }

const SELLER_FACTS = {
  name: true, legalName: true, legalAddress: true, idNumber: true, taxCode: true,
  taxCheckedAt: true, taxRegisteredName: true, taxActive: true,
  verifiedIdentityHash: true, verifiedUntil: true,
} as const

/** A revoked identity: nothing, and no way up (canMessage). */
const REVOKED: TeacherDmTierInfo = { tier: 'revoked', limit: TEACHER_DM_LIMITS.revoked, next: 'none', nextLimit: null, needsPhone: false, pooled: false }

/** The account's rung on the ladder, right now. */
export async function teacherDmTier(profileId: string, now: Date = new Date()): Promise<TeacherDmTierInfo> {
  const identity = await verificationStatusForDecision(profileId, now)
  if (!canMessage(identity)) return REVOKED
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { accountType: true, phone: true, seller: { select: { id: true, ...SELLER_FACTS } } },
  })
  const business = profile?.accountType === 'business'
  const seller = profile?.seller ?? null
  const businessLive = business && !!seller && isBusinessVerified(seller as unknown as VerificationFacts)
  if (identity === 'verified' && businessLive) {
    return { tier: 'business', limit: TEACHER_DM_LIMITS.business, next: 'tomorrow', nextLimit: null, needsPhone: false, pooled: false }
  }
  if (identity === 'verified') {
    let next: TeacherDmNext = 'switch_to_business'
    if (business && seller) {
      const latest = await db.sellerVerification.findFirst({ where: { sellerId: seller.id }, orderBy: { version: 'desc' }, select: { status: true } })
      const view = verificationView(seller as unknown as VerificationFacts, (latest?.status as 'draft' | 'pending' | 'approved' | 'rejected' | undefined) ?? null)
      // 'changes_needed' was never approved — it is not a lapse (opus, plan review): verify, not renew.
      next = view === 'pending' ? 'business_pending' : view === 'expired' ? 'renew_business' : 'verify_business'
    } else if (business) {
      next = 'verify_business'
    }
    return { tier: 'identity', limit: TEACHER_DM_LIMITS.identity, next, nextLimit: TEACHER_DM_LIMITS.business, needsPhone: false, pooled: false }
  }
  const needsPhone = PHONE_OTP_ENABLED && !profile?.phone
  const next: TeacherDmNext = needsPhone ? 'add_phone'
    : identity === 'pending' ? 'identity_pending'
    : identity === 'expired' ? 'renew_identity'
    : 'verify_identity'
  return {
    tier: 'unverified',
    limit: needsPhone ? 0 : TEACHER_DM_LIMITS.unverified,
    next,
    nextLimit: needsPhone ? TEACHER_DM_LIMITS.unverified : TEACHER_DM_LIMITS.identity,
    needsPhone,
    pooled: !PHONE_OTP_ENABLED,
  }
}

type Reader = Pick<Prisma.TransactionClient, 'conversation'>

/** Distinct teachers this account opened a thread with since `since` (one teacher = one teacher listing). */
export async function teacherThreadsOpenedSince(client: Reader, buyerProfileId: string, since: Date): Promise<number> {
  const rows = await client.conversation.findMany({
    where: { buyerProfileId, createdAt: { gte: since }, listing: { listingType: TEACHER_LISTING_TYPE } },
    select: { listingId: true },
    distinct: ['listingId'],
  })
  return rows.length
}

function shape(t: TeacherDmTierInfo, used: number, poolUsed: number, resetAt: Date, hasThread: boolean): TeacherDmStanding {
  const own = Math.max(0, t.limit - used)
  const pool = t.pooled ? Math.max(0, TEACHER_DM_IP_POOL - poolUsed) : Infinity
  const remaining = Math.min(own, pool)
  const reason: TeacherDmReason | null = remaining > 0 ? null
    : t.tier === 'revoked' ? 'revoked'
    : t.needsPhone ? 'phone'
    : own === 0 ? 'limit'
    : 'pool'
  return { ...t, used, remaining, resetAt: resetAt.toISOString(), reason, hasThread }
}

async function poolUsedNow(key: string): Promise<number> {
  const v = await kv.get<number | string>(key)
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Where the account stands today — what the profile page shows and the route's early check refuses on. */
export async function teacherDmStanding(profileId: string, opts: { ip?: string | null; listingId?: string | null; now?: Date } = {}): Promise<TeacherDmStanding> {
  const now = opts.now ?? new Date()
  const { day, start, resetAt } = vnDayWindow(now)
  const [tier, used] = await Promise.all([teacherDmTier(profileId, now), teacherThreadsOpenedSince(db, profileId, start)])
  // ⛔ AFTER the count, never beside it (codex, gate 2026-10-13): a thread another tap commits between the two reads is
  // then either counted AND found, or neither — never counted yet unfound, which would refuse a double tap at the last
  // slot that openTeacherThread's lock would have answered with that very thread.
  const thread = opts.listingId
    ? await db.conversation.findUnique({ where: { listingId_buyerProfileId: { listingId: opts.listingId, buyerProfileId: profileId } }, select: { id: true } })
    : null
  const poolUsed = tier.pooled ? await poolUsedNow(poolKeyFor(opts.ip, day)) : 0
  const standing = shape(tier, used, poolUsed, resetAt, !!thread)
  return thread ? { ...standing, threadId: thread.id } : standing
}

export type OpenTeacherThread =
  | { outcome: 'existing' | 'created'; id: string }
  | { outcome: 'refused'; standing: TeacherDmStanding }

/**
 * Create the NEW teacher thread — or find the one a concurrent request just made — under the account's lock, with the
 * tier re-derived and the day recounted inside it. Nothing is written on a refusal.
 */
export async function openTeacherThread(a: {
  profileId: string; listingId: string; sellerId: string; sellerProfileId: string | null; ip: string | null; now?: Date
}): Promise<OpenTeacherThread> {
  const tier = await teacherDmTier(a.profileId, a.now ?? new Date())
  try {
    return await db.$transaction(async (tx) => {
      await teacherDmLock(tx, a.profileId)
      // The day is read UNDER the lock (codex, gate 2026-10-13): a request that waited past midnight is counted, and
      // pooled, on the day its thread is created — the day the row's createdAt says.
      const { day, start, resetAt } = vnDayWindow(a.now ?? new Date())
      const key = poolKeyFor(a.ip, day)
      const existing = await tx.conversation.findUnique({
        where: { listingId_buyerProfileId: { listingId: a.listingId, buyerProfileId: a.profileId } },
        select: { id: true },
      })
      if (existing) return { outcome: 'existing', id: existing.id } as const
      const used = await teacherThreadsOpenedSince(tx, a.profileId, start)
      // ⛔ A REVOCATION SINCE THE TIER WAS READ is seen here, under the lock (codex, gate 2026-10-13): the tier is read
      // before the transaction, and the lock can be waited on. A revocation takes this same lock (dm-lock.ts), so it
      // either committed before this read or waits for this thread. Any revoked row makes the identity revoked
      // (derive-verification.ts), so one indexed read on THIS connection answers it.
      // ⚠️ Accepted: any OTHER change — an expiry, a badge window closing, an account-type switch — applies to requests that
      // read the tier after it. Ones already waiting on this lock when it lands open threads at the rung they read, within
      // that rung's own limit, recounted here (codex, gate 2026-10-13). A revocation is the change that must not wait,
      // and it does not.
      if (tier.tier !== 'revoked' && await tx.identityVerification.findFirst({ where: { profileId: a.profileId, status: 'revoked' }, select: { id: true } })) {
        return { outcome: 'refused', standing: shape(REVOKED, used, 0, resetAt, false) } as const
      }
      let poolUsed = 0
      if (tier.pooled) {
        // The pool is shared across accounts: its own lock, always taken after the account's.
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${key}))`
        const rows = await tx.$queryRaw<Array<{ v: unknown }>>`select kv_get(${key}) as v`
        const n = Number(rows[0]?.v ?? 0)
        poolUsed = Number.isFinite(n) ? n : 0
      }
      const standing = shape(tier, used, poolUsed, resetAt, false)
      if (standing.remaining <= 0) return { outcome: 'refused', standing } as const
      const convo = await tx.conversation.create({
        data: { listingId: a.listingId, buyerProfileId: a.profileId, sellerId: a.sellerId, sellerProfileId: a.sellerProfileId },
        select: { id: true },
      })
      // 2 days of life: the key is per Vietnam day, and nothing reads yesterday's.
      if (tier.pooled) await tx.$queryRaw`select kv_incrby(${key}, 1::bigint, ${2 * 86_400}::int) as v`
      return { outcome: 'created', id: convo.id } as const
    }, { timeout: 15_000 })
  } catch (e) {
    // A thread made outside this lock (no other path makes a teacher thread — belt and braces): it is the same thread.
    if ((e as { code?: string })?.code !== 'P2002') throw e
    const winner = await db.conversation.findUnique({
      where: { listingId_buyerProfileId: { listingId: a.listingId, buyerProfileId: a.profileId } },
      select: { id: true },
    })
    if (!winner) throw e
    return { outcome: 'existing', id: winner.id }
  }
}

/**
 * What the thread's newest message says about an opener about to go into an EXISTING teacher thread:
 *   · `repeat` — the teacher has written nothing yet and the newest message is this writer's own, word for word: a re-sent
 *     opener (a second tap of the profile's Message button). Not sent again — it would spend one of the two messages
 *     "2 until reply" allows on a duplicate, and the next tap would be refused instead of opening the chat (Opus, gate
 *     2026-10-13). Only while unanswered — the one state the cap holds — so a chat the teacher has joined is never
 *     second-guessed (codex, gate 2026-10-13). A teacher listing's only doors here send generated openers; anything
 *     typed goes through the thread's own send route, which never asks this.
 *   · `empty` — nothing in the thread yet: its opener never landed (the insert failed after the thread was made), so this
 *     message is the first contact and rings the teacher like one. The thread is kept, not undone: a concurrent tap may
 *     be writing into it (codex, gate 2026-10-13), and the slot it holds is the one this message uses.
 * `text` null (an offer) is never a repeat.
 */
export async function openerAgainst(
  conversationId: string, writerProfileId: string, teacherProfileId: string | null, text: string | null,
): Promise<{ empty: boolean; repeat: boolean }> {
  const last = await db.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { senderProfileId: true, body: true, deletedAt: true },
  })
  const same = !!last && text !== null && last.senderProfileId === writerProfileId && !last.deletedAt && last.body === text
  // Asked only when it could matter: has the teacher written anything at all (earlier than this newest message)?
  const answered = same && !!teacherProfileId
    && !!(await db.message.findFirst({ where: { conversationId, senderProfileId: teacherProfileId }, select: { id: true } }))
  return { empty: !last, repeat: same && !answered }
}

/**
 * The refusal, with everything the client needs to say why and what lifts it. 429 with Retry-After until the Vietnam
 * midnight; a revoked identity is 403 — waiting changes nothing.
 * The CODE comes from the caller, as a literal at the route (`teacherDmRefusal(s, { error: 'teacher_thread_cap' })`): the
 * route is where the code reaches the wire, and errors.test.ts reads the routes to keep the error vocabulary honest.
 */
export function teacherDmRefusal(s: TeacherDmStanding, code: { error: 'teacher_thread_cap' }): NextResponse {
  const resetIn = Math.max(1, Math.ceil((Date.parse(s.resetAt) - Date.now()) / 1000))
  const body = {
    ...code,
    tier: s.tier, limit: s.limit, used: s.used, remaining: 0, resetAt: s.resetAt,
    next: s.next, nextLimit: s.nextLimit, reason: s.reason,
  }
  // No ids, only the rung and the reason: how often each rung is met, to tune the numbers.
  logInfo('teacher dm refused', { op: 'teachers.dm_quota.refused', tier: s.tier, reason: s.reason, next: s.next })
  return NextResponse.json(body, {
    status: s.tier === 'revoked' ? 403 : 429,
    // No Retry-After where waiting changes nothing: a revoked identity, or an account that needs a phone first (Opus, gate).
    headers: { 'Cache-Control': 'private, no-store', ...(s.tier === 'revoked' || s.reason === 'phone' ? {} : { 'Retry-After': String(resetIn) }) },
  })
}

/**
 * ⛔ A TEACHER WHO HAS NOT ANSWERED GETS AT MOST TEACHER_UNANSWERED_MAX MESSAGES (owner, 2026-10-13: "2 until reply").
 * Once the teacher has written anything in the thread — a reply, a share — the chat is open. Every message the writer
 * sent counts, recalled ones too: a recall must not buy another try.
 * This is the EARLY answer, a read: every send into the thread also carries teacherUnansweredGuard (below), the half
 * that cannot be raced.
 */
export async function mayWriteToTeacher(conversationId: string, buyerProfileId: string, teacherProfileId: string | null): Promise<boolean> {
  if (!teacherProfileId) return true
  const [teacherSpoke, sent] = await Promise.all([
    db.message.findFirst({ where: { conversationId, senderProfileId: teacherProfileId }, select: { id: true } }),
    db.message.count({ where: { conversationId, senderProfileId: buyerProfileId } }),
  ])
  return !!teacherSpoke || sent < TEACHER_UNANSWERED_MAX
}

/**
 * ⛔ THE ATOMIC HALF OF "2 UNTIL REPLY" (codex, gate 2026-10-13). mayWriteToTeacher is a read, and two sends at the same
 * instant both passed it — ten fired at once landed eleven messages on a teacher who never answered (measured on a local
 * Postgres). These two writes ride SendOpts.alongside, in the message's own batch transaction BEFORE its insert: a
 * per-thread advisory lock, so concurrent sends into the thread queue on it; then the rule read again, aborting the batch
 * — and the insert with it — when the writer has reached the cap and the teacher has not written. Read committed: each
 * statement sees what committed before it began, so the second of two sends sees the first's message (measured: ten
 * concurrent writers, exactly two messages). Plain SQL has no RAISE, so the abort is a division by zero.
 */
export function teacherUnansweredGuard(
  conversationId: string, buyerProfileId: string, teacherProfileId: string, repeatOf: string | null = null,
): Prisma.PrismaPromise<unknown>[] {
  const lock = db.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher-unanswered:' + conversationId}))`
  if (repeatOf === null) {
    return [lock, db.$queryRaw`select 1 / (case when exists (select 1 from "Message" where "conversationId" = ${conversationId} and "senderProfileId" = ${teacherProfileId}::uuid)
      or (select count(*) from "Message" where "conversationId" = ${conversationId} and "senderProfileId" = ${buyerProfileId}::uuid) < ${TEACHER_UNANSWERED_MAX}::int
      then 1 else 0 end) as ok`]
  }
  /*
   * ⛔ AN OPENER (`repeatOf`) IS ALSO REFUSED AS A REPEAT HERE, UNDER THE LOCK (codex + Opus, gate 2026-10-13): unanswered,
   * and the thread's newest message is this writer's own, word for word. openerAgainst asks the same before the send,
   * but as a read: a double tap on a NEW teacher had both requests read the thread empty and both openers land,
   * spending the writer's two messages and ringing twice. A repeat aborts with its OWN SQLSTATE — 22003, an int
   * overflow, data-dependent so never folded at plan time — and the cap's division never fires on one, so the
   * caller can tell "already said" (open the thread) from "held" whatever order the planner evaluates them in.
   */
  return [lock, db.$queryRaw`with t as (
      select exists (select 1 from "Message" where "conversationId" = ${conversationId} and "senderProfileId" = ${teacherProfileId}::uuid) as answered,
             (select count(*) from "Message" where "conversationId" = ${conversationId} and "senderProfileId" = ${buyerProfileId}::uuid) as sent,
             coalesce((select m."senderProfileId" = ${buyerProfileId}::uuid and m."deletedAt" is null and m.body = ${repeatOf}
                       from "Message" m where m."conversationId" = ${conversationId} order by m."createdAt" desc, m.id desc limit 1), false) as same
    )
    select (case when not answered and same then 2147483648 else 1 end)::int as fresh,
           1 / (case when (not answered and same) or answered or sent < ${TEACHER_UNANSWERED_MAX}::int then 1 else 0 end) as ok
    from t`]
}

/**
 * The guard's own abort, as Prisma raises it through the pg adapter — measured on Postgres (2026-10-13,
 * dm-guard.integration.test.ts): P2010 "raw query failed" carrying the guard's SQLSTATE — 22012 (division_by_zero) when
 * "2 until reply" holds the send, 22003 (an int overflow) when an opener repeats the writer's own newest message. The
 * guard is the only statement in a message's batch that divides or casts a number, so these are its refusals and
 * nothing else's. null for anything else.
 */
export function teacherGuardAbort(e: unknown): 'cap' | 'repeat' | null {
  const x = e as { code?: unknown; meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } } | null
  if (x?.code !== 'P2010') return null
  const cause = x.meta?.driverAdapterError?.cause
  const code = cause?.code ?? cause?.originalCode
  return code === '22012' ? 'cap' : code === '22003' ? 'repeat' : null
}

/**
 * Send into a teacher thread with the guard riding along. The guard's own abort — and only it — is a refusal, and nothing
 * of this send was written: 'cap', another send took the last place; 'repeat', an opener (`repeatOf`) that is already
 * the writer's newest message. Any other failure is the send's own and is rethrown — including one AFTER the message
 * committed, which must never read as "not sent" (Opus, gate 2026-10-13: an earlier draft inferred the refusal from the
 * rule saying no afterwards, which that very message makes true). A thread with no teacher profile has no rule.
 */
export async function sendToTeacherGuarded<T>(
  thread: { conversationId: string; buyerProfileId: string; teacherProfileId: string | null; repeatOf?: string | null },
  send: (alongside: Prisma.PrismaPromise<unknown>[]) => Promise<T>,
): Promise<{ sent: true; value: T } | { sent: false; reason: 'cap' | 'repeat' }> {
  const { conversationId, buyerProfileId, teacherProfileId, repeatOf = null } = thread
  if (!teacherProfileId) return { sent: true, value: await send([]) }
  try {
    return { sent: true, value: await send(teacherUnansweredGuard(conversationId, buyerProfileId, teacherProfileId, repeatOf)) }
  } catch (e) {
    const reason = teacherGuardAbort(e)
    if (reason) return { sent: false, reason }
    throw e
  }
}
