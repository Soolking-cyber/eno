import { NextRequest } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
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
async function handleMessage(msg: Rpc, auth: ApiAuth): Promise<object | null> {
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
        serverInfo: { name: 'eno.vn Partner API', version: '1.0.0' },
        instructions:
          'Manage an eno.vn storefront: list/create/update/delete listings, bulk-import, sync a catalogue by your own externalId, read analytics, and manage webhooks. Every action is scoped to the one shop behind the API key.',
      })
    }
    case 'ping':
      return rpcResult(msg.id, {})
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolDescriptors() })
    case 'tools/call': {
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

export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req)
  if (!r.ok) {
    return new Response(JSON.stringify(rpcError(null, -32001, r.message)), {
      status: r.status,
      headers: { 'content-type': 'application/json', 'WWW-Authenticate': 'Bearer', ...CORS },
    })
  }

  let body: unknown
  try { body = await req.json() } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers: CORS }) }

  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Rpc[]
  const responses = (await Promise.all(messages.map((m) => handleMessage(m, r.auth)))).filter((x): x is object => x !== null)

  // Only notifications/responses in the payload → nothing to return (202, per spec).
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })

  return Response.json(batch ? responses : responses[0], {
    headers: { 'X-RateLimit-Limit': String(r.rate.limit), 'X-RateLimit-Remaining': String(r.rate.remaining), ...CORS },
  })
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
