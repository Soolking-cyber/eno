import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { EDITION } from '@/lib/edition'
import { CALL_PROTOCOL_VERSION } from '@/lib/calls/types'
import { sasNonceSchema, tabIdSchema } from '@/lib/calls/protocol'
import { callLimitRefusal, callPermit, hasCallConsent, loadConversationForCall } from '@/lib/calls/server/eligibility'
import { mintRelayCredential, relayConfigured, revokeRelayCredential } from '@/lib/calls/server/relay'
import { RING_TIMEOUT_S, commitTag, startCall, sweepStale } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'
import { sendRingPush } from '@/lib/calls/server/cards'
import { boundedCapabilities, relayForClient } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: THE CALL BUTTON OF ONE THREAD (DESIGN.md v3 §3.2 step 1, §4) ─────────────────────────────────────
//
// GET  → what the button may offer here: audio / video each 'ok' or the refusal code that explains why not, and the
//        consent state both ways ("Allow calls from <name>"), and — only when a call is possible — the two ids the
//        safety-code commitment binds (session.ts commitTag: pseudonyms, never profile ids). No side effects.
// POST → start a call. Gates in order (eligibility.ts): the runtime switch for BOTH people, the thread kind, neither
//        suspended, no block, the caller verified (video / teacher threads: both), the callee's consent, the limits.
//        Then one relay credential for the caller, then ONE transaction (session.ts startCall): cross-call merge, busy
//        checks, the session + the caller's lock, the ring broadcast. Answers:
//          { kind: 'ringing', callId, relay, ringTimeoutSec }   ring the callee's devices (push in after())
//          { kind: 'merge', callId }                           they are ringing YOU here: answer that call instead
//          { kind: 'unavailable', callId }                     busy — reads like a decline (§3.2 step 1)
//        and the refusals: protocol_mismatch 409 (reload to call) · not_found 404 · every eligibility code ·
//        calls_consent_required 403 · rate_limited / calls_cooldown 429 · relay_unavailable 503 · call_in_progress 409.
// ⚠️ The commitment C is all the caller sends of the safety code (sas.ts step 1); nA and the certificate stay on the
// phone. callId is minted here, AFTER C — which is why C cannot include it.

const startBody = z.strictObject({
  v: z.int(),
  media: z.enum(['audio', 'video']),
  tabId: tabIdSchema,
  commit: sasNonceSchema,
  capabilities: boundedCapabilities,
})

export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:button', limit: 120, window: '1 m' } }, async ({ params, userId }) => {
  const convo = await loadConversationForCall(params.id)
  if (!convo) throw new ApiError('not_found', 404)
  const [audio, video] = await Promise.all([callPermit(convo, userId, 'audio'), callPermit(convo, userId, 'video')])
  const calleeId = audio.ok ? audio.calleeId : video.ok ? video.calleeId : null
  const [theyAllowMe, iAllowThem] = calleeId
    ? await Promise.all([hasCallConsent(convo.id, calleeId, userId), hasCallConsent(convo.id, userId, calleeId)])
    : [false, false]
  const relay = audio.ok ? relayConfigured(audio.config.relay) : false
  return {
    protocolVersion: CALL_PROTOCOL_VERSION,
    audio: audio.ok ? (relay ? 'ok' : 'relay_unavailable') : audio.error,
    video: video.ok ? (relay ? 'ok' : 'relay_unavailable') : video.error,
    consent: { theyAllowMe, iAllowThem },
    commitIds: calleeId ? { caller: commitTag(userId, convo.id), callee: commitTag(calleeId, convo.id) } : null,
  }
})

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:start', limit: 20, window: '1 h' }, body: startBody },
  async ({ params, userId, body }) => {
    if (body.v !== CALL_PROTOCOL_VERSION) throw new ApiError('protocol_mismatch', 409)
    const convo = await loadConversationForCall(params.id)
    if (!convo) throw new ApiError('not_found', 404)
    const permit = await callPermit(convo, userId, body.media)
    if (!permit.ok) return NextResponse.json({ error: permit.error }, { status: permit.status })
    if (!(await hasCallConsent(convo.id, permit.calleeId, userId))) throw new ApiError('calls_consent_required', 403)

    // Close out whatever either person left stale (a crashed tab's call) so its record is written now. Correctness
    // does not depend on it — busy checks read freshness in SQL — but the cards and the relay revocations do, and so
    // does the pair cooldown: run BEFORE the limits, a ring nobody ended yet counts as the unanswered call it is
    // (round-5 review — after them, a caller who never polls got a fourth ring past the cooldown).
    for (const profileId of [userId, permit.calleeId]) {
      for (const { row, reason } of await sweepStale({ onlyProfile: profileId, limit: 5 })) after(() => afterCallEnded(row, reason))
    }
    const limited = await callLimitRefusal(userId, permit.calleeId)
    if (limited) return NextResponse.json({ error: limited.error }, { status: limited.status })

    const grant = await mintRelayCredential(permit.config.relay)
    if (!grant) throw new ApiError('relay_unavailable', 503)
    let result: Awaited<ReturnType<typeof startCall>>
    try {
      result = await startCall({
        conversationId: convo.id, callerId: userId, calleeId: permit.calleeId, media: body.media,
        protocolVersion: body.v, edition: EDITION, relay: grant.provider, callerTab: body.tabId, commit: body.commit,
        callerCaps: body.capabilities ?? null, callerRelayUser: grant.handle,
      })
    } catch (e) {
      // The credential was minted for a call that never existed — revoke it rather than leave it live for its TTL.
      after(() => revokeRelayCredential(grant.provider, grant.handle))
      throw e
    }
    if (result.kind !== 'ringing') after(() => revokeRelayCredential(grant.provider, grant.handle))
    switch (result.kind) {
      case 'busy_self':
        throw new ApiError('call_in_progress', 409)
      case 'blocked':
        throw new ApiError('blocked', 403)
      case 'consent_required':
        throw new ApiError('calls_consent_required', 403)
      case 'merge':
        return { kind: 'merge', callId: result.callId }
      case 'unavailable': {
        const ended = result.row
        after(() => afterCallEnded(ended, 'unavailable'))
        return { kind: 'unavailable', callId: result.callId }
      }
      case 'ringing': {
        const callId = result.callId
        after(() => sendRingPush({ id: callId, conversation_id: convo.id, caller_id: userId, callee_id: permit.calleeId, media: body.media }))
        return { kind: 'ringing', callId, relay: relayForClient(grant), ringTimeoutSec: RING_TIMEOUT_S }
      }
    }
  },
)
