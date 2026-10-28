import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { conciergeOpenFor, startSession } from '@/lib/concierge/config'
import { conciergeFace, OPENING_LINE, openingAudio } from '@/lib/concierge/start'
import { warmConciergeBrain } from '@/lib/concierge/brain'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/concierge/start — the Start tap: the switch read fresh, the day's caps, a session that ends after
 * SESSION_MINUTES (config.ts), the face to connect and the opening line with its voice. 200 { session, deadline, face,
 * opening: { text, audio } }. The brain's connection is opened meanwhile (the first answer is then ~1 s, not ~2.5 s).
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'concierge-start', limit: 20, window: '1 h', strict: true } }, async ({ profile }) => {
  if (!(await conciergeOpenFor(profile.id, { fresh: true }))) throw new ApiError('forbidden', 403)
  let session
  const out: { cap?: 'account' | 'site' } = {}
  try {
    session = await startSession(profile.id, Date.now(), out)
  } catch (e) {
    logError(e, { op: 'concierge.start' })
    throw new ApiError('not_configured', 503)
  }
  // The account's own day is used up, or the whole site's: the window says which, and offers the text assistant.
  if (!session) throw out.cap === 'site' ? new ApiError('guide_busy', 429) : new ApiError('limit_reached', 429)
  warmConciergeBrain()
  return NextResponse.json(
    { session: session.id, deadline: session.deadline, face: conciergeFace(), opening: { text: OPENING_LINE, audio: await openingAudio() } },
    { headers: { 'cache-control': 'private, no-store' } },
  )
})
