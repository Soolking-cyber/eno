// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildWebmcpScript, SITE_TEXT_ONLY_TOOLS, WEBMCP_HEADERS, type WebMcpDescriptor } from './webmcp-script'

/**
 * WebMCP (/webmcp.js, built by src/lib/webmcp-script.ts from the search server's tool list, loaded by a plain <script src>
 * in src/app/[lang]/layout.tsx). These tests RUN the generated script. Pinned: nothing at all without `modelContext` or
 * inside a frame; the read-only tools only, each registered once per document, exactly as the server describes them;
 * every call a cookie-less tools/call on /api/mcp/search; the shape ora.ai's reader credits (a local read from
 * `document.modelContext || navigator.modelContext`, then `mc.registerTool({...})` with literal objects).
 */

vi.mock('@/lib/db', () => ({ db: {} }))

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const TOOLS: WebMcpDescriptor[] = [
  { name: 'search_listings', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { title: 'Search', ...READ } },
  { name: 'get_listing_details', description: 'Details', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { title: 'Details', ...READ } },
  // A tool the server does NOT mark read-only: never offered to the page's agent.
  { name: 'post_listing', description: 'Writes', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
]

function okFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { params: { name: string } }
    const result = { content: [{ type: 'text', text: `called ${body.params.name}` }], structuredContent: { ok: true } }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } })
  })
}
const names = (registerTool: ReturnType<typeof vi.fn>) => registerTool.mock.calls.map((c) => c[0].name)

/** A fresh document's run of the script built from `tools`. */
function run(tools: WebMcpDescriptor[] = TOOLS) {
  delete (window as unknown as { __enoWebMcp?: boolean }).__enoWebMcp
  const source = buildWebmcpScript(tools)
  const start = () => new Function(source)()
  start()
  return { again: start }
}
function withContext(registerTool: ReturnType<typeof vi.fn>, on: 'document' | 'navigator' = 'document') {
  ;((on === 'document' ? document : navigator) as unknown as { modelContext: unknown }).modelContext = { registerTool }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (document as unknown as { modelContext?: unknown }).modelContext
  delete (navigator as unknown as { modelContext?: unknown }).modelContext
})

