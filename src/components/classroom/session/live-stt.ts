'use client'

import { mark } from './trace'

/**
 * LIVE LISTENING (owner, 2026-10-26: "its too slow no feel like live speech … make it instant conversation"). Measured on
 * the owner's own session, a turn waited 1.2 s of silence, then for the whole clip to be uploaded and transcribed (0.5 s
 * for 4 s of speech, 5.5 s for 45 s). Here the learner's speech streams to Soniox WHILE they say it and comes back as words;
 * Soniox ends the utterance on meaning, pauses and intonation (its `<end>` token), so the words exist ~0.5 s after the
 * learner stops — and the page sends the TEXT as the turn (src/lib/classroom/soniox.ts says why Soniox).
 *
 * ⛔ SONIOX DECIDES (owner, 2026-10-27, after "it cant hear me nor transcribe what i say": "dont alter with code let the stt
 * decide itself"). While the page listens, EVERY frame streams here — no detector of ours in between (ours kept soft
 * voices out: its noise floor rose with a fan or the avatar's echo) — and Soniox's own `<end>` is the end of the turn.
 * Gating saved nothing anyway: Soniox bills "the full stream duration, not just the audio processed". Its in-progress
 * words (`activity`) say when the learner is speaking. A keepalive holds the socket whenever no audio has gone for a while
 * (Soniox closes it after 20 s of nothing), and a socket that takes audio but answers nothing is a broken one: Soniox
 * answers about once a second even in silence (measured 2026-10-27), so STALL_MS without a message ends it.
 *
 * One socket for the session, opened with a single-use key the server mints after the same checks as a turn
 * (api/classroom/sessions/<id>/stt-token), re-checked every minute while it is open (a withdrawal, the switch). Any
 * failure → `failed()`, and the page opens it again (session-screen.tsx retryLive) — there is no other way to hear the
 * learner (Soniox only, owner 2026-10-27). ⛔ Nothing is stored; the words are never logged.
 *
 * ⛔ EVERY WORD BELONGS TO ITS OWN UTTERANCE (2026-10-26 review, codex): an utterance the page gave up on (muted, or sent as
 * dropped when its words were late) still gets its words and its end marker from Soniox, later. Words are matched to the
 * current utterance by their place on the stream's audio clock (only audio from inside utterances is sent, so the clock
 * is the sum of what was sent), and an abandoned utterance's own end marker is consumed without ending the current one.
 */
