import 'server-only'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import type { CallEndReason, CallMedia, CallRole } from '../types'
import {
  MAX_SNAPSHOT_CANDIDATES_PER_NEG, MAX_SNAPSHOT_NEGOTIATIONS, resyncSnapshotSchema,
  type CallStateName, type ClientEvent, type IceCandidate, type ResyncSnapshot,
} from '../protocol'
import { blockingOn } from '@/lib/user-blocks'
import { SWEEP_FRESH_S, type RelayProvider } from './config'
import { boxEvent, broadcast, callTopic, ringTopic } from './events'

/**
 * In-app calls — THE SESSION IN POSTGRES (DESIGN.md v3 §3.2 steps 1–10, §3.3; tables: scripts/calls-ddl.mjs).
 *
 * ⛔ POSTGRES IS THE TRUTH, REALTIME IS THE HINT. Every state change and every relayed event is written here in the
 * same transaction that broadcasts it (events.ts), and phones re-read it (snapshotFor) whenever they may have missed
 * a broadcast. Nothing a phone must see exists only in a broadcast.
 *
 * ⛔ FRESHNESS IS DECIDED IN SQL, ON EVERY CHECK — NEVER BY A SWEEP TIMER (§3.2 step 7). A call holds its people
 * only while it is FRESH: ringing for under RING_TIMEOUT_S, or answered with BOTH heartbeats younger than
 * HEARTBEAT_STALE_S and under the 2 h cap. A tab that died mid-call therefore frees its owner within 45 s even if
 * /api/cron/calls-sweep never runs; the sweep only writes the end, the card and frees rows.
 *
 * ⛔ ONE PERSON, ONE LIVE CALL — SERIALISED PER PERSON. Every transaction that can put someone into a call (start,
 * accept) first takes a transaction-scoped advisory lock on each person involved, in sorted order (no deadlock),
 * so "is either of them busy?" and "make them busy" cannot interleave with another start or accept for the same
 * person. call_lock then records the holder (a fast busy lookup and a constraint that would refuse a second holder
 * outright); a stale holder is simply replaced.
 *
 * ⚠️ IDS ARE MINTED HERE (crypto.randomUUID) — call_session.id has no default on purpose: the telemetry schema
 * requires a real RFC 9562 UUID (telemetry.ts), and the box never re-uses one.
 * ⚠️ NO SDP, NONCE OR CANDIDATE IN LOGS. Errors name the call id and a code.
 */

type Tx = Prisma.TransactionClient

export const RING_TIMEOUT_S = 45
export const HEARTBEAT_STALE_S = 45
/**
 * A side ON HOLD gets the hold limit (negotiation.ts HOLD_LIMIT_MS, 2 min) plus slack before its silence counts: an
 * iPhone in the background has its timers throttled and may miss heartbeats while it is legitimately on hold
 * (commit-gate review). The hold limit itself is the PHONE's rule (it ends the call); the box bounds every call, held
 * or not, by the 2 h cap — and either person can hang up.
 */
export const HOLD_STALE_S = 150
export const CALL_CAP_S = 2 * 3600
/**
 * An ANSWERED call must connect within this, or it is over ('media_failed'). The 2 h cap counts from the first
 * connection, so without this a pair of phones heartbeating `connected: false` forever would hold both people busy
 * with no bound at all (round-7 review). The phone gives up far sooner (negotiation.ts CONNECT_DEADLINE_MS, 20 s,
 * re-armed by a restart); this is the box's backstop.
 */
export const CONNECT_DEADLINE_S = 90
/**
 * What caller_commit holds: since protocol v2 (2026-10-22) there is no safety code and so no commitment, but the column
 * is NOT NULL with a hex CHECK (calls-ddl.mjs) — every new row carries zeros, and a call that ends zeroes an old one.
 */
const ZERO_COMMIT = '0'.repeat(64)

/** The raw row, as $queryRaw returns it. */
export interface CallSessionRow {
  id: string
  conversation_id: string
  caller_id: string | null
  callee_id: string | null
  caller_hash: string
  callee_hash: string
  /** The safety code's commitment ids — protocol v1 only; NULL on every row since v2 (kept for rows from before). */
  caller_tag: string | null
  callee_tag: string | null
  media: CallMedia
  state: CallStateName
  end_reason: CallEndReason | null
  protocol_version: number
  edition: 'marketplace' | 'services'
  relay_provider: RelayProvider
  caller_tab: string
  callee_tab: string | null
  caller_commit: string
  callee_nonce: string | null
  caller_reveal: string | null
  caller_hold: boolean | null
  caller_hold_seq: number | null
  callee_hold: boolean | null
  callee_hold_seq: number | null
  caller_relay_user: string | null
  callee_relay_user: string | null
  caller_caps: unknown
  callee_caps: unknown
  ringing_at: Date
  accepted_at: Date | null
  ready_at: Date | null
  connected_at: Date | null
  ended_at: Date | null
  caller_heartbeat_at: Date | null
  callee_heartbeat_at: Date | null
}

/**
 * A row that still holds its people (see the ⛔ above). Written against the bare table name so it composes into any
 * query on call_session.
 */
