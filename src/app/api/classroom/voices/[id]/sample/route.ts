import { ApiError, route } from '@/lib/api/handler'
import { replySsml, speak, speechConfig } from '@/lib/classroom/azure-speech'
import { voiceById } from '@/lib/classroom/voices'
import { requireTeacher } from '@/lib/classroom/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The same line for every voice — nothing anyone typed reaches the speech service from here. */
const SAMPLE = "Hi! I'm your teacher's AI avatar. Shall we practise some English together today?"

/**
 * GET /api/classroom/voices/<id>/sample — what a voice sounds like, for the avatar wizard's picker. Teachers only, a fixed
 * sentence, an allowlisted voice (voices.ts): the same bytes for everyone, so the browser may keep them a day.
 */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-voice-sample', limit: 60, window: '1 h' } }, async ({ profile, params }) => {
  await requireTeacher(profile.id, { open: false })
  const voice = voiceById(params.id)
  if (!voice) throw new ApiError('voice_invalid', 404)
  const cfg = speechConfig()
  if (!cfg) throw new ApiError('speech_unavailable', 503)
  const mp3 = await speak(cfg, replySsml(SAMPLE, voice.id, 'natural')).catch(() => { throw new ApiError('speech_unavailable', 503) })
  return new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' } })
})
