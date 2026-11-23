import { describe, expect, it, vi } from 'vitest'

/**
 * x402 over MCP (specs/transports-v2/mcp.md; owner 2026-11-23, paid ads): the route hands a tool the call's params._meta,
 * answers an unpaid call with the PaymentRequired object as BOTH structuredContent and content[0].text in an isError
 * result (never the `{error}` envelope), and puts a paid tool's settlement in result._meta.
 */
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: true, remaining: 59, limit: 60, resetSec: 60, windowSec: 60 })) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: vi.fn(async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599 } })),
  API_RATE_PER_MIN: 600,
  API_RATE_WINDOW_SEC: 60,
}))
const PR = { x402Version: 2, error: 'Payment required to buy this ad', resource: { url: 'https://eno.vn/api/mcp' }, accepts: [{ scheme: 'exact', network: 'eip155:8453' }] }
const SETTLED = { success: true, transaction: `0x${'c'.repeat(64)}`, network: 'eip155:8453' }
vi.mock('@/lib/mcp/tools', async () => {
  const { z } = await import('zod')
  const { ToolError, ToolPaymentRequired, ToolResultWithMeta } = await import('@/lib/mcp/tool-types')
  const paid = {
    scope: 'listings:write',
    input: z.object({ listingId: z.string() }),
    handler: async (_a: unknown, _args: unknown, ctx?: { meta?: Record<string, unknown> }) => {
      if (!ctx?.meta?.['x402/payment']) throw new ToolPaymentRequired(PR)
      return new ToolResultWithMeta({ ad: { id: 'ad1' }, message: null }, { 'x402/payment-response': SETTLED })
    },
  }
  return { ToolError, toolDescriptors: () => [], TOOLS_BY_NAME: new Map([['promote_listing', paid]]) }
})

const { POST } = await import('./route')
const call = async (meta?: Record<string, unknown>) => {
  const res = await POST(new Request('https://eno.vn/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer eno_live_test' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'promote_listing', arguments: { listingId: 'l1' }, ...(meta ? { _meta: meta } : {}) } }),
  }) as never)
  return (await res.json()).result
}

describe('POST /api/mcp — x402 transport', () => {
  it('unpaid: isError with the PaymentRequired as structuredContent and as content[0].text', async () => {
    const r = await call()
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toEqual(PR)
    expect(JSON.parse(r.content[0].text)).toEqual(PR)
    expect(r._meta).toBeUndefined()
  })

  it('paid (params._meta["x402/payment"]): the tool\'s answer, with the settlement in result._meta', async () => {
    const r = await call({ 'x402/payment': { x402Version: 2 } })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toEqual({ ad: { id: 'ad1' }, message: null })
    expect(JSON.parse(r.content[0].text)).toEqual({ ad: { id: 'ad1' }, message: null })
    expect(r._meta).toEqual({ 'x402/payment-response': SETTLED })
  })
})
