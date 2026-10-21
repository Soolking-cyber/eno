import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { CALL_PROTOCOL_VERSION } from '../types'
import { serverEventSchema, type ClientEvent, type ServerEvent } from '../protocol'

/**
 * In-app calls — what the box broadcasts, and the one door it uses (DESIGN.md v3 §3.3).
 *
 * Topics: 'ring:<profileId>' for what must reach every tab of a person (ring, cancel, answered_elsewhere — its own
 * receive policy, "own ring channel", scripts/calls-ddl.mjs), 'call:<conversationId>' for everything inside a call (the
 * existing 'convo participants can receive' policy admits exactly the two participants, whatever the prefix).
 * ⚠️ 'ring:', NOT THE CHAT'S 'user:' TOPIC. A Phoenix socket joins a topic once, so sharing 'user:<id>' would mean
 * one channel object owned by two lifecycles — chat-context re-subscribes on every token refresh and drops the
 * channel on pagehide. A topic of its own lets the call layer keep its channel up for exactly as long as it needs. Every message
 * is the Realtime event 'call_event' carrying one protocol.ts event as its payload.
 *
 * ⛔ BROADCAST INSIDE THE TRANSACTION THAT WROTE THE STATE. broadcast_call_event → realtime.send INSERTs into
 * realtime.messages, and Realtime delivers from the WAL — so a broadcast sent in the same transaction leaves on
 * COMMIT and never for a rollback. A broadcast after commit could be lost to a crash between the two; one before
 * would announce state that may never land.
 * ⚠️ PAYLOADS CARRY NO USER IPs AND NO NAMES. realtime.messages keeps them ~3 days: relayed SDP and candidates
 * hold only relay addresses (re-serialised by sdp-guard.ts before they get here), and the ring says only
 * audio/video — who is calling is fetched over HTTP (GET /api/calls/:id).
 */

type RawSql = Pick<Prisma.TransactionClient, '$executeRaw'>

export const REALTIME_EVENT = 'call_event'
/** A box event's tabId: not a browser tab, and the reducer ignores it for box kinds (negotiation.ts seenKey). */
export const BOX_TAB = 'box'

export const ringTopic = (profileId: string) => `ring:${profileId}`
export const callTopic = (conversationId: string) => `call:${conversationId}`

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type ServerBody = DistributiveOmit<ServerEvent, 'v' | 'callId' | 'idempotencyKey' | 'tabId'>

/**
 * One box event, envelope included, validated against the protocol before it can leave (a malformed box event would
 * be refused by every phone — better loud here). Each gets a fresh key: box events are never retransmitted, the
 * snapshot is their recovery path.
 */
export function boxEvent(callId: string, body: ServerBody): ServerEvent {
  const event = { v: CALL_PROTOCOL_VERSION, callId, idempotencyKey: `box-${randomUUID()}`, tabId: BOX_TAB, ...body }
  return serverEventSchema.parse(event)
}

/** Broadcast inside the caller's transaction (see the ⛔ above). */
export async function broadcast(tx: RawSql, topic: string, event: ServerEvent | ClientEvent): Promise<void> {
  await tx.$executeRaw`SELECT public.broadcast_call_event(${topic}, ${REALTIME_EVENT}, ${JSON.stringify(event)}::jsonb)`
}
