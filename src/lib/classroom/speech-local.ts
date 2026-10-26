import 'server-only'
import { logError, logWarn } from '@/lib/log'
import { SpeechError } from './azure-speech'
import { quietError } from './quiet-error'

/**
 * ENO'S OWN SPEECH SERVER — the classroom's ears and voice since 2026-10-26 (owner: "we need to make it dirt cheap to
 * scale and use"): NVIDIA Parakeet speech-to-text and Gradium Phonon voices, open models on the VN box's CPU, $0 a minute
 * (infra/vn-node/classroom-speech — server.py says why those models and what they measured).
 *
 *   transcribe()   one learner turn (16 kHz mono WAV) → their words, as heard (grammar kept: no Whisper-style tidying)
 *   synthesize()   one reply in an allowlisted voice (voices.ts) → MP3, 24 kHz mono (~7 KB a second) — the format
 *                  Azure's TTS gave, so the page decodes it exactly as before
 *
 * ⛔ NO HOSTED FALLBACK (plan review 2026-10-26, codex + opus): falling back to Azure when this server fails would send a
 * child's free-talk audio to Singapore without anyone choosing that, and change the avatar's voice in mid-session. A
 * failure is "try again" (the turn answers 503 speech_unavailable); Azure is asked only to score drills (azure-speech.ts).
 * ⛔ The audio and the words are never logged; an error carries the status and the stage, nothing else.
 */
export type LocalSpeechConfig = { url: string; key: string }

/**
 * Where the server may be: ON eno's own network — the container itself (`eno-classroom-speech`, exactly: any other single
 * name could fall through to the host's resolver and its search domain), loopback, or a private address (10/8,
 * 172.16/12, 192.168/16, and 100.64/10 for a tunnel to a second box). ⛔ Never a public host: learner audio and the key
 * travel in plain HTTP. Checked on the host the URL parser CANONICALISES — "134744072" and "0x8.8.8.8" are both
 * 8.8.8.8 to fetch(), so they must be to this check too (codex + opus, commit reviews).
 */
const INTERNAL_HOST = /^(?:eno-classroom-speech|localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})$/

/** CLASSROOM_SPEECH_URL (http://eno-classroom-speech:8090 on the box) and CLASSROOM_SPEECH_KEY (the server's SPEECH_KEY).
 *  Either missing, or not an internal origin with nothing after it → null, and the classroom answers speech_unavailable. */
export function localSpeechConfig(): LocalSpeechConfig | null {
  const raw = process.env.CLASSROOM_SPEECH_URL?.trim()
  const key = process.env.CLASSROOM_SPEECH_KEY?.trim()
  if (!raw || !key || key.length < 24) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return refused(raw, 'unparsable', '')
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return refused(raw, 'not an origin', u.hostname)
  if (!INTERNAL_HOST.test(u.hostname)) return refused(raw, 'not internal', u.hostname)
  return { url: `${u.protocol}//${u.host}`, key }
}

/** A set but refused address answers like an unset one — so it says why, once per value, in the log (opus, commit
 *  review: both editions answering speech_unavailable with nothing in the log). The host only; the key is never near it. */
let refusedUrl = ''
function refused(raw: string, why: string, host: string): null {
  if (refusedUrl !== raw) {
    refusedUrl = raw
    logWarn('[classroom] CLASSROOM_SPEECH_URL ignored — speech is off', { why, host: host.slice(0, 80) })
  }
  return null
}

export type Heard = { text: string; status: 'ok' | 'silence' }

/**
 * Each stage's WHOLE budget, its retry included (codex + opus, commit review: a fresh timeout per attempt let one stage
 * run ~30 s). A 45 s turn takes ~5-8 s on the box's CPU, a 5 s one ~1 s; a reply's voice ~1-3 s. Both stages together,
 * with Gemini's own deadline, stay under the turn route's 40 s. The server stops reading a reply at 12 s by itself.
 */
export const STT_BUDGET_MS = 12_000
export const TTS_BUDGET_MS = 10_000
/** The server answers 503 at once when it is full rather than queueing: one short wait, one retry, then "try again" —
 *  and the retry only when this much of the budget is still left. */
