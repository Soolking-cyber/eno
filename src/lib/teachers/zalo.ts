import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { zaloHref } from '@/lib/contact'
import { blocksMessaging, getEnforcement } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'
import { COVER_CONSENT_VERSION } from './cover'
import { HOME_HIDDEN_TEACHER_LISTING_IDS, TEACHER_LISTING_TYPE, type TeacherDmNext } from './constants'
import { poolKeyFor, teacherDmTier, vnDayWindow } from './dm-quota'
import { teacherDmLock } from './dm-lock'
import {
  COVER_ZALO_NOTICE_VERSION, ZALO_REVEAL_LIMITS, ZALO_REVEAL_PER_TEACHER_UNVERIFIED, ZALO_REVEAL_POOL, normalizeVnMobile,
} from './zalo-rules'

/**
 * ⛔ "ZALO FOR URGENT COVER" (owner, 2026-10-28) — the ONE exception to "a school gets a teacher's contact only through
 * the teacher's Share tap" (/privacy; api/teachers/contact): a teacher with cover lessons ON may switch on a Zalo number
 * that a SCHOOL (a business account) can reveal on their profile without the teacher replying first — "in urgent cover
 * it's hard to reach the needed person". Plan reviewed by codex + opus (2026-10-28, ~/eno-cover-zalo-2026-10-28).
 *
 * THE TEACHER'S SIDE (saveCoverZalo) — their own switch, number and notice:
 *   · ON needs cover ON under today's cover notice, a VN mobile (zalo-rules.ts normalizeVnMobile), the CURRENT Zalo
 *     notice shown (`zaloNotice`, never stamped from a stale page) and the stamps the page loaded (`base`, a
 *     compare-and-set: an old tab can never switch back on a number withdrawn in another);
 *   · a NEW GRANT (`coverZaloAt` = now) is stamped when it goes on, when the number changes, or when an older notice's
 *     grant is renewed — a reveal discloses one grant, so a school that saw the old number counts again for a new one;
 *   · OFF is never refused: the number is DELETED (NULL) and the withdrawal stamped. Cover going off deletes it too
 *     (withdrawZaloForCoverOff, called by every cover save under the same teacher lock).
 *   · every change is a compliance-log row ('teacher.zalo.on' | 'teacher.zalo.changed' | 'teacher.zalo.off', with the
 *     notice version and the reason) — the grant history the four columns alone would overwrite. Never the number.
 *
 * THE SCHOOL'S SIDE (revealZalo) — one transaction, all of it re-read under the locks:
 *   · a signed-in BUSINESS account (`accountType`), not suspended, not revoked, not blocked either way, never the teacher;
 *   · the teacher live (profile, listing active + verified, never the demo), cover ON under today's notice, and a Zalo
 *     granted under today's Zalo notice;
 *   · the caps (zalo-rules.ts): 1 a day / 20 a day once business-verified; below that also the connection's pool and the
 *     per-teacher cap; re-opening the SAME grant is free and never counted or rung twice (the ledger's unique key);
 *   · LOCKS, in one order: the viewer's teacher-DM lock (dm-lock.ts — a revocation takes it too, so it is serialized with
 *     this), the pool's, then the teacher's own 'teacher:<id>' lock that every teacher save takes — so a withdrawal or a
 *     cover switch-off either committed before this read (and is seen) or waits for this reveal to finish. Who is asking
 *     (account type, enforcement, tier, blocks) is read AGAIN under the viewer's lock.
 *   · the TEACHER IS TOLD, atomically: a new ledger row and its bell row ('teacher_zalo_seen', the school's name as it
 *     reads now) commit together or not at all.
 */

export type ZaloReason = 'business_only' | 'suspended' | 'revoked' | 'limit' | 'pool' | 'teacher_cap' | 'busy'
export type ZaloTier = 'school' | 'verified' | 'none'
export type ZaloStanding = {
  /** The teacher offers Zalo for urgent cover right now, to this viewer. */
  available: boolean
  /** This viewer already saw the current grant (re-opening it is free). */
  revealed: boolean
  tier: ZaloTier
  limit: number
  used: number
  remaining: number
  resetAt: string
  /** Why the next NEW reveal would be refused, or null. */
  reason: ZaloReason | null
  /** What lifts the cap — the DM ladder's steps (verify identity → business → pending → renew), or null. */
  next: TeacherDmNext | null
}

