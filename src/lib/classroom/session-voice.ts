import 'server-only'
import { localSpeechConfig, synthesize, synthesizeStream } from './speech-local'
import type { Speaker } from './turn-stream'
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

/**
 * The avatar's voice for one turn's sentences, STREAMED as it is made (turn-stream.ts; owner, 2026-10-26: "delayless") —
 * speakLine's voice and rate, so every sentence sounds like the one before it. Null when eno's speech server is not
 * configured: the words still reach the screen.
 */
export function speakerFor(voice: string, level: string, band: AgeBand): Speaker | null {
  const cfg = localSpeechConfig()
  if (!cfg) return null
  const slow = level === 'A1' || level === 'A2' || band === 'child-young'
  const id = (voiceFor(voice) ?? VOICES[0]).id
  return (text, signal) => synthesizeStream(cfg, text, id, slow ? 'slow' : 'natural', signal)
}
