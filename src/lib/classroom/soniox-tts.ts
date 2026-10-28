import 'server-only'
import { logWarn } from '@/lib/log'
import { SpeechError } from './azure-speech'
import { sonioxConfig, type SonioxConfig } from './soniox'
import { spokenPart } from './speech-local'
import type { VoicePace, VoiceStyle } from './pace'
import { encodeWav } from './wav'

/**
 * THE AVATAR'S VOICE — Soniox text-to-speech (owner, 2026-10-27: "replace to soniox tts" — "5 voice we have to replace with
 * cheapest best fastest api remove from box"). Picked 2026-10-27 by a research workflow checked against vendor pages:
 * tts-rt-v2, $0.70 per hour of audio, the same vendor, account and region as the classroom's ears (soniox.ts); Soniox says
 * the audio is never stored and never used for training.
 *
 * ONE WebSocket per server process, kept warm while sessions talk (a cold one adds its TLS round trips to a reply's first
 * sentence), the account key in the protocols list (['soniox-api-key', key] — Node's WebSocket sends no headers). Each line
 * is its own STREAM on it (`stream_id`; Soniox allows 5 at once on a socket):
 *   → {stream_id, model, language, voice, audio_format, sample_rate, speed}  then  {stream_id, text, text_end: true}
 *   ← {stream_id, audio: <base64>} … {stream_id, audio_end: true} … {stream_id, terminated: true}
 *   ← {stream_id, error_code, error_message}: that stream ends; the socket and the other streams go on.
 * A socket silent for 40 s is closed by Soniox: {keep_alive: true} every KEEPALIVE_MS while it is open; closed by us after
 * IDLE_CLOSE_MS without a stream. ⛔ The words are never logged; an error carries its code only.
 */

/** The voice's whole wait for its FIRST sound (the turn route's own deadline is 40 s). */
export const TTS_BUDGET_MS = 10_000
/** Within a line, the longest wait for its next chunk (Soniox makes audio faster than real time). */
export const TTS_STALL_MS = 4_000
/** PCM for the face and the speakers: the rate the page plays at (voice.ts — the face resamples to its own). */
export const TTS_RATE = 24_000
const OPEN_MS = 5_000
const KEEPALIVE_MS = 20_000
const IDLE_CLOSE_MS = 5 * 60_000
/** Soniox takes at most 5 streams on one socket; a sixth line opens another socket (review, codex + opus). */
const STREAMS_PER_SOCKET = 5
const MAX_SOCKETS = 4

/** Soniox's `speed` (0.7–1.3) for each of the learner's paces (pace.ts) — Phonon's steps, measured 2026-10-27. */
export const SPEED: Readonly<Record<VoicePace, number>> = { slowest: 0.82, gentle: 0.91, natural: 1, quick: 1.12 }

/** A child's voice, louder (pace.ts `loud`): +6 dB, with a soft knee above LOUD_KNEE so a peak bends instead of clipping. */
const LOUD_GAIN = 2
const LOUD_KNEE = 22_000

type Stream = { push: (bytes: Uint8Array) => void; end: () => void; fail: (e: SpeechError) => void }
/** A stream on a socket. `settled`: over for us (ended, failed, cancelled) but still Soniox's until its `terminated` —
 *  counted against the socket's five until then (review, opus), or REAP_MS at most. */
type Slot = { stream: Stream; settled: boolean; reap?: ReturnType<typeof setTimeout> }
const REAP_MS = 15_000

class Link {
  private ws: WebSocket | null = null
  private opening: Promise<WebSocket> | null = null
  private readonly streams = new Map<string, Slot>()
  private keepalive: ReturnType<typeof setInterval> | null = null
  private lastUsed = Date.now()
  constructor(readonly url: string, readonly key: string) {}

  get active(): number { return this.streams.size }

