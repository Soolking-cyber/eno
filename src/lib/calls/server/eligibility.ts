import 'server-only'
import { db } from '@/lib/db'
import { messagingGate } from '@/lib/enforcement'
import { blockingOn, isBlockedBetween, isStaffProfile } from '@/lib/user-blocks'
import { verifiedIdentityFor } from '@/lib/kyc/identity'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { deskSellerIds } from '@/lib/edition-scope'
import { RENTAL_DESK_SELLER_IDS } from '@/lib/rental-check/desk-ids'
import { JOBS_DESK_SELLER_ID } from '@/lib/teachers/job-dms/constants'
import { isEVisaThread } from '@/lib/ios-hide-visa-server'
import { threadKind } from '@/lib/thread-kind'
import { rateLimit } from '@/lib/ratelimit'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import type { CallMedia } from '../types'
import { modeAdmits, readCallsConfig, resetCallsConfigCache, type CallsConfig } from './config'
import { pairCallCounts } from './session'

/**
 * In-app calls — WHO MAY CALL WHOM, WHERE (DESIGN.md v3 §4; owner decision 2, 2026-10-21).
 *
 *   · Both people pass the runtime switch (config.ts) — in a beta the callee must be in it too, or their phone would
 *     ring with no way to answer.
 *   · Any listing chat between two real people, and (owner, 2026-10-22: "in chat call video call feature no need for
 *     post for that we can build guardrails later on") the listing-less chats with eno's rental and jobs desks, which
 *     support@eno.forum answers. Never a chat with eno's visa / trip storefront, a visa application's, a visa- or
 *     itinerary-kind thread or an e-Visa product's: the licensed eno.vn must not show those, and a call card prints the
 *     listing's title. Never a support thread (nobody on the line: its replies come one-way from the admin surface), any
 *     other listing-less chat (its listing is gone — what it was about cannot be checked) or an unclaimed storefront.
 *   · Neither side suspended from messaging; no block either way (blocking must be live — config.ts).
 *   · The CALLER holds a live verified identity (eKYC). Video, and every call in a teacher thread, need the CALLEE
 *     verified too (§4: "video and all teacher-thread calls require BOTH sides ID-verified"). ⚠️ The eno team
 *     (ADMIN_EMAILS) is exempt from the identity half — staff are known people, and the staff phase of the rollout
 *     (mode 'staff') must not need a KYC case per test account. Consent, blocks and every other gate still apply.
 *   · Nobody KNOWN to be under 18. The Terms already require 18+ (terms/page.tsx); KYC stores no birth year today
 *     (IdentityVerification.birthYear has no writer), so this only bites once it does. ⚠️ Before mode 'all', KYC must
 *     start recording the MRZ birth year — until then the beta cohort is the owner's own choice of adults.
 *   · The callee said yes to THIS person in THIS thread ("Allow calls from <name>", call_consent) — the consent
 *     evidence PDPL/Decree 356 Art 6 asks for, and the reason a stranger cannot ring anyone cold.
 *   · Rate limits and the pair cooldown (§4 limits).
 *
 * Every refusal is a code the call button can explain (ApiErrorCode), checked cheapest first.
 */

export interface ConversationForCall {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  sellerId: string
  listingId: string | null
  visaApplicationId: string | null
  listingType: string | null
}

/**
 * Every code a refusal here can carry. NAMED so the routes can put `{ error: permit.error }` on the wire and
 * src/lib/api/errors.test.ts can still see what that emits (RE_EMITTED_UNIONS), and errors.ts can assert at compile
 * time that each one is an ApiErrorCode.
 */
export type CallRefusalCode =
  | 'not_participant'
  | 'blocked'
  | 'rate_limited'
  | 'calls_unavailable'
  | 'calls_not_verified'
  | 'calls_peer_not_verified'
  | 'calls_consent_required'
  | 'calls_thread_unavailable'
  | 'calls_cooldown'