const BUSY_RETRY_MS = 400
const RETRY_MIN_LEFT_MS = 3_000

async function call(cfg: LocalSpeechConfig, path: '/stt' | '/tts', init: { headers: Record<string, string>; body: BodyInit }, budgetMs: number, stage: 'stt' | 'tts', fetchImpl: typeof fetch): Promise<{ res: Response; signal: AbortSignal }> {
  const deadline = Date.now() + budgetMs
  for (let attempt = 0; ; attempt++) {
    // One signal per attempt, ending at the stage's deadline — it also bounds reading the answer's body.
    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()))
    let res: Response
    try {
      // redirect 'error': the address was checked to be internal; a redirect could carry the audio and the key elsewhere
      // (codex, round 2).
      res = await fetchImpl(`${cfg.url}${path}`, { method: 'POST', headers: { ...init.headers, 'x-speech-key': cfg.key }, body: init.body, signal, redirect: 'error' })
    } catch {
      throw new SpeechError(502, stage) // unreachable, refused, or out of time
    }
    if (res.ok) return { res, signal }
    await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.speech.cancel' }))
    if (res.status === 503 && attempt === 0 && deadline - Date.now() - BUSY_RETRY_MS >= RETRY_MIN_LEFT_MS) {
      await new Promise((r) => setTimeout(r, BUSY_RETRY_MS))
      continue
    }
    throw new SpeechError(res.status, stage)
  }
}

/** Speech-to-text of one learner turn. 'silence' when nothing was said (the page asks them to try again). */
export async function transcribe(cfg: LocalSpeechConfig, wav: Buffer, fetchImpl: typeof fetch = fetch): Promise<Heard> {
  const { res } = await call(cfg, '/stt', { headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(wav) }, STT_BUDGET_MS, 'stt', fetchImpl)
  const body = (await res.json().catch(() => null)) as { text?: unknown; status?: unknown } | null
  if (!body || typeof body.text !== 'string' || (body.status !== 'ok' && body.status !== 'silence')) throw new SpeechError(502, 'stt')
  const text = body.text.trim()
  return body.status === 'ok' && text ? { text, status: 'ok' } : { text: '', status: 'silence' }
}

/** The server refuses a line over this (server.py MAX_TEXT_CHARS). The app's lines stay well under it; a longer one is
 *  cut at its last full sentence — spoken short beats not spoken at all (opus, commit review). */
export const MAX_SPOKEN_CHARS = 600

/** A sentence's end: . ! ? or …, any closing quotes or brackets, then a space, a line break or the end. */
const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s|$)/g

export function spokenPart(text: string): string {
  if (text.length <= MAX_SPOKEN_CHARS) return text
  // One character past the cap, so a sentence ending exactly AT the cap is seen to end (codex, commit review).
  const head = text.slice(0, MAX_SPOKEN_CHARS + 1)
  let cut = 0
  for (const m of head.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length
    if (end <= MAX_SPOKEN_CHARS) cut = end
  }
  if (!cut) {
    // No whole sentence fits: end on a word, never inside one.
    const lastSpace = head.slice(0, MAX_SPOKEN_CHARS).search(/\s\S*$/)
    cut = lastSpace > 0 ? lastSpace : MAX_SPOKEN_CHARS
  }
  // Never half an emoji: a lone surrogate would reach the server as invalid JSON text.
  const out = /[\uD800-\uDBFF]$/.test(text.slice(0, cut)) ? text.slice(0, cut - 1) : text.slice(0, cut)
  return out.trimEnd()
}

/** One line in `voice` (an id from voices.ts — the server refuses any other) → MP3 bytes. */
export async function synthesize(cfg: LocalSpeechConfig, text: string, voice: string, rate: 'slow' | 'natural', fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const { res } = await call(cfg, '/tts', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: spokenPart(text), voice, rate }) }, TTS_BUDGET_MS, 'tts', fetchImpl)
  if (!(res.headers.get('content-type') ?? '').startsWith('audio/mpeg')) throw new SpeechError(502, 'tts')
  const bytes = Buffer.from(await res.arrayBuffer().catch(() => { throw new SpeechError(502, 'tts') }))
  if (bytes.length < 200) throw new SpeechError(502, 'tts')
  return bytes
}