  private socket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws)
    if (this.opening) return this.opening
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(this.url, ['soniox-api-key', this.key])
      } catch {
        reject(new SpeechError(502, 'tts'))
        return
      }
      const t = setTimeout(() => { try { ws.close() } catch { /* closed */ } reject(new SpeechError(504, 'tts')) }, OPEN_MS)
      ws.onopen = () => {
        clearTimeout(t)
        this.ws = ws
        this.keepalive = setInterval(() => this.tick(), KEEPALIVE_MS)
        resolve(ws)
      }
      ws.onerror = () => { clearTimeout(t); reject(new SpeechError(502, 'tts')) }
      // Closed before it ever opened: the open fails — never a promise every later line waits on (review, codex).
      ws.onclose = () => { clearTimeout(t); reject(new SpeechError(502, 'tts')); this.drop(ws) }
      ws.onmessage = (e) => this.message(e.data)
    }).finally(() => { this.opening = null })
    return this.opening
  }

  /** The socket closed or broke: every stream on it still running has failed. */
  private drop(ws: WebSocket) {
    if (this.ws !== ws) return
    this.ws = null
    if (this.keepalive) { clearInterval(this.keepalive); this.keepalive = null }
    for (const slot of this.streams.values()) {
      if (slot.reap) clearTimeout(slot.reap)
      if (!slot.settled) slot.stream.fail(new SpeechError(502, 'tts'))
    }
    this.streams.clear()
  }

  /** Over for us; still counted until Soniox's `terminated` (or REAP_MS). */
  private settle(id: string) {
    const slot = this.streams.get(id)
    if (!slot || slot.settled) return
    slot.settled = true
    slot.reap = setTimeout(() => this.streams.delete(id), REAP_MS)
  }
  private release(id: string) {
    const slot = this.streams.get(id)
    if (slot?.reap) clearTimeout(slot.reap)
    this.streams.delete(id)
  }

  private tick() {
    const ws = this.ws
    if (!ws) return
    // Nothing spoken for a while: let the socket go (it counts against Soniox's connection limit even when idle).
    if (!this.streams.size && Date.now() - this.lastUsed > IDLE_CLOSE_MS) { try { ws.close() } catch { /* closed */ } this.drop(ws); return }
    try { ws.send(JSON.stringify({ keep_alive: true })) } catch { /* the close handler fails the streams */ }
  }

  private message(data: unknown) {
    let m: { stream_id?: unknown; audio?: unknown; audio_end?: unknown; terminated?: unknown; error_code?: unknown }
    try { m = JSON.parse(String(data)) } catch { return }
    const id = typeof m.stream_id === 'string' ? m.stream_id : ''
    const slot = this.streams.get(id)
    if (!slot) return
    if (m.terminated === true) {
      const was = slot.settled
      this.release(id)
      if (!was) slot.stream.end()
      return
    }
    if (slot.settled) return // cancelled or ended for us: nothing more is delivered
    if (m.error_code !== undefined) {
      this.settle(id) // Soniox follows an error with `terminated`
      const code = typeof m.error_code === 'number' ? m.error_code : 502
      logWarn('[classroom] soniox voice refused a line', { code: String(m.error_code).slice(0, 40) })
      slot.stream.fail(new SpeechError(code >= 400 && code < 600 ? code : 502, 'tts'))
      return
    }
    if (typeof m.audio === 'string' && m.audio) slot.stream.push(new Uint8Array(Buffer.from(m.audio, 'base64')))
    if (m.audio_end === true) { this.settle(id); slot.stream.end() }
  }

  /** One line as its own stream; `stop()` cancels it at Soniox (the learner talked over the avatar). */
  async speak(id: string, config: Record<string, unknown>, text: string, stream: Stream, signal?: AbortSignal): Promise<() => void> {
    // Counted AT ONCE, before the socket opens: lines asked for together see each other in the pool (linkFor).
    this.streams.set(id, { stream, settled: false })
    let ws: WebSocket
    try {
      ws = await this.socket()
    } catch (e) {
      this.release(id)
      throw e
    }
    if (!this.streams.has(id)) throw new SpeechError(502, 'tts') // the socket died while it opened
    // Talked over (or given up on) while the socket opened (review, codex): the words are never sent.
    if (signal?.aborted) { this.release(id); throw new SpeechError(499, 'tts') }
    this.lastUsed = Date.now()
    try {
      ws.send(JSON.stringify({ stream_id: id, ...config }))
      ws.send(JSON.stringify({ stream_id: id, text, text_end: true }))
    } catch {
      this.release(id)
      throw new SpeechError(502, 'tts')
    }
    return () => {
      const slot = this.streams.get(id)
      if (!slot || slot.settled) return
      this.settle(id)
      try { ws.send(JSON.stringify({ stream_id: id, cancel: true })) } catch { /* closed */ }
    }
  }
}

let links: Link[] = []
let seq = 0
/** A socket with room for one more stream: the first that has it, else a new one (up to MAX_SOCKETS), else a 429.
 *  A new key or region (a redeploy's env) starts a pool of its own; the old sockets close themselves once idle (tick). */
