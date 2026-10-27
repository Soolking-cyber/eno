import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { conciergeOpenFor, liveSession } from '@/lib/concierge/config'
import { mintSttKey, sonioxConfig, sttSettingsFor } from '@/lib/classroom/soniox'
import { rateLimit } from '@/lib/ratelimit'
import { logWarn } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const body = z.object({ session: z.string().max(40) })

/**
 * POST /api/concierge/stt-token { session } — a single-use Soniox key for the window's live-listening socket (the classroom's
 * live listening, src/components/classroom/session/live-stt.ts): valid a minute to OPEN it, the stream cut at the session's
 * end. English and Vietnamese hints — the person may speak either (the avatar answers in English). 200 SttGrant; any
 * refusal → the window listens the old way (no words until the person stops — then the turn says "try again").
 */
export const POST = route({ auth: 'profile', body, rateLimit: { bucket: 'concierge-stt-token', limit: 30, window: '1 h', strict: true } }, async ({ profile, body }) => {
  const s = await liveSession(body.session, profile.id)
  if (!s) throw new ApiError('session_over', 409)
  if (!(await conciergeOpenFor(profile.id))) throw new ApiError('forbidden', 403)
  const cfg = sonioxConfig()
  if (!cfg) throw new ApiError('speech_unavailable', 503)
  // A few sockets per session: a dropped connection may ask again, a script may not ask dozens.
  const rl = await rateLimit('concierge-stt-session', s.id, 6, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('speech_unavailable', 503)
  try {
    const apiKey = await mintSttKey(cfg, { expiresInSeconds: 60, maxSessionSeconds: (s.deadline - Date.now()) / 1000 })
    return NextResponse.json({ apiKey, url: cfg.ws, model: cfg.model, settings: sttSettingsFor('adult'), languageHints: ['en', 'vi'] }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    logWarn('[concierge] soniox key failed', { status: (e as { status?: number }).status ?? null })
    throw new ApiError('speech_unavailable', 503)
  }
})

/** GET ?session=<id> — may the session still be heard live? 204, or the refusal (the window closes its socket). */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'concierge-stt-check', limit: 120, window: '1 h' } }, async ({ profile, req }) => {
  const s = await liveSession(new URL(req.url).searchParams.get('session'), profile.id)
  if (!s) throw new ApiError('session_over', 409)
  if (!(await conciergeOpenFor(profile.id))) throw new ApiError('forbidden', 403)
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'private, no-store' } })
})
