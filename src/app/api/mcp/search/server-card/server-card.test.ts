import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 1, limit: 1, resetSec: 30, windowSec: 60 }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
const { GET } = await import('./route')
const { searchServerCard } = await import('@/lib/mcp/search-server-card')
const { POST } = await import('../route')

const req = (accept = '') => new Request('https://eno.vn/api/mcp/search/server-card', { headers: { accept } }) as never

describe('the listing-search server card (<server>/server-card)', () => {
  it('describes /api/mcp/search, keyless, in the card shape', async () => {
    const res = GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const card = await res.json()
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/search$/)
    expect(card.remotes).toHaveLength(1)
    expect(card.remotes[0]).toMatchObject({ type: 'streamable-http' })
    expect(card.remotes[0].url).toMatch(/\/api\/mcp\/search$/)
    expect(card.remotes[0].headers).toBeUndefined()
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(JSON.stringify(card)).not.toMatch(/visa|itinerar|paypal/i)
  })
  it('labels the card type only when it is asked for and not refused', () => {
    expect(GET(req('application/mcp-server-card+json')).headers.get('content-type')).toMatch(/^application\/mcp-server-card\+json/)
    expect(GET(req('application/json, application/mcp-server-card+json;q=0')).headers.get('content-type')).toMatch(/^application\/json/)
    expect(GET(req('application/mcp-server-card+json;profile=x;q=0, application/json;q=1')).headers.get('content-type')).toMatch(/^application\/json/)
    expect(GET(req('application/mcp-server-card+json;q=0.5')).headers.get('content-type')).toMatch(/^application\/mcp-server-card\+json/)
  })
  it('its name is the key the site-wide card\'s mcpServers map gives the search server, at the same URL', async () => {
    const { GET: siteCard } = await import('@/app/api/well-known/mcp-server-card/route')
    const site = await siteCard(new Request('https://eno.vn/.well-known/mcp.json') as never).json()
    const card = searchServerCard()
    expect(site.mcpServers[card.name]).toEqual({ url: card.remotes[0].url, transport: 'streamable-http' })
  })
  it('every protocol version on the card is one the search server\'s initialize accepts', async () => {
    for (const v of searchServerCard().remotes[0].supportedProtocolVersions) {
      const res = await POST(new Request('https://eno.vn/api/mcp/search', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
      }))
      const body = await res.json()
      expect(body.result.protocolVersion).toBe(v)
      expect(body.result.serverInfo.version).toBe(searchServerCard().version)
    }
  })
})
