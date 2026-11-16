import { SITE_NAME } from '@/lib/edition'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { clientIp } from '@/lib/client-ip'
import { DOCS_TOOLS_BY_NAME, DocsToolError, docsToolDescriptors } from '@/lib/mcp/docs-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── THE DOCS, AS AN MCP SERVER (owner, 2026-11-16: "Build it" — ora's product + docs MCP coverage) ──────────────────
 * The third MCP surface, beside the Partner server (/api/mcp, one shop's actions) and the listing search
 * (/api/mcp/search): two read-only tools over the documents this site already publishes for agents (src/lib/mcp/
 * docs-tools.ts). Same transport, protocol handling, batch rules, body cap and rate-limit shape as the search server,
 * whose route this mirrors; only the tools, the server's name and the budgets differ.
 * ⛔ PUBLIC DOCUMENTS ONLY, NO CREDENTIAL: everything it returns is served to anyone at its own URL.
 * ⛔ KEPT OUT OF THE STORE AND DIRECTORY SUBMISSIONS unless the owner says otherwise (owner + mk1e3-26, 2026-11-16).
 */

// 2025-11-25 since 2026-11-16, like /api/mcp and /api/mcp/search (40ee0e54b): the three servers speak the same revisions.
const PROTOCOL_VERSION = '2025-11-25'
const SUPPORTED = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
const MAX_BATCH = 8
/** Requests of any kind per IP (initialize, tools/list, ping are cheap). */
const REQUESTS_PER_IP_PER_MIN = 600
/** TOOL CALLS counted one by one (a batch of 8 is 8); the documents are cached, so these only bound the work. */
const CALLS_PER_IP_PER_MIN = 120
const CALLS_GLOBAL_PER_MIN = 1200
/** Read with a cap, not req.json(), as on the search server. */
const MAX_BODY_BYTES = 64 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*', // no credential exists on this server, so no origin can borrow one
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const rpcResult = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const toolErr = (id: Rpc['id'], code: string, message: string) =>
  rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }], isError: true })

