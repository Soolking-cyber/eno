import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { sendPushToProfile } from '@/lib/push'
import { maskEmailHandle } from '@/lib/utils'
import { cutText } from '@/lib/feed-text'
import { logError } from '@/lib/log'
import type { CallEndReason } from '../types'
import { RING_TIMEOUT_S, loadCall, type CallSessionRow, type EndedCallRow } from './session'

/**
 * In-app calls — what a call leaves behind in the thread, the bell and the lock screen (DESIGN.md v3 §3.2 steps 2
 * and 9). Persisted copy is a BILINGUAL COMPOSITE (the price-drop.ts / offer idiom): it is written server-side, where
 * tr() cannot run at render time, and a 'call' row predating a reader's language choice must still read.
 *
 * ⚠️ BUSY, DECLINED, CANCELLED AND TIMED OUT ALL READ "MISSED CALL" (§3.2 step 1: "busy, decline and timeout all look
 * the same to a stranger"). The record sits in a thread BOTH people read, so a "Declined" row would tell the caller
 * exactly what the box is careful never to say live.
 * ⚠️ BEST-EFFORT, AFTER THE FACT. Cards and pushes run after the transition committed (routes call these in
 * after()); a failure is logged and never undoes or fails the call's end. Exactly one writer exists per call: only
 * the transaction that won the transition to 'ended' gets the row to write from (session.ts endCall).
 */

export type CallOutcome = 'completed' | 'missed' | 'failed'

const NOT_ANSWERED: ReadonlySet<CallEndReason> = new Set<CallEndReason>(['missed', 'declined', 'unavailable', 'cancelled'])

/** Pure. `before` is the row as it was when the call ended (endCall's return), `reason` the end it got. */
export function callOutcome(before: Pick<CallSessionRow, 'state' | 'connected_at'>, reason: CallEndReason): CallOutcome {
  if (before.connected_at) return 'completed'
  if (before.state === 'ringing' || before.state === 'ended' || NOT_ANSWERED.has(reason)) return 'missed'
  return 'failed'
}

/** 0:42 · 3:12 · 1:02:03 — whole seconds, never negative. */
export function formatCallDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSec) ? totalSec : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * The thread row's body. Pure. One kind of call since 2026-10-22 (owner: one call button, the camera inside): a call
 * placed video-capable may never turn a camera on, so the record never says "video" — just the call and its length.
 */
export function callCardText(outcome: CallOutcome, durationSec: number): string {
  if (outcome === 'completed') return `📞 Cuộc gọi · Call · ${formatCallDuration(durationSec)}`
  if (outcome === 'missed') return '📞 Cuộc gọi nhỡ · Missed call'
  return "📞 Cuộc gọi không kết nối được · Call didn't connect"
}

export const CALL_REQUEST_TEXT = '📞 Muốn gọi cho bạn · Would like to call you'
/** The lock-screen ring — one kind of call (the camera, where allowed, is inside it), so never "video". */
export const RING_TEXT = 'Cuộc gọi đến · Incoming call'
const MISSED_TEXT = 'Cuộc gọi nhỡ · Missed call'
export const ANSWERED_TEXT = 'Đã trả lời · Answered'
export const RING_OVER_TEXT = 'Cuộc gọi đã kết thúc · Call ended'

/** The tag every notification about one call shares, so the missed-call push replaces the ringing one. */
export const callNotificationTag = (callId: string) => `call-${callId}`

/**
 * The push-service TOPIC every push about one call shares (RFC 8030 §5.4: ≤32 base64url characters, so a hash — the
 * call id itself is 36). The ring, its replacement and the missed-call push all carry it: a replacement sent while the
 * ring is still QUEUED for an offline phone replaces it there (ring latency, 2026-10-25). Only what is still queued: a
 * ring already dispatched is not recalled (its TTL is the ring timeout). The tag does the same on the phone once
 * delivered.
 */
export const callPushTopic = (callId: string) => createHash('sha256').update(`eno-call:${callId}`).digest('base64url').slice(0, 32)

async function displayName(profileId: string): Promise<string> {
  const p = await db.profile.findUnique({ where: { id: profileId }, select: { displayName: true, email: true } })
  return p?.displayName || maskEmailHandle(p?.email) || 'eno'
}

async function threadTarget(conversationId: string) {
  return db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true },
  })
}

/**
 * Ring EVERY device the callee registered for push — the box cannot tell which of them has the app open, and the
 * service worker shows every push (iOS revokes a subscription whose push shows nothing). Generic copy; the name is the
 * caller's. Whatever ends the ring later REPLACES this notification under the same tag (replaceRingPush, or the
 * missed-call push), so no lock screen keeps an "Incoming call" that is over (round-5 review).
 */
