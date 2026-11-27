import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ⛔ THE SERVER SPEAKS MCP 2026-07-28 BESIDE THE HANDSHAKE ERA (2026-11-27, src/lib/mcp/modern.ts).
 * A request whose params._meta names 2026-07-28 is served by that revision: no handshake, headers checked against the body,
 * resultType/serverInfo on every result, cache hints on lists and reads, server/discover. A request without it is served
 * exactly as before — the second half of this file pins that the legacy answers did not gain a single field.
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

const V = '2026-07-28'
const META = { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} }
type Body = { jsonrpc: string; id?: number; method: string; params?: Record<string, unknown> }
/** A 2026-07-28 request: _meta in the body, the mirrored headers on the POST (overridable). */
const modern = (method: string, params: Record<string, unknown> = {}, headers: Record<string, string | null> = {}, path = '/api/mcp') => {
  const name = method === 'resources/read' ? params.uri : params.name
  const base: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': V,
    'mcp-method': method,
    ...(typeof name === 'string' ? { 'mcp-name': name } : {}),
  }
  for (const [k, v] of Object.entries(headers)) { if (v === null) delete base[k]; else base[k] = v }
  return new Request(`https://eno.vn${path}`, { method: 'POST', headers: base, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: META } }) }) as never
}
const legacy = (body: Body | Body[], headers: Record<string, string> = {}) =>
  new Request('https://eno.vn/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as never

describe('MCP 2026-07-28 requests', { timeout: 20_000 }, () => {
  beforeEach(() => vi.resetModules())

  it('tools/list: the same tools, with resultType, the cache hints and the server\'s identity', async () => {
    const { POST } = await import('./route')
    const res = await POST(modern('tools/list'))
    expect(res.status).toBe(200)
    const { result, id } = await res.json()
    expect(id).toBe(7)
    expect(result.resultType).toBe('complete')
    expect(result.ttlMs).toBeGreaterThan(0)
    expect(result.cacheScope).toBe('public')
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('eno Agentic Commerce')
    const old = await (await POST(legacy({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).json()
    expect(result.tools).toEqual(old.result.tools)
  })

  it('server/discover: every version spoken, the capabilities and the instructions — in both eras', async () => {
    const { POST } = await import('./route')
    const { result } = await (await POST(modern('server/discover'))).json()
    expect(result.supportedVersions).toEqual(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
    expect(result.capabilities.tools).toBeDefined()
    expect(result.capabilities.extensions).toEqual({ 'io.modelcontextprotocol/ui': {} })
    expect(result.instructions).toMatch(/search_listings/)
    expect(result).toMatchObject({ resultType: 'complete', cacheScope: 'public' })
    expect(result._meta['io.modelcontextprotocol/serverInfo'].version).toBeTruthy()
    // A probe with no _meta (a client finding out which era this is) gets the same answer.
    const probe = await (await POST(legacy({ jsonrpc: '2.0', id: 2, method: 'server/discover' }))).json()
    expect(probe.result.supportedVersions).toEqual(result.supportedVersions)
  })

  it('a public tool runs with no sign-in and answers as this revision', async () => {
    const { POST } = await import('./route')
    const { result } = await (await POST(modern('tools/call', { name: 'list_categories', arguments: {} }))).json()
    expect(result.resultType).toBe('complete')
    expect(result.isError).toBeFalsy()
    expect(Array.isArray(result.structuredContent.categories)).toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
    expect(result).not.toHaveProperty('ttlMs')
  })

  it('a shop tool still needs the sign-in: 401 with the challenge that names it', async () => {
    const { POST } = await import('./route')
    const res = await POST(modern('tools/call', { name: 'list_listings', arguments: {} }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=/)
  })

  it('ping and unknown methods are 404 + -32601; initialize selects the handshake era; a missing resource is -32602', async () => {
    const { POST } = await import('./route')
    for (const m of ['ping', 'prompts/list', 'subscriptions/listen']) {
      const res = await POST(modern(m))
      expect(res.status, m).toBe(404)
      expect((await res.json()).error.code).toBe(-32601)
    }
    // "An initialize request selects legacy semantics" (basic/versioning), whatever its _meta and headers say.
    const init = await POST(modern('initialize', { protocolVersion: V }))
    expect(init.status).toBe(200)
    expect((await init.json()).result.protocolVersion).toBe('2025-11-25')
    expect((await (await POST(modern('resources/read', { uri: 'ui://nope' }))).json()).error.code).toBe(-32602)
  })

  it('a notification has no header rules: 202, even with a 2026-07-28 header', async () => {
    const { POST } = await import('./route')
    const res = await POST(new Request('https://eno.vn/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': V }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }) as never)
    expect(res.status).toBe(202)
  })

  it('a handshake version in _meta is served as that version, but its header must match it', async () => {
    const { POST } = await import('./route')
    const at = (header: string) => new Request('https://eno.vn/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': header }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } }) }) as never
    const ok = await POST(at('2025-11-25'))
    expect(ok.status).toBe(200)
    expect(Object.keys((await ok.json()).result)).toEqual(['tools'])
    const bad = await POST(at(V))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe(-32020)
  })

  it('a resource read carries the cache hints', async () => {
    const { POST } = await import('./route')
    const list = await (await POST(modern('resources/list'))).json()
    const uri = list.result.resources[0].uri as string
    const { result } = await (await POST(modern('resources/read', { uri }))).json()
    expect(result.contents[0].uri).toBe(uri)
    expect(result).toMatchObject({ resultType: 'complete', cacheScope: 'public' })
  })

  it('headers that do not mirror the body: 400 HeaderMismatch (-32020), nothing run', async () => {
    const { POST } = await import('./route')
    for (const req of [
      modern('tools/list', {}, { 'mcp-protocol-version': null }),
      modern('tools/list', {}, { 'mcp-method': null }),
      modern('tools/list', {}, { 'mcp-method': 'tools/call' }),
      modern('tools/call', { name: 'list_categories', arguments: {} }, { 'mcp-name': 'search_listings' }),
      modern('tools/call', { name: 'list_categories', arguments: {} }, { 'mcp-name': null }),
    ]) {
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe(-32020)
      expect(body.id).toBe(7)
    }
  })

  it('a version this server does not speak: 400 UnsupportedProtocolVersion (-32022) with the list to retry from', async () => {
    const { POST } = await import('./route')
    const res = await POST(new Request('https://eno.vn/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } }),
    }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe(-32022)
    expect(body.error.data).toEqual({ supported: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], requested: '2099-01-01' })
  })

  it('a 2026-07-28 header on a body without its _meta is served as before (the header alone changes nothing)', async () => {
    // A client that negotiated 2025-11-25 in initialize but stamps its SDK's newest version on the header (commit gate,
    // opus, 2026-11-27): refusing it would break such a client the day its SDK upgrades. Single and batch alike.
    const { POST } = await import('./route')
    const one = await POST(legacy({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { 'mcp-protocol-version': V }))
    expect(one.status).toBe(200)
    expect(Object.keys((await one.json()).result)).toEqual(['tools'])
    const many = await POST(legacy([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', id: 6, method: 'tools/list' }], { 'mcp-protocol-version': V }))
    expect(many.status).toBe(200)
    expect(await many.json()).toHaveLength(2)
  })

  it('a batch is a handshake-era shape: one carrying a 2026-07-28 request is refused', async () => {
    const { POST } = await import('./route')
    const res = await POST(legacy([
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: META } },
    ]))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32600)
  })

  it('the ChatGPT address hides the same tools in this revision', async () => {
    const { POST } = await import('./route')
    const { result } = await (await POST(modern('tools/list', {}, {}, '/api/mcp/chatgpt'))).json()
    const names = (result.tools as { name: string }[]).map((t) => t.name)
    expect(names).not.toContain('create_ad')
    expect(names).toContain('search_listings')
  })
})