async function handleMessage(msg: Rpc, ip: string): Promise<object | null> {
  // JSON-RPC 2.0: an id is a string, a number or null; anything else (an object, an array, true) is Invalid Request.
  const validId = (id: unknown) => id === undefined || id === null || typeof id === 'string' || typeof id === 'number'
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || !validId(msg.id)) {
    // Not a valid request (null, 42, {}, a bad id …): Invalid Request, echoing the id only when it is a valid one.
    const id = msg && typeof msg === 'object' && !Array.isArray(msg) && validId(msg.id) && msg.id !== undefined ? msg.id : null
    return rpcError(id, -32600, 'Invalid Request')
  }
  // A notification (no `id` member at all) gets no reply and runs nothing: JSON-RPC says so, and a tools/call sent as one
  // must not spend the rate budget or a feed query on an answer nobody will read. An explicit `id: null` is a request.
  if (msg.id === undefined) return null
  // JSON-RPC: `params`, when present, is structured (an object or an array) — a bare 42 or "x" is Invalid params.
  if (msg.params !== undefined && (msg.params === null || typeof msg.params !== 'object')) return rpcError(msg.id, -32602, 'Invalid params')
  switch (msg.method) {
    case 'initialize': {
      const req = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : ''
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED.has(req) ? req : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        // ⛔ DERIVED from the edition, like /api/mcp's serverInfo: never a literal host.
        serverInfo: {
          name: `${SITE_NAME} Docs`,
          title: `${SITE_NAME} Docs`,
          version: '1.0.0',
          description: `Search and read ${SITE_NAME}'s documentation for agents and developers: the site, its APIs and MCP servers, authentication and rules. No sign-in.`,
          websiteUrl: `${OAUTH_ISSUER}/developers`,
          icons: [{ src: `${OAUTH_ISSUER}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
        },
        instructions:
          `Answer questions about ${SITE_NAME}'s interfaces from its own documents: search_docs to find the section, get_doc for a whole document. Cite the document's url. To search listings, use the listing search server at ${OAUTH_ISSUER}/api/mcp/search.`,
      })
    }
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, { tools: docsToolDescriptors() })
    case 'tools/call': {
      // Only a string is a tool name; anything else (an object with a hostile toString, a number) is simply unknown.
      const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
      const tool = DOCS_TOOLS_BY_NAME.get(name)
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`)
      const parsed = tool.input.safeParse(msg.params?.arguments ?? {})
      if (!parsed.success) {
        return toolErr(msg.id, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
      }
      try {
        // In order, not together, as on the search server: a refused address never spends the global budget.
        const perIp = await rateLimit('mcp-docs-call-ip', ip, CALLS_PER_IP_PER_MIN, '1 m')
        const all = perIp.success ? await rateLimit('mcp-docs-call-all', 'all', CALLS_GLOBAL_PER_MIN, '1 m') : null
        if (!perIp.success || !all?.success) return toolErr(msg.id, 'rate_limited', 'Too many requests right now. Wait a minute and try again.')
        const result = await tool.handler(parsed.data as Record<string, unknown>, OAUTH_ISSUER)
        return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result })
      } catch (e) {
        if (e instanceof DocsToolError) return toolErr(msg.id, e.code, e.message)
        console.error('[mcp-docs] tool error', name, e)
        return toolErr(msg.id, 'internal_error', 'The docs could not be read. Try again shortly.')
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

export async function POST(req: Request) {
  // The limiters run before a byte is parsed, as on /api/mcp: an anonymous route must not be a free allocation pump.
  // MCP Streamable HTTP: a request naming a protocol version this server does not speak is answered 400.
  const version = req.headers.get('mcp-protocol-version')
  if (version && !SUPPORTED.has(version)) {
    return Response.json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${version.slice(0, 40)}`), { status: 400, headers: CORS })
  }
  const ip = clientIp(req)
  const rl = await rateLimit('mcp-docs-ip', ip, REQUESTS_PER_IP_PER_MIN, '1 m')
  if (!rl.success) {
    return new Response(JSON.stringify(rpcError(null, -32001, 'Too many requests. Slow down.')), {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(rl.resetSec), ...CORS },
    })
  }
  const text = await readCapped(req, MAX_BODY_BYTES)
  if (text === null) return Response.json(rpcError(null, -32600, `Request too large: at most ${MAX_BODY_BYTES} bytes.`), { status: 413, headers: CORS })
  let body: unknown
  try { body = JSON.parse(text) } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers: CORS }) }
  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Rpc[]
  // An empty batch is Invalid Request (JSON-RPC 2.0 §6), answered with one error, not silence.
  if (batch && messages.length === 0) return Response.json(rpcError(null, -32600, 'Invalid Request: empty batch'), { status: 400, headers: CORS })
  if (messages.length > MAX_BATCH) {
    return Response.json(rpcError(null, -32600, `Batch too large: ${messages.length} messages, maximum ${MAX_BATCH}.`), { status: 400, headers: CORS })
  }
  // One message's failure answers that message with an internal error; it never takes its batch siblings down with it.
  const answer = (m: Rpc) => handleMessage(m, ip).catch((e) => {
    console.error('[mcp-docs] message failed', e)
    const id = m && typeof m === 'object' && (typeof m.id === 'string' || typeof m.id === 'number') ? m.id : null
    return rpcError(id, -32603, 'Internal error')
  })
  const responses = (await Promise.all(messages.map(answer))).filter((r): r is object => r !== null)
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })
  return Response.json(batch ? responses : responses[0], { headers: CORS })
}

/** The body as text, or null once it passes `max` bytes — counted while streaming, so an oversized body is dropped as soon
 *  as it crosses the line, whatever Content-Length claims (or when there is none). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch((e) => logError(e, { op: 'mcp-docs.cancelBody' })); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  // A browser gets the setup page; an MCP client's GET (Accept: text/event-stream) gets 405 — no server stream here.
  const accept = req.headers.get('accept') ?? ''
  if (!accept.includes('text/event-stream') && accept.includes('text/html')) {
    return new Response(null, { status: 302, headers: { Location: `${OAUTH_ISSUER}/developers`, Vary: 'Accept', ...CORS } })
  }
  return new Response(JSON.stringify(rpcError(null, -32601, 'GET not supported; use POST.')), {
    status: 405,
    headers: { 'content-type': 'application/json', Allow: 'POST, OPTIONS', Vary: 'Accept', ...CORS },
  })
}