export type Refusal = { error: CallRefusalCode; status: number }

export type CallPermit =
  | { ok: true; calleeId: string; teacherThread: boolean; config: CallsConfig }
  | ({ ok: false } & Refusal)

export const refuse = (error: CallRefusalCode, status: number): { ok: false } & Refusal => ({ ok: false, error, status })

/** ≤3 unanswered calls to the same person per 24 h, then a cooldown (§4). */
export const PAIR_UNANSWERED_LIMIT = 3
/** A callee rung by this many DIFFERENT people in an hour stops being ringable by anyone new for the day (§4). */
export const INBOUND_DISTINCT_LIMIT = 5
/** Accounts younger than this get the low daily cap (§4: ≤5/day for accounts < 7 days). */
export const NEW_ACCOUNT_DAYS = 7

/** Which way this profile faces in the thread, or null when it is not one of the two people in it. */
export function counterpartOf(convo: ConversationForCall, profileId: string): string | null {
  if (convo.buyerProfileId === profileId) return convo.sellerProfileId
  if (convo.sellerProfileId === profileId) return convo.buyerProfileId
  return null
}

/**
 * The desks whose chats may carry a call (owner, 2026-10-22): the rental and jobs desks — support@eno.forum is their
 * chats' `sellerProfileId`, so somebody is on the line. Both editions' rental ids: the two sites share one database, and
 * the accept runs these rules again on the callee's site, which may be the other one. Their chats carry no listing
 * (measured 2026-10-22: 74 of 74). Not the support desks (nobody on the line — support-thread.ts) and not eno's visa /
 * trip storefront (deskSellerIds(), refused listing or not).
 */
const CALLABLE_DESK_IDS: readonly string[] = [...RENTAL_DESK_SELLER_IDS, JOBS_DESK_SELLER_ID]

/** The structural part of "may this thread carry a call" — pure. threadPermitRefusal adds the DB-backed kinds. */
export function threadRefusal(convo: ConversationForCall, profileId: string, deskIds: readonly string[]): Refusal | null {
  if (convo.buyerProfileId !== profileId && convo.sellerProfileId !== profileId) return { error: 'not_participant', status: 403 }
  // An unclaimed storefront has nobody to ring; a thread with one person on both sides has nobody else.
  const other = counterpartOf(convo, profileId)
  if (!other || other === profileId) return { error: 'calls_thread_unavailable', status: 403 }
  if (convo.visaApplicationId) return { error: 'calls_thread_unavailable', status: 403 }
  // eno's visa / trip storefront: never, with a listing or without — the licensed eno.vn must not show it. Nor a support
  // thread: nobody is on the line there (support-thread.ts).
  if (convo.sellerId === SUPPORT_SELLER_ID || deskIds.includes(convo.sellerId)) return { error: 'calls_thread_unavailable', status: 403 }
  // No listing: only a chat with the rental or jobs desk. Any other listing-less chat lost its listing, and what it was
  // about (a visa product? a teacher?) can no longer be checked — fail closed (commit-gate review, codex + opus).
  if (!convo.listingId) return CALLABLE_DESK_IDS.includes(convo.sellerId) ? null : { error: 'calls_thread_unavailable', status: 403 }
  // A desk chat WITH a listing is about something the desk handles, not someone's item.
  if (CALLABLE_DESK_IDS.includes(convo.sellerId)) return { error: 'calls_thread_unavailable', status: 403 }
  return null
}

/**
 * May this thread carry a call at all — the structural rules (threadRefusal) AND the DB-backed kinds: never a visa- or
 * itinerary-kind thread, never an e-Visa product's. ONE function for callPermit and the consent route (round-5 review:
 * the consent route ran only the structural half, so consent could be stored on a thread no call may ever use — on the
 * licensing boundary, of all places).
 */
