import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { readCapped } from '@/lib/classroom/http'
import { startLearnerSession, startTeacherTest } from '@/lib/classroom/session-start'
import { NextAtRefusal } from '@/lib/classroom/refusal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * POST /api/classroom/sessions — start practising: `{ seatId }` for a learner (the account must own the seat's learner), or
 * `{ test: true }` for a teacher trying their own avatar. A live session of the same seat is returned, not refused (a reload
 * resumes it). Refusals that have a "when": `{ error: 'week_limit' | 'day_limit' | 'test_limit', nextAt }` (409).
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-start', limit: 30, window: '1 h' } }, async ({ req, profile }) => {
  const body = await readCapped(req, 1_000)
  try {
    const session = body.test === true
      ? await startTeacherTest(profile.id)
      : typeof body.seatId === 'string' && body.seatId.length <= 40
        ? await startLearnerSession(body.seatId, profile.id)
        : null
    if (!session) throw new ApiError('bad_request', 400)
    return NextResponse.json({ session }, { headers: NO_STORE })
  } catch (e) {
    if (e instanceof NextAtRefusal) return NextResponse.json({ error: e.code, nextAt: e.nextAt }, { status: 409, headers: NO_STORE })
    throw e
  }
})
