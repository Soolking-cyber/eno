import 'server-only'

/**
 * AZURE AI SPEECH — since 2026-10-26 ONLY the pronunciation score of a repeat-after-me drill (the learner was asked to say
 * a KNOWN sentence). The transcript and the avatar's voice come from eno's own speech server (speech-local.ts): Azure STT
 * and neural TTS were most of a practice-hour's speech bill, and free talk scored against the recogniser's own transcript
 * was the weakest score we kept (plan review, codex + opus). Plain REST, no SDK, server-side only — the key never reaches
 * a browser, and the drill's audio is sent from memory and never stored (plan: "Student audio is never stored").
 *
 *   assess()   Pronunciation Assessment against the drill sentence (Microsoft's scripted-assessment setup)
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
  /** 'stt' and 'tts' are speech-local.ts's stages; this file only ever throws 'assess'. */
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
  const body = await sttCall(cfg, wav, Buffer.from(JSON.stringify(params), 'utf8').toString('base64'), fetchImpl)
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

async function sttCall(cfg: SpeechConfig, wav: Buffer, pronHeader: string, fetchImpl: typeof fetch): Promise<SttBody> {
  const url = `https://${cfg.region}.stt.speech.microsoft.com${STT_PATH}?language=en-US&format=detailed&profanity=masked`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.key,
      'Content-Type': WAV,
      Accept: 'application/json',
      'Pronunciation-Assessment': pronHeader,
    },
    body: new Uint8Array(wav),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new SpeechError(res.status, 'assess')
  return (await res.json().catch(() => { throw new SpeechError(502, 'assess') })) as SttBody
}