function linkFor(cfg: SonioxConfig): Link {
  links = links.filter((l) => l.url === cfg.tts && l.key === cfg.key)
  const free = links.find((l) => l.active < STREAMS_PER_SOCKET)
  if (free) return free
  if (links.length < MAX_SOCKETS) { const l = new Link(cfg.tts, cfg.key); links.push(l); return l }
  // Every socket full (review, codex): this line is refused here — the box says it — never a sixth stream on a socket.
  throw new SpeechError(429, 'tts')
}

/** A child's louder voice, in place: PCM16 LE samples times LOUD_GAIN, bent smoothly above LOUD_KNEE. */
export function louder(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  const src = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dst = new DataView(out.buffer)
  const room = 32_767 - LOUD_KNEE
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const v = src.getInt16(i, true) * LOUD_GAIN
    const a = Math.abs(v)
    const bent = a <= LOUD_KNEE ? a : LOUD_KNEE + room * Math.tanh((a - LOUD_KNEE) / room)
    dst.setInt16(i, Math.round(Math.sign(v) * Math.min(32_767, bent)), true)
  }
  return out
}

/**
 * One line in `voice`, STREAMED: raw PCM16 (mono, LE, TTS_RATE Hz) as Soniox makes it. Resolves once the FIRST sound is in
 * (within TTS_BUDGET_MS) — a voice that cannot start throws here, as the old speech server's did, so the turn says
 * "audio-failed" at once; later chunks within TTS_STALL_MS each, or the line ends there with a 504. `signal` stops it.
 */
export async function sonioxSpeakStream(text: string, voice: string, style: VoiceStyle, signal?: AbortSignal, firstSoundMs = TTS_BUDGET_MS): Promise<{ rate: number; chunks: AsyncGenerator<Uint8Array>; pauseMs: number }> {
  const cfg = sonioxConfig()
  if (!cfg) throw new SpeechError(503, 'tts')
  const queue: Uint8Array[] = []
  let done = false
  let failure: SpeechError | null = null
  let wake: (() => void) | null = null
  const nudge = () => { const w = wake; wake = null; w?.() }
  const id = `l${++seq}`
  if (signal?.aborted) throw new SpeechError(499, 'tts')
  // ONE clock from the ask (review, opus): the socket's opening counts against the first sound, so the box can take the
  // line on time even when the socket is slow.
  const deadline = Date.now() + firstSoundMs
  // Given up on (no socket in time): the words must never go out after the box has taken the line (review, codex + opus).
  const giveUp = new AbortController()
  const speaking = linkFor(cfg).speak(id, lineConfig(cfg, voice, style, 'pcm_s16le'), spokenPart(text), {
    push: (b) => { queue.push(b); nudge() },
    end: () => { done = true; nudge() },
    fail: (e) => { failure = e; done = true; nudge() },
  }, signal ? AbortSignal.any([signal, giveUp.signal]) : giveUp.signal)
  let lateTimer: ReturnType<typeof setTimeout> | undefined
  let talkedOver = false
  let onTalkOver: (() => void) | undefined
  const started = await Promise.race([
    speaking,
    new Promise<null>((r) => { lateTimer = setTimeout(() => r(null), firstSoundMs) }),
    // Talked over while the socket is stalled (review, codex): the caller is answered at once, not when the socket decides.
    new Promise<null>((r) => { onTalkOver = () => { talkedOver = true; r(null) }; signal?.addEventListener('abort', onTalkOver, { once: true }) }),
  ]).finally(() => {
    clearTimeout(lateTimer)
    if (onTalkOver) signal?.removeEventListener('abort', onTalkOver) // no listener left per sentence (review, codex)
  })
  if (!started && talkedOver) {
    giveUp.abort()
    speaking.then((s) => s(), (e) => { if ((e as { status?: number }).status !== 499) logWarn('[classroom] a talked-over soniox line failed to open', { status: (e as { status?: number }).status ?? null }) })
    throw new SpeechError(499, 'tts')
  }
  if (!started) {
    // The socket did not even open in time: the line is the box's — given up here, so speak() sends nothing when the socket
    // does open (and a stream that slipped through is cancelled).
    giveUp.abort()
    speaking.then((s) => s(), (e) => { if ((e as { status?: number }).status !== 499) logWarn('[classroom] a late soniox line failed to open', { status: (e as { status?: number }).status ?? null }) })
    throw new SpeechError(504, 'tts')
  }
  const stop: () => void = started
  // Talked over while the socket was opening (review, codex): cancelled at Soniox, never spoken.
  if (signal?.aborted) { stop(); throw new SpeechError(499, 'tts') }
  // A talk-over drops what already arrived too (review, codex): nothing queued plays after it.
  const onAbort = () => { stop(); queue.length = 0; done = true; nudge() }
  signal?.addEventListener('abort', onAbort, { once: true })
  /** The next chunk within `ms`, or null at the end; throws the line's failure. */
  const next = async (ms: number): Promise<Uint8Array | null> => {
    if (!queue.length && !done) {
      const timedOut = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => { wake = null; resolve(true) }, ms)
        wake = () => { clearTimeout(t); resolve(false) }
      })
      if (timedOut && !queue.length && !done) { stop(); throw new SpeechError(504, 'tts') }
    }
    if (queue.length) return queue.shift()!
    if (failure && !signal?.aborted) throw failure
    return null
  }
  let first: Uint8Array | null
  try {
    first = await next(Math.max(1, deadline - Date.now()))
  } catch (e) {
    signal?.removeEventListener('abort', onAbort)
    throw e
  }
  if (!first && !signal?.aborted) { signal?.removeEventListener('abort', onAbort); throw new SpeechError(502, 'tts') }
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      // PCM16 is whole 2-byte samples: a chunk cut mid-sample keeps its odd byte for the next one.
      let carry: Uint8Array | null = null
      for (let c = first; c; c = await next(TTS_STALL_MS)) {
        // Talked over before this chunk was taken — the first one included (review, codex): nothing more plays.
        if (signal?.aborted) return
        let bytes: Uint8Array = carry ? concat(carry, c) : c
        carry = null
        if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.slice(0, -1) }
        // Louder on WHOLE samples only — a chunk cut mid-sample is joined first (review, codex).
        if (bytes.length) yield style.loud ? louder(bytes) : bytes
      }
    } finally {
      stop()
      signal?.removeEventListener('abort', onAbort)
    }
  }
  return { rate: TTS_RATE, chunks: chunks(), pauseMs: style.pauseMs }
}