export type LiveStt = {
  /** The page listens from here: a new utterance — the audio that follows belongs to it. */
  begin(): void
  /** 16 kHz mono PCM16 of the current utterance. Ignored outside one. */
  push(pcm: Int16Array): void
  /** The page has the utterance's words (or gave up on it): no more audio until the next begin(). */
  pause(): void
  /** Make Soniox end the utterance now (the page's 45 s cap on one turn). */
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
/** Soniox ends a socket that hears nothing for 20 s: a keepalive goes whenever no audio has gone for this long. */
const KEEPALIVE_MS = 8_000
/** Audio is going out but Soniox has said nothing for this long: the socket is stuck — the page opens another. */
const STALL_MS = 6_000
/** The longest the key request may take before this try counts as failed. */
const KEY_WAIT_MS = 10_000
/** The key route's refusals that no retry can change (stt-grant.ts) — every other failure may pass. */
const FINAL_REFUSALS: ReadonlySet<string> = new Set(['session_over', 'session_not_found', 'classroom_closed', 'consent_required', 'seat_inactive', 'stt_keys_spent'])
/** While the socket is open, the server re-checks the session this often (a withdrawal or the switch closes it). */
const RECHECK_MS = 60_000

/**
 * Where the socket's key comes from: a classroom session's id (its own stt-token route) — or the voice concierge's routes
 * (src/components/concierge), as two requests: the key, and the minute-by-minute "may this still be heard?".
 */
export type SttSource = string | { grant: (signal: AbortSignal) => Promise<Response>; check: () => Promise<Response> }

export async function openLiveStt(source: SttSource, on: {
  /** One utterance's words, as Soniox finalized them, and its length in ms (from its first word to its last). */
  utterance: (text: string, speechMs: number) => void
  /** The socket broke, or the session may no longer be heard: the page waits, and opens it again (Soniox only). */
  failed: () => void
  /**
   * Soniox's latest answer in this utterance holds words (final or still in progress) — the learner is speaking — or none
   * (a noise it took back). Called on every answer; the page shows "Hearing you" from it.
   */
  activity?: (speaking: boolean) => void
}): Promise<LiveStt | 'refused' | null> {
  const checkReq = typeof source === 'string' ? () => fetch(`/api/classroom/sessions/${source}/stt-token`, { method: 'GET' }) : source.check
  // Only the server's own FINAL refusals end the tries (FINAL_REFUSALS: the session is over, the switch is off, consent
  // withdrawn, no keys left); anything else — Soniox down, the network, a passing 401 or rate limit, a proxy's 403/404
  // during a deploy (review, codex + opus) — may pass: the page tries again a few times.
  // ⛔ Bounded (review, codex): a request stuck on a dead network would hold off every retry and the screen's end. An
  // AbortController and a timer — AbortSignal.timeout() is missing before iOS 16 (review, codex + opus).
  // The timer covers the body too (review, codex): headers that arrive and a body that never does is the same dead network.
  const abort = new AbortController()
  const giveUp = setTimeout(() => abort.abort(), KEY_WAIT_MS)
  let grant: Grant | null
  try {
    const r = await (typeof source === 'string'
      ? fetch(`/api/classroom/sessions/${source}/stt-token`, { method: 'POST', signal: abort.signal })
      : source.grant(abort.signal)).catch(() => null)
    if (!r?.ok) {
      mark('live listening: no key', String(r?.status ?? 'network'))
      if (!r || r.status < 400 || r.status >= 500) return null
      const code = ((await r.json().catch(() => null)) as { error?: unknown } | null)?.error
      return typeof code === 'string' && FINAL_REFUSALS.has(code) ? 'refused' : null
    }
    grant = (await r.json().catch(() => null)) as Grant | null
  } finally {
    clearTimeout(giveUp)
  }
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
  /** When audio last went out, when it started flowing after a gap, and when Soniox last answered (Date.now ms). */
  let lastSentAt = 0
  let flowingSince = 0
  let lastHeardAt = Date.now()
  const timers: ReturnType<typeof setInterval>[] = []
  timers.push(setInterval(() => {
    // ⚠️ By the audio, not by `streaming` (plan review, opus): listening streams for minutes, and an iOS interruption (a
    // call, the lock screen) stops the frames without ending it — the socket would close after 20 s of nothing.
    if (ws.readyState === WebSocket.OPEN && Date.now() - lastSentAt >= KEEPALIVE_MS) ws.send(JSON.stringify({ type: 'keepalive' }))
  }, KEEPALIVE_MS / 2))
  timers.push(setInterval(() => {
    // A socket that swallows audio and answers nothing (a stalled network) would leave the learner on "Listening" for good.
    const now = Date.now()
    if (closed || !streaming || now - lastSentAt > 1_000) return
    if (now - Math.max(lastHeardAt, flowingSince) > STALL_MS) { mark('live listening: stalled'); shutDown(true) }
  }, 1_000))
  timers.push(setInterval(() => {
    void checkReq().then((res) => {
      if (!res.ok && res.status !== 429) { mark('live listening: no longer allowed', String(res.status)); shutDown(true) }
    }).catch(() => { /* a network blip is not a refusal */ })
  }, RECHECK_MS))

  const reset = () => { finals = ''; firstMs = null; lastMs = 0 }
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data !== 'string') return
    let m: Message
    try { m = JSON.parse(e.data) as Message } catch { return }
    lastHeardAt = Date.now()
    if (m.error_code) { mark('live listening: error', `${m.error_code} ${m.error_type ?? ''}`); shutDown(true); return }
    // In-progress words of THIS utterance (by the audio clock) — with its final words so far, "the learner is speaking".
    let pending = false
    for (const t of m.tokens ?? []) {
      if (!t.is_final && typeof t.text === 'string' && t.text.trim() && t.text !== END && t.text !== FIN
        && !(typeof t.start_ms === 'number' && t.start_ms < utterStartMs - 20)) { pending = true; break }
    }
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
    // (Not after the page paused for a turn this answer ended.)
    if (streaming && !closed) on.activity?.(pending || finals.trim().length > 0)
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
      const now = Date.now()
      if (now - lastSentAt > 1_000) flowingSince = now
      lastSentAt = now
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
/** A pure hesitation sound — never a word that can be an answer ("So.", "Well." can; so can "Mm." — a yes, review). */
const HESITATION_WORD = /^(?:u+[hm]+|e+r+m*|e+h+|h+m+|a+h+|ừ+m+|ờ+|ơ+|à+)$/i
/**
 * Soniox ended an utterance on nothing but a hesitation ("Um.", "Ờ…"): not a turn — the learner is finding the word, and the
 * stream simply goes on (owner, 2026-10-27: Soniox decides; this only keeps a sound from being sent as an answer).
 */
export function isHesitation(text: string): boolean {
  const words = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 2 && words.every((w) => HESITATION_WORD.test(w))
}
export function isFiller(text: string): boolean {
  // Vietnamese hesitations too ("ờ", "ừm", "à", "thì" — review, opus: the learners are Vietnamese); "so-so" stays one word.
  // NFC first (a decomposed "ờ" is "o" + marks); digits stay words ("like 2" is an answer — review, codex + opus).
  const words = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 2 && words.every((w) => FILLER_WORD.test(w))
}
