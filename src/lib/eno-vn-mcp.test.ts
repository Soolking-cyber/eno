import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// Plain ESM (packages/eno-vn-mcp ships JavaScript only); allowJs reads its JSDoc types.
import { createBridge, pickServer, sseMessages, UsageError, USAGE } from '../../packages/eno-vn-mcp/bin/eno-vn-mcp.mjs'

/**
 * eno-vn-mcp (packages/eno-vn-mcp, published to npm as `eno-vn-mcp`; owner 2026-11-16): a stdio bridge to the hosted MCP
 * servers. Offline: the bridge takes an injected fetch and writer.
 */
type Reply = { status?: number; body?: unknown; raw?: string; type?: string; headers?: Record<string, string> }
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string; redirect: string } }> = []
  let i = 0
  const impl = async (url: string, init: { headers: Record<string, string>; body: string; redirect: string }) => {
    calls.push({ url, init })
    const r = replies[Math.min(i++, replies.length - 1)]
    const h: Record<string, string> = { 'content-type': r.type ?? 'application/json', ...(r.headers ?? {}) }
    return { status: r.status ?? 200, headers: { get: (n: string) => h[n.toLowerCase()] ?? null }, text: async () => r.raw ?? JSON.stringify(r.body) }
  }
  return { calls, impl }
}
function bridgeWith(replies: Reply[], key: string | null = null) {
  const out: unknown[] = []
  const f = fakeFetch(replies)
  const bridge = createBridge({ url: 'https://eno.vn/api/mcp/search', key, write: (m: unknown) => out.push(m), fetchImpl: f.impl })
  return { bridge, out, calls: f.calls }
}
const line = (m: unknown) => JSON.stringify(m)
const KEY = `eno_live_${'A'.repeat(32)}`

describe('eno-vn-mcp: which server', () => {
  it('search without a key, shop with one, and --server picks', () => {
    expect(pickServer([], {})).toEqual({ name: 'search', url: 'https://eno.vn/api/mcp/search', key: null })
    expect(pickServer([], { ENO_API_KEY: KEY })).toEqual({ name: 'shop', url: 'https://eno.vn/api/mcp', key: KEY })
    expect(pickServer(['--server', 'docs'], {}).url).toBe('https://eno.vn/api/mcp/docs')
    expect(pickServer(['--server=search'], { ENO_API_KEY: KEY }).name).toBe('search')
  })

  it('⛔ the key goes to the shop server ONLY', () => {
    expect(pickServer(['--server', 'search'], { ENO_API_KEY: KEY }).key).toBeNull()
    expect(pickServer(['--server', 'docs'], { ENO_API_KEY: KEY }).key).toBeNull()
  })

  it('refuses: shop without a key, an unknown server or argument, a placeholder key, a non-https or non-origin base', () => {
    expect(() => pickServer(['--server', 'shop'], {})).toThrow(UsageError)
    expect(() => pickServer(['--server', 'admin'], {})).toThrow(/search, docs or shop/)
    expect(() => pickServer(['--server', 'constructor'], {})).toThrow(UsageError)
    expect(() => pickServer(['--verbose'], {})).toThrow(/unknown argument/)
    expect(() => pickServer([], { ENO_API_KEY: 'eno_live_…' })).toThrow(/placeholder/)
    expect(() => pickServer([], { ENO_BASE_URL: 'http://eno.vn' })).toThrow(/https/)
    expect(() => pickServer([], { ENO_BASE_URL: 'https://eno.vn/x' })).toThrow(/bare origin/)
    expect(pickServer([], { ENO_BASE_URL: 'http://localhost:3000' }).url).toBe('http://localhost:3000/api/mcp/search')
  })

  it('the usage names every server and the client config', () => {
    for (const s of ['search', 'docs', 'shop', 'ENO_API_KEY', '"command": "npx"', 'https://eno.vn/developers/mcp']) expect(USAGE).toContain(s)
  })
})

