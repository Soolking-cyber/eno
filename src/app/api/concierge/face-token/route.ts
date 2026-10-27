import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { conciergeOpenFor, liveSession } from '@/lib/concierge/config'
import { mintSessionToken, spatiusConfig } from '@/lib/classroom/spatius'
import { logWarn } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/concierge/face-token { session } — a Spatius session token for the window's face. ⛔ IT EXPIRES WITH THE
 * SESSION (config.ts SESSION_MINUTES): Spatius bills every connected minute, idle included, so no face outlives the session
 * it was asked for. The window asks again only after its idle pause, on a tap. 200 { token }; 503 avatar_unavailable =
 * voice-only.
 */
export const POST = route({ auth: 'profile', body: z.object({ session: z.string().max(40) }), rateLimit: { bucket: 'concierge-face', limit: 12, window: '1 h', strict: true } }, async ({ profile, body }) => {
  const s = await liveSession(body.session, profile.id)
  if (!s) throw new ApiError('session_over', 409)
  if (!(await conciergeOpenFor(profile.id))) throw new ApiError('forbidden', 403)
  const cfg = spatiusConfig()
  if (!cfg) throw new ApiError('avatar_unavailable', 503)
  // ⛔ The session's end, never past it (commit review, codex + opus): in its last minute no new face — the window closes.
  if (s.deadline - Date.now() < 60_000) throw new ApiError('session_over', 409)
  const expireAt = Math.floor(s.deadline / 1000)
  try {
    return NextResponse.json({ token: await mintSessionToken(cfg, expireAt) }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    logWarn('[concierge] face token failed — voice only', { status: (e as { status?: number }).status ?? null })
    throw new ApiError('avatar_unavailable', 503)
  }
})
