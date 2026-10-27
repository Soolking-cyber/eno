import { ApiError, route } from '@/lib/api/handler'
import { speakLine } from '@/lib/classroom/session-voice'
import { voiceById } from '@/lib/classroom/voices'
import { requireTeacher } from '@/lib/classroom/guards'
import { NATURAL_VOICE } from '@/lib/classroom/pace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The same line for every voice — nothing anyone typed reaches a speech service from here. */
const SAMPLE = "Hi! I'm your teacher's AI avatar. Shall we practise some English together today?"

/**
 * GET /api/classroom/voices/<id>/sample — what a voice sounds like, for the avatar wizard's picker. Teachers only, a fixed
 * sentence, an allowlisted voice (voices.ts): the same bytes for everyone, so the browser may keep them a day.
 */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-voice-sample', limit: 60, window: '1 h' } }, async ({ profile, params }) => {
  await requireTeacher(profile.id, { open: false })
  const voice = voiceById(params.id)
  if (!voice) throw new ApiError('voice_invalid', 404)
  // The voice learners hear — Soniox, or the box when Soniox cannot (session-voice.ts).
  const b64 = await speakLine(SAMPLE, voice.id, NATURAL_VOICE).catch(() => { throw new ApiError('speech_unavailable', 503) })
  // ⚠️ Not cached for a day any more: a sample the box made while Soniox rested would stand in for the real voice.
  return new Response(new Uint8Array(Buffer.from(b64, 'base64')), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=600' } })
})
