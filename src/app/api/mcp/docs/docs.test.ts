import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The docs MCP server (src/app/api/mcp/docs/route.ts + src/lib/mcp/docs-tools.ts): two read-only tools over the
 * documents the site already publishes, each built by its own route's GET (mocked here), cached, rate-limited.
 */
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: true, resetSec: 60 })) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
const md = (text: string, status = 200) => new Response(text, { status, headers: { 'content-type': 'text/markdown' } })
vi.mock('@/lib/llms-txt', () => ({ llmsIndexResponse: () => md('# eno.vn\n\n> A classifieds marketplace.\n\n## For developers\n\nThe Partner API and the MCP servers.') }))
vi.mock('@/app/md/agents/route', () => ({ GET: async () => md('# eno.vn for agents\n\n## Rate limits\n\n600 requests per 60s per key; a 429 carries Retry-After.') }))
vi.mock('@/app/md/auth/route', () => ({ GET: async () => md('# Authenticating\n\n## OAuth scopes\n\nlistings:read, listings:write.') }))
vi.mock('@/app/md/pricing/route', () => ({ GET: () => md('Not found', 404) }))

const rpc = async (method: string, params: Record<string, unknown> = {}) => {
  const { POST } = await import('./route')
  const res = await POST(new Request('https://eno.vn/api/mcp/docs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  return (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } }
}
const call = async (name: string, args: Record<string, unknown>) => (await rpc('tools/call', { name, arguments: args })).result as { structuredContent?: Record<string, unknown>; isError?: boolean; content: { text: string }[] }

beforeEach(async () => { (await import('@/lib/mcp/docs-tools')).resetDocsCache() })

describe('docs MCP server', () => {
  it('lists exactly two tools, both read-only', async () => {
    const tools = (await rpc('tools/list')).result!.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[]
    expect(tools.map((t) => t.name)).toEqual(['search_docs', 'get_doc'])
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  it('initialize names the docs server, never the search one, and speaks 2025-11-25 like the other two servers', async () => {
    const init = (await rpc('initialize', { protocolVersion: '2025-06-18' })).result!
    expect((init.serverInfo as { name: string }).name).toMatch(/ Docs$/)
    expect(init.protocolVersion).toBe('2025-06-18')
    expect((await rpc('initialize', { protocolVersion: '2025-11-25' })).result!.protocolVersion).toBe('2025-11-25')
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).result!.protocolVersion).toBe('2025-11-25')
  })

  it('search_docs finds the matching section, heading first, with its document\'s URL', async () => {
    const r = (await call('search_docs', { query: 'rate limits' })).structuredContent!.results as { doc_id: string; section: string; url: string; snippet: string }[]
    expect(r[0]).toMatchObject({ doc_id: 'agents', section: 'Rate limits' })
    expect(r[0].url).toMatch(/\/agents\.md$/)
    expect(r[0].snippet).toContain('600 requests')
    expect((await call('search_docs', { query: 'zzzz' })).structuredContent!.results).toEqual([])
  })

  it('get_doc returns a whole document; a document its route does not serve here (404) is not offered', async () => {
    const d = (await call('get_doc', { id: 'auth' })).structuredContent!
    expect(d).toMatchObject({ id: 'auth', title: 'Authenticating' })
    expect(String(d.text)).toContain('listings:read')
    const missing = await call('get_doc', { id: 'pricing' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('not_found')
  })

  it('calls on a cold cache share ONE load (no stampede), and a cut document says so', async () => {
    const { loadDocs, resetDocsCache } = await import('@/lib/mcp/docs-tools')
    const agents = await import('@/app/md/agents/route')
    const spy = vi.spyOn(agents, 'GET')
    resetDocsCache()
    await Promise.all([loadDocs('o', 5), loadDocs('o', 5), loadDocs('o', 5)])
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await call('get_doc', { id: 'auth' })).structuredContent!.truncated).toBe(false)
  })

  it('a heading inside a code block is code, not a section', async () => {
    const { searchDocs } = await import('@/lib/mcp/docs-tools')
    const r = searchDocs([{ id: 'x', title: 'X', url: 'u', text: '# X\n\n## Install\n\n```sh\n# install the cli\nnpx eno-vn\n```' }], 'install')
    expect(r.map((x) => x.section)).toEqual(['Install'])
  })

  it('a document that FAILED to load is retried after 30 s, not cached as missing for 10 minutes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadDocs, resetDocsCache } = await import('@/lib/mcp/docs-tools')
    const auth = await import('@/app/md/auth/route')
    resetDocsCache()
    vi.spyOn(auth, 'GET').mockRejectedValueOnce(new Error('db hiccup'))
    const t0 = 1_000_000
    expect((await loadDocs('https://eno.vn', t0)).map((d) => d.id)).not.toContain('auth')
    expect((await loadDocs('https://eno.vn', t0 + 29_000)).map((d) => d.id)).not.toContain('auth') // still the short-lived set
    expect((await loadDocs('https://eno.vn', t0 + 31_000)).map((d) => d.id)).toContain('auth')
  })

  it('rejects bad input as a tool error, and an unknown tool as a JSON-RPC error', async () => {
    expect((await call('search_docs', { query: '' })).isError).toBe(true)
    expect((await rpc('tools/call', { name: 'delete_everything', arguments: {} })).error!.message).toContain('Unknown tool')
  })
})

describe('docs MCP server card', () => {
  it('names the docs server at its own URL, with the versions its initialize accepts', async () => {
    const { docsServerCard } = await import('@/lib/mcp/docs-server-card')
    const card = docsServerCard()
    expect(card.remotes[0].url).toMatch(/\/api\/mcp\/docs$/)
    expect(card.name).toMatch(/\/docs$/)
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(card.remotes[0].supportedProtocolVersions).toEqual(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
    // …and they are the versions its initialize accepts (the same list as the search server's card).
    const { searchServerCard } = await import('@/lib/mcp/search-server-card')
    expect(card.remotes[0].supportedProtocolVersions).toEqual(searchServerCard().remotes[0].supportedProtocolVersions)
  })
})