export class ZaloNoticeChangedError extends Error { constructor() { super('zalo_notice_changed'); this.name = 'ZaloNoticeChangedError' } }
export class ZaloChangedError extends Error { constructor() { super('zalo_changed'); this.name = 'ZaloChangedError' } }
export class ZaloInvalidError extends Error {
  constructor(readonly field: 'zalo' | 'cover') { super(`zalo_invalid:${field}`); this.name = 'ZaloInvalidError' }
}

/** The bell a teacher gets for each new disclosure. Persisted copy is a bilingual composite (notify.ts's idiom); it names
 *  the school, so it is shown as written — never machine-translated (notification-text.ts: not on the allowlist). */
export const ZALO_SEEN = { type: 'teacher_zalo_seen', url: '/teachers/cover-zalo' } as const
export const zaloSeenTitle = 'Một trường đã xem số Zalo của bạn · A school saw your Zalo number'
/** ⛔ THE NAME IS THE ACCOUNT'S OWN WORDS, QUOTED (review, 2026-10-28): a business name is self-typed, so "eno Support saw
 *  your Zalo" must read as an account CALLED that, never as eno speaking. */
export const zaloSeenBody = (school: string) =>
  `Tài khoản trường “${school}” đã xem số Zalo dạy thay khẩn của bạn. · The school account “${school}” saw your Zalo number for urgent cover.`

const TX_OPTS = { maxWait: 5_000, timeout: 10_000 } as const
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const sameStamp = (sent: unknown, stored: Date | null) =>
  sent === null || sent === undefined ? stored === null : typeof sent === 'string' && stored !== null && Date.parse(sent) === stored.getTime()

// ── THE TEACHER'S OWN ─────────────────────────────────────────────────────────────────────────────────────────────────

export type CoverZaloState = {
  /** The teacher has a profile. */
  hasProfile: boolean
  /** Cover is ON under today's cover notice — Zalo can be switched on only then. */
  coverOn: boolean
  on: boolean
  zalo: string | null
  /** Granted under an older notice: off for schools until switched on again under today's. */
  stale: boolean
  /** The page's compare-and-set base — send it back with a switch-on: the profile it was read from, and the stamps. */
  base: { profile: string | null; at: string | null; withdrawnAt: string | null }
  /** The profile's phone, for prefilling — only while it is a VN mobile. */
  phoneSuggestion: string | null
  noticeVersion: string
  /** The schools that saw a grant, newest first — the latest SEEN_BY_SHOWN (the teacher's own record; all of it is in
   *  their data download). */
  seenBy: { name: string; at: string }[]
  /** How many there are in all — the page says when it shows only the latest (review round 2). */
  seenByTotal: number
}

/** How many of the schools that saw the number the page lists; the rest are in the data download (export.ts). */
const SEEN_BY_SHOWN = 100

/** The teacher's own Zalo state, or `hasProfile: false`. Never cached: the route answers private, no-store. */
export async function readCoverZalo(profileId: string): Promise<CoverZaloState> {
  const tp = await db.teacherProfile.findUnique({
    where: { profileId },
    select: {
      id: true, coverOpen: true, coverConsentVersion: true,
      private: { select: { phone: true, coverZalo: true, coverZaloAt: true, coverZaloVersion: true, coverZaloWithdrawnAt: true } },
      zaloReveals: { select: { viewerName: true, revealedAt: true }, orderBy: { revealedAt: 'desc' }, take: SEEN_BY_SHOWN },
      _count: { select: { zaloReveals: true } },
    },
  })
  const p = tp?.private ?? null
  return {
    hasProfile: !!tp,
    coverOn: !!tp && tp.coverOpen && tp.coverConsentVersion === COVER_CONSENT_VERSION,
    on: !!p?.coverZalo,
    zalo: p?.coverZalo ?? null,
    stale: !!p?.coverZalo && p.coverZaloVersion !== COVER_ZALO_NOTICE_VERSION,
    base: { profile: tp?.id ?? null, at: iso(p?.coverZaloAt), withdrawnAt: iso(p?.coverZaloWithdrawnAt) },
    phoneSuggestion: normalizeVnMobile(p?.phone ?? null),
    noticeVersion: COVER_ZALO_NOTICE_VERSION,
    seenBy: (tp?.zaloReveals ?? []).map((r) => ({ name: r.viewerName, at: r.revealedAt.toISOString() })),
    seenByTotal: tp?._count.zaloReveals ?? 0,
  }
}

