import { after } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { CALL_PROTOCOL_VERSION } from '@/lib/calls/types'
import { liveCallRefusal, liveVideoAllowed } from '@/lib/calls/server/eligibility'
import { callClock, endCall, heartbeat, sweepStale } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'
import { storeTelemetry } from '@/lib/calls/server/telemetry-store'
import { participantCall, tabIdSchema } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: "THIS TAB IS STILL IN THE CALL" (DESIGN.md v3 §3.2 step 7) ──────────────────────────────────────
//
// Every 15 s from the bound tab of each side, from the start of ringing (caller) or the accept (callee). Every busy
// check reads these timestamps in SQL (session.ts FRESH), so a tab that dies frees its owner within 45 s with no
// timer involved. Each beat also re-judges the call by the start's own rules — how the kill switch, a narrowed
// switch, a suspension or a block reaches a call that is already connected. Over HTTP, never Realtime (§3.3: Realtime's event budget is for signalling).
// Body: { tabId, connected, telemetry? } — `connected` stamps the first connection once (the 2 h cap counts from it);
// `telemetry` is the 30 s summary riding along (telemetry-store.ts), refused silently if malformed so a telemetry bug
// can never end a call.
// 200 { state, capInMs, videoAllowed } — the time left before the 2 h cap (null until connected), so the screen can warn
// at 1:55; and whether the cameras may be on (eligibility.ts liveVideoAllowed): the video switch going off PAUSES them —
// the phones turn theirs off and the call goes on as voice — it never ends the call. 409 call_gone — ended, or not the
// bound tab (the phone then reads /state and tears down).

const heartbeatBody = z.strictObject({ tabId: tabIdSchema, connected: z.boolean(), telemetry: z.unknown().optional() })

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:heartbeat', limit: 30, window: '1 m' }, body: heartbeatBody },
  async ({ params, userId, body }) => {
    const { row: before, role } = await participantCall(params.id, userId)
    // A call of another protocol version (one live across a deploy) can no longer signal — the signal route refuses its
    // events — so a beat must not keep it, and both people's locks, alive until the 2 h cap: it ends here (protocol v2
    // plan review, codex).
    if (before.protocol_version !== CALL_PROTOCOL_VERSION) {
      const ended = await endCall({ callId: before.id, reason: 'protocol_mismatch' })
      if (ended) after(() => afterCallEnded(ended, 'protocol_mismatch'))
      throw new ApiError('protocol_mismatch', 409)
    }
    const row = await heartbeat({ callId: before.id, profileId: userId, tabId: body.tabId, connected: body.connected })
    if (!row) throw new ApiError('call_gone', 409)
    // Only from the bound tab of a live call (commit-gate review): the hang-up summary has its own route and window.
    if (body.telemetry !== undefined) await storeTelemetry(before.id, role, body.telemetry).catch(() => false)
    // ⛔ STILL ALLOWED? The same rules the start and the accept ran, judged as a voice call (eligibility.ts
    // liveCallRefusal): the kill switch, a narrowed switch, a suspension or a block that landed mid-call ends it at the
    // next beat — the block route ends it at once, and this is also the backstop for anything that path missed.
    const refusal = await liveCallRefusal(row)
    if (refusal) {
      const ended = await endCall({ callId: row.id, reason: refusal })
      if (ended) after(() => afterCallEnded(ended, refusal))
      throw new ApiError('call_gone', 409)
    }
    // The 2 h cap and a peer that stopped beating are enforced as soon as either side is heard from.
    const stale = await sweepStale({ onlyCall: row.id, limit: 1 })
    for (const s of stale) after(() => afterCallEnded(s.row, s.reason))
    if (stale.length) throw new ApiError('call_gone', 409)
    // Time left before the 2 h cap, by the DATABASE's clock (session.ts callClock) — the phone adds it to its own now.
    const clock = await callClock(row.id)
    return { state: row.state, capInMs: clock?.capRemainingMs ?? null, videoAllowed: await liveVideoAllowed(row) }
  },
)
