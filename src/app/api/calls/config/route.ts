import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { getCurrentProfileId } from '@/lib/admin'
import { CALL_PROTOCOL_VERSION } from '@/lib/calls/types'
import { callsEnabledFor } from '@/lib/calls/server/config'
import { relayConfigured } from '@/lib/calls/server/relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: IS CALLING ON FOR ME? (DESIGN.md v3 §3.2 step 1) ─────────────────────────────────────────────────
//
// The client keeps this ≤ 60 s in memory and shows no call UI at all when `enabled` is false — the runtime switch
// (src/lib/calls/server/config.ts: off | staff | beta | all + cohort), blocking being live, and the relay being
// configured on this deployment. Signed out → { enabled: false }, never a 401: the thread page asks on load.
// Whether a call is allowed IN A GIVEN THREAD is a separate, per-thread question (GET /api/conversations/:id/call).

// ⚠️ NO RATE LIMIT, ON PURPOSE: a public route keys its bucket by IP, and Vietnamese carriers put thousands of phones
// behind one CGNAT address. A signed-out request does no database work at all; a signed-in one reads a cached row.
export const GET = route({ auth: 'public' }, async () => {
  const profileId = await getCurrentProfileId()
  // `userId`: the account this answer is FOR — the client keys its 60 s copy by it, so an answer that lands after a
  // switch of account is never filed under the previous one (client review).
  const off = { enabled: false, video: false, protocolVersion: CALL_PROTOCOL_VERSION, userId: profileId }
  // Signed out: never cached — the answer must change the moment someone signs in.
  if (!profileId) return NextResponse.json(off, { headers: { 'Cache-Control': 'no-store' } })
  const { enabled, config } = await callsEnabledFor(profileId)
  const on = enabled && relayConfigured(config.relay)
  // ⚠️ no-store here too: a browser cache is not keyed by who is signed in, so one account's answer must never be
  // served to the next account on a shared device (commit-gate review). The client keeps its own 60 s copy in memory.
  return NextResponse.json(
    on ? { enabled: true, video: config.video, protocolVersion: CALL_PROTOCOL_VERSION, userId: profileId } : off,
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
