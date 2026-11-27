import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { readCapped } from '@/lib/mcp/read-capped'
import { UcpRequestError, ucpError } from './catalog'

/**
 * The UCP catalog routes' shared door (src/lib/ucp/catalog.ts has the protocol). Open to any agent — nothing here is
 * private — so the limits are the MCP search server's: per address and global, a 64 KB body, JSON only. A malformed
 * request is a 400 with a UCP error body; a failure of ours a 500 with one; `UCP-Agent` / `Request-Id` are read, never
 * required (a missing header refused nothing a browser could not already see on the site).
 */
export const UCP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, UCP-Agent, Request-Id, Idempotency-Key, Authorization',
  'Access-Control-Max-Age': '86400',
}
const PER_IP_PER_MIN = 300
const GLOBAL_PER_MIN = 2400
const MAX_BODY = 64 * 1024

export async function ucpPost(req: Request, capability: string, run: (body: unknown) => Promise<{ status?: number; body: object } | object>) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...UCP_CORS }
  const ip = clientIp(req)
  const [one, all] = await Promise.all([rateLimit('ucp-ip', ip, PER_IP_PER_MIN, '1 m'), rateLimit('ucp-global', 'all', GLOBAL_PER_MIN, '1 m')])
  if (!one.success || !all.success) {
    return Response.json(ucpError(capability, 'rate_limited', 'Too many requests; retry shortly.'), { status: 429, headers: { ...headers, 'Retry-After': String((one.success ? all : one).resetSec) } })
  }
  const text = await readCapped(req, MAX_BODY, 'ucp.readBody')
  if (text === null) return Response.json(ucpError(capability, 'invalid_request', `Request too large: at most ${MAX_BODY} bytes.`), { status: 413, headers })
  let body: unknown = {}
  if (text.trim()) {
    try { body = JSON.parse(text) } catch { return Response.json(ucpError(capability, 'invalid_request', 'The body is not valid JSON.'), { status: 400, headers }) }
  }
  try {
    const out = await run(body)
    const withStatus = out as { status?: number; body?: object }
    if (typeof withStatus.status === 'number' && withStatus.body) return Response.json(withStatus.body, { status: withStatus.status, headers })
    return Response.json(out, { headers })
  } catch (e) {
    if (e instanceof UcpRequestError) return Response.json(ucpError(capability, e.code, e.message), { status: 400, headers })
    logError(e, { op: `ucp.${capability}` })
    return Response.json(ucpError(capability, 'internal_error', 'Something went wrong on our side; retry.'), { status: 500, headers })
  }
}