const FRESH = Prisma.sql`(
  (call_session.state = 'ringing' AND call_session.ringing_at > now() - make_interval(secs => ${RING_TIMEOUT_S}))
  OR (call_session.state IN ('accepted', 'ready', 'connected')
      AND call_session.caller_heartbeat_at > now() - make_interval(secs => CASE WHEN call_session.caller_hold THEN ${HOLD_STALE_S}::int ELSE ${HEARTBEAT_STALE_S}::int END)
      AND call_session.callee_heartbeat_at > now() - make_interval(secs => CASE WHEN call_session.callee_hold THEN ${HOLD_STALE_S}::int ELSE ${HEARTBEAT_STALE_S}::int END)
      AND (CASE WHEN call_session.connected_at IS NULL
                THEN call_session.accepted_at > now() - make_interval(secs => ${CONNECT_DEADLINE_S}::int)
                ELSE call_session.connected_at > now() - make_interval(secs => ${CALL_CAP_S}::int) END))
)`

/**
 * The key both digests below are made with — the teacher DM pool digest's choice (IDENTITY_HASH_PEPPER, else
 * SUPABASE_SECRET_KEY). ⛔ In production a missing key THROWS (round-6 review): an unkeyed digest of a profile UUID can
 * be tested against every known id, so no call starts rather than one that leaves a guessable trail. A bare local run
 * or a test degrades to the unkeyed digest.
 */
function digestKey(): string | null {
  const key = process.env.IDENTITY_HASH_PEPPER || process.env.SUPABASE_SECRET_KEY || null
  if (!key && process.env.NODE_ENV === 'production') throw new Error('calls: IDENTITY_HASH_PEPPER / SUPABASE_SECRET_KEY unset')
  return key
}

/**
 * The participant hash kept when account erasure NULLs caller_id / callee_id: keyed, so the table alone never says
 * who called whom, while a lawful request about a person can still be matched.
 */
export function partyHash(profileId: string): string {
  const key = digestKey()
  const input = `eno-call-party:${profileId}`
  return (key ? createHmac('sha256', key).update(input) : createHash('sha256').update(input)).digest('hex')
}

async function lockPeople(tx: Tx, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-call-person:${id}`}, 0))`
  }
}

/** The fresh call this person is in (either side), if any. */
async function freshCallOf(tx: Tx, profileId: string, exceptCallId?: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM public.call_session
     WHERE (caller_id = ${profileId}::uuid OR callee_id = ${profileId}::uuid)
       AND state <> 'ended' AND ${FRESH}
       AND (${exceptCallId ?? null}::uuid IS NULL OR id <> ${exceptCallId ?? null}::uuid)
     LIMIT 1`
  return rows[0]?.id ?? null
}

/**
 * A block row between the two, read INSIDE the per-person lock (commit-gate review): the route's eligibility check ran
 * before this transaction, and a block that committed since must still stop the ring or the accept. The block route's
 * own call-ending takes the same lock (endCallsBetween), so whichever commits first, the other sees it. Only while
 * blocking is live (ugc-safety) — the same switch isBlockedBetween obeys.
 */
async function blockedInTx(tx: Tx, a: string, b: string): Promise<boolean> {
  if (!blockingOn()) return false
  const rows = await tx.$queryRaw<{ x: number }[]>`
    SELECT 1 AS x FROM "ForumUserBlock"
     WHERE ("blockerProfileId" = ${a}::uuid AND "blockedProfileId" = ${b}::uuid)
        OR ("blockerProfileId" = ${b}::uuid AND "blockedProfileId" = ${a}::uuid)
     LIMIT 1`
  return rows.length > 0
}

async function takeLock(tx: Tx, profileId: string, callId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO public.call_lock (profile_id, call_id) VALUES (${profileId}::uuid, ${callId}::uuid)
    ON CONFLICT (profile_id) DO UPDATE SET call_id = EXCLUDED.call_id, taken_at = now()`
}

export async function loadCall(callId: string, client: Pick<Tx, '$queryRaw'> = db): Promise<CallSessionRow | null> {
  const rows = await client.$queryRaw<CallSessionRow[]>`SELECT * FROM public.call_session WHERE id = ${callId}::uuid`
  return rows[0] ?? null
}

/**
 * ⛔ WHAT THE CALLER MAY LEARN ABOUT A CALL THAT WAS NEVER ANSWERED: only that it was not — busy, declined and timed
 * out are all 'unavailable' to the caller (§3.2 step 1: "busy, decline and timeout all look the same to a stranger").
 * Every place an end reason leaves the box toward the caller goes through this — the 'ended' broadcast, the snapshot
 * and the call details. Found by the two-browser harness: the 'ended' event used to carry 'declined' straight through.
 */
// ⚠️ 'blocked' is NOT masked, deliberately: chat already answers 'blocked' (403) to either side of a block
// (api/conversations/[id]/messages), and the call screen words it as a plain "Call ended" (call-copy.ts callEndText).
const NOT_ANSWERED_REASONS: ReadonlySet<string> = new Set(['declined', 'missed', 'unavailable'])
export function endReasonFor(row: Pick<CallSessionRow, 'end_reason' | 'accepted_at'>, role: CallRole): CallEndReason | null {
  if (role === 'caller' && row.accepted_at === null && row.end_reason !== null && NOT_ANSWERED_REASONS.has(row.end_reason)) return 'unavailable'
  return row.end_reason
}