export async function threadPermitRefusal(convo: ConversationForCall, profileId: string): Promise<Refusal | null> {
  const structural = threadRefusal(convo, profileId, await deskSellerIds())
  if (structural) return structural
  const kind = await threadKind({ listingId: convo.listingId })
  if (kind !== 'listing' || (await isEVisaThread(convo.id))) return { error: 'calls_thread_unavailable', status: 403 }
  return null
}

/**
 * Known to be under 18 by a VERIFIED document's birth year. A year alone cannot say whether the birthday has passed,
 * so the ambiguous year counts as under 18 (born in Y: in calendar year C they are C−Y−1 or C−Y).
 */
export function knownMinorByYear(birthYear: number | null | undefined, currentYear: number): boolean {
  return typeof birthYear === 'number' && Number.isInteger(birthYear) && birthYear >= currentYear - 18
}

const ictYear = (now: Date) => new Date(now.getTime() + 7 * 3600_000).getUTCFullYear()

async function verifiedAdult(profileId: string, now: Date): Promise<boolean> {
  if (!(await verifiedIdentityFor(profileId))) return false
  const minor = await db.identityVerification.findFirst({
    where: { profileId, status: 'verified', birthYear: { gte: ictYear(now) - 18 } },
    select: { id: true },
  })
  return !minor
}

export async function loadConversationForCall(conversationId: string): Promise<ConversationForCall | null> {
  const c = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, sellerId: true, listingId: true, visaApplicationId: true,
      listing: { select: { listingType: true } },
    },
  })
  if (!c) return null
  return {
    id: c.id, buyerProfileId: c.buyerProfileId, sellerProfileId: c.sellerProfileId, sellerId: c.sellerId,
    listingId: c.listingId, visaApplicationId: c.visaApplicationId, listingType: c.listing?.listingType ?? null,
  }
}

/**
 * The rules that hold for the whole LIFE of a call, not only its start: the switch admits both people (and video, for a
 * video call), neither is suspended, no block either way. callPermit runs them at the start and the accept,
 * liveCallRefusal on every heartbeat. The thread and identity rules are about STARTING a call — a listing sold or
 * deleted, or a verification lapsing, mid-call hangs nobody up (round-6 review).
 */
async function standingRefusal(config: CallsConfig, callerId: string, calleeId: string, media: CallMedia): Promise<
  { error: 'calls_unavailable' | 'blocked' } | { error: null; callerStaff: boolean; calleeStaff: boolean }
> {
  // No blocking, no calls (config.ts): Block is the way out of an unwanted caller, and it exists only with ugc-safety.
  if (config.mode === 'off' || !blockingOn()) return { error: 'calls_unavailable' }
  const [callerStaff, calleeStaff] = await Promise.all([isStaffProfile(callerId), isStaffProfile(calleeId)])
  if (!modeAdmits(config, callerId, callerStaff, true) || !modeAdmits(config, calleeId, calleeStaff, true)) return { error: 'calls_unavailable' }
  if (media === 'video' && !config.video) return { error: 'calls_unavailable' }
  if ((await messagingGate(callerId)) || (await messagingGate(calleeId))) return { error: 'calls_unavailable' }
  if (await isBlockedBetween(callerId, calleeId)) return { error: 'blocked' }
  return { error: null, callerStaff, calleeStaff }
}

/**
 * Everything except consent and the limits: may these two talk by call in this thread at all? Shared by the call
 * button's state (GET /api/conversations/:id/call), the consent request and the start itself.
 */
