import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { CALL_PROTOCOL_VERSION } from '@/lib/calls/types'
import { callPermit, loadConversationForCall, videoAllowedBy } from '@/lib/calls/server/eligibility'
import { mintRelayCredential, revokeRelayCredential } from '@/lib/calls/server/relay'
import { acceptCall, endCall } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'
import { ANSWERED_TEXT, replaceRingPush } from '@/lib/calls/server/cards'
import { boundedCapabilities, participantCall, relayForClient, tabIdSchema } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: ANSWER (DESIGN.md v3 §3.2 step 3) ───────────────────────────────────────────────────────────────
//
// The callee's tab has ALREADY obtained the mic before calling this — a tab that cannot capture never takes the call
// away from the callee's other devices. Body: { v, tabId, capabilities }.
//   · protocol_mismatch 409 — the two builds cannot call each other ("reload to call");
//   · the call is re-judged from the CALLER'S side (eligibility.ts callPermit): a block, a suspension or the switch
//     going off while it rang ends it here (blocked / unavailable) instead of connecting it;
//   · call_gone 409 — answered on another device, cancelled, or past the 45 s ring; call_in_progress 409 — this
//     person is already in another call;
//   · judged by the VOICE rules whatever the call's media: the video switch going off while it rang pauses the cameras
//     (`videoAllowed` false) instead of ending the call — the same rule as the heartbeat (eligibility.ts liveCallRefusal);
//   · 200 { relay, conversationId, media, videoAllowed } — the bound tab; the caller is told 'accepted' in the same
//     transaction, and the callee's other tabs 'answered_elsewhere'; the "Incoming call" on their lock screens is
//     replaced with a silent "Answered" (cards.ts replaceRingPush).

const acceptBody = z.strictObject({
  v: z.int(),
  tabId: tabIdSchema,
  /** Protocol v1's safety-code nonce: an old tab still sends it — allowed ONLY so the version check answers it 'reload
   *  to call' instead of a bare 400. Never read. */
  nonce: z.string().max(64).optional(),
  capabilities: boundedCapabilities,
})

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:accept', limit: 30, window: '1 m' }, body: acceptBody },
  async ({ params, userId, body }) => {
    const { row, role } = await participantCall(params.id, userId)
    if (role !== 'callee') throw new ApiError('not_found', 404)
    if (body.v !== CALL_PROTOCOL_VERSION || body.v !== row.protocol_version) throw new ApiError('protocol_mismatch', 409)
    if (row.state !== 'ringing' || !row.caller_id) throw new ApiError('call_gone', 409)

    const convo = await loadConversationForCall(row.conversation_id)
    if (!convo) throw new ApiError('call_gone', 409)
    const permit = await callPermit(convo, row.caller_id, 'audio')
    if (!permit.ok) {
      const ended = await endCall({ callId: row.id, reason: permit.error === 'blocked' ? 'blocked' : 'unavailable', fromStates: ['ringing'] })
      if (ended) after(() => afterCallEnded(ended, permit.error === 'blocked' ? 'blocked' : 'unavailable'))
      return NextResponse.json({ error: permit.error }, { status: permit.status })
    }

    const grant = await mintRelayCredential(row.relay_provider)
    if (!grant) throw new ApiError('relay_unavailable', 503)
    let result: Awaited<ReturnType<typeof acceptCall>>
    try {
      result = await acceptCall({
        callId: row.id, calleeId: userId, tabId: body.tabId,
        calleeCaps: body.capabilities ?? null, calleeRelayUser: grant.handle,
      })
    } catch (e) {
      after(() => revokeRelayCredential(grant.provider, grant.handle))
      throw e
    }
    if (!result.ok) {
      after(() => revokeRelayCredential(grant.provider, grant.handle))
      if (result.error === 'call_in_progress') throw new ApiError('call_in_progress', 409)
      throw new ApiError('call_gone', 409)
    }
    after(() => replaceRingPush(row, ANSWERED_TEXT, true))
    return { relay: relayForClient(grant), conversationId: row.conversation_id, media: row.media, videoAllowed: videoAllowedBy(permit.config, row.media) }
  },
)
