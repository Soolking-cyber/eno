import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { recordReveal } from '@/lib/calls/server/session'
import { participantCall, sasNonceSchema, tabIdSchema } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: THE CALLER'S SAFETY-CODE REVEAL (sas.ts step 5; DESIGN.md v3 §3.2 step 5) ─────────────────────────
//
// Once DTLS is connected and nB is frozen, the caller sends nA; the box keeps the FIRST one and re-emits it to the
// callee as a 'reveal' box event (and in every snapshot). The callee checks it against the commitment it froze before
// accepting — a reveal that does not open it, or none within 10 s, is a mismatch.
//   200 { stored: true }  first reveal (broadcast) · 200 { stored: false }  the same nonce again (retry; no broadcast)
//   409 reveal_conflict   a DIFFERENT nonce after the first — never replaced · 409 call_gone  not live / not the bound tab

const revealBody = z.strictObject({ tabId: tabIdSchema, nonce: sasNonceSchema })

export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'calls:reveal', limit: 30, window: '1 m' }, body: revealBody },
  async ({ params, userId, body }) => {
    const { row, role } = await participantCall(params.id, userId)
    if (role !== 'caller') throw new ApiError('not_found', 404)
    const r = await recordReveal(row.id, userId, body.tabId, body.nonce)
    if (r === 'gone') throw new ApiError('call_gone', 409)
    if (r === 'conflict') throw new ApiError('reveal_conflict', 409)
    return { stored: r === 'stored' }
  },
)