export async function callPermit(convo: ConversationForCall, callerId: string, media: CallMedia, now = new Date()): Promise<CallPermit> {
  const config = await readCallsConfig()
  // No blocking, no calls (config.ts): Block is the way out of an unwanted caller, and it exists only with ugc-safety.
  if (config.mode === 'off' || !blockingOn()) return refuse('calls_unavailable', 403)
  const thread = await threadPermitRefusal(convo, callerId)
  if (thread) return { ok: false, ...thread }
  const calleeId = counterpartOf(convo, callerId) as string

  const standing = await standingRefusal(config, callerId, calleeId, media)
  if (standing.error) return refuse(standing.error, 403)
  const { callerStaff, calleeStaff } = standing

  const teacherThread = convo.listingType === TEACHER_LISTING_TYPE
  if (!callerStaff && !(await verifiedAdult(callerId, now))) return refuse('calls_not_verified', 403)
  if ((media === 'video' || teacherThread) && !calleeStaff && !(await verifiedAdult(calleeId, now))) return refuse('calls_peer_not_verified', 403)
  return { ok: true, calleeId, teacherThread, config }
}

/**
 * Is a LIVE call still one the box would allow? Asked on every heartbeat (either side, every 15 s): the STANDING rules
 * the start and the accept also ran (standingRefusal) — so the kill switch, a NARROWED switch (staff or beta), a
 * suspension or a block ends a call within one beat plus CONFIG_CACHE_MS, whether or not the sweep timer runs
 * (round-5 review: the switch's own docs promised that, and only the sweep delivered it). Not the thread or identity
 * rules (round-6 review: a listing sold mid-call is no reason to hang up), and not consent: a withdrawal stops the next
 * call, and the person on the line can hang up this one.
 *   null           still allowed — or the switch could not be READ (a database blip is not the owner's kill switch);
 *   'blocked'      a block either way: the call leaves nothing behind (cards.ts);
 *   'kill_switch'  any other refusal: the screen says "Calls are paused for now", and no bell or push follows.
 * ⚠️ A refusal is judged AGAIN against a fresh read of the switch before it ends anything: another process's cached
 * row may still say 'off' for up to 30 s after the owner switched calls on, and must not hang up what the row allows.
 * ⛔ JUDGED AS A VOICE CALL, WHATEVER THE ROW'S MEDIA. Since protocol v2 nearly every verified call is placed
 * video-capable, so judging the row's media made the video switch end nearly every call. Video off pauses the cameras
 * instead (liveVideoAllowed — the heartbeat's `videoAllowed`); only the voice rules hang anybody up.
 */
export async function liveCallRefusal(row: { caller_id: string | null; callee_id: string | null }): Promise<'blocked' | 'kill_switch' | null> {
  const { caller_id: callerId, callee_id: calleeId } = row
  // An erased participant: account erasure ended the call in its own transaction (session.ts endCallsOfIn).
  if (!callerId || !calleeId) return null
  const judge = async () => (await standingRefusal(await readCallsConfig(), callerId, calleeId, 'audio')).error
  if (!(await judge())) return null
  resetCallsConfigCache()
  const again = await judge()
  if (!again) return null
  if (!(await readCallsConfig()).readOk) return null
  return again === 'blocked' ? 'blocked' : 'kill_switch'
}

/**
 * May the cameras be on in this call? A video-capable call while the video switch is on. The switch going off PAUSES
 * the cameras (the phones turn theirs off and say so) and the call goes on as voice; back on, the camera button returns.
 */
export function videoAllowedBy(config: Pick<CallsConfig, 'video'>, media: CallMedia): boolean {
  return media === 'video' && config.video
}

/**
 * videoAllowedBy for a live call, from the switch as this process reads it — or `undefined` when it could not be read:
 * a database blip is not the owner's switch, and the phone keeps video as it was (second-opinion review: answering
 * `true` there lifted a pause the owner had set, for as long as the failed read stayed cached).
 */
export async function liveVideoAllowed(row: { media: CallMedia }): Promise<boolean | undefined> {
  if (row.media !== 'video') return false
  const config = await readCallsConfig()
  return config.readOk ? videoAllowedBy(config, row.media) : undefined
}