/**
 * The teacher's switch. `body`: `{ on: true, zalo, zaloNotice, base: { at, withdrawnAt } }` or `{ on: false }`.
 * Throws ZaloNoticeChangedError (409, reload), ZaloChangedError (409, changed in another window), ZaloInvalidError
 * (400: a number that is not a VN mobile, or cover not on). Returns the state as saved, or `hasProfile: false`.
 */
export async function saveCoverZalo(profileId: string, raw: unknown, actorIp: string | null): Promise<CoverZaloState> {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const on = body.on === true
  let zalo: string | null = null
  if (on) {
    if (body.zaloNotice !== COVER_ZALO_NOTICE_VERSION) throw new ZaloNoticeChangedError()
    zalo = normalizeVnMobile(body.zalo)
    if (!zalo) throw new ZaloInvalidError('zalo')
  }
  const base = (body.base && typeof body.base === 'object' ? body.base : {}) as Record<string, unknown>
  const saved = await db.$transaction(async (tx) => {
    // The teacher's own lock — every profile and cover save takes it (publish.ts), and so does a reveal.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({
      where: { profileId },
      select: { id: true, coverOpen: true, coverConsentVersion: true, private: { select: { coverZalo: true, coverZaloAt: true, coverZaloVersion: true, coverZaloWithdrawnAt: true } } },
    })
    if (!tp) return false
    const p = tp.private
    const now = new Date()
    if (!on) {
      if (!p?.coverZalo) return true
      await tx.teacherPrivate.update({ where: { teacherProfileId: tp.id }, data: { coverZalo: null, coverZaloWithdrawnAt: now } })
      await audit(tx, profileId, actorIp, 'teacher.zalo.off', { teacherProfileId: tp.id, reason: 'teacher' })
      return true
    }
    // ⛔ COMPARE-AND-SET: what this page loaded must still be what is stored — another window's switch-off is never undone
    // — and on the SAME profile (review round 6: a tab loaded before the profile was deleted and made again carries
    // empty stamps that a new profile's empty stamps would match).
    if (base.profile !== tp.id || !sameStamp(base.at, p?.coverZaloAt ?? null) || !sameStamp(base.withdrawnAt, p?.coverZaloWithdrawnAt ?? null)) throw new ZaloChangedError()
    if (!(tp.coverOpen && tp.coverConsentVersion === COVER_CONSENT_VERSION)) throw new ZaloInvalidError('cover')
    const same = p?.coverZalo === zalo && p?.coverZaloVersion === COVER_ZALO_NOTICE_VERSION
    if (same) return true
    const action = p?.coverZalo ? 'teacher.zalo.changed' : 'teacher.zalo.on'
    // ⛔ EVERY GRANT A NEW INSTANT (review round 6): a reveal is told apart by this stamp, so two changes in one millisecond
    // must never share it (the second would read as already seen — no count, no bell). Strictly after the last one.
    const grantAt = p?.coverZaloAt && p.coverZaloAt.getTime() >= now.getTime() ? new Date(p.coverZaloAt.getTime() + 1) : now
    await tx.teacherPrivate.upsert({
      where: { teacherProfileId: tp.id },
      create: { teacherProfileId: tp.id, coverZalo: zalo, coverZaloAt: grantAt, coverZaloVersion: COVER_ZALO_NOTICE_VERSION },
      update: { coverZalo: zalo, coverZaloAt: grantAt, coverZaloVersion: COVER_ZALO_NOTICE_VERSION },
    })
    await audit(tx, profileId, actorIp, action, { teacherProfileId: tp.id, notice: COVER_ZALO_NOTICE_VERSION })
    return true
  }, TX_OPTS)
  if (!saved) return { ...(await readCoverZalo(profileId)), hasProfile: false }
  return readCoverZalo(profileId)
}

