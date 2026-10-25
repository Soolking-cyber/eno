import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { logError, logWarn } from '@/lib/log'
import { LIMITS } from '@/lib/classroom/constants'
import { mintSessionToken, spatiusConfig, tokenExpireAt } from '@/lib/classroom/spatius'
import { classroomOpenFor, readClassroomConfig, resetClassroomConfigCache } from '@/lib/classroom/config'
import { under13 } from '@/lib/classroom/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/classroom/sessions/<id>/token — the Spatius session token for a LIVE avatar-mode session: the browser's key to
 * the 3D face (Direct Mode). ⛔ One per session plus LIMITS.tokenMintsPerSession − 1 re-mints (a reload), counted
 * atomically; each expires LIMITS.tokenGraceSeconds after the session's end (spatius.ts). Any failure → the page runs the
 * session voice-only (the session row is switched too, so the cost estimate stays honest).
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-token', limit: 30, window: '1 h' } }, async ({ profile, params }) => {
  const cfg = spatiusConfig()
  const s = await db.classroomSession.findUnique({
    where: { id: params.id },
    select: {
      id: true, status: true, mode: true, endsAt: true, testerId: true, learnerId: true,
      learner: { select: { ownerId: true, kind: true, birthYear: true, withdrawnAt: true } },
      enrollment: { select: { status: true, learnerId: true } },
      avatar: { select: { teacherProfile: { select: { profileId: true } } } },
    },
  })
  if (!s || !(s.testerId === profile.id || s.learner?.ownerId === profile.id)) throw new ApiError('session_not_found', 404)
  const now = new Date()
  if (s.status !== 'live' || s.endsAt <= now) throw new ApiError('session_over', 409)
  // A withdrawn learner, or a seat removed or left, gets no face either (2c round 1, opus) — turns refuse them already.
  if (s.enrollment && (s.enrollment.status !== 'active' || s.enrollment.learnerId !== s.learnerId || s.learner?.withdrawnAt)) throw new ApiError('seat_inactive', 409)
  if (s.mode !== 'avatar' || !cfg) throw new ApiError('avatar_unavailable', 409)
  // The switch at EVERY mint, fresh (2c round 2, opus): "off" stops the next reload's face, not the next sweep.
  if (!(await classroomOpenFor(s.avatar.teacherProfile.profileId, { fresh: true })).open) throw new ApiError('classroom_closed', 403)
  // ⛔ UNDER 13: NO ANIMATED AVATAR UNTIL SPATIUS'S WRITTEN OK (Terms §11) — checked at EVERY mint against the switch as it
  // is now, not only when the session started: switching spatiusChildrenOk off stops the next reload's token too.
  if (s.learner && under13(s.learner.kind === 'child' ? 'child' : 'self', s.learner.birthYear, now)) {
    resetClassroomConfigCache()
    if (!(await readClassroomConfig()).spatiusChildrenOk) throw new ApiError('avatar_unavailable', 409)
  }
  // Count the mint FIRST and atomically: two tabs racing for a token cannot both pass the cap.
  const counted = await db.classroomSession.updateMany({
    where: { id: s.id, status: 'live', tokenMints: { lt: LIMITS.tokenMintsPerSession } },
    data: { tokenMints: { increment: 1 } },
  })
  if (!counted.count) throw new ApiError('token_limit', 409)
  try {
    const token = await mintSessionToken(cfg, tokenExpireAt(s.endsAt, now))
    return NextResponse.json({ token, appId: cfg.appId, region: cfg.region }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    logWarn('[classroom] spatius token failed — session goes voice-only', { status: (e as { status?: number }).status ?? null })
    await db.classroomSession.update({ where: { id: s.id }, data: { mode: 'voice', updatedAt: new Date() } }).catch((e) => logError(e, { op: 'classroom.token.voice' }))
    throw new ApiError('avatar_unavailable', 503)
  }
})
