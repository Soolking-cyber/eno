import 'server-only'
import diagnostics from 'node:diagnostics_channel'
import { Agent, fetch as undiciFetch } from 'undici'
import { logError, logInfo, logWarn } from '@/lib/log'
import { quietError } from './quiet-error'

/**
 * THE TUTOR'S LIVE BRAIN — OpenAI GPT-6 Luna, STREAMED (owner, 2026-10-26: "latest openai model for this job", "use latest
 * best with affordable pricing", "mvp should work flawless delayless").
 *
 * ⛔ WHY NOT GEMINI FOR THE LIVE TURN: measured from Vietnam the same day, gemini-3.8-flash (Vertex — `global` is its only
 * location for this project) answered a tutor turn in 3.0 s median and 10.3 s at p90, and gemini-3.5-flash returned 429
 * quota errors (one call waited 42 s). A reply that arrives 10 s after the learner stopped is not a conversation. Gemini
 * still writes the reports and the character text — there a few seconds do not matter.
 * gpt-6-luna: OpenAI's efficient model for focused, high-volume work and the only GPT-6 with reasoning `none`
 * (developers.openai.com/api/docs/models), $0.10 / $0.50 per 1M tokens — about $0.02 a practice-hour at the classroom's
 * measured use (~100k tokens in, ~11k out).
 *
 * Plain REST (the Responses API, server-sent events) on one kept-open connection (openAiAgent), no SDK. ⛔ The words are
 * never logged; an error carries its status.
 */
export type OpenAiConfig = { key: string; model: string; url: string; firstTokenMs: number; tier: string }

/**
 * OPENAI_API_KEY, and CLASSROOM_TUTOR_MODEL (default gpt-6-luna). No first word within `firstTokenMs` → the turn hands
 * over to Gemini (tutor-ai.ts) — this model's first word normally comes in well under a second.
 * ⚠️ LOCAL TESTS ONLY: CLASSROOM_TUTOR_STANDIN_URL sends the same requests to a stand-in ON THIS MACHINE — exactly
 * http://127.0.0.1:<port> or http://localhost:<port>, anything else turns the OpenAI brain off rather than send the key
 * elsewhere (owner, 2026-10-26: "use local codex subscription model for test before we commit" — a shim outside the repo
 * answers through the owner's codex CLI). A stand-in answers whole after its own start-up: its first word may take 30 s.
 */
export function openAiConfig(): OpenAiConfig | null {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key || !/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) return null
  const model = process.env.CLASSROOM_TUTOR_MODEL?.trim() || 'gpt-6-luna'
  // ⚠️ PRIORITY PROCESSING (measured 2026-10-26 from Vietnam, the real tutor prompt, 5 calls each): the first sentence in
  // 0.75–1.42 s (median 0.9) against 1.06–3.1 s (median 1.4) on the default tier — about twice the token price, ~$0.04
  // a practice-hour. CLASSROOM_OPENAI_TIER=default turns it off.
  const tier = process.env.CLASSROOM_OPENAI_TIER?.trim() || 'priority'
  const standIn = process.env.CLASSROOM_TUTOR_STANDIN_URL?.trim()
  if (!standIn) return { key, model, url: 'https://api.openai.com', firstTokenMs: 4_000, tier }
  const port = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\/?$/.exec(standIn)?.[1]
  if (!port) {
    if (refusedStandIn !== standIn) { refusedStandIn = standIn; logWarn('[classroom] CLASSROOM_TUTOR_STANDIN_URL is not this machine — the OpenAI brain is off') }
    return null
  }
  return { key, model, url: `http://127.0.0.1:${port}`, firstTokenMs: 30_000, tier }
}
let refusedStandIn = ''

export class LlmError extends Error {
  constructor(readonly status: number) { super(`llm_${status}`) }
}

export type JsonSchema = Record<string, unknown>

