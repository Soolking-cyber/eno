import { after } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { endCall } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'
import { participantCall } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: DECLINE (DESIGN.md v3 §3.2 steps 1 and 3) ───────────────────────────────────────────────────────
//
// The callee says no from one device: the call ends 'declined', every other ringing device stops ('cancel' on
// user:<callee>), and the caller is told 'unavailable' — the same word busy and a timeout get.
// ⚠️ { reason: 'media' } IS NOT A DECLINE. It is one device that could not open its mic or camera at Accept; the
// call keeps ringing on the callee's other devices (§3.2 step 3), so nothing changes here.
// 200 { ended: boolean } — false when it had already ended (answered elsewhere, cancelled, timed out): idempotent.

const declineBody = z.strictObject({ reason: z.enum(['declined', 'media']).optional() })

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:decline', limit: 30, window: '1 m' }, body: declineBody },
  async ({ params, userId, body }) => {
    const { row, role } = await participantCall(params.id, userId)
    if (role !== 'callee') throw new ApiError('not_found', 404)
    if (body.reason === 'media') return { ended: false }
    const ended = await endCall({ callId: row.id, reason: 'declined', fromStates: ['ringing'], profileId: userId })
    if (ended) after(() => afterCallEnded(ended, 'declined'))
    return { ended: ended !== null }
  },
)
