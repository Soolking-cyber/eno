import { ApiError, route } from '@/lib/api/handler'
import { readBytesCapped } from '@/lib/classroom/http'
import { LIVE_TEXT_MAX, processTurn, type LiveHeard, type TurnResult } from '@/lib/classroom/session-turn'
import type { TurnLine } from '@/lib/classroom/turn-stream'
import { quietError } from '@/lib/classroom/quiet-error'
import { LIMITS } from '@/lib/classroom/constants'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 40

/**
 * POST /api/classroom/sessions/<id>/turns — one learner turn, the client's idempotency key in `x-turn-id`. Heard LIVE
 * (the page streamed the speech to Soniox — live-stt.ts): the words in `x-transcript` (base64url UTF-8) and `x-speech-ms`,
 * with the WAV as the body only for a repeat-after-me sentence (Azure scores it). Otherwise the body is the WAV itself
 * (16 kHz mono PCM16, ≤ 45 s — wav.ts), transcribed by eno's own speech server. A refusal decided before the transcript is the usual `{ error }`
 * with its status. Otherwise a 200 of JSON LINES (application/x-ndjson), each written as soon as it exists, so the avatar
 * starts talking about a second after the learner stops (owner, 2026-10-26: "delayless"):
 *   {"kind":"silence"}                                            and nothing more; or
 *   {"kind":"heard",learnerText}                                  the learner's words, then for each sentence of the reply
 *   {"kind":"say",part,text} {"kind":"pcm",part,rate,data}… {"kind":"part-end",part,"last":false}
 *                                                                 its words, its voice as made (raw PCM16, base64), its end
 *                                                                 — or {"kind":"audio-failed",part} for a voice that failed;
 *   {"kind":"drill",expect}                                       the reply asked for a repeat-after-me sentence;
 *   {"kind":"part-end",part,"last":true}                          the reply's voice is all out — sent the moment its last
 *                                                                 sentence is voiced, BEFORE the save (2026-10-27);
 *   {"kind":"reply",seq,learnerText,reply,hint,hintVi,expect,heardAs,secondsLeft}   once the turn is SAVED;
 *   {"kind":"end"}                                                the answer is complete.
 * Or, when no answer could be made and nothing was said: {"kind":"error","error":"tutor_unavailable"}, then end.
 * An answer that stops before "end" was cut off (turn-stream.ts has the whole contract).
 * ⛔ The audio is never stored (session-turn.ts). The per-account limit sits above a session's own cap (80 turns): a stuck
 * client cannot hammer the speech services.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-turn', limit: 240, window: '1 h' } }, async ({ req, profile, params }) => {
  const live = liveHeard(req.headers)
  // The clip comes only with the old way, or with a repeat-after-me sentence (Azure scores it); live words come alone.
  const wav = (req.headers.get('content-type') ?? '').startsWith('audio/') ? await readBytesCapped(req, LIMITS.turnBytes) : null
  const result = await processTurn(params.id, profile.id, req.headers.get('x-turn-id') ?? '', wav, new Date(), live ?? undefined)
  return new Response(answerLines(result), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'private, no-store',
      // nginx (the VN origin) holds a proxied answer in its buffers by default — each line must leave when it is written.
      'x-accel-buffering': 'no',
    },
  })
})

/**
 * A turn heard LIVE (live-stt.ts): `x-transcript` — the words, UTF-8 in base64url (a header carries no raw UTF-8) — and
 * `x-speech-ms`. Null when absent; a malformed one is a 400.
 */
function liveHeard(h: Headers): LiveHeard | null {
  const raw = h.get('x-transcript')
  if (raw === null) return null
  // Room for LIVE_TEXT_MAX characters of the widest UTF-8 (4 bytes each), in base64 (4 per 3); the text itself is cut to
  // LIVE_TEXT_MAX by the turn (review, opus: a long Vietnamese transcript was refused whole).
  if (raw.length > Math.ceil((LIVE_TEXT_MAX * 4 * 4) / 3) || !/^[A-Za-z0-9_-]*$/.test(raw)) throw new ApiError('bad_request', 400)
  const text = Buffer.from(raw, 'base64url').toString('utf8')
  const ms = Number(h.get('x-speech-ms') ?? '0')
  if (!Number.isFinite(ms) || ms < 0) throw new ApiError('bad_request', 400)
  return { text, ms }
}

/**
 * The answer as JSON lines, each ended by "\n", one per pull — a slow reader holds the lines back (in memory: one reply's
 * worth), never the turn. A client that goes away cancels the stream: its voice stops, nothing more is written (so
 * nothing throws unhandled) — and the turn itself still finishes and is saved (turn-stream.ts).
 */
function answerLines(result: TurnResult): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const line = (o: object) => encoder.encode(`${JSON.stringify(o)}\n`)
  if (result.kind === 'silence') return new ReadableStream({ start(c) { c.enqueue(line({ kind: 'silence' })); c.close() } })
  const { lines, stop } = result
  let over = false
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      let next: IteratorResult<TurnLine, void>
      try {
        next = await lines.next()
      } catch (e) {
        // turn-stream.ts answers every failure as a line — this is a bug: logged without what it carried, and the answer
        // ends without "end", which the client reads as cut off.
        if (over) return
        over = true
        logError(quietError(e), { op: 'classroom.turn.lines' })
        c.close()
        return
      }
      if (over) return // the client went away meanwhile
      if (next.done) {
        over = true
        c.close()
        return
      }
      c.enqueue(line(next.value))
    },
    cancel() {
      over = true
      stop()
    },
  })
}
