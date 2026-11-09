import 'server-only'
import { SonioxError, type SonioxConfig } from './soniox'

/**
 * THE WORDS OF AN OWN-VOICE RECORDING (own-voice.ts), heard by Soniox's real-time ears from THIS server — the same vendor,
 * account and model as a lesson (soniox.ts), and the same "never stored" (no Async API, no file kept at Soniox):
 *   wss://stt-rt.soniox.com/transcribe-websocket, protocols ['soniox-api-key', key]
 *   → {model, audio_format: pcm_s16le, sample_rate, num_channels: 1, language_hints: ['en']}, the audio as binary frames,
 *     then an EMPTY TEXT frame (the end; an empty binary frame is only an empty chunk)
 *   ← {tokens: [{text, is_final}]} … {finished: true}, then it closes; {error_code} closes it at once.
 * The recording is sent as fast as the socket takes it (it is already whole). ⛔ The words are never logged.
 */
const OPEN_MS = 6_000
/** The whole check: a two-minute recording is heard in a few seconds when sent at once. */
const HEAR_MS = 45_000
/** Half a second of 24 kHz PCM16 a frame. */
const FRAME_BYTES = 24_000

type Message = { tokens?: { text?: unknown; is_final?: unknown }[]; finished?: unknown; error_code?: unknown }

export async function transcribePcm(cfg: SonioxConfig, pcm: Uint8Array, rate: number, open: (url: string, protocols: string[]) => WebSocket = (u, p) => new WebSocket(u, p)): Promise<string> {
  let ws: WebSocket
  try { ws = open(cfg.ws, ['soniox-api-key', cfg.key]) } catch { throw new SonioxError(502) }
  ws.binaryType = 'arraybuffer'
  return new Promise<string>((resolve, reject) => {
    const words: string[] = []
    let opened = false
    let settled = false
    const done = (e: SonioxError | null) => {
      if (settled) return
      settled = true
      clearTimeout(openTimer)
      clearTimeout(hearTimer)
      try { ws.close() } catch { /* closed */ }
      if (e) reject(e)
      else resolve(words.join('').replace(/\s+/g, ' ').trim())
    }
    const openTimer = setTimeout(() => { if (!opened) done(new SonioxError(504)) }, OPEN_MS)
    const hearTimer = setTimeout(() => done(new SonioxError(504)), HEAR_MS)
    ws.onopen = () => {
      opened = true
      try {
        ws.send(JSON.stringify({ model: cfg.model, audio_format: 'pcm_s16le', sample_rate: rate, num_channels: 1, language_hints: ['en'] }))
        for (let at = 0; at < pcm.length; at += FRAME_BYTES) ws.send(pcm.subarray(at, Math.min(pcm.length, at + FRAME_BYTES)))
        ws.send('')
      } catch {
        done(new SonioxError(502))
      }
    }
    ws.onerror = () => done(new SonioxError(502))
    ws.onclose = () => done(new SonioxError(502)) // a close before `finished` is no answer (after it, done() already ran)
    ws.onmessage = (e) => {
      let m: Message
      try { m = JSON.parse(String(e.data)) as Message } catch { return }
      if (m.error_code !== undefined) { done(new SonioxError(typeof m.error_code === 'number' && m.error_code >= 400 && m.error_code < 600 ? m.error_code : 502)); return }
      for (const t of m.tokens ?? []) {
        // `<end>`/`<fin>` markers are not words.
        if (t?.is_final === true && typeof t.text === 'string' && !/^<\w+>$/.test(t.text)) words.push(t.text)
      }
      if (m.finished === true) done(null)
    }
  })
}
