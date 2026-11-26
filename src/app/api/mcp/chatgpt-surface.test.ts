import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ⛔ THE CHATGPT ADDRESS HIDES THE AD-BUYING TOOLS, AND ONLY THERE (owner, 2026-11-26; route.ts Surface).
 * Both directions: /api/mcp/chatgpt never lists or runs get_ad_offer / promote_listing / create_ad, and /api/mcp keeps
 * them for every other client. Its 401 names its own metadata document, which names it exactly (RFC 9728 §3.3), and the
 * authorization server accepts it as a resource.
 */

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 59, limit: 60, resetSec: 60, windowSec: 60 })),
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: vi.fn(async () => ({ ok: false, status: 401, code: 'unauthorized', message: 'Missing or malformed API key.' })),
  API_RATE_PER_MIN: 600,
  API_RATE_WINDOW_SEC: 60,
}))

const HIDDEN = ['get_ad_offer', 'promote_listing', 'create_ad']
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://eno.vn${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as never
const names = async (res: Response) => ((await res.json()).result.tools as { name: string }[]).map((t) => t.name)

describe('the ChatGPT address of the MCP server', { timeout: 20_000 }, () => {
  beforeEach(() => vi.resetModules())

  it('lists every tool but the three ad-buying ones; /api/mcp still lists them', async () => {
    const { POST } = await import('./chatgpt/route')
    const chatgpt = await names(await POST(post('/api/mcp/chatgpt', { jsonrpc: '2.0', id: 1, method: 'tools/list' })))
    const full = await names(await (await import('./route')).POST(post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })))
    for (const n of HIDDEN) {
      expect(full).toContain(n)
      expect(chatgpt).not.toContain(n)
    }
    expect(chatgpt).toEqual(full.filter((n) => !HIDDEN.includes(n)))
    expect(chatgpt).toEqual(expect.arrayContaining(['search_listings', 'list_ads', 'get_ad_stats', 'send_message']))
  })

  it('a trailing slash is the same address', async () => {
    const { POST } = await import('./chatgpt/route')
    expect(await names(await POST(post('/api/mcp/chatgpt/', { jsonrpc: '2.0', id: 1, method: 'tools/list' })))).not.toContain('promote_listing')
  })

  it('introduces itself without the ads, and the full address still offers them', async () => {
    const { POST } = await import('./chatgpt/route')
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }
    const c = (await (await POST(post('/api/mcp/chatgpt', init))).json()).result
    expect(c.instructions).not.toMatch(/promote_listing|get_ad_offer|USDC|x402|an ad the shop pays/)
    expect(c.instructions).toMatch(/no tool makes a payment/)
    expect(c.serverInfo.description).not.toMatch(/ads/)
    const f = (await (await (await import('./route')).POST(post('/api/mcp', init))).json()).result
    expect(f.instructions).toMatch(/promote_listing buys an ad/)
  })

  it('a hidden tool is unknown there, even with a credential', async () => {
    const auth = await import('@/lib/api/auth')
    vi.mocked(auth.resolveApiKey).mockResolvedValueOnce({
      ok: true,
      auth: { keyId: 'k', sellerId: 's', profileId: 'p', scopes: new Set(['ads:write', 'listings:read', 'listings:write']) },
      rate: { limit: 600, remaining: 599 },
    } as never)
    const { POST } = await import('./chatgpt/route')
    const res = await POST(post('/api/mcp/chatgpt', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'promote_listing', arguments: { listingId: 'x' } } }, { authorization: 'Bearer eno_live_x' }))
    const body = await res.json()
    expect(body.error).toEqual({ code: -32602, message: 'Unknown tool: promote_listing' })
  })

  it('an anonymous call to a hidden tool is unknown, not a sign-in prompt', async () => {
    const { POST } = await import('./chatgpt/route')
    const res = await POST(post('/api/mcp/chatgpt', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_ad', arguments: {} } }))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toEqual({ code: -32602, message: 'Unknown tool: create_ad' })
    const full = await (await import('./route')).POST(post('/api/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_ad', arguments: {} } }))
    expect(full.status).toBe(401)
  })

  it('its 401 names its own metadata document, which names the address exactly', async () => {
    const { OAUTH_ISSUER } = await import('@/lib/api/oauth')
    const { POST } = await import('./chatgpt/route')
    const res = await POST(post('/api/mcp/chatgpt', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_listings' } }))
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${OAUTH_ISSUER}/.well-known/oauth-protected-resource/api/mcp/chatgpt"`)
    const full = await (await import('./route')).POST(post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_listings' } }))
    expect(full.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${OAUTH_ISSUER}/.well-known/oauth-protected-resource/api/mcp"`)
    const { GET } = await import('../well-known/oauth-protected-resource/mcp-chatgpt/route')
    expect((await (await GET()).json()).resource).toBe(`${OAUTH_ISSUER}/api/mcp/chatgpt`)
  })

  it('the authorization server accepts the address as a resource, and nothing near it', async () => {
    const { OAUTH_ISSUER } = await import('@/lib/api/oauth')
    const { isMcpResource } = await import('@/lib/api/oauth-grant')
    const o = OAUTH_ISSUER
    for (const r of [`${o}/api/mcp`, `${o}/api/mcp/`, `${o}/api/mcp/chatgpt`, `${o}/api/mcp/chatgpt/`]) expect(isMcpResource(r), r).toBe(true)
    for (const r of [`${o}/api/mcp/chatgpt2`, `${o}/api/mcp/other`, o, `${o}/api/v1`, 'https://evil.test/api/mcp/chatgpt']) expect(isMcpResource(r), r).toBe(false)
  })
})