/** The role this profile plays in the call, or null when it is not a participant. */
export function roleOf(row: Pick<CallSessionRow, 'caller_id' | 'callee_id'>, profileId: string): CallRole | null {
  if (row.caller_id === profileId) return 'caller'
  if (row.callee_id === profileId) return 'callee'
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Start (§3.2 step 1)
// ---------------------------------------------------------------------------------------------------------------

export interface StartInput {
  conversationId: string
  callerId: string
  calleeId: string
  media: CallMedia
  protocolVersion: number
  edition: 'marketplace' | 'services'
  relay: RelayProvider
  callerTab: string
  callerCaps: unknown
  callerRelayUser: string
  /** The phone's id for this attempt (abandonStart). */
  startId: string
}

export type StartResult =
  /** Ringing: the callee's every tab was sent a ring. */
  | { kind: 'ringing'; callId: string }
  /** The callee is ringing the caller in this thread right now: answer THAT call instead (cross-call merge). */
  | { kind: 'merge'; callId: string }
  /** The callee is in another call or ringing: logged as an ended call; to the caller it reads like a decline. */
  | { kind: 'unavailable'; callId: string; row: EndedCallRow }
  /** The caller already has a fresh call of their own. */
  | { kind: 'busy_self' }
  /** A block landed between the eligibility check and this transaction. */
  | { kind: 'blocked' }
  /** The callee withdrew their consent between the route's check and this transaction. */
  | { kind: 'consent_required' }
  /** This very start was already given up by its phone (abandonStart's tombstone): nothing is rung. */
  | { kind: 'abandoned' }

export async function startCall(input: StartInput): Promise<StartResult> {
  const callId = randomUUID()
  return db.$transaction(async (tx) => {
    await lockPeople(tx, [input.callerId, input.calleeId])
    // ⛔ A START ITS PHONE ALREADY GAVE UP ON never rings (client review): the give-up can land while the relay mint is
    // still running — before this row exists — and leaves this tombstone, under the same caller lock.
    const abandoned = await tx.$queryRaw<{ x: number }[]>`SELECT 1 AS x FROM public.call_abandon WHERE start_id = ${input.startId}`
    if (abandoned[0]) return { kind: 'abandoned' } as const

    const merge = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public.call_session
       WHERE caller_id = ${input.calleeId}::uuid AND callee_id = ${input.callerId}::uuid
         AND conversation_id = ${input.conversationId} AND state = 'ringing' AND ${FRESH}
       LIMIT 1`
    if (merge[0]) return { kind: 'merge', callId: merge[0].id } as const
    if (await blockedInTx(tx, input.callerId, input.calleeId)) return { kind: 'blocked' } as const
    // Consent too, under the lock: a withdrawal that returned success must stop the next ring (commit-gate review).
    const consent = await tx.$queryRaw<{ x: number }[]>`
      SELECT 1 AS x FROM public.call_consent
       WHERE conversation_id = ${input.conversationId} AND granter_id = ${input.calleeId}::uuid
         AND grantee_id = ${input.callerId}::uuid AND revoked_at IS NULL`
    if (!consent[0]) return { kind: 'consent_required' } as const

    if (await freshCallOf(tx, input.callerId)) return { kind: 'busy_self' } as const

    const calleeBusy = (await freshCallOf(tx, input.calleeId)) !== null
    // ⚠️ A BUSY CALL IS BORN ENDED, so endCallIn's clean-up never runs on it: it is written already clean — no
    // capabilities, no relay user (round-5 review). caller_commit is zeros on every row since protocol v2.
    const rows = await tx.$queryRaw<CallSessionRow[]>`
      INSERT INTO public.call_session (
        id, conversation_id, caller_id, callee_id, caller_hash, callee_hash, caller_tag, callee_tag, media, state,
        end_reason, protocol_version, edition, relay_provider, caller_tab, start_id, caller_commit, caller_caps, caller_relay_user,
        caller_heartbeat_at, ended_at
      ) VALUES (
        ${callId}::uuid, ${input.conversationId}, ${input.callerId}::uuid, ${input.calleeId}::uuid,
        ${partyHash(input.callerId)}, ${partyHash(input.calleeId)},
        NULL, NULL, ${input.media},
        ${calleeBusy ? 'ended' : 'ringing'}, ${calleeBusy ? 'unavailable' : null},
        ${input.protocolVersion}, ${input.edition}, ${input.relay}, ${input.callerTab}, ${input.startId}, ${ZERO_COMMIT},
        ${calleeBusy ? null : JSON.stringify(input.callerCaps ?? null)}::jsonb,
        ${calleeBusy ? null : input.callerRelayUser}, now(), CASE WHEN ${calleeBusy} THEN now() END
      ) RETURNING *`
    if (calleeBusy) return { kind: 'unavailable', callId, row: { ...rows[0], connected_secs: null } } as const

    await takeLock(tx, input.callerId, callId)
    await broadcast(tx, ringTopic(input.calleeId), boxEvent(callId, { kind: 'ring', payload: { media: input.media } }))
    return { kind: 'ringing', callId } as const
  }, { timeout: 10_000 })
}

// ---------------------------------------------------------------------------------------------------------------
// Accept (§3.2 step 3)
// ---------------------------------------------------------------------------------------------------------------

export interface AcceptInput {
  callId: string
  calleeId: string
  tabId: string
  calleeCaps: unknown
  calleeRelayUser: string
}

export type AcceptResult =
  | { ok: true; row: CallSessionRow }
  | { ok: false; error: 'call_gone' | 'call_in_progress' }

export async function acceptCall(input: AcceptInput): Promise<AcceptResult> {
  return db.$transaction(async (tx) => {
    const before = await loadCall(input.callId, tx)
    if (!before || before.callee_id !== input.calleeId || !before.caller_id) return { ok: false, error: 'call_gone' } as const
    await lockPeople(tx, [before.caller_id, input.calleeId])
    if (await blockedInTx(tx, before.caller_id, input.calleeId)) return { ok: false, error: 'call_gone' } as const
    if (await freshCallOf(tx, input.calleeId, input.callId)) return { ok: false, error: 'call_in_progress' } as const

    // ⚠️ ONE conditional UPDATE is the whole race: a second tab's accept, the caller's cancel and the ring timeout all
    // meet here, and exactly one of them finds the row still ringing and fresh.
    const rows = await tx.$queryRaw<CallSessionRow[]>`
      UPDATE public.call_session
         SET state = 'accepted', accepted_at = now(), callee_tab = ${input.tabId},
             callee_caps = ${JSON.stringify(input.calleeCaps ?? null)}::jsonb, callee_relay_user = ${input.calleeRelayUser},
             callee_heartbeat_at = now(), caller_heartbeat_at = GREATEST(caller_heartbeat_at, now() - make_interval(secs => 15))
       WHERE id = ${input.callId}::uuid AND callee_id = ${input.calleeId}::uuid AND state = 'ringing' AND ${FRESH}
       RETURNING *`
    const row = rows[0]
    if (!row) return { ok: false, error: 'call_gone' } as const
    await takeLock(tx, input.calleeId, input.callId)
    // The callee's other tabs stop ringing; the winner is named so it does not close itself (protocol.ts).
    await broadcast(tx, ringTopic(input.calleeId), boxEvent(row.id, { kind: 'answered_elsewhere', payload: { calleeTabId: input.tabId } }))
    await broadcast(tx, callTopic(row.conversation_id), boxEvent(row.id, {
      kind: 'accepted',
      payload: { calleeTabId: input.tabId, capabilities: input.calleeCaps ?? undefined },
    }))
    return { ok: true, row } as const
  }, { timeout: 10_000 })
}

// ---------------------------------------------------------------------------------------------------------------
// End (§3.2 steps 9–10) — one transition, one winner
// ---------------------------------------------------------------------------------------------------------------

export interface EndInput {
  callId: string
  reason: CallEndReason
  /** Only end from these states (decline: ringing only). Default: any live state. */
  fromStates?: readonly CallStateName[]
  /** Restrict to a participant (route callers); the sweep passes none. */
  profileId?: string
}

/**
 * Ends the call if it is still live, and returns the row AS IT WAS BEFORE the clean-up (so the card, the missed-call
 * bell and the relay revocation know what happened) — or null when someone else ended it first. Releases both
 * locks, drops the negotiation and idempotency rows, and clears protocol v1's safety-code columns, capabilities and relay
 * handles from the row: metadata is all that outlives a call.
 */
/**
 * The row as it was when the call ended, plus how long it was connected — measured IN SQL, from the same
 * transaction-start now() the end is stamped with. ⚠️ Never Date.now() minus a timestamp read back through Prisma:
 * that mixes the app's clock with the database's, and @prisma/adapter-pg decodes timestamptz as UTC whatever the
 * session time zone says (measured 2026-10-21 on a +07 database: seven hours out). Production runs UTC; this code
 * does not depend on it.
 */
export type EndedCallRow = CallSessionRow & { connected_secs: number | null }

export async function endCall(input: EndInput): Promise<EndedCallRow | null> {
  return db.$transaction((tx) => endCallIn(tx, input), { timeout: 10_000 })
}

export async function endCallIn(tx: Tx, input: EndInput): Promise<EndedCallRow | null> {
  const states = [...(input.fromStates ?? ['ringing', 'accepted', 'ready', 'connected'])]
  const before = await tx.$queryRaw<EndedCallRow[]>`
    SELECT *, EXTRACT(EPOCH FROM (now() - connected_at))::float8 AS connected_secs FROM public.call_session
     WHERE id = ${input.callId}::uuid AND state <> 'ended' AND state = ANY(${states}::text[])
       AND (${input.profileId ?? null}::uuid IS NULL OR caller_id = ${input.profileId ?? null}::uuid OR callee_id = ${input.profileId ?? null}::uuid)
     FOR UPDATE`
  const row = before[0]
  if (!row) return null
  await tx.$executeRaw`
    UPDATE public.call_session
       SET state = 'ended', end_reason = ${input.reason}, ended_at = now(),
           caller_commit = ${ZERO_COMMIT}, callee_nonce = NULL, caller_reveal = NULL, caller_tag = NULL, callee_tag = NULL,
           caller_caps = NULL, callee_caps = NULL, caller_relay_user = NULL, callee_relay_user = NULL
     WHERE id = ${row.id}::uuid`
  await tx.$executeRaw`DELETE FROM public.call_lock WHERE call_id = ${row.id}::uuid`
  await tx.$executeRaw`DELETE FROM public.call_negotiation WHERE call_id = ${row.id}::uuid`
  await tx.$executeRaw`DELETE FROM public.call_signal_key WHERE call_id = ${row.id}::uuid`
  // While ringing, only the CALLER is on call:<conversationId> (the callee joins it after accepting) — so the reason
  // there is the caller's view of it (endReasonFor): a decline or a timeout reads 'unavailable'.
  const told = endReasonFor({ end_reason: input.reason, accepted_at: row.accepted_at }, 'caller') ?? input.reason
  await broadcast(tx, callTopic(row.conversation_id), boxEvent(row.id, { kind: 'ended', payload: { reason: told } }))
  if (row.state === 'ringing' && row.callee_id) {
    // Every ringing tab of the callee stops (a decline from one device, the caller's cancel, the timeout).
    await broadcast(tx, ringTopic(row.callee_id), boxEvent(row.id, { kind: 'cancel', payload: {} }))
  }
  return row
}

// ---------------------------------------------------------------------------------------------------------------
// Liveness, connection
// ---------------------------------------------------------------------------------------------------------------

export interface HeartbeatInput {
  callId: string
  profileId: string
  tabId: string
  /** The engine reports its first connection; the box stamps connected_at once (the 2 h cap counts from it). */
  connected: boolean
}

/** Refreshes this side's heartbeat. Returns the row after the write, or null when not a live participant tab. */
export async function heartbeat(input: HeartbeatInput): Promise<CallSessionRow | null> {
  const rows = await db.$queryRaw<CallSessionRow[]>`
    UPDATE public.call_session
       SET caller_heartbeat_at = CASE WHEN caller_id = ${input.profileId}::uuid AND caller_tab = ${input.tabId} THEN now() ELSE caller_heartbeat_at END,
           callee_heartbeat_at = CASE WHEN callee_id = ${input.profileId}::uuid AND callee_tab = ${input.tabId} THEN now() ELSE callee_heartbeat_at END,
           state = CASE WHEN ${input.connected} AND state IN ('accepted', 'ready') THEN 'connected' ELSE state END,
           connected_at = CASE WHEN ${input.connected} AND connected_at IS NULL AND state IN ('accepted', 'ready', 'connected') THEN now() ELSE connected_at END
     WHERE id = ${input.callId}::uuid AND state <> 'ended' AND ${FRESH}
       AND ((caller_id = ${input.profileId}::uuid AND caller_tab = ${input.tabId})
         OR (callee_id = ${input.profileId}::uuid AND callee_tab = ${input.tabId}))
     RETURNING *`
  // ⚠️ FRESH ONLY: a call that already went stale can only be ENDED, never revived by a late heartbeat — its people
  // may already be in another call that took over their locks (commit-gate review).
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------------------------------------------
// Relaying a phone's event (§3.2 step 4) — stored, deduplicated and broadcast in one transaction
// ---------------------------------------------------------------------------------------------------------------

export type RelayOutcome = 'relayed' | 'duplicate' | 'gone' | 'wrong_tab' | 'full'

/**
 * Stores and relays one ALREADY-VALIDATED, ALREADY-SANITISED client event (the route runs protocol.ts and
 * sdp-guard.ts first). 'end' is not handled here — it ends the call (endCall).
 * ⚠️ The idempotency key is scoped by the SENDER'S ROLE as the box resolved it (calls-ddl.mjs call_signal_key): a key
 * the peer saw in a broadcast can never pre-empt this side's next send.
 */
export async function relayClientEvent(callId: string, profileId: string, event: Exclude<ClientEvent, { kind: 'end' }>): Promise<RelayOutcome> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<CallSessionRow[]>`
      SELECT * FROM public.call_session WHERE id = ${callId}::uuid AND state <> 'ended' AND ${FRESH} FOR UPDATE`
    // FRESH: a call that went stale can only be ended — never kept talking through (commit-gate review).
    const row = rows[0]
    const role = row ? roleOf(row, profileId) : null
    if (!row || !role) return 'gone'
    // In-call events exist only once a callee tab is bound (offers wait for 'ready' anyway).
    if (row.state === 'ringing') return 'gone'
    if (event.tabId !== (role === 'caller' ? row.caller_tab : row.callee_tab)) return 'wrong_tab'
    // Roles: only the caller offers; only the callee answers, says ready, or asks for a restart.
    const callerOnly = event.kind === 'offer'
    const calleeOnly = event.kind === 'answer' || event.kind === 'ready' || event.kind === 'restart_request'
    if ((callerOnly && role !== 'caller') || (calleeOnly && role !== 'callee')) return 'wrong_tab'

    // ⚠️ NOTHING IS BROADCAST THAT IS NOT STORED (round-6 review): a candidate batch past the per-negotiation cap would
    // reach a listening peer but never a resyncing one — so it is refused here, before its key is spent. A relay-only
    // phone gathers a handful of candidates; the cap is for a client gone wrong.
    if (event.kind === 'candidates') {
      const col = Prisma.raw(role === 'caller' ? 'caller_candidates' : 'callee_candidates')
      const held = await tx.$queryRaw<{ n: number }[]>`
        SELECT jsonb_array_length(${col})::int AS n FROM public.call_negotiation WHERE call_id = ${callId}::uuid AND neg_id = ${event.negId}`
      if ((held[0]?.n ?? 0) + event.payload.candidates.length > MAX_SNAPSHOT_CANDIDATES_PER_NEG) return 'full'
    }
    const fresh = await tx.$queryRaw<{ idem: string }[]>`
      INSERT INTO public.call_signal_key (call_id, sender, idem) VALUES (${callId}::uuid, ${role}, ${event.idempotencyKey})
      ON CONFLICT DO NOTHING RETURNING idem`
    if (!fresh[0]) return 'duplicate'

    switch (event.kind) {
      case 'ready':
        await tx.$executeRaw`
          UPDATE public.call_session SET state = 'ready', ready_at = COALESCE(ready_at, now())
           WHERE id = ${callId}::uuid AND state = 'accepted'`
        break
      case 'offer':
        await tx.$executeRaw`
          INSERT INTO public.call_negotiation (call_id, neg_id, offer_sdp, offer_meta)
          VALUES (${callId}::uuid, ${event.negId}, ${event.payload.sdp},
                  ${JSON.stringify({ codecPlan: event.payload.codecPlan ?? null, capabilities: event.payload.capabilities ?? null })}::jsonb)
          ON CONFLICT (call_id, neg_id) DO UPDATE SET offer_sdp = EXCLUDED.offer_sdp, offer_meta = EXCLUDED.offer_meta, updated_at = now()`
        // Bounded: only the newest generations matter (the snapshot carries MAX_SNAPSHOT_NEGOTIATIONS), so a phone that
        // restarts ICE in a loop cannot grow the table without limit (commit-gate review).
        await tx.$executeRaw`
          DELETE FROM public.call_negotiation WHERE call_id = ${callId}::uuid AND neg_id < ${event.negId - MAX_SNAPSHOT_NEGOTIATIONS}`
        break
      case 'answer':
        await tx.$executeRaw`
          INSERT INTO public.call_negotiation (call_id, neg_id, answer_sdp) VALUES (${callId}::uuid, ${event.negId}, ${event.payload.sdp})
          ON CONFLICT (call_id, neg_id) DO UPDATE SET answer_sdp = EXCLUDED.answer_sdp, updated_at = now()`
        break
      case 'candidates': {
        const col = Prisma.raw(role === 'caller' ? 'caller_candidates' : 'callee_candidates')
        const batch = JSON.stringify(event.payload.candidates)
        // Fits: checked above under the call's row lock, which every signal of this call takes first.
        await tx.$executeRaw`
          INSERT INTO public.call_negotiation (call_id, neg_id, ${col}) VALUES (${callId}::uuid, ${event.negId}, ${batch}::jsonb)
          ON CONFLICT (call_id, neg_id) DO UPDATE SET ${col} = call_negotiation.${col} || EXCLUDED.${col}, updated_at = now()`
        break
      }
      case 'hold':
      case 'resume': {
        const held = event.kind === 'hold'
        if (role === 'caller') {
          await tx.$executeRaw`
            UPDATE public.call_session SET caller_hold = ${held}, caller_hold_seq = ${event.payload.seq}
             WHERE id = ${callId}::uuid AND (caller_hold_seq IS NULL OR caller_hold_seq < ${event.payload.seq})`
        } else {
          await tx.$executeRaw`
            UPDATE public.call_session SET callee_hold = ${held}, callee_hold_seq = ${event.payload.seq}
             WHERE id = ${callId}::uuid AND (callee_hold_seq IS NULL OR callee_hold_seq < ${event.payload.seq})`
        }
        break
      }
      case 'restart_request':
        break // nothing to keep: a lone hint the callee repeats until it is honoured (negotiation.ts)
    }
    await broadcast(tx, callTopic(row.conversation_id), event)
    return 'relayed'
  }, { timeout: 10_000 })
}

// ---------------------------------------------------------------------------------------------------------------
// The resync snapshot (GET /api/calls/:id/state)
// ---------------------------------------------------------------------------------------------------------------

type NegRow = {
  neg_id: number
  offer_sdp: string | null
  offer_meta: { codecPlan?: unknown; capabilities?: unknown } | null
  answer_sdp: string | null
  caller_candidates: IceCandidate[]
  callee_candidates: IceCandidate[]
}

/** Pure: the row + its negotiation rows → what this role may see. Exported for tests. */
export function buildSnapshot(row: CallSessionRow, role: CallRole, negs: readonly NegRow[]): ResyncSnapshot {
  const byNeg = [...negs].sort((a, b) => a.neg_id - b.neg_id)
  const offer = [...byNeg].reverse().find((n) => n.offer_sdp)
  const answer = [...byNeg].reverse().find((n) => n.answer_sdp)
  const peerHeld = role === 'caller' ? row.callee_hold : row.caller_hold
  const peerSeq = role === 'caller' ? row.callee_hold_seq : row.caller_hold_seq
  const candidates = byNeg
    .map((n) => ({ negId: n.neg_id, candidates: (role === 'caller' ? n.callee_candidates : n.caller_candidates) ?? [] }))
    .filter((c) => c.candidates.length > 0)
    .slice(-MAX_SNAPSHOT_NEGOTIATIONS)
    .map((c) => ({ negId: c.negId, candidates: c.candidates.slice(0, MAX_SNAPSHOT_CANDIDATES_PER_NEG) }))
  return resyncSnapshotSchema.parse({
    v: row.protocol_version,
    callId: row.id,
    callState: row.state,
    endReason: endReasonFor(row, role),
    peerTabId: role === 'caller' ? row.callee_tab : row.caller_tab,
    latestOffer: offer?.offer_sdp
      ? { negId: offer.neg_id, sdp: offer.offer_sdp, codecPlan: offer.offer_meta?.codecPlan ?? undefined, capabilities: offer.offer_meta?.capabilities ?? undefined }
      : null,
    latestAnswer: answer?.answer_sdp ? { negId: answer.neg_id, sdp: answer.answer_sdp } : null,
    peerHold: peerSeq != null && peerHeld != null ? { held: peerHeld, seq: peerSeq } : null,
    peerCapabilities: (role === 'caller' ? row.callee_caps : row.caller_caps) ?? undefined,
    candidates,
  })
}

export async function snapshotFor(row: CallSessionRow, role: CallRole): Promise<ResyncSnapshot> {
  const negs = row.state === 'ended' ? [] : await db.$queryRaw<NegRow[]>`
    SELECT neg_id, offer_sdp, offer_meta, answer_sdp, caller_candidates, callee_candidates
      FROM public.call_negotiation WHERE call_id = ${row.id}::uuid ORDER BY neg_id DESC LIMIT ${MAX_SNAPSHOT_NEGOTIATIONS}`
  return buildSnapshot(row, role, negs)
}

// ---------------------------------------------------------------------------------------------------------------
// The sweep (/api/cron/calls-sweep, and opportunistically from the call routes)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The end reason a stale live row earns; `capped` and `unconnected` are computed in SQL (see EndedCallRow). Pure;
 * exported for tests. An answered call that never connected 'media_failed' — "Call didn't connect" — even when its
 * heartbeats stopped too: it was never a call that could be lost.
 */
export function staleReason(row: { state: CallStateName; capped: boolean; unconnected?: boolean }): CallEndReason {
  if (row.state === 'ringing') return 'missed'
  if (row.capped) return 'cap_reached'
  if (row.unconnected) return 'media_failed'
  return 'lost'
}

/**
 * Ends up to `limit` live calls that are no longer fresh (or every live call when `killAll` — the kill switch).
 * Each is its own transaction, so one bad row cannot hold the rest hostage. Returns each ended row (pre-clean-up)
 * with the reason it got, for afterCallEnded.
 */
export async function sweepStale(opts: { killAll?: boolean; limit?: number; onlyProfile?: string; onlyCall?: string } = {}): Promise<{ row: EndedCallRow; reason: CallEndReason }[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000))
  const candidates = await db.$queryRaw<{ id: string; state: CallStateName; capped: boolean; unconnected: boolean }[]>`
    SELECT id, state, (connected_at IS NOT NULL AND connected_at <= now() - make_interval(secs => ${CALL_CAP_S})) AS capped,
           (state <> 'ringing' AND connected_at IS NULL AND accepted_at <= now() - make_interval(secs => ${CONNECT_DEADLINE_S})) AS unconnected
      FROM public.call_session
     WHERE state <> 'ended' AND (${opts.killAll === true} OR NOT ${FRESH})
       AND (${opts.onlyProfile ?? null}::uuid IS NULL OR caller_id = ${opts.onlyProfile ?? null}::uuid OR callee_id = ${opts.onlyProfile ?? null}::uuid)
       AND (${opts.onlyCall ?? null}::uuid IS NULL OR id = ${opts.onlyCall ?? null}::uuid)
     ORDER BY ringing_at
     LIMIT ${limit}`
  const ended: { row: EndedCallRow; reason: CallEndReason }[] = []
  for (const c of candidates) {
    const reason: CallEndReason = opts.killAll ? 'kill_switch' : staleReason(c)
    // Re-checked under the row lock: a heartbeat may have landed since the candidate list was read.
    const row = await db.$transaction(async (tx) => {
      if (!opts.killAll) {
        const still = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.call_session WHERE id = ${c.id}::uuid AND state <> 'ended' AND NOT ${FRESH} FOR UPDATE`
        if (!still[0]) return null
      }
      return endCallIn(tx, { callId: c.id, reason })
    }, { timeout: 10_000 })
    if (row) ended.push({ row, reason })
  }
  return ended
}

