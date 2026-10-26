'use client'

import { mark } from './trace'

/**
 * LIVE LISTENING (owner, 2026-10-26: "its too slow no feel like live speech … make it instant conversation"). Measured on
 * the owner's own session, a turn waited 1.2 s of silence, then for the whole clip to be uploaded and transcribed (0.5 s
 * for 4 s of speech, 5.5 s for 45 s). Here the learner's speech streams to Soniox WHILE they say it and comes back as words;
 * Soniox ends the utterance on meaning, pauses and intonation (its `<end>` token), so the words exist ~0.5 s after the
 * learner stops — and the page sends the TEXT as the turn (src/lib/classroom/soniox.ts says why Soniox).
 *
 * Our own voice detector (recorder-worklet.js) still decides when the learner STARTS: audio flows only from a speech-start
 * (with its pre-roll) until the page has the utterance's words — the room is not streamed between turns, and Soniox bills
 * only what it hears. Between utterances a keepalive holds the socket (Soniox closes it after 20 s of nothing).
 *
 * One socket for the session, opened with a single-use key the server mints after the same checks as a turn
 * (api/classroom/sessions/<id>/stt-token), re-checked every minute while it is open (a withdrawal, the switch). Any
 * failure → `failed()`, and the page listens the old way for the rest of the session (the clip, sent whole to eno's own
 * speech server). ⛔ Nothing is stored; the words are never logged.
 *
 * ⛔ EVERY WORD BELONGS TO ITS OWN UTTERANCE (2026-10-26 review, codex): an utterance the page gave up on (muted, or sent as
 * a clip when its words were late) still gets its words and its end marker from Soniox, later. Words are matched to the
 * current utterance by their place on the stream's audio clock (only audio from inside utterances is sent, so the clock
 * is the sum of what was sent), and an abandoned utterance's own end marker is consumed without ending the current one.
 */
export type LiveStt = {
  /** The learner started speaking: a new utterance — the audio that follows belongs to it. */
  begin(): void
  /** 16 kHz mono PCM16 of the current utterance. Ignored outside one. */
  push(pcm: Int16Array): void
  /** The page has the utterance's words (or gave up on it): no more audio until the next begin(). */
  pause(): void
  /** The detector heard the learner stop and Soniox has not ended the utterance yet: make it end now. */
  finalize(): void
  /** Abandon the current utterance (muted mid-sentence, or sent as a clip): whatever Soniox returns for it is dropped. */
  cancel(): void
  close(): void
  /** Soniox ends an utterance at most this long after the speech stops (its max_endpoint_delay_ms). */
  maxDelayMs: number
}

type Token = { text?: string; is_final?: boolean; start_ms?: number; end_ms?: number }
type Message = { tokens?: Token[]; finished?: boolean; error_code?: number; error_type?: string }
type Grant = { apiKey: string; url: string; model: string; settings: Record<string, number>; languageHints: string[] }

/** Soniox's markers: the end of an utterance (endpoint detection) and the end of a requested finalization. */
const END = '<end>'
const FIN = '<fin>'
/** Soniox ends a socket that hears nothing for 20 s; a keepalive this often holds it between utterances. */
const KEEPALIVE_MS = 8_000
/** While the socket is open, the server re-checks the session this often (a withdrawal or the switch closes it). */
const RECHECK_MS = 60_000