/**
 * One line in `voice`, WHOLE — the session's opening line and the wizard's voice samples (the page decodes it). MP3; a
 * child's louder voice (`style.loud`) comes as WAV instead — 16 kHz PCM made louder here, as the streamed replies are
 * (review, codex + opus: an MP3 cannot be made louder without decoding it).
 */
export async function sonioxSpeakLine(text: string, voice: string, style: VoiceStyle, budgetMs = TTS_BUDGET_MS): Promise<Buffer> {
  const cfg = sonioxConfig()
  if (!cfg) throw new SpeechError(503, 'tts')
  const parts: Uint8Array[] = []
  let cancel: (() => void) | null = null
  const format = style.loud ? 'pcm_s16le' : 'mp3'
  const giveUp = new AbortController()
  await new Promise<void>((resolve, reject) => {
    // Out of time — even before the socket opened: never sent then (giveUp), cancelled if it was (review, opus).
    const t = setTimeout(() => { giveUp.abort(); cancel?.(); reject(new SpeechError(504, 'tts')) }, budgetMs)
    let link: Link
    try { link = linkFor(cfg) } catch (e) { clearTimeout(t); reject(e); return }
    link.speak(`l${++seq}`, lineConfig(cfg, voice, style, format, format === 'pcm_s16le' ? LOUD_LINE_RATE : undefined), spokenPart(text), {
      push: (b) => { parts.push(b) },
      end: () => { clearTimeout(t); resolve() },
      fail: (e) => { clearTimeout(t); reject(e) },
    }, giveUp.signal).then((stop) => { cancel = stop }, (e: unknown) => { clearTimeout(t); reject(e) })
  })
  const bytes = Buffer.concat(parts)
  if (bytes.length < 200) throw new SpeechError(502, 'tts')
  if (format === 'mp3') return bytes
  const whole = bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes
  const pcm = louder(new Uint8Array(whole.buffer, whole.byteOffset, whole.byteLength))
  return Buffer.from(encodeWav(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), LOUD_LINE_RATE))
}
/** A child's whole line, as WAV: 16 kHz is plenty for a voice and keeps the start's answer small (~32 KB a second). */
const LOUD_LINE_RATE = 16_000

function lineConfig(cfg: SonioxConfig, voice: string, style: VoiceStyle, format: 'pcm_s16le' | 'mp3', rate = TTS_RATE): Record<string, unknown> {
  return {
    model: cfg.ttsModel,
    language: style.language ?? 'en',
    voice,
    audio_format: format,
    ...(format === 'pcm_s16le' ? { sample_rate: rate } : {}),
    speed: SPEED[style.pace],
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
