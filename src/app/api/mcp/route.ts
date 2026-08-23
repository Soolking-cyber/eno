import { SITE_NAME } from '@/lib/edition'
import { NextRequest } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { TOOLS_BY_NAME, toolDescriptors, ToolError } from '@/lib/mcp/tools'
import type { ApiAuth } from '@/lib/api/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Partner MCP server (Phase 4) ─────────────────────────────────────────────────
// A stateless Model Context Protocol server over the Streamable-HTTP transport, wrapping
// the same shop-scoped cores as /api/v1. Partners point an AI client (Claude, etc.) at
// https://eno.vn/api/mcp with their eno_live_ key as the Bearer token — the key lives in the
// client's connection config, NEVER as a tool argument, so it never reaches the model. The
// model only sees tool names, schemas, and results. JSON-RPC requests get JSON responses
// (no SSE needed — every tool is request/response). Auth + per-key rate limit reuse resolveApiKey.

const PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])

const CORS = {
  'Access-Control-Allow-Origin': '*', // token-auth (no cookies) → safe to allow any origin for web MCP clients
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const rpcResult = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const toolErr = (id: Rpc['id'], code: string, message: string) =>
  rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }], isError: true })

// Handle one JSON-RPC message. Returns the response object, or null for notifications.
async function handleMessage(msg: Rpc, auth: ApiAuth | null): Promise<object | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return msg && msg.id !== undefined ? rpcError(msg.id ?? null, -32600, 'Invalid Request') : null
  }
  const isNotification = msg.id === undefined || msg.id === null

  switch (msg.method) {
    case 'initialize': {
      const req = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : ''
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED.has(req) ? req : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        // ⛔ DERIVED. This was the literal 'eno.vn Partner API', which meant the SERVICES build's
        // MCP server introduced itself as the licensed marketplace on every `initialize`. It is
        // the fifth instance of this exact leak in this repo (static llms.txt, the OpenAPI title,
        // the developers page, an ApiStatus description — each caught by a reviewer, never by a
        // gate), and the newly published Server Card is what made it observable: on eno.forum the
        // card said "eno.forum Partner API" while the server it describes said "eno.vn Partner
        // API". The MCP Server Card spec's "Consistency with Runtime Behavior" makes that
        // contradiction a SHOULD NOT, so the card cannot be trusted while this line is a literal.
        serverInfo: { name: `${SITE_NAME} Partner API`, version: '1.0.0' },
        instructions:
          `Manage a ${SITE_NAME} storefront: list/create/update/delete listings, bulk-import, sync a catalogue by your own externalId, read analytics, and manage webhooks. Every action is scoped to the one shop behind the API key.`,
      })
    }
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolDescriptors() })
    case 'tools/call': {
      // ⛔ THE ONLY METHOD THAT NEEDS A CREDENTIAL. `auth` is non-null by construction: POST
      // resolves a key whenever the payload contains a tools/call and returns 401 at the transport
      // before dispatching, which is what MCP clients expect (it is how they discover the OAuth
      // authorization server from WWW-Authenticate). This guard exists so the type is honest and
      // so a future change to that ordering fails here loudly rather than calling a tool with no
      // caller. ⚠️ An earlier comment here claimed the refusal happens per-message in the RPC
      // envelope; it does not, and two reviewers caught the contradiction.
      if (!auth) return toolErr(msg.id, 'unauthorized', 'This tool needs an API key. Send it as `Authorization: Bearer eno_live_…`.')
      const name = String(msg.params?.name || '')
      const tool = TOOLS_BY_NAME.get(name)
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`)
      if (!auth.scopes.has(tool.scope)) return toolErr(msg.id, 'insufficient_scope', `This key is missing the "${tool.scope}" scope.`)
      const parsed = tool.input.safeParse(msg.params?.arguments ?? {})
      if (!parsed.success) {
        return toolErr(msg.id, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
      }
      try {
        const result = await tool.handler(auth, parsed.data as Record<string, unknown>)
        return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
      } catch (e) {
        if (e instanceof ToolError) return toolErr(msg.id, e.code, e.message)
        console.error('[mcp] tool error', name, e)
        return toolErr(msg.id, 'internal_error', 'The tool failed to execute.')
      }
    }
    default:
      // Other notifications (initialized/cancelled/…) need no reply; unknown REQUESTS error.
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

// ⚠️ WS6 — NOT MIGRATED, and this is the clearest refusal in the surface: all three exports speak a
// DIFFERENT PROTOCOL, not a different dialect of `{ error }`.
//   · THE AUTH IS `resolveApiKey`, THE /api/v1 MECHANISM. `src/lib/api/handler.ts` says in as many
//     words that it is not for that surface. A rejected key answers a JSON-RPC error object
//     (`{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":…}}`) at r.status with
//     `WWW-Authenticate: Bearer` — not `{"error":"auth_required"}` 401 from a cookie session.
//   · EVERY RESPONSE CARRIES HEADERS THE WRAPPER'S PLAIN-OBJECT RETURN CANNOT: `CORS` on all four
//     exit paths, `X-RateLimit-Limit`/`-Remaining` on success, `Allow: POST, OPTIONS` on GET's 405.
//   · TWO EXITS HAVE NO BODY AT ALL — the notifications-only 202 and OPTIONS' 204 preflight — and
//     one is a 405. `route()` always serialises a JSON body (`data ?? {}`).
//   · A TOOL FAILURE IS A 200. `toolErr()` returns a JSON-RPC *result* with `isError:true`; MCP
//     clients require that, so an `ApiError` throw mapping to a 4xx would break the transport.
// Returning a `Response` from a handler could carry the bytes, but then auth, rate limiting, body
// parsing and error shaping all stay hand-written — the wrapper would be an empty options object
// around an untouched function.
/**
 * ⛔ DISCOVERY IS OPEN; EXECUTION IS AUTHENTICATED. THIS ORDER IS THE POINT.
 *
 * `resolveApiKey` used to run BEFORE the body was even parsed, so every method — `initialize`,
 * `ping`, `tools/list` — answered 401 without a key. That is not how MCP is meant to work, and it
 * had a measurable cost: the is-agentic audit reported "MCP manifest found at /.well-known/mcp.json
 * but PROTOCOL HANDSHAKE FAILED", then marked `MCP tool listing`, `MCP tool descriptions`,
 * `MCP resources exposed` and `Listed in MCP registries` as "No MCP server detected" — four checks
 * at 0, and the manifest itself at 3/6, for a server that was running the whole time. Any MCP
 * client that discovers us has the same experience: it cannot even ask what we are.
 *
 * ⚠️ OPENING THIS LEAKS NOTHING. `tools/list` returns names, descriptions and input schemas — the
 * same surface `/openapi.json` and `/.well-known/mcp-server-card` already publish to anonymous
 * callers by design. What it does NOT return is any shop's data: every tool that touches data is
 * `tools/call`, which still requires a key AND the tool's scope.
 *
 * ⚠️ AND THE OPEN PATH IS RATE-LIMITED BY IP, because it no longer has a key to key on. Without
 * that, an anonymous caller could hammer a route that parses JSON and allocates on every request.
 */
const MAX_BATCH = 32

export async function POST(req: NextRequest) {
  // ⛔ ORDER MATTERS, AND THE FIRST DRAFT GOT IT WRONG. Auth used to run before anything else, so
  // opening discovery meant `req.json()` became the FIRST thing an anonymous request reached —
  // and the malformed-JSON path returned 400 before the limiter was ever consulted, so a loop of
  // large invalid bodies was never throttled at all. The comment even claimed the route "cannot be
  // used as an allocation pump" while that was true. fable caught it.
  // So: the cheap IP limiter runs FIRST, on every request, before a byte is parsed.
  // ⚠️ A KEYED CALLER IS RESOLVED FIRST, THOUGH, so a partner doing discovery gets its own 600/min
  // key bucket instead of sharing the anonymous 60/min IP bucket with everyone behind its NAT —
  // codex and fable both flagged that demotion.
  const hasCredential = !!req.headers.get('authorization')
  let auth: ApiAuth | null = null
  let rateHeaders: Record<string, string> = {}

  if (hasCredential) {
    const r = await resolveApiKey(req)
    if (!r.ok) {
      // ⛔ A BAD CREDENTIAL FALLS BACK TO THE IP LIMITER, AND IT HAS TO. `hasCredential` is mere
      // header presence, so without this `Authorization: Bearer junk` would skip the anonymous
      // bucket entirely and drive an unthrottled key lookup — free key-space probing, on the one
      // path where throttling matters most. codex caught that the comment above ("the cheap IP
      // limiter runs FIRST, on every request") was false for exactly this case.
      const rl = await rateLimit('mcp-discovery', clientIp(req), 60, '1 m')
      return new Response(JSON.stringify(rpcError(null, -32001, r.message)), {
        status: rl.success ? r.status : 429,
        headers: {
          'content-type': 'application/json',
          'WWW-Authenticate': 'Bearer',
          ...(rl.success ? {} : { 'Retry-After': String(rl.resetSec) }),
          ...CORS,
        },
      })
    }
    auth = r.auth
    rateHeaders = { 'X-RateLimit-Limit': String(r.rate.limit), 'X-RateLimit-Remaining': String(r.rate.remaining) }
  } else {
    const rl = await rateLimit('mcp-discovery', clientIp(req), 60, '1 m')
    if (!rl.success) {
      return new Response(JSON.stringify(rpcError(null, -32001, 'Too many discovery requests. Slow down.')), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': String(rl.resetSec), ...CORS },
      })
    }
    rateHeaders = { 'X-RateLimit-Limit': String(rl.limit), 'X-RateLimit-Remaining': String(rl.remaining) }
  }

  let body: unknown
  try { body = await req.json() } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers: CORS }) }

  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Rpc[]

  // ⛔ THE LIMITER COUNTS REQUESTS, NOT MESSAGES — so without this cap one allowed request could
  // carry 50,000 batched messages and `Promise.all` would execute every one. 60 requests/min times
  // an unbounded batch is an unbounded amount of work per minute. fable's catch.
  if (messages.length > MAX_BATCH) {
    return Response.json(rpcError(null, -32600, `Batch too large: ${messages.length} messages, maximum ${MAX_BATCH}.`), { status: 400, headers: { ...rateHeaders, ...CORS } })
  }

  // A credential is required to EXECUTE. Discovery needs none.
  const needsAuth = messages.some((m) => m && typeof m === 'object' && (m as Rpc).method === 'tools/call')
  if (needsAuth && !auth) {
    // ⚠️ The caller's id is preserved when there is exactly one message, so a client can still
    // correlate the failure — `id: null` on a single request violates JSON-RPC 2.0. codex's catch.
    const id = !batch && messages[0] && typeof messages[0] === 'object' ? (messages[0].id ?? null) : null
    return new Response(JSON.stringify(rpcError(id, -32001, 'This tool needs an API key. Send it as `Authorization: Bearer eno_live_…`.')), {
      status: 401,
      headers: { 'content-type': 'application/json', 'WWW-Authenticate': 'Bearer', ...rateHeaders, ...CORS },
    })
  }

  const responses = (await Promise.all(messages.map((m) => handleMessage(m, auth)))).filter((x): x is object => x !== null)

  // Only notifications/responses in the payload → nothing to return (202, per spec).
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })

  return Response.json(batch ? responses : responses[0], { headers: { ...rateHeaders, ...CORS } })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  // No server-initiated stream — this server is request/response only.
  return new Response(JSON.stringify(rpcError(null, -32601, 'GET not supported; use POST.')), {
    status: 405,
    headers: { 'content-type': 'application/json', Allow: 'POST, OPTIONS', ...CORS },
  })
}