/**
 * ⚡ ONE KEPT-OPEN CONNECTION TO OPENAI (owner, 2026-10-27: "need super fast response"; measured the same night from
 * Vietnam, the real tutor request): every turn used to open a NEW TLS connection — undici drops an idle socket after 4 s,
 * and a stream cancelled after `response.completed` takes its socket with it (15 of 15 calls opened one even with a 120 s
 * pool) — ~0.35 s of every reply (first sentence p50 1.47 s → 1.13 s on a kept connection, 11 calls each; read to its end,
 * 0 new connections in 50 calls). So: undici's own fetch on this pool (2 minutes idle), and every finished answer read to
 * its end (streamJson). A globalThis singleton: `next dev` reloads this module, and a pool per reload would leak.
 */
const KEEP_ALIVE_MS = 120_000
function openAiAgent(): Agent {
  const g = globalThis as { __enoOpenAiAgent?: Agent }
  g.__enoOpenAiAgent ??= new Agent({ keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: KEEP_ALIVE_MS })
  return g.__enoOpenAiAgent
}
const openAiFetch = ((url: string, init: RequestInit) => undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: openAiAgent() })) as unknown as typeof fetch

/** New connections to OpenAI so far, from undici's own diagnostics — the "first words" log says whether a reply needed one
 *  (the pool's whole point: measured from the box, not assumed). Subscribed once per process. */
function openAiConnects(): { n: number } {
  const g = globalThis as { __enoOpenAiConnects?: { n: number } }
  if (!g.__enoOpenAiConnects) {
    const c = { n: 0 }
    diagnostics.subscribe('undici:client:connected', (m) => { if ((m as { connectParams?: { hostname?: string } }).connectParams?.hostname === 'api.openai.com') c.n += 1 })
    g.__enoOpenAiConnects = c
  }
  return g.__enoOpenAiConnects
}

/** How long a finished answer's last bytes may take to be read — then its connection is let go instead (a server that never
 *  closes the stream). */
const DRAIN_MS = 2_000

/**
 * A kept connection the server had already closed: undici's "other side closed" and the socket errors that go with it.
 * ⛔ ONLY these are tried again (2026-10-27 review, codex + opus): any other failure — a refused dial, a DNS miss, a TLS
 * error, a timeout — would only fail again, and a request OpenAI may already have started is not sent twice for nothing.
 */
const STALE_SOCKET = new Set(['UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ECONNRESET', 'EPIPE'])
const staleSocket = (e: unknown) => STALE_SOCKET.has(String((e as { cause?: { code?: unknown } } | null)?.cause?.code ?? ''))

/** Reads what is left of a FINISHED answer, so its connection goes back to the pool (openAiAgent above says why). Never
 *  throws; cancelled after DRAIN_MS. */
function drain(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  const timer = setTimeout(() => { reader.cancel().catch((e) => logError(quietError(e), { op: 'classroom.llm.drain' })) }, DRAIN_MS)
  void (async () => {
    try {
      for (;;) if ((await reader.read()).done) break
    } catch {
      // cancelled, or the connection broke: nothing left to keep
    } finally {
      clearTimeout(timer)
    }
  })()
}

/**
 * One structured answer, STREAMED: yields the JSON text as it is written (deltas). The caller reads the partial JSON as it
 * grows — the reply's first sentence can be spoken while the rest is still being written.
 */