describe('eno-vn-mcp: the bridge', () => {
  it('forwards each message as the POST body, writes the answer, and carries the agreed version after initialize', async () => {
    const { bridge, out, calls } = bridgeWith([
      { body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'eno.vn Search' } } } },
      { status: 202, raw: '' },
      { body: { jsonrpc: '2.0', id: 2, result: { tools: [] } } },
    ])
    await bridge.handle(line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
    await bridge.handle(line({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    await bridge.handle(line({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    expect(calls).toHaveLength(3)
    expect(JSON.parse(calls[0].init.body).method).toBe('initialize')
    expect(calls[0].init.headers['mcp-protocol-version']).toBeUndefined()
    expect(calls[2].init.headers['mcp-protocol-version']).toBe('2025-06-18')
    expect(calls[0].init.headers.accept).toBe('application/json, text/event-stream')
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.headers.authorization).toBeUndefined()
    // The notification's 202 writes nothing.
    expect(out.map((m) => (m as { id: unknown }).id)).toEqual([1, 2])
  })

  it('a message sent while initialize is in flight waits for it', async () => {
    let release!: () => void
    const order: string[] = []
    const out: unknown[] = []
    const bridge = createBridge({
      url: 'u', key: null, write: (m: unknown) => out.push(m),
      fetchImpl: async (_u: string, init: { body: string; headers: Record<string, string> }) => {
        const m = JSON.parse(init.body)
        order.push(`${m.method}:${init.headers['mcp-protocol-version'] ?? '-'}`)
        if (m.method === 'initialize') await new Promise<void>((r) => { release = r })
        return { status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25' } }) }
      },
    })
    const a = bridge.handle(line({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const b = bridge.handle(line({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['initialize:-'])
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['initialize:-', 'tools/list:2025-11-25'])
  })

  it('sends the key as the Bearer token when it has one', async () => {
    const { bridge, calls } = bridgeWith([{ body: { jsonrpc: '2.0', id: 1, result: {} } }], KEY)
    await bridge.handle(line({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('⛔ an error the server could not tie to a request (id null) comes back on the request\'s own id', async () => {
    const { bridge, out } = bridgeWith([{ status: 401, body: { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or malformed API key.' } } }])
    await bridge.handle(line({ jsonrpc: '2.0', id: 'a1', method: 'initialize' }))
    expect(out).toEqual([{ jsonrpc: '2.0', id: 'a1', error: { code: -32001, message: 'Missing or malformed API key.' } }])
  })

  it('⛔ every request is answered: a network failure, a non-MCP reply, a redirect', async () => {
    const out: unknown[] = []
    const down = createBridge({ url: 'u', key: null, write: (m: unknown) => out.push(m), fetchImpl: async () => { throw new Error('ECONNRESET') } })
    await down.handle(line({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))
    expect(out[0]).toMatchObject({ id: 3, error: { code: -32603 } })
    const html = bridgeWith([{ status: 502, type: 'text/html', raw: '<html>Bad gateway</html>' }])
    await html.bridge.handle(line({ jsonrpc: '2.0', id: 4, method: 'tools/call' }))
    expect(html.out[0]).toMatchObject({ id: 4, error: { message: expect.stringContaining('HTTP 502') } })
    const moved = bridgeWith([{ status: 308, raw: '', headers: { location: 'https://elsewhere.example/' } }])
    await moved.bridge.handle(line({ jsonrpc: '2.0', id: 5, method: 'tools/list' }))
    expect(moved.out[0]).toMatchObject({ id: 5, error: { message: expect.stringContaining('redirect') } })
    // …but a failed NOTIFICATION gets no answer: it never expects one.
    out.length = 0
    await down.handle(line({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(out).toEqual([])
  })

  it('⛔ a notification never gets an answer — not even the server\'s id-null error for it', async () => {
    const { bridge, out } = bridgeWith([{ status: 401, body: { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Revoked key.' } } }], KEY)
    await bridge.handle(line({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(out).toEqual([])
  })

  it('⛔ only JSON-RPC reaches the client: an edge error body that is JSON but not MCP becomes the bridge\'s own error', async () => {
    const { bridge, out } = bridgeWith([{ status: 429, body: { error: 'rate limited' } }])
    await bridge.handle(line({ jsonrpc: '2.0', id: 6, method: 'tools/call' }))
    expect(out).toEqual([{ jsonrpc: '2.0', id: 6, error: { code: -32603, message: expect.stringContaining('HTTP 429') } }])
  })

  it('a line that is not JSON gets a parse error; a blank line is ignored', async () => {
    const { bridge, out, calls } = bridgeWith([])
    await bridge.handle('{not json')
    await bridge.handle('   ')
    expect(out).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32700, message: expect.any(String) } }])
    expect(calls).toHaveLength(0)
  })

  it('a request the server sends in a stream does not count as the answer to the client\'s request of the same id', async () => {
    const { bridge, out } = bridgeWith([{ type: 'text/event-stream', raw: 'data: {"jsonrpc":"2.0","id":1,"method":"sampling/createMessage"}\n\n' }])
    await bridge.handle(line({ jsonrpc: '2.0', id: 1, method: 'tools/call' }))
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 1, error: { code: -32603 } })
  })

  it('reads a text/event-stream answer too', async () => {
    expect(sseMessages('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\ndata: not json\n\n')).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
    const { bridge, out } = bridgeWith([{ type: 'text/event-stream', raw: 'data: {"jsonrpc":"2.0","id":9,"result":{"ok":true}}\n\n' }])
    await bridge.handle(line({ jsonrpc: '2.0', id: 9, method: 'ping' }))
    expect(out).toEqual([{ jsonrpc: '2.0', id: 9, result: { ok: true } }])
  })
})

describe('eno-vn-mcp: the package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/eno-vn-mcp/package.json', import.meta.url), 'utf8'))
  it('is what ora.ai and npx look for: "mcp" in the name, a bin, the homepage on eno.vn, no dependencies', () => {
    expect(pkg.name).toBe('eno-vn-mcp')
    expect(pkg.bin).toEqual({ 'eno-vn-mcp': 'bin/eno-vn-mcp.mjs' })
    expect(pkg.homepage).toBe('https://eno.vn/developers/mcp')
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.files).toContain('bin/eno-vn-mcp.mjs')
  })
  it('its version is the one the program reports', () => {
    expect(readFileSync(new URL('../../packages/eno-vn-mcp/bin/eno-vn-mcp.mjs', import.meta.url), 'utf8')).toContain(`export const VERSION = '${pkg.version}'`)
  })
})
