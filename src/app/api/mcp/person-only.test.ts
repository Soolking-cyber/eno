import { describe, expect, it, vi } from 'vitest'

/**
 * A CHAT-ONLY connection (a person-only sign-in grant: no shop, sellerId '' — oauth-grant.ts connectTarget, 2026-11-17)
 * reaches the chat tools and is told plainly, never "missing scope", that a shop tool needs a business shop.
 */
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 59, limit: 60, resetSec: 60, windowSec: 60 })),
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: vi.fn(async () => ({ ok: true, auth: { keyId: 'k1', sellerId: '', profileId: 'p1', scopes: new Set(['messages:read', 'messages:write']) }, rate: { limit: 600, remaining: 599 } })),
  API_RATE_PER_MIN: 600,
  API_RATE_WINDOW_SEC: 60,
}))
vi.mock('@/lib/mcp/tools', async () => {
  const { z } = await import('zod')
  class ToolError extends Error {
    constructor(public code: string, message: string, public detail?: string) { super(message) }
  }
  return {
    ToolError,
    toolDescriptors: () => [],
    TOOLS_BY_NAME: new Map([
      ['create_listing', { scope: 'listings:write', input: z.object({}), handler: async () => ({ created: true }) }],
      ['list_conversations', { scope: 'messages:read', input: z.object({}), handler: async () => ({ conversations: [] }) }],
    ]),
  }
})

const { POST } = await import('./route')
const call = async (name: string) => {
  const res = await POST(new Request('https://eno.vn/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
  }) as never)
  const body = await res.json()
  return { isError: !!body.result.isError, payload: JSON.parse(body.result.content[0].text) }
}

describe('POST /api/mcp — a chat-only connection', () => {
  it('runs the chat tools', async () => {
    expect(await call('list_conversations')).toEqual({ isError: false, payload: { conversations: [] } })
  })
  it('is told a shop tool needs a business shop (no_shop), not a bare missing scope', async () => {
    const r = await call('create_listing')
    expect(r.isError).toBe(true)
    expect(r.payload.error.code).toBe('no_shop')
  })
})