/**
 * Ends every live call between two people (a block landed — §3.2 step 9: "Block ends the call and stops credential
 * re-minting"). Returns the ended rows for afterCallEnded.
 */
export async function endCallsBetween(a: string, b: string, reason: CallEndReason): Promise<EndedCallRow[]> {
  // Under the same per-person locks as start and accept: a start that read "not blocked" just before the block
  // committed holds these locks until it commits, so this waits for it and then ends what it created.
  return db.$transaction(async (tx) => {
    await lockPeople(tx, [a, b])
    const live = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public.call_session
       WHERE state <> 'ended'
         AND ((caller_id = ${a}::uuid AND callee_id = ${b}::uuid) OR (caller_id = ${b}::uuid AND callee_id = ${a}::uuid))`
    const ended: EndedCallRow[] = []
    for (const { id } of live) {
      const row = await endCallIn(tx, { callId: id, reason })
      if (row) ended.push(row)
    }
    return ended
  }, { timeout: 10_000 })
}

/**
 * Ends every live call of ONE person, inside the caller's transaction — account erasure (round-5 review: NULLing the
 * ids alone left the peer in a call with nobody, both relay credentials live and the peer's lock held until the stale
 * sweep). Under the same per-person lock as start and accept: a start racing the erasure either committed first and is
 * ended here, or waits for the erasure to commit. Returns the ended rows (pre-clean-up) for afterCallEnded.
 */
export async function endCallsOfIn(tx: Tx, profileId: string, reason: CallEndReason): Promise<EndedCallRow[]> {
  await lockPeople(tx, [profileId])
  const live = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM public.call_session
     WHERE state <> 'ended' AND (caller_id = ${profileId}::uuid OR callee_id = ${profileId}::uuid)`
  const ended: EndedCallRow[] = []
  for (const { id } of live) {
    const row = await endCallIn(tx, { callId: id, reason })
    if (row) ended.push(row)
  }
  return ended
}

/**
 * The newest call ringing THIS person right now (fresh — session.ts FRESH), or null. The ring broadcast is a hint a
 * page can miss — loading, or its socket reconnecting — so the call runtime asks here whenever its ring channel
 * (re)subscribes (client review: a call that rang during page start-up never showed).
 */
export async function ringingCallFor(profileId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM public.call_session
     WHERE callee_id = ${profileId}::uuid AND state = 'ringing' AND ${FRESH}
     ORDER BY ringing_at DESC LIMIT 1`
  return rows[0]?.id ?? null
}

/** How long a give-up is kept — far past any start still on its way (the relay mint, the transaction). */
const ABANDON_KEEP_MIN = 10

/**
 * A START WHOSE RESPONSE NEVER CAME BACK (a timeout on a slow network): the phone has no call id to end it by, and the
 * box may already be ringing the other person — or still minting the relay credential, with no row yet (client
 * review, twice). Under the caller's lock: a tombstone for THIS start (startCall refuses it), then the call it already
 * made, if any, ends — ringing 'cancelled', answered meanwhile as a hang-up. Only this caller's, only this start.
 */
export async function abandonStart(conversationId: string, callerId: string, startId: string): Promise<{ row: EndedCallRow; reason: CallEndReason }[]> {
  return db.$transaction(async (tx) => {
    await lockPeople(tx, [callerId])
    await tx.$executeRaw`INSERT INTO public.call_abandon (start_id) VALUES (${startId}) ON CONFLICT (start_id) DO NOTHING`
    const live = await tx.$queryRaw<{ id: string; state: CallStateName }[]>`
      SELECT id, state FROM public.call_session
       WHERE conversation_id = ${conversationId} AND caller_id = ${callerId}::uuid AND start_id = ${startId} AND state <> 'ended'`
    const ended: { row: EndedCallRow; reason: CallEndReason }[] = []
    for (const c of live) {
      const reason: CallEndReason = c.state === 'ringing' ? 'cancelled' : 'hangup'
      const row = await endCallIn(tx, { callId: c.id, reason })
      if (row) ended.push({ row, reason })
    }
    return ended
  }, { timeout: 10_000 })
}

/**
 * The clock of one call, measured IN SQL against the database's own now() — never in JavaScript: @prisma/adapter-pg
 * decodes timestamptz as UTC whatever the session's time zone (measured on a +07 database), and a phone's clock can be
 * minutes off. Remaining ring, remaining time before the 2 h cap (null until connected), and how long ago it ended.
 */
export async function callClock(callId: string): Promise<{ ringRemainingMs: number; capRemainingMs: number | null; endedAgoMs: number | null } | null> {
  const rows = await db.$queryRaw<{ ring: number; cap: number | null; ended: number | null }[]>`
    SELECT GREATEST(0, EXTRACT(EPOCH FROM (ringing_at + make_interval(secs => ${RING_TIMEOUT_S}::int) - now())) * 1000)::float8 AS ring,
           (EXTRACT(EPOCH FROM (connected_at + make_interval(secs => ${CALL_CAP_S}::int) - now())) * 1000)::float8 AS cap,
           (EXTRACT(EPOCH FROM (now() - ended_at)) * 1000)::float8 AS ended
      FROM public.call_session WHERE id = ${callId}::uuid`
  const r = rows[0]
  return r ? { ringRemainingMs: Math.round(r.ring), capRemainingMs: r.cap === null ? null : Math.round(r.cap), endedAgoMs: r.ended === null ? null : Math.round(r.ended) } : null
}

/**
 * What the §4 limits count (eligibility.ts callLimitRefusal): this pair's UNANSWERED calls in 24 h — every ended call
 * that never connected, a call to a busy person included (round-7 review: it still leaves a missed-call row, bell and
 * push) — the distinct callers who rang the callee in the last hour, and whether this caller is already one of them.
 */
export async function pairCallCounts(callerId: string, calleeId: string): Promise<{ unanswered: number; inbound: number; known: number }> {
  const rows = await db.$queryRaw<{ unanswered: number; inbound: number; known: number }[]>`
    SELECT
      (SELECT count(*)::int FROM public.call_session
        WHERE caller_id = ${callerId}::uuid AND callee_id = ${calleeId}::uuid AND state = 'ended'
          AND connected_at IS NULL AND ringing_at > now() - interval '24 hours') AS unanswered,
      (SELECT count(DISTINCT caller_id)::int FROM public.call_session
        WHERE callee_id = ${calleeId}::uuid AND ringing_at > now() - interval '1 hour') AS inbound,
      (SELECT count(*)::int FROM public.call_session
        WHERE caller_id = ${callerId}::uuid AND callee_id = ${calleeId}::uuid AND ringing_at > now() - interval '1 hour') AS known`
  return rows[0] ?? { unanswered: 0, inbound: 0, known: 0 }
}

/**
 * "The sweep is running": every run of /api/cron/calls-sweep stamps call_config.swept_at (creating the row 'off' when
 * there is none), and both writers of the switch refuse to turn calls ON unless the stamp is recent (config.ts
 * SWEEP_FRESH_S; scripts/calls-mode.mjs restates the check).
 */
export async function stampSweep(): Promise<void> {
  await db.$executeRaw`
    INSERT INTO public.call_config (id, swept_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET swept_at = now()`
}

/** Has the sweep run within SWEEP_FRESH_S? False when it never has — or when the table or column is not there yet. */
export async function sweepIsFresh(): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<{ ok: boolean | null }[]>`
      SELECT swept_at > now() - make_interval(secs => ${SWEEP_FRESH_S}) AS ok FROM public.call_config WHERE id = 1`
    return rows[0]?.ok === true
  } catch (e) {
    if (e instanceof Error && /42P01|42703|call_config" does not exist|"swept_at" does not exist/.test(e.message)) return false
    throw e
  }
}

/**
 * Telemetry older than this is deleted by the sweep. ⚠️ PROVISIONAL — DESIGN.md §3.6 leaves the window to counsel
 * (COUNSEL-QUESTIONS.md q3); the numbers in it are only useful for a quarter anyway. call_session is NOT purged here:
 * its window (≥ 12 months of system logs, Decree 333/2026 Art 16.6) is counsel's to set, and legal_hold must block it.
 */
export const TELEMETRY_RETENTION_DAYS = 90

export async function purgeOldTelemetry(): Promise<number> {
  // Give-ups (abandonStart) are only needed while a start could still be on its way. Independent of the telemetry purge
  // below (client review): one failing never stops the other.
  await db.$executeRaw`DELETE FROM public.call_abandon WHERE created_at < now() - make_interval(mins => ${ABANDON_KEEP_MIN})`
    .catch((e: unknown) => logError(e, { op: 'calls.purgeAbandons' }))
  return db.$executeRaw`
    DELETE FROM public.call_telemetry WHERE created_at < now() - make_interval(days => ${TELEMETRY_RETENTION_DAYS})`
}
