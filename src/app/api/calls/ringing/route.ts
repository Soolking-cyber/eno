import { route } from '@/lib/api/handler'
import { ringingCallFor } from '@/lib/calls/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: IS SOMEONE RINGING ME? (DESIGN.md v3 §3.3 — Postgres is the truth, Realtime the hint) ──────────────
//
// The ring on ring:<me> is a broadcast: a page still loading, or whose socket is reconnecting, never hears it. The call
// runtime asks here whenever that channel (re)subscribes and shows the ring itself (client review).
// 200 { callId } — the newest FRESH ringing call for me, or null. Ids only: the ring screen reads the rest from
// GET /api/calls/:id, like a broadcast ring.
export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:ringing', limit: 60, window: '1 m' } }, async ({ userId }) => {
  return { callId: await ringingCallFor(userId) }
})
