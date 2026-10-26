import 'server-only'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { logWarn } from '@/lib/log'
import { rateLimit } from '@/lib/ratelimit'
import { LIMITS } from './constants'
import { classroomOpenFor } from './config'
import { PRACTICE_NOTICE_VERSION, TEACHER_VIEW_NOTICE_VERSION } from './notices'
import { mintSttKey, sonioxConfig, sttSettingsFor, type SttSettings } from './soniox'
import type { AgeBand } from './limits'

export type SttGrant = { apiKey: string; url: string; model: string; settings: SttSettings; languageHints: string[] }

/**
 * A single-use Soniox key for ONE live-listening socket of a LIVE session (soniox.ts): the page streams the learner's speech
 * to Soniox with it. ⛔ THE SAME CHECKS AS A TURN, BEFORE ANY AUDIO LEAVES: the caller's own live session, the seat still
 * theirs, the notices as they are NOW agreed to (the learner's speech reaches Soniox before any turn is sent), the switch
 * read fresh. Any refusal → the page listens the old way (the clip, sent whole to eno's own speech server).
 */
export async function sttGrant(sessionId: string, accountId: string, now = Date.now()): Promise<SttGrant> {
  const cfg = sonioxConfig()
  if (!cfg) throw new ApiError('speech_unavailable', 503)
  const s = await sttAllowed(sessionId, accountId, now)
  // ⛔ A FEW KEYS PER SESSION (2026-10-26 review, opus): each opens a socket billed to eno until the session ends — a
  // reload or a dropped connection needs another, a script must not get dozens.
  const rl = await rateLimit('classroom-stt-session', sessionId, STT_KEYS_PER_SESSION, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('speech_unavailable', 503)
  const band = (s.planSnapshot as { band?: unknown } | null)?.band
  const settings = sttSettingsFor(band === 'child-young' || band === 'child' || band === 'teen' ? (band as AgeBand) : 'adult')
  try {
    // Valid for a minute to OPEN the socket (the page opens it at once); the stream ends with the session's grace.
    const apiKey = await mintSttKey(cfg, { expiresInSeconds: 60, maxSessionSeconds: (s.endsAt.getTime() - now) / 1000 + LIMITS.deadlineGraceSeconds })
    return { apiKey, url: cfg.ws, model: cfg.model, settings, languageHints: ['en'] }
  } catch (e) {
    logWarn('[classroom] soniox key failed — the page listens the old way', { status: (e as { status?: number }).status ?? null })
    throw new ApiError('speech_unavailable', 503)
  }
}

/** A socket is opened once per session (a reload or a dropped connection may ask again, up to this many in an hour). */
export const STT_KEYS_PER_SESSION = 6

/**
 * May this session still be heard live? The checks without a key — the page asks every minute while its socket is open
 * (live-stt.ts), and closes it on a refusal: a withdrawal, a removed seat, the switch turned off (2026-10-26 review,
 * codex + opus: the key was checked once, the socket lived to the session's end).
 */
export async function sttAllowed(sessionId: string, accountId: string, now = Date.now()) {
  const s = await db.classroomSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, status: true, endsAt: true, testerId: true, learnerId: true, planSnapshot: true,
      learner: { select: { ownerId: true, withdrawnAt: true, practiceConsentVersion: true, teacherViewConsentVersion: true } },
      enrollment: { select: { status: true, learnerId: true } },
      avatar: { select: { teacherProfile: { select: { profileId: true } } } },
    },
  })
  if (!s || !(s.testerId === accountId || s.learner?.ownerId === accountId)) throw new ApiError('session_not_found', 404)
  if (s.status !== 'live' || now > s.endsAt.getTime() + LIMITS.deadlineGraceSeconds * 1000) throw new ApiError('session_over', 409)
  if (s.enrollment && (s.enrollment.status !== 'active' || s.enrollment.learnerId !== s.learnerId || s.learner?.withdrawnAt)) throw new ApiError('seat_inactive', 409)
  if (s.learner && (s.learner.practiceConsentVersion !== PRACTICE_NOTICE_VERSION || s.learner.teacherViewConsentVersion !== TEACHER_VIEW_NOTICE_VERSION)) {
    throw new ApiError('consent_required', 409)
  }
  if (!(await classroomOpenFor(s.avatar.teacherProfile.profileId, { fresh: true })).open) throw new ApiError('classroom_closed', 403)
  return s
}
