import { SITE_NAME } from '@/lib/edition'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { SEARCH_TOOLS_BY_NAME, SearchToolError } from '@/app/api/mcp/search/tools'
import { failureBody, meta, parseAsk, sseBody, sseFailure, toResults, wantsStream, type Failure } from '@/lib/nlweb'

/**
 * POST /ask — NLWeb v0.55 over the public listing search (src/lib/nlweb.ts says what it is and is not). Root-level like
 * src/app/app: proxy.ts's matcher skips `ask` exactly, and `ask` is a reserved handle (handle-format.ts), so neither the
 * [lang] rewrite nor a storefront can take the path. Measured before reserving (2026-11-16): eno.vn/ask 404 for GET and POST.
 * Skipping the proxy skips its cross-origin write guard too, which protects cookie-bearing writes: this route reads no
 * cookie, changes nothing and answers only what the anonymous MCP search answers.
 * Rate limits: the search server's ratio (1 address to 40 for the whole budget), and the per-address limit runs BEFORE the
 * body is read; a body over 4 KB is refused unread (commit gate, codex + opus).
 */
const ASKS_PER_IP_PER_MIN = 30
const ASKS_GLOBAL_PER_MIN = 1200
const BODY_MAX = 4096

/** The body as text, read as a stream and abandoned the moment it passes `max` BYTES — with or without a Content-Length
 * (a chunked body has none), and in bytes, not characters (commit gate, codex + opus). null = too large. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      void reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

/** Any origin may call it (commit gate, agy: a browser agent's cross-origin POST): it reads no cookie and sends no credential. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...headers } })
const sse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...CORS } })
const RETRY = { 'retry-after': '60' }

/** Every answer, error included, is an NLWeb envelope (commit gate, opus): a throw anywhere is INTERNAL_ERROR, never Next's bare 500. */
export async function POST(req: Request) {
  try {
    return await answer(req)
  } catch (e) {
    console.error('[nlweb] /ask failed', e)
    // A streaming caller (by its Accept: the body may be what failed) still gets an SSE error event (commit gate, agy + opus).
    return failure(wantsStream({}, req.headers.get('accept')), { code: 'INTERNAL_ERROR', message: 'The search failed. Try again shortly.' }, 500)
  }
}

/** A failure in the form the caller asked for: an SSE `error` event for a streaming caller, else JSON (commit gate, agy + opus). */
function failure(streaming: boolean, f: Failure, status = 200, headers: Record<string, string> = {}): Response {
  return streaming
    ? new Response(sseFailure(f), { status, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...CORS, ...headers } })
    : json(failureBody(f), status, headers)
}

async function answer(req: Request): Promise<Response> {
  // Before the body is read only the Accept header can say "stream"; after it, prefer.streaming can too.
  const early = wantsStream({}, req.headers.get('accept'))
  const ip = clientIp(req)
  const perIp = await rateLimit('nlweb-ask-ip', ip, ASKS_PER_IP_PER_MIN, '1 m')
  if (!perIp.success) return failure(early, { code: 'RATE_LIMITED', message: 'Too many questions right now. Wait a minute and try again.' }, 429, RETRY)

  const raw = Number(req.headers.get('content-length') ?? 0) > BODY_MAX ? null : await readCapped(req, BODY_MAX)
  if (raw === null) return failure(early, { code: 'INVALID_QUERY', message: 'The body is too large.' }, 413)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return failure(early, { code: 'INVALID_QUERY', message: 'The body must be JSON: {"query": {"text": "…"}}.' }, 400)
  }
  const prefer = body && typeof body === 'object' && (body as { prefer?: unknown }).prefer
  const streaming = wantsStream(prefer && typeof prefer === 'object' ? (prefer as Record<string, unknown>) : {}, req.headers.get('accept'))
  const fail = (f: Failure, status = 200, headers: Record<string, string> = {}) => failure(streaming, f, status, headers)
  const ask = parseAsk(body, req.headers.get('accept'), req.headers.get('accept-language'))
  // A malformed request is a 400 (spec §7.4); an unsupported format or mode is an application-level failure, 200.
  if ('code' in ask) return fail(ask, ask.code === 'INVALID_QUERY' ? 400 : 200)

  const all = await rateLimit('nlweb-ask-all', 'all', ASKS_GLOBAL_PER_MIN, '1 m')
  if (!all.success) return fail({ code: 'RATE_LIMITED', message: 'Too many questions right now. Wait a minute and try again.' }, 429, RETRY)

  // The tool's own input schema, then its handler with that one argument — exactly what /api/mcp/search's tools/call does
  // (route.ts: `tool.input.safeParse(...)`, then `tool.handler(parsed.data)`): the edition scope, withheld aisles and the
  // keyword-only path all live inside the handler, so this route gets the same answer and nothing more.
  const tool = SEARCH_TOOLS_BY_NAME.get('search_listings')!
  const args = tool.input.safeParse({ q: ask.text, lang: ask.lang, limit: 10 })
  if (!args.success) return fail({ code: 'INVALID_QUERY', message: 'That question cannot be searched.' }, 400)
  let search: { total: number; listings: never[] }
  try {
    const result = (await tool.handler(args.data as Record<string, unknown>)) as { total?: unknown; listings?: unknown }
    if (!Array.isArray(result.listings)) throw new Error('search_listings returned no listings array')
    search = { total: Number(result.total) || 0, listings: result.listings as never[] }
  } catch (e) {
    if (e instanceof SearchToolError) return fail({ code: 'INVALID_QUERY', message: e.message })
    console.error('[nlweb] search failed', e)
    return fail({ code: 'INTERNAL_ERROR', message: 'The search failed. Try again shortly.' }, 500)
  }
  if (search.listings.length === 0) {
    return fail({ code: 'NO_RESULTS', message: ask.lang === 'vi' ? `Không có tin đang đăng nào trên ${SITE_NAME} khớp với yêu cầu.` : `No live listings on ${SITE_NAME} match that.` })
  }
  const results = toResults(search, ask, SITE_NAME)
  if (ask.streaming) return sse(sseBody(results))
  return json({ _meta: meta('answer'), results })
}

/** A browser's preflight for the cross-origin POST. */
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, accept-language', 'access-control-max-age': '86400' },
  })
}

/** The protocol is POST only (spec §7.1). */
export function GET() {
  return json(failureBody({ code: 'INVALID_QUERY', message: 'POST a JSON body: {"query": {"text": "…"}} (NLWeb v0.55).' }), 405, { allow: 'POST' })
}