export async function openLiveStt(sessionId: string, on: {
  /** One utterance's words, as Soniox finalized them, and its length in ms (from its first word to its last). */
  utterance: (text: string, speechMs: number) => void
  /** The socket could not open, broke, or the session may no longer be heard: the page goes back to sending clips. */
  failed: () => void
}): Promise<LiveStt | null> {
  const r = await fetch(`/api/classroom/sessions/${sessionId}/stt-token`, { method: 'POST' }).catch(() => null)
  if (!r?.ok) { mark('live listening: no key', String(r?.status ?? 'network')); return null }
  const grant = (await r.json().catch(() => null)) as Grant | null
  if (!grant?.apiKey || !grant.url) return null
  let ws: WebSocket
  try {
    ws = new WebSocket(grant.url, ['soniox-api-key', grant.apiKey])
  } catch {
    return null
  }
  ws.binaryType = 'arraybuffer'
  const opened = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8_000)
    ws.onopen = () => { clearTimeout(t); resolve(true) }
    ws.onerror = () => { clearTimeout(t); resolve(false) }
  })
  if (!opened) { try { ws.close() } catch { /* closed */ } mark('live listening: socket failed'); return null }
  ws.send(JSON.stringify({
    model: grant.model,
    audio_format: 'pcm_s16le',
    sample_rate: 16_000,
    num_channels: 1,
    language_hints: grant.languageHints,
    enable_endpoint_detection: true,
    ...grant.settings,
  }))
  mark('live listening: on')

  /** Audio is flowing for an utterance (begin → pause). */
  let streaming = false
  /** The stream's audio clock: ms of audio sent so far — and where the current utterance began on it. */
  let sentMs = 0
  let utterStartMs = 0
  /** Finalizations asked for and their `<fin>` markers seen; every `<fin>` up to `abandonedUpTo` ends an utterance the page
   *  gave up on, and is consumed silently. */
  let finSent = 0
  let finSeen = 0
  let abandonedUpTo = 0
  /** The current utterance's final words so far. */
  let finals = ''
  let firstMs: number | null = null
  let lastMs = 0
  let closed = false
  const timers: ReturnType<typeof setInterval>[] = []
  timers.push(setInterval(() => {
    if (!streaming && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'keepalive' }))
  }, KEEPALIVE_MS))
  timers.push(setInterval(() => {
    void fetch(`/api/classroom/sessions/${sessionId}/stt-token`, { method: 'GET' }).then((res) => {
      if (!res.ok && res.status !== 429) { mark('live listening: no longer allowed', String(res.status)); shutDown(true) }
    }).catch(() => { /* a network blip is not a refusal */ })
  }, RECHECK_MS))

  const reset = () => { finals = ''; firstMs = null; lastMs = 0 }
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data !== 'string') return
    let m: Message
    try { m = JSON.parse(e.data) as Message } catch { return }
    if (m.error_code) { mark('live listening: error', `${m.error_code} ${m.error_type ?? ''}`); shutDown(true); return }
    for (const t of m.tokens ?? []) {
      if (!t.is_final || typeof t.text !== 'string') continue
      if (t.text === END || t.text === FIN) {
        // An abandoned utterance's marker: its words were dropped already; the current utterance goes on. (An `<end>` carries
        // no count: one that arrives for an abandoned utterance ends nothing — its current words are empty, see below.)
        if (t.text === FIN && ++finSeen <= abandonedUpTo) continue
        const text = finals.trim()
        const ms = firstMs === null ? 0 : Math.max(0, lastMs - firstMs)
        reset()
        // An empty END (a cough, a breath) is no utterance: the learner may still be speaking — keep listening. An empty
        // FIN answers the page's own finalize: it learns that nothing more was heard.
        if (text || t.text === FIN) on.utterance(text, ms)
        continue
      }
      // A word from before this utterance began on the audio clock belongs to one the page gave up on.
      if (typeof t.start_ms === 'number' && t.start_ms < utterStartMs - 20) continue
      finals += t.text
      if (typeof t.start_ms === 'number' && firstMs === null) firstMs = t.start_ms
      if (typeof t.end_ms === 'number') lastMs = t.end_ms
    }
  }
  const shutDown = (broke: boolean) => {
    if (closed) return
    closed = true
    for (const t of timers) clearInterval(t)
    try { ws.close() } catch { /* closed */ }
    if (broke) on.failed()
  }
  ws.onclose = () => { if (!closed) { mark('live listening: socket closed'); shutDown(true) } }
  ws.onerror = () => { if (!closed) shutDown(true) }

  return {
    begin() {
      if (closed) return
      streaming = true
      utterStartMs = sentMs
      reset()
    },
    push(pcm) {
      if (closed || !streaming || ws.readyState !== WebSocket.OPEN || !pcm.length) return
      ws.send(pcm.buffer.byteLength === pcm.byteLength ? pcm.buffer : pcm.slice().buffer)
      sentMs += pcm.length / 16
    },
    pause() {
      streaming = false
    },
    finalize() {
      if (closed || ws.readyState !== WebSocket.OPEN) return
      finSent += 1
      ws.send(JSON.stringify({ type: 'finalize' }))
    },
    cancel() {
      if (closed) return
      streaming = false
      reset()
      if (ws.readyState !== WebSocket.OPEN) return
      // Every `<fin>` owed so far — this finalize's and any asked for earlier — ends the abandoned utterance; its words are
      // dropped by the audio clock.
      finSent += 1
      abandonedUpTo = finSent
      ws.send(JSON.stringify({ type: 'finalize' }))
      utterStartMs = sentMs
    },
    close() {
      if (closed) return
      try { if (ws.readyState === WebSocket.OPEN) ws.send('') } catch { /* closing */ }
      shutDown(false)
    },
    maxDelayMs: typeof grant.settings.max_endpoint_delay_ms === 'number' ? grant.settings.max_endpoint_delay_ms : 2_000,
  }
}

/**
 * A FILLER, NOT A TURN (review round 2, opus): Soniox may end an utterance on "Um" while the learner is still finding the
 * next word — only words like these are held for what follows; "Yes." or "I'm fine" are answers, sent at once.
 */
const FILLER_WORD = /^(?:u+[hm]+|e+r+m*|e+h+|h+m+|a+h+|o+h+|m{2,}|so|well|and|but|like|because|ừ+m+|ờ+|ơ+|à+|thì|mà|kiểu)$/i
export function isFiller(text: string): boolean {
  // Vietnamese hesitations too ("ờ", "ừm", "à", "thì" — review, opus: the learners are Vietnamese); "so-so" stays one word.
  const words = text.toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 2 && words.every((w) => FILLER_WORD.test(w))
}
