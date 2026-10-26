import 'server-only'
import { localSpeechConfig, synthesize } from './speech-local'
import { VOICES, voiceFor } from './voices'
import type { AgeBand } from './limits'

/**
 * One line in the avatar's voice → base64 MP3 for the page (it decodes it for AvatarKit, or plays it in voice-only mode),
 * spoken by eno's own speech server (speech-local.ts). Slower for beginners (A1–A2) and young children. Throws when the
 * server is not configured or failed — the caller then sends the words without the voice (the captions still show them),
 * never a broken session. A voice saved before the switch speaks as its counterpart (voices.ts voiceFor); an unknown one
 * in the first voice, rather than failing.
 */
export async function speakLine(text: string, voice: string, level: string, band: AgeBand): Promise<string> {
  const cfg = localSpeechConfig()
  if (!cfg) throw Object.assign(new Error('speech_not_configured'), { status: 503 })
  const slow = level === 'A1' || level === 'A2' || band === 'child-young'
  const mp3 = await synthesize(cfg, text, (voiceFor(voice) ?? VOICES[0]).id, slow ? 'slow' : 'natural')
  return mp3.toString('base64')
}