/**
 * ⛔ COVER OFF DELETES THE ZALO — called INSIDE every save that writes the cover columns (publish.ts saveTeacherProfile
 * and saveTeacherCover), under their teacher lock, with what that save leaves `coverOpen` at. The number exists only for
 * cover; a teacher who stops offering cover is not reachable by it any more, and switching cover on again does not bring
 * it back (they switch Zalo on again, under the notice then).
 */
export async function withdrawZaloForCoverOff(tx: Prisma.TransactionClient, a: { profileId: string; teacherProfileId: string; coverOpen: boolean; actorIp?: string | null; bySweep?: boolean }): Promise<boolean> {
  if (a.coverOpen) return false
  // One statement, its count the truth (a row without a number is left alone, and no withdrawal is stamped for it).
  const cleared = await tx.$executeRaw`UPDATE "TeacherPrivate" SET "coverZalo" = NULL, "coverZaloWithdrawnAt" = ${new Date()}
    WHERE "teacherProfileId" = ${a.teacherProfileId} AND "coverZalo" IS NOT NULL`
  if (cleared !== 1) return false
  await audit(tx, a.profileId, a.actorIp ?? null, 'teacher.zalo.off', { teacherProfileId: a.teacherProfileId, reason: a.bySweep ? 'sweep_cover_off' : 'cover_off' }, a.bySweep ? 'system' : 'user')
  return true
}

