import { ApiError, route } from '@/lib/api/handler'
import { storeTelemetry } from '@/lib/calls/server/telemetry-store'
import { participantCall, readJsonCapped } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: THE HANG-UP SUMMARY (DESIGN.md v3 §3.6) ───────────────────────────────────────────────────────────
//
// The final telemetry summary, sent with navigator.sendBeacon after the call ended (the 30 s ones ride the
// heartbeat). Body: one CallTelemetrySummary — numbers and enums only (src/lib/calls/telemetry.ts); refused with
// 400 bad_request if it does not parse, names another call or side, or carries anything IP-shaped. Accepted for 15
// minutes after the end, from either participant. 200 { ok: true } also for a repeat (stored once per seq).

const LATE_WINDOW_MS = 15 * 60_000
/** A summary is a few hundred bytes of numbers; nothing near this is ever legitimate. */
const MAX_BODY_CHARS = 16 * 1024

export const POST = route({ auth: 'userId', rateLimit: { bucket: 'calls:telemetry', limit: 30, window: '1 m' } }, async ({ req, params, userId }) => {
  const raw = await readJsonCapped(req, MAX_BODY_CHARS)
  const { row, role } = await participantCall(params.id, userId)
  if (row.ended_at && Date.now() - row.ended_at.getTime() > LATE_WINDOW_MS) throw new ApiError('call_gone', 409)
  if (!(await storeTelemetry(row.id, role, raw))) throw new ApiError('bad_request', 400)
  return { ok: true }
})