export async function sendRingPush(row: Pick<CallSessionRow, 'id' | 'conversation_id' | 'caller_id' | 'callee_id' | 'media'>): Promise<void> {
  if (!row.caller_id || !row.callee_id) return
  try {
    // Still ringing? This runs after the start's response, and a call cancelled or answered in that gap must not
    // ring a lock screen AFTER its replacement was sent.
    if ((await loadCall(row.id))?.state !== 'ringing') return
    await sendPushToProfile(row.callee_id, {
      title: await displayName(row.caller_id),
      body: RING_TEXT,
      url: `/messages/${row.conversation_id}?call=${row.id}`,
      tag: callNotificationTag(row.id),
      ring: true,
    }, { urgency: 'high', ttlSec: RING_TIMEOUT_S, topic: callPushTopic(row.id), skipBadge: true })
  } catch (e) {
    logError(e, { op: 'calls.ringPush', callId: row.id })
  }
}

/**
 * Replaces the ringing notification on every device of the callee (same tag) once the ring is over and no missed-call
 * push will — answered, declined, blocked, the switch. SILENT: where the ring was already dismissed this shows anew,
 * and an "it's over" line must not buzz. `named` false titles it 'eno' (a block, an erased caller: no name survives).
 */
export async function replaceRingPush(row: Pick<CallSessionRow, 'id' | 'conversation_id' | 'caller_id' | 'callee_id'>, body: string, named: boolean): Promise<void> {
  if (!row.callee_id) return
  try {
    await sendPushToProfile(row.callee_id, {
      title: named && row.caller_id ? await displayName(row.caller_id) : 'eno',
      body,
      url: `/messages/${row.conversation_id}`,
      tag: callNotificationTag(row.id),
      silent: true,
    }, { urgency: 'high', ttlSec: 3_600, topic: callPushTopic(row.id), skipBadge: true })
  } catch (e) {
    logError(e, { op: 'calls.replaceRingPush', callId: row.id })
  }
}

/**
 * The call record in the thread (authored by the CALLER), plus — when the callee missed it, and did not decline it
 * themselves — a 'call_missed' bell row and a push that replaces the ringing notification. Returns whether that push
 * went out (afterCallEnded replaces the ring itself otherwise).
 */
export async function writeCallRecord(before: EndedCallRow, reason: CallEndReason): Promise<boolean> {
  if (!before.caller_id || !before.callee_id) return false // an erased account: nothing to address the record to
  // ⛔ A BLOCKED CALL LEAVES NOTHING: no thread row authored by the person just blocked, no bell, no push naming them
  // (commit-gate review — a block during ringing read as a "missed call" from the blocked person).
  if (reason === 'blocked') return false
  try {
    const convo = await threadTarget(before.conversation_id)
    if (!convo) return false
    const outcome = callOutcome(before, reason)
    const durationSec = before.connected_at ? (before.connected_secs ?? 0) : 0
    await insertMessage(convo, before.caller_id, callCardText(outcome, durationSec), { kind: 'call' })
    // No bell or push for a decline (the callee chose it) or the kill switch (the box ended everyone's ringing at once).
    if (outcome !== 'missed' || reason === 'declined' || reason === 'kill_switch') return false
    const callerName = await displayName(before.caller_id)
    await db.notification.create({
      data: {
        recipientId: before.callee_id,
        type: 'call_missed',
        title: callerName,
        body: MISSED_TEXT,
        actorName: callerName,
        conversationId: before.conversation_id,
      },
    })
    await sendPushToProfile(before.callee_id, {
      title: callerName,
      body: MISSED_TEXT,
      url: `/messages/${before.conversation_id}`,
      tag: callNotificationTag(before.id),
    }, { topic: callPushTopic(before.id), urgency: 'high' }) // it replaces a ring on the lock screen: through doze too
    return true
  } catch (e) {
    logError(e, { op: 'calls.writeCallRecord', callId: before.id })
    return false
  }
}

/**
 * "<name> would like to call you" — the recipient's Allow-calls card, with a bell row and a push. False when the thread
 * is gone (nothing written); a throw means nothing was written either (insertMessage commits the row and the thread
 * bump in one transaction), and everything after the card is best-effort and never throws.
 */
export async function writeCallRequest(conversationId: string, requesterId: string, recipientId: string): Promise<boolean> {
  const convo = await threadTarget(conversationId)
  if (!convo) return false
  await insertMessage(convo, requesterId, CALL_REQUEST_TEXT, { kind: 'call_request' })
  try {
    const name = await displayName(requesterId)
    await db.notification.create({
      data: { recipientId, type: 'call_request', title: name, body: cutText(CALL_REQUEST_TEXT, 140), actorName: name, conversationId },
    })
    await sendPushToProfile(recipientId, { title: name, body: CALL_REQUEST_TEXT, url: `/messages/${conversationId}`, tag: `convo-${conversationId}` })
  } catch (e) {
    logError(e, { op: 'calls.writeCallRequest', conversationId })
  }
  return true
}