export async function* streamJson(cfg: OpenAiConfig, req: {
  instructions: string
  input: string
  schema: JsonSchema
  schemaName: string
  maxOutputTokens: number
  signal?: AbortSignal
  firstTokenMs?: number
}, fetchImpl: typeof fetch = openAiFetch): AsyncGenerator<string> {
  // A budget already spent sends nothing (2026-10-26 review, codex): an abort listener added to an aborted signal never
  // fires, so a request started now would run unbounded once its first word cleared the only timer.
  if (req.signal?.aborted) throw new LlmError(504)
  const t0 = performance.now()
  const connects = openAiConnects().n
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  // No first word within this → given up (the caller hands over); the rest of the answer has no timer of its own beyond
  // the caller's signal: a reply is ~100 tokens.
  const firstToken = setTimeout(onAbort, req.firstTokenMs ?? cfg.firstTokenMs)
  const body = JSON.stringify({
    model: cfg.model,
    instructions: req.instructions,
    input: [{ role: 'user', content: req.input }],
    text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } },
    reasoning: { effort: 'none' },
    ...(cfg.tier && cfg.tier !== 'default' ? { service_tier: cfg.tier } : {}),
    max_output_tokens: req.maxOutputTokens,
    // ⛔ Not stored at OpenAI beyond what the API requires (the practice notice: transcripts are not kept by vendors).
    store: false,
    stream: true,
  })
  let res: Response
  let retried = false
  for (;;) {
    try {
      res = await fetchImpl(`${cfg.url}/v1/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body,
        signal: stop.signal,
        redirect: 'error',
      })
      break
    } catch (e) {
      // ⚡ A KEPT CONNECTION THE SERVER HAD ALREADY CLOSED fails at once (2026-10-27 plan review, opus): ONE more try, on a
      // fresh connection, inside the same first-word budget — never after an abort, never for any other failure.
      // ⚠️ Accepted: if OpenAI had already taken the request when the socket died, it is billed twice (~$0.0005).
      if (!retried && !stop.signal.aborted && staleSocket(e)) { retried = true; continue }
      clearTimeout(firstToken)
      req.signal?.removeEventListener('abort', onAbort)
      throw new LlmError(502)
    }
  }
  if (!res.ok || !res.body) {
    clearTimeout(firstToken)
    req.signal?.removeEventListener('abort', onAbort)
    await res.body?.cancel().catch((e) => logError(quietError(e), { op: 'classroom.llm.cancel' }))
    throw new LlmError(res.status || 502)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let done = false
  let first = false
  try {
    while (!done) {
      const { value, done: end } = await reader.read()
      if (end) break
      buf += dec.decode(value, { stream: true })
      // Server-sent events: blank-line separated, each with one `data:` line of JSON.
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
        if (!data || data === '[DONE]') continue
        let ev: { type?: string; delta?: string; response?: { status?: string; incomplete_details?: { reason?: string } } }
        try { ev = JSON.parse(data) } catch { continue }
        if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
          if (!first) { first = true; logInfo('[classroom] tutor first words', { ms: Math.round(performance.now() - t0), newConnection: openAiConnects().n > connects, retried }) }
          clearTimeout(firstToken)
          yield ev.delta
        } else if (ev.type === 'response.completed') {
          done = true
          break
        } else if (ev.type === 'response.incomplete') {
          // The server ENDED the answer (a cap, a filter): the stream is over and its connection still good — drained too
          // (2026-10-27 review, opus: the warm-up's 40-token cap could end it here).
          done = true
          throw new LlmError(ev.response?.incomplete_details?.reason === 'max_output_tokens' ? 413 : 502)
        } else if (ev.type === 'error' || ev.type === 'response.failed') {
          done = true
          throw new LlmError(502)
        }
      }
    }
  } catch (e) {
    if (e instanceof LlmError) throw e
    throw new LlmError(stop.signal.aborted ? 504 : 502)
  } finally {
    clearTimeout(firstToken)
    req.signal?.removeEventListener('abort', onAbort)
    // ⚡ FINISHED — completed, or ended by the server — read to its end, and the connection goes back to the pool
    // (openAiAgent above). Anything else — a broken stream, an abort, a caller that stopped reading early — is cancelled,
    // and that connection is let go.
    if (done) drain(reader)
    else reader.cancel().catch((e) => logError(quietError(e), { op: 'classroom.llm.cancel' }))
  }
}

/**
 * Pure: from a PARTIAL JSON object as streamed so far, the value of a string field (unescaped) and whether it is complete.
 * The tutor's schema writes `safety` first, then `reply` (OpenAI writes properties in schema order), so the reply's text
 * can be read — and spoken sentence by sentence — before the hint and the rest exist.
 */
export function partialString(json: string, field: string): { text: string; complete: boolean } | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json)
  if (!m) return null
  let i = m.index + m[0].length
  let out = ''
  while (i < json.length) {
    const ch = json[i]
    if (ch === '"') return { text: out, complete: true }
    if (ch === '\\') {
      const nx = json[i + 1]
      if (nx === undefined) break // the escape is cut in half: wait for more
      if (nx === 'u') {
        const hex = json.slice(i + 2, i + 6)
        if (hex.length < 4) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === 'r' ? '\r' : nx === 'b' ? '\b' : nx === 'f' ? '\f' : nx
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return { text: out, complete: false }
}
