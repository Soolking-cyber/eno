import { ApiError, route } from '@/lib/api/handler'
import { logWarn } from '@/lib/log'
import { isServerEventKind, parseEvent, type ClientEvent } from '@/lib/calls/protocol'
import { relayAllowList } from '@/lib/calls/server/relay'
import { sanitizeClientEvent } from '@/lib/calls/server/signal'
import { relayClientEvent } from '@/lib/calls/server/session'
import { endByParticipant, participantCall, readJsonCapped } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: ONE PHONE → THE OTHER (DESIGN.md v3 §3.2 steps 4–8, §3.3) ───────────────────────────────────────
//
// Every in-call event a phone sends — ready, offer, answer, candidates, restart_request, hold, resume, end — as the
// protocol.ts envelope the negotiation reducer emits. The box:
//   1. parses it (version FIRST: another build's event is protocol_mismatch 409, "reload to call"; a malformed one is
//      bad_request 400) and refuses a box-only kind from a phone;
//   2. checks it is a participant's, from the tab bound to that side (wrong_tab 409), in a live call (call_gone 409);
//   3. 'end' ends the call (http.ts endByParticipant); everything else is SANITISED (signal.ts: a description the
//      guard refuses is invalid_sdp 400; candidates are rebuilt or dropped against THIS call's relay ranges),
//   4. and stored + deduplicated + broadcast in ONE transaction (session.ts relayClientEvent). A retried POST reuses
//      its key and is answered { duplicate: true } without a second broadcast.
// ⚠️ NO SDP, CANDIDATE OR KEY IN LOGS — the only log here is a count when a description lost every candidate (a wrong
// relay allow-list would otherwise fail every call silently: sdp-guard review).
// Rate: a call retransmits every 2.5 s and trickles a few candidate batches; 300/min per person is far above that.

/** One event: a 64 KB description plus a bounded plan (protocol.ts) fits well inside; nothing bigger is parsed at all. */
const MAX_BODY_CHARS = 96 * 1024

export const POST = route({ auth: 'userId', rateLimit: { bucket: 'calls:signal', limit: 300, window: '1 m' } }, async ({ req, params, userId }) => {
  // A declared size over the cap is refused before a byte is read, and an undeclared one stops at the cap (http.ts).
  const parsed = parseEvent(await readJsonCapped(req, MAX_BODY_CHARS))
  if (!parsed.ok) throw parsed.error === 'unsupported_version' ? new ApiError('protocol_mismatch', 409) : new ApiError('bad_request', 400)
  const event = parsed.value
  if (isServerEventKind(event.kind) || event.callId !== params.id) throw new ApiError('bad_request', 400)
  const clientEvent = event as ClientEvent

  const { row, role } = await participantCall(params.id, userId)
  if (row.state === 'ended') throw new ApiError('call_gone', 409)
  if (clientEvent.kind === 'end') {
    const ended = await endByParticipant(row, role, userId, clientEvent.tabId, clientEvent.payload.reason)
    return { ok: true, ended: ended !== null }
  }

  const clean = sanitizeClientEvent(clientEvent, relayAllowList(row.relay_provider))
  if (!clean.ok) throw new ApiError('invalid_sdp', 400)
  if (clean.lostAll) logWarn('calls.relay.candidates_dropped', { callId: row.id, kind: clientEvent.kind, before: clean.before, provider: row.relay_provider })
  if (clean.event === null) return { ok: true, dropped: true }

  const outcome = await relayClientEvent(row.id, userId, clean.event)
  if (outcome === 'gone') throw new ApiError('call_gone', 409)
  if (outcome === 'wrong_tab') throw new ApiError('wrong_tab', 409)
  if (outcome === 'full') {
    logWarn('calls.signal.candidates_full', { callId: row.id, before: clean.before })
    return { ok: true, dropped: true }
  }
  return { ok: true, duplicate: outcome === 'duplicate' }
})
