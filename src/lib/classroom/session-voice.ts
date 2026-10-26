import 'server-only'
import { localSpeechConfig, synthesize, synthesizeStream } from './speech-local'
import type { Speaker } from './turn-stream'
import { VOICES, voiceFor } from './voices'
import type { VoiceStyle } from './pace'

/**
 * One line in the avatar's voice → base64 MP3 for the page (it decodes it for AvatarKit, or plays it in voice-only mode),
 * spoken by eno's own speech server (speech-local.ts) in the learner's voice style (pace.ts: the pace, a child's louder
 * voice and longer pauses). Throws when the server is not configured or failed — the caller then sends the words without
 * the voice (the captions still show them), never a broken session. A voice saved before the switch speaks as its
 * counterpart (voices.ts voiceFor); an unknown one in the first voice, rather than failing.
 */
export async function speakLine(text: string, voice: string, style: VoiceStyle): Promise<string> {
  const cfg = localSpeechConfig()
  if (!cfg) throw Object.assign(new Error('speech_not_configured'), { status: 503 })
  const mp3 = await synthesize(cfg, text, (voiceFor(voice) ?? VOICES[0]).id, style)
  return mp3.toString('base64')
}

/**
 * The avatar's voice for one turn's sentences, STREAMED as it is made (turn-stream.ts; owner, 2026-10-26: "delayless").
 * `style` is read for EACH sentence: a learner who asks for a slower voice hears the reply's own sentences at the new pace
 * (the tutor's `pace` comes before its first sentence — session-turn.ts). Null when eno's speech server is not configured:
 * the words still reach the screen.
 */
export function speakerFor(voice: string, style: () => VoiceStyle): Speaker | null {
  const cfg = localSpeechConfig()
  if (!cfg) return null
  const id = (voiceFor(voice) ?? VOICES[0]).id
  return (text, signal) => synthesizeStream(cfg, text, id, style(), signal)
}