describe('WebMCP script', () => {
  it('does nothing — not one request, not one registration — in a browser without modelContext', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    run()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('registers the read-only tools once each, as the server describes them — never a writing one — with no request first', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    const { again } = run()
    again() // the script run again in the same document: still once
    await vi.advanceTimersByTimeAsync(5 * 60_000) // the late checks fire too
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
    expect(fetch).not.toHaveBeenCalled() // literal definitions: nothing fetched to register
    const tool = registerTool.mock.calls[0][0]
    expect(tool.description).toBe('Search')
    expect(tool.inputSchema).toEqual(TOOLS[0].inputSchema)
    expect(tool.annotations.readOnlyHint).toBe(true)
  })

  it('every tool says its answer may carry others\' text (untrustedContentHint) — only a site-text-only tool is exempt', () => {
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    for (const c of registerTool.mock.calls) expect(c[0].annotations, c[0].name).toMatchObject({ readOnlyHint: true, untrustedContentHint: true })
    // Fails closed: a tool nobody listed is marked; the exempt one is not.
    expect(buildWebmcpScript([{ name: 'list_seller_reviews', description: 'x', inputSchema: {}, annotations: { readOnlyHint: true } }])).toContain('"untrustedContentHint":true')
    expect(buildWebmcpScript([{ name: 'list_categories', description: 'x', inputSchema: {}, annotations: { readOnlyHint: true } }])).not.toContain('untrustedContentHint')
  })

  it('every call is a cookie-less tools/call on /api/mcp/search, answered with the server\'s result', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    const result = await registerTool.mock.calls[0][0].execute({ q: 'iphone' })
    expect(result.content[0].text).toBe('called search_listings')
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/mcp/search')
    expect(init.credentials).toBe('omit')
    expect(JSON.parse(String(init.body))).toMatchObject({ method: 'tools/call', params: { name: 'search_listings', arguments: { q: 'iphone' } } })
  })

  it('a failed call answers as a tool error, never a thrown promise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'rate limited' } }))))
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    const result = await registerTool.mock.calls[0][0].execute({ q: 'x' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('rate limited')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect((await registerTool.mock.calls[1][0].execute({ id: 'x' })).isError).toBe(true)
  })

  it('a call that throws before it is sent (input that will not serialise) is a tool error; a "signal" that is not one is ignored', async () => {
    vi.stubGlobal('fetch', okFetch())
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect((await registerTool.mock.calls[0][0].execute(circular)).isError).toBe(true)
    expect((await registerTool.mock.calls[0][0].execute({ q: 'x' }, { signal: 'not a signal' })).content[0].text).toBe('called search_listings')
  })

  it('an SSE answer the server keeps OPEN after its reply still resolves at once; a notification before it is skipped', async () => {
    const reply = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'sse' }] } }, null, 2)
    const sse = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\n${reply.split('\n').map((l) => `data: ${l}`).join('\n')}\n\n`
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(sse)) /* never closed */ } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    expect((await registerTool.mock.calls[0][0].execute({})).content[0].text).toBe('sse')
  })

  it('a modelContext that appears a moment after load is still found (and used once)', async () => {
    const registerTool = vi.fn()
    run()
    await vi.advanceTimersByTimeAsync(5_000)
    withContext(registerTool) // the agent extension arrives
    await vi.advanceTimersByTimeAsync(120_000)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
  })

  it('document.modelContext leads: never a second pick from the deprecated navigator alias (ora 2026-11-17) — one without registerTool registers nothing', () => {
    const registerTool = vi.fn()
    ;(document as unknown as { modelContext: unknown }).modelContext = {}
    withContext(registerTool, 'navigator')
    run()
    expect(registerTool).not.toHaveBeenCalled()
    expect(buildWebmcpScript(TOOLS)).not.toMatch(/mc = navigator\.modelContext/)
  })

  it('one tool the browser refuses — by throwing or by a rejected promise — never stops the others, and is tried again', async () => {
    let refuse = true
    const registerTool = vi.fn((tool: { name: string }) => {
      if (!refuse) return undefined
      if (tool.name === 'search_listings') throw new Error('schema rejected')
      return Promise.reject(new Error('async refusal'))
    })
    withContext(registerTool)
    run()
    await vi.advanceTimersByTimeAsync(0)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
    refuse = false // the agent extension has finished starting up
    await vi.advanceTimersByTimeAsync(2_000)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details', 'search_listings', 'get_listing_details'])
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(registerTool).toHaveBeenCalledTimes(4) // in now: never registered again
  })

  it('a registerTool that has not settled is never called a second time; when it lands it counts', async () => {
    let resolveFirst: () => void = () => {}
    const registerTool = vi.fn((tool: { name: string }) =>
      tool.name === 'search_listings' && registerTool.mock.calls.length === 1 ? new Promise<void>((r) => { resolveFirst = r }) : undefined)
    withContext(registerTool)
    run()
    await vi.advanceTimersByTimeAsync(100_000) // passes at 2 s, 10 s, 30 s, 90 s while it hangs
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
    resolveFirst()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('every call ends within 10 s even when the caller passes a signal of its own', async () => {
    // jsdom's AbortSignal.timeout runs on a real timer the fake clock cannot advance: drive it by the fake clock here.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController()
      setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), ms)
      return c.signal
    })
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))
    })))
    const registerTool = vi.fn()
    withContext(registerTool)
    run()
    const pending = registerTool.mock.calls[0][0].execute({ q: 'x' }, { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await pending).isError).toBe(true)
  })

  it('⛔ never in a frame: inside an iframe the script does nothing at all', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    const top = Object.getOwnPropertyDescriptor(window, 'top')
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) })
    try {
      run()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    } finally {
      if (top) Object.defineProperty(window, 'top', top)
    }
    expect(registerTool).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('⛔ keeps the shape ora.ai\'s reader credits: a local from document/navigator modelContext, then mc.registerTool on literal objects', () => {
    // ora, 2026-11-16, on the version that registered what tools/list returned: "found no registerTool() call that runs on
    // a modelContext read from document or navigator". Its own pages use exactly this shape.
    const source = buildWebmcpScript(TOOLS)
    expect(source).toContain('var mc = document.modelContext || navigator.modelContext;')
    expect(source).toContain('mc.registerTool(tool)')
    expect(source).toContain('register({"name":"search_listings","description":"Search",')
    expect(source).not.toContain('post_listing')
    expect(() => new Function(source)).not.toThrow() // valid JavaScript
  })
})

// A cold import of the search tools reaches the PDP and feed modules: 30 s, like search.test.ts's 20 s per test.
describe('/webmcp.js — the route and the page that loads it', { timeout: 30_000 }, () => {
  it('serves the script built from the search server\'s OWN tool list, as JavaScript', async () => {
    const { GET } = await import('@/app/webmcp.js/route')
    const { searchToolDescriptors } = await import('@/app/api/mcp/search/tools')
    const res = GET()
    expect(res.headers.get('content-type')).toBe(WEBMCP_HEADERS['content-type'])
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=3600')
    const body = await res.text()
    expect(body).toBe(buildWebmcpScript(searchToolDescriptors()))
    for (const t of searchToolDescriptors()) {
      if (t.annotations.readOnlyHint === true) expect(body).toContain(`register({"name":${JSON.stringify(t.name)},`)
    }
  })

  it('⛔ the script registers EXACTLY what /api/mcp/search answers tools/list with (name, description, input schema)', async () => {
    const { POST } = await import('@/app/api/mcp/search/route')
    const res = await POST(new Request('https://eno.vn/api/mcp/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }))
    const listed = ((await res.json()) as { result: { tools: WebMcpDescriptor[] } }).result.tools
    const { GET } = await import('@/app/webmcp.js/route')
    const registerTool = vi.fn()
    withContext(registerTool)
    delete (window as unknown as { __enoWebMcp?: boolean }).__enoWebMcp
    new Function(await GET().text())()
    const registered = registerTool.mock.calls.map((c) => ({ name: c[0].name, description: c[0].description, inputSchema: c[0].inputSchema, annotations: c[0].annotations }))
    const readOnly = listed.filter((t) => t.annotations?.readOnlyHint === true)
    expect(readOnly.length).toBeGreaterThan(0)
    // The server's own annotations, plus WebMCP's untrustedContentHint on the tools that answer with sellers' text.
    expect(registered).toEqual(readOnly.map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      annotations: SITE_TEXT_ONLY_TOOLS.has(t.name) ? t.annotations : { ...t.annotations, untrustedContentHint: true },
    })))
    // The real server today: the two listing tools carry sellers' text; list_categories is the site's own taxonomy.
    expect(registered.filter((t) => t.annotations.untrustedContentHint).map((t) => t.name).sort()).toEqual(['get_listing_details', 'search_listings'])
  })

  it('⛔ the layout loads it by a plain <script src> — what agent-readiness checkers read', () => {
    const layout = readFileSync('src/app/[lang]/layout.tsx', 'utf8')
    expect(layout).toContain('<script src="/webmcp.js" async />')
  })
})
