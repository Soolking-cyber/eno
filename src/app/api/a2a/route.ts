import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { readJsonCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/handler'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { A2A_ERR, handleA2A, requestedVersion, rpcError, searchRunner, type Rpc } from '@/lib/a2a/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/a2a — the A2A JSON-RPC endpoint the Agent Card names (src/lib/a2a/agent.ts says what it answers).
 *
 * ⛔ RATE LIMITS, AS ON /api/mcp/search: requests per IP before a byte is parsed, then each skill call per IP and in a
 * GLOBAL bucket of its OWN (`a2a-call-all`): sharing the search MCP server's would let anonymous A2A traffic lock MCP
 * search clients out (gate review 2026-11-17). The two globals together are the origin's ceiling for these searches.
 * One request per POST: A2A defines no batches, so an array is Invalid Request.
 */

const REQUESTS_PER_IP_PER_MIN = 300
const CALLS_PER_IP_PER_MIN = 120
const CALLS_GLOBAL_PER_MIN = 1200 // half the search MCP server's: A2A is the smaller door
const MAX_BODY_BYTES = 32 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*', // no credential exists on this endpoint, so no origin can borrow one
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, A2A-Version, A2A-Extensions',
  'Access-Control-Max-Age': '86400',
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } })

export async function POST(req: Request) {
  const ip = clientIp(req)
  const rl = await rateLimit('a2a-ip', ip, REQUESTS_PER_IP_PER_MIN, '1 m')
  if (!rl.success) return json(rpcError(null, A2A_ERR.internal, 'Too many requests. Slow down.'), 429, { 'Retry-After': String(rl.resetSec) })

  let body: unknown
  try {
    body = await readJsonCapped(req, MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) return json(rpcError(null, A2A_ERR.invalidRequest, `Request too large: at most ${MAX_BODY_BYTES} bytes.`), 413)
    return json(rpcError(null, A2A_ERR.parse, 'Invalid JSON payload'), 400)
  }
  if (Array.isArray(body)) return json(rpcError(null, A2A_ERR.invalidRequest, 'Send one JSON-RPC request per POST.'), 400)

  const rpc = body && typeof body === 'object' ? (body as Rpc) : null
  const rpcId = rpc && (typeof rpc.id === 'string' || typeof rpc.id === 'number') ? rpc.id : null
  const v = requestedVersion(req, rpc?.method)
  if (typeof v !== 'string') return json(rpcError(rpcId, A2A_ERR.version, `A2A version ${v.unsupported} is not supported; this agent speaks 1.0 and 0.3.`), 400)

  const run = searchRunner(async () => {
    // ⛔ IN ORDER, NOT TOGETHER: a call this address's own bucket refuses must not also spend the global one.
    const perIp = await rateLimit('a2a-call-ip', ip, CALLS_PER_IP_PER_MIN, '1 m')
    return perIp.success && (await rateLimit('a2a-call-all', 'all', CALLS_GLOBAL_PER_MIN, '1 m')).success
  })
  try {
    const answer = await handleA2A(body as Rpc, v, run)
    return answer ? json(answer) : new Response(null, { status: 202, headers: CORS })
  } catch (e) {
    console.error('[a2a] request failed', e)
    return json(rpcError(rpcId, A2A_ERR.internal, 'Internal error'), 500)
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

/** A browser lands on the developer page; anything else learns the method. */
export async function GET(req: Request) {
  if ((req.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(null, { status: 302, headers: { Location: `${OAUTH_ISSUER}/developers#a2a`, Vary: 'Accept', ...CORS } })
  }
  return json(rpcError(null, A2A_ERR.methodNotFound, 'Use POST with a JSON-RPC 2.0 request. The Agent Card is at /.well-known/agent-card.json.'), 405, { Allow: 'POST, OPTIONS', Vary: 'Accept' })
}
