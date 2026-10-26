import { route } from '@/lib/api/handler'
import { readBytesCapped } from '@/lib/classroom/http'
import { processTurn, type TurnResult } from '@/lib/classroom/session-turn'
import type { TurnLine } from '@/lib/classroom/turn-stream'
import { quietError } from '@/lib/classroom/quiet-error'
import { LIMITS } from '@/lib/classroom/constants'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 40

/**
 * POST /api/classroom/sessions/<id>/turns — one learner turn: the body is the WAV itself (16 kHz mono PCM16, ≤ 45 s —
 * wav.ts), the client's idempotency key in `x-turn-id`. A refusal decided before the transcript is the usual `{ error }`
 * with its status. Otherwise a 200 of JSON LINES (application/x-ndjson), each written as soon as it exists, so the avatar
 * starts talking about a second after the learner stops (owner, 2026-10-26: "delayless"):
 *   {"kind":"silence"}                                            and nothing more; or
 *   {"kind":"heard",learnerText}                                  the learner's words, then for each sentence of the reply
 *   {"kind":"say",part,text} {"kind":"pcm",part,rate,data}… {"kind":"part-end",part,"last":false}
 *                                                                 its words, its voice as made (raw PCM16, base64), its end
 *                                                                 — or {"kind":"audio-failed",part} for a voice that failed;
 *   {"kind":"reply",seq,learnerText,reply,hint,hintVi,expect,heardAs,secondsLeft}   once the turn is SAVED;
 *   {"kind":"part-end",part,"last":true} {"kind":"end"}           the reply's voice is all out; the answer is complete.
 * Or, when no answer could be made and nothing was said: {"kind":"error","error":"tutor_unavailable"}, then end.
 * An answer that stops before "end" was cut off (turn-stream.ts has the whole contract).
 * ⛔ The audio is never stored (session-turn.ts). The per-account limit sits above a session's own cap (80 turns): a stuck
 * client cannot hammer the speech services.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-turn', limit: 240, window: '1 h' } }, async ({ req, profile, params }) => {
  const wav = await readBytesCapped(req, LIMITS.turnBytes)
  const result = await processTurn(params.id, profile.id, req.headers.get('x-turn-id') ?? '', wav)
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
