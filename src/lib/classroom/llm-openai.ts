import 'server-only'
import { logError, logWarn } from '@/lib/log'
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
 * Plain REST (the Responses API, server-sent events), no SDK. ⛔ The words are never logged; an error carries its status.
 */
export type OpenAiConfig = { key: string; model: string; url: string; firstTokenMs: number }

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
  const standIn = process.env.CLASSROOM_TUTOR_STANDIN_URL?.trim()
  if (!standIn) return { key, model, url: 'https://api.openai.com', firstTokenMs: 4_000 }
  const port = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\/?$/.exec(standIn)?.[1]
  if (!port) {
    if (refusedStandIn !== standIn) { refusedStandIn = standIn; logWarn('[classroom] CLASSROOM_TUTOR_STANDIN_URL is not this machine — the OpenAI brain is off') }
    return null
  }
  return { key, model, url: `http://127.0.0.1:${port}`, firstTokenMs: 30_000 }
}
let refusedStandIn = ''

export class LlmError extends Error {
  constructor(readonly status: number) { super(`llm_${status}`) }
}

export type JsonSchema = Record<string, unknown>

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
}, fetchImpl: typeof fetch = fetch): AsyncGenerator<string> {
  // A budget already spent sends nothing (2026-10-26 review, codex): an abort listener added to an aborted signal never
  // fires, so a request started now would run unbounded once its first word cleared the only timer.
  if (req.signal?.aborted) throw new LlmError(504)
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  // No first word within this → given up (the caller hands over); the rest of the answer has no timer of its own beyond
  // the caller's signal: a reply is ~100 tokens.
  const firstToken = setTimeout(onAbort, req.firstTokenMs ?? cfg.firstTokenMs)
  let res: Response
  try {
    res = await fetchImpl(`${cfg.url}/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: cfg.model,
        instructions: req.instructions,
        input: [{ role: 'user', content: req.input }],
        text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } },
        reasoning: { effort: 'none' },
        max_output_tokens: req.maxOutputTokens,
        // ⛔ Not stored at OpenAI beyond what the API requires (the practice notice: transcripts are not kept by vendors).
        store: false,
        stream: true,
      }),
      signal: stop.signal,
      redirect: 'error',
    })
  } catch {
    clearTimeout(firstToken)
    req.signal?.removeEventListener('abort', onAbort)
    throw new LlmError(502)
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
          clearTimeout(firstToken)
          yield ev.delta
        } else if (ev.type === 'response.completed') {
          done = true
          break
        } else if (ev.type === 'response.incomplete') {
          throw new LlmError(ev.response?.incomplete_details?.reason === 'max_output_tokens' ? 413 : 502)
        } else if (ev.type === 'error' || ev.type === 'response.failed') {
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
    reader.cancel().catch((e) => logError(quietError(e), { op: 'classroom.llm.cancel' }))
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