describe('the handshake era is untouched', { timeout: 20_000 }, () => {
  beforeEach(() => vi.resetModules())

  it('initialize, ping, tools/list and a batch answer exactly as before: no resultType, no cache hints, no _meta', async () => {
    const { POST } = await import('./route')
    const init = await (await POST(legacy({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }))).json()
    expect(Object.keys(init.result)).toEqual(['protocolVersion', 'capabilities', 'serverInfo', 'instructions'])
    expect(init.result.protocolVersion).toBe('2025-11-25')
    // A client asking for 2026-07-28 through the HANDSHAKE (a legacy client guessing) still negotiates down, as before.
    const guess = await (await POST(legacy({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: V } }))).json()
    expect(guess.result.protocolVersion).toBe('2025-11-25')
    expect((await (await POST(legacy({ jsonrpc: '2.0', id: 2, method: 'ping' }))).json()).result).toEqual({})
    const list = await (await POST(legacy({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-protocol-version': '2025-11-25' }))).json()
    expect(Object.keys(list.result)).toEqual(['tools'])
    const batch = await (await POST(legacy([{ jsonrpc: '2.0', id: 4, method: 'ping' }, { jsonrpc: '2.0', id: 5, method: 'tools/list' }]))).json()
    expect(batch).toHaveLength(2)
    expect(batch[0].result).toEqual({})
  })

  it('an unknown MCP-Protocol-Version header stays lenient (Claude, ChatGPT, Grok, Muse)', async () => {
    const { POST } = await import('./route')
    const res = await POST(legacy({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '2024-01-01' }))
    expect(res.status).toBe(200)
  })

  it('a missing resource keeps its handshake-era code', async () => {
    const { POST } = await import('./route')
    const body = await (await POST(legacy({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://nope' } }))).json()
    expect(body.error.code).toBe(-32002)
  })
})