/** `actor` 'system' for the daily sweep (review round 5): the log says who acted — the teacher, or eno's own run. */
async function audit(tx: Prisma.TransactionClient, profileId: string, actorIp: string | null, action: string, detail: Prisma.InputJsonObject, actor: 'user' | 'system' = 'user') {
  // A bounded wait on the log's own lock (publish.ts's rule): a log busy for 2 s fails the save, which the teacher repeats.
  // ⛔ RESTORED AFTER (review round 4): this runs in the MIDDLE of a cover save (withdrawZaloForCoverOff), and a
  // transaction-local setting would otherwise bound every statement after it — the save's listing write included.
  const [{ was }] = await tx.$queryRaw<{ was: string }[]>`SELECT current_setting('lock_timeout') AS was`
  await tx.$executeRaw`SELECT set_config('lock_timeout', '2000ms', true)`
  await appendAudit(tx as unknown as Parameters<typeof appendAudit>[0], {
    actorType: actor, actorId: actor === 'user' ? profileId : null, actorIp, action, subjectType: 'profile', subjectId: profileId, detail,
  })
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${was}, true)`
}

// ── THE SCHOOL'S SIDE ─────────────────────────────────────────────────────────────────────────────────────────────────

type Target = { teacherProfileId: string; teacherAccountId: string; zalo: string; grantAt: Date }

/** The teacher behind a listing, when it offers Zalo for urgent cover right now — read inside the reveal's locks. */
async function targetOf(client: Prisma.TransactionClient | typeof db, listingId: string): Promise<Target | null> {
  if ((HOME_HIDDEN_TEACHER_LISTING_IDS as readonly string[]).includes(listingId)) return null
  const tp = await client.teacherProfile.findFirst({
    where: { listingId, status: 'live', listing: { status: 'active', verified: true, listingType: TEACHER_LISTING_TYPE } },
    select: { id: true, profileId: true, coverOpen: true, coverConsentVersion: true, private: { select: { coverZalo: true, coverZaloAt: true, coverZaloVersion: true } } },
  })
  const p = tp?.private
  if (!tp || !tp.coverOpen || tp.coverConsentVersion !== COVER_CONSENT_VERSION) return null
  if (!p?.coverZalo || !p.coverZaloAt || p.coverZaloVersion !== COVER_ZALO_NOTICE_VERSION) return null
  return { teacherProfileId: tp.id, teacherAccountId: tp.profileId, zalo: p.coverZalo, grantAt: p.coverZaloAt }
}

type Viewer = { tier: ZaloTier; limit: number; next: TeacherDmNext | null; reason: ZaloReason | null; name: string; pooled: boolean }

/** Who is asking, judged before the transaction (dm-quota.ts: the tier's reads use the shared pool). */
async function viewerOf(viewerId: string, now: Date): Promise<Viewer> {
  const profile = await db.profile.findUnique({ where: { id: viewerId }, select: { accountType: true, businessName: true, seller: { select: { name: true } } } })
  // The business's name — its storefront's, else the one given at business onboarding; never the person's display name
  // (review, 2026-10-28: it outlives the account on the teacher's record, and a person's name was never the school's).
  const name = (profile?.seller?.name || profile?.businessName || '').trim().slice(0, 80) || 'A school (no name given)'
  const none = (reason: ZaloReason, next: TeacherDmNext | null = null): Viewer => ({ tier: 'none', limit: 0, next, reason, name, pooled: false })
  if (profile?.accountType !== 'business') return none('business_only', 'switch_to_business')
  if (blocksMessaging((await getEnforcement(viewerId)).state)) return none('suspended')
  const t = await teacherDmTier(viewerId, now)
  if (t.tier === 'revoked') return none('revoked', 'none')
  if (t.tier === 'business') return { tier: 'verified', limit: ZALO_REVEAL_LIMITS.verified, next: 'tomorrow', reason: null, name, pooled: false }
  // Below business verification: the step that lifts it — identity first, then the business (the owner's order).
  const next: TeacherDmNext = t.tier === 'identity' ? t.next : t.next === 'add_phone' ? 'verify_identity' : t.next
  return { tier: 'school', limit: ZALO_REVEAL_LIMITS.school, next, reason: null, name, pooled: true }
}

type Counts = { used: number; pool: number; teacher: number; seen: boolean }
async function countsOf(client: Prisma.TransactionClient | typeof db, viewerId: string, target: Target | null, day: string, poolKey: string): Promise<Counts> {
  const [used, pool, teacher, seen] = await Promise.all([
    client.teacherZaloReveal.count({ where: { viewerProfileId: viewerId, day } }),
    client.teacherZaloReveal.count({ where: { poolKey, day } }),
    target ? client.teacherZaloReveal.count({ where: { teacherProfileId: target.teacherProfileId, day, poolKey: { not: null } } }) : 0,
    target ? client.teacherZaloReveal.count({ where: { viewerProfileId: viewerId, teacherProfileId: target.teacherProfileId, grantAt: target.grantAt } }) : 0,
  ])
  return { used, pool, teacher, seen: seen > 0 }
}

function refusal(v: Viewer, c: Counts): ZaloReason | null {
  if (v.reason) return v.reason
  if (c.seen) return null
  if (c.used >= v.limit) return 'limit'
  if (v.pooled && c.pool >= ZALO_REVEAL_POOL) return 'pool'
  if (v.pooled && c.teacher >= ZALO_REVEAL_PER_TEACHER_UNVERIFIED) return 'teacher_cap'
  return null
}

function standingOf(v: Viewer, c: Counts, available: boolean, resetAt: Date): ZaloStanding {
  const reason = available ? refusal(v, c) : v.reason
  return {
    available, revealed: available && c.seen, tier: v.tier, limit: v.limit, used: c.used, remaining: Math.max(0, v.limit - c.used),
    resetAt: resetAt.toISOString(), reason, next: reason ? v.next : null,
  }
}

/** May this viewer be shown the Zalo button for this teacher, and what would a tap do? Never the number. */
export async function zaloStanding(viewerId: string, listingId: string, ip: string | null, now = new Date()): Promise<ZaloStanding> {
  const { day, resetAt } = vnDayWindow(now)
  const [v, target] = await Promise.all([viewerOf(viewerId, now), targetOf(db, listingId)])
  const blocked = target ? target.teacherAccountId === viewerId || (await isBlockedBetween(viewerId, target.teacherAccountId)) : false
  // ⛔ NO ORACLE (review, 2026-10-28): an account that may not reveal at all (personal, suspended, revoked) learns nothing
  // about whether this teacher offers Zalo — the same "not available" as a teacher who does not.
  const live = !!target && !blocked && !v.reason
  const c = await countsOf(db, viewerId, live ? target : null, day, poolKeyFor(ip, day))
  return standingOf(v, c, live, resetAt)
}

export type RevealResult =
  | { ok: true; zalo: string; href: string; standing: ZaloStanding }
  | { ok: false; reason: ZaloReason; standing: ZaloStanding }
  | null

/**
 * Reveal the teacher's Zalo to this viewer — or refuse, saying why. `null`: no teacher here offers it to this viewer
 * (not live, cover or Zalo off, the demo, blocked, the teacher themself) — one answer for all, so it is no oracle.
 */
export async function revealZalo(viewerId: string, listingId: string, ip: string | null, now = new Date()): Promise<RevealResult> {
  const { day, resetAt } = vnDayWindow(now)
  const poolKey = poolKeyFor(ip, day)
  const pre = await targetOf(db, listingId)
  // An account that may not reveal at all gets the same null as a teacher who offers nothing (no oracle).
  if (!pre || pre.teacherAccountId === viewerId || (await viewerOf(viewerId, now)).reason) return null
  if (await isBlockedBetween(viewerId, pre.teacherAccountId)) return null
  if (!takeRevealSlot()) return { ok: false, reason: 'busy', standing: standingOf(await viewerOf(viewerId, now), { used: 0, pool: 0, teacher: 0, seen: false }, true, resetAt) }
  try {
    return await revealInTx(viewerId, listingId, pre, day, poolKey, resetAt, now)
  } finally {
    releaseRevealSlot()
  }
}

/**
 * ⛔ AT MOST REVEAL_SLOTS REVEALS IN FLIGHT PER SERVER PROCESS (review round 2, opus): each holds its transaction's
 * connection while it re-reads the viewer through the shared client (dm-quota.ts's pool caution), so a burst from many
 * accounts at once could take the whole pool (10). Three at a time is ≤ 6 connections; a tap past it is told to retry.
 */
const REVEAL_SLOTS = 3
let revealsInFlight = 0
const takeRevealSlot = () => (revealsInFlight < REVEAL_SLOTS ? (revealsInFlight++, true) : false)
const releaseRevealSlot = () => { revealsInFlight = Math.max(0, revealsInFlight - 1) }

async function revealInTx(viewerId: string, listingId: string, pre: Target, day: string, poolKey: string, resetAt: Date, now: Date): Promise<RevealResult> {
  return db.$transaction(async (tx) => {
    await teacherDmLock(tx, viewerId)
    // ⛔ WHO IS ASKING, READ UNDER THE VIEWER'S LOCK (review, 2026-10-28): a revocation takes this lock too (dm-lock.ts),
    // so one committed while this reveal waited is seen here, not missed by a read made before it. Its reads go through
    // the shared client (dm-quota.ts's caution about the pool); a reveal is one per school per day, so the cost is a few
    // reads while one connection is held. A block made meanwhile is read again too.
    const v = await viewerOf(viewerId, now)
    if (v.reason) return null
    if (v.pooled) await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher-zalo-pool:' + poolKey}))`
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + pre.teacherAccountId}))`
    // ⛔ THE DAY, AFTER THE LOCKS (review round 3): a reveal that waited across Vietnam midnight must not count on
    // yesterday's quota while it discloses today. The pool's lock was taken for the day it started; if the day moved
    // meanwhile, nothing is counted or shown — the tap is asked again (rare: a wait across 00:00).
    if (vnDayWindow(new Date()).day !== day) return { ok: false as const, reason: 'busy' as const, standing: standingOf(v, { used: 0, pool: 0, teacher: 0, seen: false }, true, resetAt) }
    // Everything again under the locks: a withdrawal, a cover switch-off or a new number committed meanwhile is seen —
    // and a block made while this waited (review round 2: checked AFTER the last lock, just before the disclosure).
    const target = await targetOf(tx, listingId)
    if (!target || target.teacherAccountId !== pre.teacherAccountId) return null
    if (await isBlockedBetween(viewerId, target.teacherAccountId)) return null
    const c = await countsOf(tx, viewerId, target, day, poolKey)
    const reason = refusal(v, c)
    if (reason) return { ok: false as const, reason, standing: standingOf(v, c, true, resetAt) }
    if (!c.seen) {
      await tx.teacherZaloReveal.create({
        data: { viewerProfileId: viewerId, viewerName: v.name, teacherProfileId: target.teacherProfileId, grantAt: target.grantAt, day, poolKey: v.pooled ? poolKey : null },
      })
      await tx.notification.create({
        data: { recipientId: target.teacherAccountId, type: ZALO_SEEN.type, title: zaloSeenTitle, body: zaloSeenBody(v.name), url: ZALO_SEEN.url },
      })
    }
    const after: Counts = c.seen ? c : { ...c, used: c.used + 1, pool: c.pool + (v.pooled ? 1 : 0), teacher: c.teacher + (v.pooled ? 1 : 0), seen: true }
    return { ok: true as const, zalo: target.zalo, href: zaloHref(target.zalo), standing: standingOf(v, after, true, resetAt) }
  }, TX_OPTS)
}

// ── RETENTION — the daily sweep (src/app/api/cron/teacher-draft-retention runs it, 08:45 UTC) ─────────────────────────

/**
 * ⛔ WHAT IS KEPT, AND FOR HOW LONG (reviews, 2026-10-28 — /privacy says the same):
 *   · a connection's code (`poolKey`) is needed only on its own day (that day's shared pool): erased at the first run
 *     after the day is over — the next day (the run is daily, 08:45 UTC = 15:45 Vietnam);
 *   · a row whose teacher deleted their profile (`teacherProfileId` NULL) is only that day's count for the school:
 *     deleted the same way, the next day;
 *   · a Zalo number whose cover is SWITCHED OFF is deleted (the backstop to the save paths' withdrawZaloForCoverOff,
 *     for any writer that switched cover off another way), under the teacher's lock, logged. ⛔ NOT a cover-notice bump
 *     (review round 3): cover left on under an older cover notice is dormant — never revealed (targetOf needs today's
 *     cover consent) — and its number waits for the teacher to switch cover on again, rather than being wiped unseen.
 * A grant under an OLDER Zalo notice with cover on is kept too — the teacher's page asks them to renew or delete it.
 */
export async function sweepZalo(now = new Date()): Promise<{ poolKeysErased: number; countsDeleted: number; numbersDeleted: number }> {
  const today = vnDayWindow(now).day
  const poolKeysErased = await db.$executeRaw`UPDATE "TeacherZaloReveal" SET "poolKey" = NULL WHERE "poolKey" IS NOT NULL AND "day" < ${today}`
  const countsDeleted = await db.$executeRaw`DELETE FROM "TeacherZaloReveal" WHERE "teacherProfileId" IS NULL AND "day" < ${today}`
  let numbersDeleted = 0
  // In pages, up to 20,000 a run (review round 4: one page of 500 left the rest for the next day — about 50 teachers
  // offer cover today); a page that clears none stops it — a row that stays is one cover switched back on meanwhile.
  for (let page = 0; page < 100; page++) {
    const off = await db.teacherProfile.findMany({
      where: { private: { coverZalo: { not: null } }, coverOpen: false },
      select: { id: true, profileId: true },
      orderBy: { id: 'asc' },
      take: 200,
    })
    let cleared = 0
    for (const t of off) {
      const done = await db.$transaction(async (tx) => {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + t.profileId}))`
        const tp = await tx.teacherProfile.findUnique({ where: { id: t.id }, select: { coverOpen: true } })
        return withdrawZaloForCoverOff(tx, { profileId: t.profileId, teacherProfileId: t.id, coverOpen: tp?.coverOpen === true, bySweep: true })
      }, TX_OPTS)
      if (done) cleared++
    }
    numbersDeleted += cleared
    if (off.length < 200 || cleared === 0) break
  }
  return { poolKeysErased, countsDeleted, numbersDeleted }
}
