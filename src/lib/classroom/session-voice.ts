import 'server-only'
import { replySsml, speak, speechConfig } from './azure-speech'
import type { AgeBand } from './limits'

/**
 * One line in the avatar's voice → base64 MP3 for the page (it decodes it for AvatarKit, or plays it in voice-only mode).
 * Slower for beginners (A1–A2) and young children. Throws when speech is not configured or the service failed — the
 * caller then sends the words without the voice (the captions still show them), never a broken session.
 */
export async function speakLine(text: string, voice: string, level: string, band: AgeBand): Promise<string> {
  const cfg = speechConfig()
  if (!cfg) throw Object.assign(new Error('speech_not_configured'), { status: 503 })
  const slow = level === 'A1' || level === 'A2' || band === 'child-young'
  const mp3 = await speak(cfg, replySsml(text, voice, slow ? 'slow' : 'natural'))
  return mp3.toString('base64')
}
