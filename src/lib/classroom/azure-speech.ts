import 'server-only'
import { voiceById, voiceLocale } from './voices'

/**
 * AZURE AI SPEECH — the classroom's ears and voice (plan "Decisions": one vendor for all three, Southeast Asia region).
 * Plain REST, no SDK, server-side only — the key never reaches a browser, and the learner's audio is sent from memory and
 * never stored (plan: "Student audio is never stored").
 *
 *   recognize()   speech-to-text, short audio (≤ 60 s), en-US, word-for-word (the learner's own grammar kept)
 *   assess()      Pronunciation Assessment against a KNOWN reference: a drill sentence, else the transcript itself
 *                 (Microsoft's recommended accuracy setup — transcribe, then score scripted)
 *   speak()       neural TTS → MP3 (24 kHz, 48 kbps): ~6 KB a second; the browser decodes it for AvatarKit or plays it
 *
 * ⛔ The audio and the words are never logged; an error carries the status and nothing else.
 */
export type SpeechConfig = { key: string; region: string }

export function speechConfig(): SpeechConfig | null {
  const key = process.env.AZURE_SPEECH_KEY?.trim()
  const region = process.env.AZURE_SPEECH_REGION?.trim() || 'southeastasia'
  if (!key || !/^[a-z0-9]+$/.test(region)) return null
  return { key, region }
}

export class SpeechError extends Error {
  constructor(readonly status: number, readonly stage: 'stt' | 'assess' | 'tts') { super(`speech_${stage}_${status}`) }
}

const STT_PATH = '/speech/recognition/conversation/cognitiveservices/v1'
const WAV = 'audio/wav; codecs=audio/pcm; samplerate=16000'

type NBest = {
  Lexical?: string
  Display?: string
  PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; ProsodyScore?: number; PronScore?: number }
  Words?: {
    Word?: string
    PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string }
    Phonemes?: { Phoneme?: string; PronunciationAssessment?: { AccuracyScore?: number } }[]
  }[]
}
type SttBody = { RecognitionStatus?: string; DisplayText?: string; NBest?: NBest[] }

/** `text` is the display form (what the learner and the tutor read); `lexical` the spoken form ("two", not "2") — the
 *  reference a pronunciation score is taken against (2a round 6, opus: Microsoft's scripted-assessment guidance). */
export type Recognized = { text: string; lexical: string; status: 'ok' | 'silence' }

/** Speech-to-text of one learner turn. 'silence' when Azure heard no speech (the page asks them to try again). */
export async function recognize(cfg: SpeechConfig, wav: Buffer, fetchImpl: typeof fetch = fetch): Promise<Recognized> {
  const body = await sttCall(cfg, wav, null, fetchImpl, 'stt')
  if (body.RecognitionStatus === 'NoMatch' || body.RecognitionStatus === 'InitialSilenceTimeout' || body.RecognitionStatus === 'BabbleTimeout') return { text: '', lexical: '', status: 'silence' }
  if (body.RecognitionStatus !== 'Success') throw new SpeechError(502, 'stt')
  const text = (body.NBest?.[0]?.Display ?? body.DisplayText ?? '').trim()
  const lexical = (body.NBest?.[0]?.Lexical ?? '').trim() || text
  return text ? { text, lexical, status: 'ok' } : { text: '', lexical: '', status: 'silence' }
}

/** What a turn's score is kept as (ClassroomTurn.pron) — numbers and words only; trimmed for the report. */
export type PronResult = {
  accuracy: number | null
  fluency: number | null
  completeness: number | null
  prosody: number | null
  words: { word: string; score: number; error: string | null; phonemes?: { p: string; score: number }[] }[]
}

/**
 * Pronunciation Assessment of one turn against `reference`. `miscue` (omissions/insertions) only when the reference is a
 * KNOWN sentence the learner was asked to say — against the learner's own transcript it would mean nothing.
 */
export async function assess(cfg: SpeechConfig, wav: Buffer, reference: string, miscue: boolean, fetchImpl: typeof fetch = fetch): Promise<PronResult> {
  const params = {
    ReferenceText: reference,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableMiscue: miscue,
    EnableProsodyAssessment: true,
    PhonemeAlphabet: 'IPA',
  }
  const body = await sttCall(cfg, wav, Buffer.from(JSON.stringify(params), 'utf8').toString('base64'), fetchImpl, 'assess')
  if (body.RecognitionStatus !== 'Success') throw new SpeechError(502, 'assess')
  return trimPron(body.NBest?.[0])
}

/** Pure: Azure's NBest[0] → the kept shape. Exported for tests. */
export function trimPron(n: NBest | undefined): PronResult {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
  const pa = n?.PronunciationAssessment ?? {}
  return {
    accuracy: num(pa.AccuracyScore),
    fluency: num(pa.FluencyScore),
    completeness: num(pa.CompletenessScore),
    prosody: num(pa.ProsodyScore),
    words: (n?.Words ?? []).slice(0, 120).flatMap((w) => {
      const word = (w.Word ?? '').trim()
      const score = num(w.PronunciationAssessment?.AccuracyScore)
      if (!word || score == null) return []
      const error = w.PronunciationAssessment?.ErrorType && w.PronunciationAssessment.ErrorType !== 'None' ? w.PronunciationAssessment.ErrorType : null
      // Phonemes only where the word went wrong — what the report explains; the rest is weight.
      const phonemes = score < 80 ? (w.Phonemes ?? []).flatMap((p) => {
        const s = num(p.PronunciationAssessment?.AccuracyScore)
        return p.Phoneme && s != null ? [{ p: p.Phoneme, score: s }] : []
      }) : undefined
      return [{ word, score, error, ...(phonemes?.length ? { phonemes } : {}) }]
    }),
  }
}

async function sttCall(cfg: SpeechConfig, wav: Buffer, pronHeader: string | null, fetchImpl: typeof fetch, stage: 'stt' | 'assess'): Promise<SttBody> {
  const url = `https://${cfg.region}.stt.speech.microsoft.com${STT_PATH}?language=en-US&format=detailed&profanity=masked`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.key,
      'Content-Type': WAV,
      Accept: 'application/json',
      ...(pronHeader ? { 'Pronunciation-Assessment': pronHeader } : {}),
    },
    body: new Uint8Array(wav),
    signal: AbortSignal.timeout(stage === 'stt' ? 8_000 : 15_000),
  })
  if (!res.ok) throw new SpeechError(res.status, stage)
  return (await res.json().catch(() => { throw new SpeechError(502, stage) })) as SttBody
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c])

/** The SSML for one reply. ⛔ The voice id is from the allowlist (voices.ts) and the text is escaped — nothing else enters. */
export function replySsml(text: string, voiceId: string, rate: 'slow' | 'natural'): string {
  const voice = voiceById(voiceId) ?? voiceById('en-US-AvaMultilingualNeural')!
  const lang = voiceLocale(voice)
  const prosody = rate === 'slow' ? '-12%' : '0%'
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice.id}"><prosody rate="${prosody}">${escapeXml(text)}</prosody></voice></speak>`
}

/** Neural TTS → MP3 bytes. */
export async function speak(cfg: SpeechConfig, ssml: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const res = await fetchImpl(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'eno-classroom',
    },
    body: ssml,
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new SpeechError(res.status, 'tts')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length < 200) throw new SpeechError(502, 'tts')
  return bytes
}