/** Has `granter` allowed calls from `grantee` in this thread (and not withdrawn it)? */
export async function hasCallConsent(conversationId: string, granterId: string, granteeId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM public.call_consent
     WHERE conversation_id = ${conversationId} AND granter_id = ${granterId}::uuid AND grantee_id = ${granteeId}::uuid
       AND revoked_at IS NULL`
  return rows.length > 0
}

/** The current copy of the consent card — bump when its words change (stored with each grant). */
export const CALL_CONSENT_COPY_VERSION = 'allow-calls-v1'
/**
 * What the ASKER's own consent is recorded as when they send a call request: they never saw the Allow card, so it must
 * not be filed as if they had tapped it (commit-gate review — this table is consent EVIDENCE). Asking to call someone
 * is the act that implies it, and the version says exactly that.
 */
export const CALL_CONSENT_IMPLIED_VERSION = 'implied-by-request-v1'

export async function setCallConsent(conversationId: string, granterId: string, granteeId: string, allow: boolean, copyVersion: string = CALL_CONSENT_COPY_VERSION): Promise<void> {
  if (allow && copyVersion === CALL_CONSENT_IMPLIED_VERSION) {
    // ⚠️ IMPLIED NEVER OVERWRITES (round-8 review): this table is consent EVIDENCE. An existing row — an explicit tap
    // with its copy version and date, or a withdrawal — is the person's own word and outranks what asking implies.
    await db.$executeRaw`
      INSERT INTO public.call_consent (conversation_id, granter_id, grantee_id, copy_version, granted_at, revoked_at)
      VALUES (${conversationId}, ${granterId}::uuid, ${granteeId}::uuid, ${copyVersion}, now(), NULL)
      ON CONFLICT (conversation_id, granter_id, grantee_id) DO NOTHING`
  } else if (allow) {
    await db.$executeRaw`
      INSERT INTO public.call_consent (conversation_id, granter_id, grantee_id, copy_version, granted_at, revoked_at)
      VALUES (${conversationId}, ${granterId}::uuid, ${granteeId}::uuid, ${copyVersion}, now(), NULL)
      ON CONFLICT (conversation_id, granter_id, grantee_id)
      DO UPDATE SET copy_version = EXCLUDED.copy_version, granted_at = now(), revoked_at = NULL`
  } else {
    await db.$executeRaw`
      UPDATE public.call_consent SET revoked_at = now()
       WHERE conversation_id = ${conversationId} AND granter_id = ${granterId}::uuid AND grantee_id = ${granteeId}::uuid
         AND revoked_at IS NULL`
  }
}

/**
 * The §4 limits, in order: hourly and daily attempts per caller (5/day for a young account), the pair cooldown
 * after 3 unanswered calls in 24 h, and the inbound cap that stops a callee being rung by a crowd. Counted from
 * call_session itself where the question is about calls that already happened (session.ts pairCallCounts — a call to
 * a BUSY person counts as unanswered too).
 */
export async function callLimitRefusal(callerId: string, calleeId: string, now = new Date()): Promise<Refusal | null> {
  const hourly = await rateLimit('calls:start:h', callerId, 10, '1 h', { strict: true })
  if (!hourly.success) return { error: 'rate_limited', status: 429 }
  const profile = await db.profile.findUnique({ where: { id: callerId }, select: { createdAt: true } })
  const young = !profile || now.getTime() - profile.createdAt.getTime() < NEW_ACCOUNT_DAYS * 86_400_000
  const daily = await rateLimit(young ? 'calls:start:d:new' : 'calls:start:d', callerId, young ? 5 : 30, '1 d', { strict: true })
  if (!daily.success) return { error: 'rate_limited', status: 429 }

  const r = await pairCallCounts(callerId, calleeId)
  if (r.unanswered >= PAIR_UNANSWERED_LIMIT) return { error: 'calls_cooldown', status: 429 }
  // Someone already among this hour's callers is not "new"; a crowd of distinct strangers is.
  if (r.inbound >= INBOUND_DISTINCT_LIMIT && r.known === 0) return { error: 'calls_cooldown', status: 429 }
  return null
}
