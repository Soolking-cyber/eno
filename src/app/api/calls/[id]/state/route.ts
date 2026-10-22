import { NextResponse, after } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { CALL_PROTOCOL_VERSION } from '@/lib/calls/types'
import { loadCall, snapshotFor, sweepStale } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'
import { participantCall } from '@/lib/calls/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: THE RESYNC SNAPSHOT (protocol.ts ResyncSnapshot; DESIGN.md v3 §3.2 step 4) ──────────────────────
//
// What Postgres knows of the call, for the phone that suspects it missed a broadcast: on every (re)subscribe, on
// visibility → visible, on 'online', and every 2 s while ringing / connecting / reconnecting. The counterpart's
// latest offer / answer / candidates per negotiation, its tab, its latest hold, and the coarse state — each piece monotonic or keyed by negId / seq, so a stale snapshot changes nothing.
// A call that has gone stale (no heartbeat, past its ring, past the 2 h cap) is ended HERE before answering, so a
// phone polling a dead call learns it ended instead of waiting for the sweep.
// Never cached: `Cache-Control: no-store`.

export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:state', limit: 120, window: '1 m' } }, async ({ params, userId }) => {
  const found = await participantCall(params.id, userId)
  const role = found.role
  let row = found.row
  if (row.state !== 'ended') {
    const stale = await sweepStale({ onlyCall: row.id, limit: 1 })
    for (const s of stale) after(() => afterCallEnded(s.row, s.reason))
    if (stale.length) row = (await loadCall(row.id)) ?? row
  }
  // A call made by another protocol version (one still open across a deploy) has a snapshot this build cannot write —
  // the schema pins the version — so it says "reload to call" instead of a 500 (protocol v2 review).
  if (row.protocol_version !== CALL_PROTOCOL_VERSION) throw new ApiError('protocol_mismatch', 409)
  return NextResponse.json(await snapshotFor(row, role), { headers: { 'Cache-Control': 'no-store' } })
})
