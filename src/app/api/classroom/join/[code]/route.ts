import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import { afterIndividualOnboarding } from '@/lib/core/first-onboarding'
import { claimSeat, invitePreview, parseJoin } from '@/lib/classroom/join'
import { readCapped } from '@/lib/classroom/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * GET /api/classroom/join/<code> — the invite's face before sign-in: whose class, which seat. Public (the link is the
 * key — 59 bits, one use, 14 days), rate-limited per connection so codes cannot be walked.
 */
export const GET = route({ auth: 'public', rateLimit: { bucket: 'classroom-invite-peek', limit: 60, window: '1 h' } }, async ({ params }) => {
  const invite = await invitePreview(params.code)
  if (!invite) throw new ApiError('invite_invalid', 404)
  return NextResponse.json({ invite }, { headers: NO_STORE })
})

/** POST /api/classroom/join/<code> — claim the seat (join.ts claimSeat: one transaction, consents recorded beside it). */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-join', limit: 20, window: '1 h' } }, async ({ req, profile, params }) => {
  const body = parseJoin(await readCapped(req, 4_000))
  if ('error' in body) {
    if (body.error === 'notice_changed') return NextResponse.json({ error: 'notice_changed', notice: 'classroom_join' }, { status: 409, headers: NO_STORE })
    throw new ApiError('bad_request', 400)
  }
  const result = await claimSeat(params.code, profile, body)
  // The account step's after-effects (the personal handle, the welcome) — best-effort, never thrown (first-onboarding.ts).
  if (result.onboarded) await afterIndividualOnboarding(req, profile, null).catch((e) => logError(e, { op: 'classroom.join.onboarding' }))
  return NextResponse.json({ seatId: result.seatId, learnerId: result.learnerId }, { headers: NO_STORE })
})
