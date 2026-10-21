import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { CALL_END_REASONS, tabIdSchema } from '@/lib/calls/protocol'
import { endByParticipant, participantCall } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: HANG UP, ALSO FROM navigator.sendBeacon ON pagehide (DESIGN.md v3 §3.2 steps 7 and 9) ─────────────
//
// The same end as an 'end' event through /signal, in a body a beacon can carry: { tabId, reason }. Idempotent —
// 200 { ended: false } when the call had already ended. While ringing: the caller's end is a cancel, the callee's a
// decline. A box-only reason ("blocked", "kill_switch" …) from a phone is read as a plain hang-up (http.ts).

const endBody = z.strictObject({ tabId: tabIdSchema, reason: z.enum(CALL_END_REASONS) })

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:end', limit: 60, window: '1 m' }, body: endBody },
  async ({ params, userId, body }) => {
    const { row, role } = await participantCall(params.id, userId)
    const ended = await endByParticipant(row, role, userId, body.tabId, body.reason)
    return { ended: ended !== null }
  },
)
