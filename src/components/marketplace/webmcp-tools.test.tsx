// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * WebMCP (webmcp-tools.tsx): the public search MCP server's tools, offered to a browser agent on the page. Pinned here:
 * nothing at all happens without `modelContext`; ONE loop per document (however often it is started or the component
 * mounts); the tools are the server's own read-only ones, each registered once; every call is a cookie-less tools/call on
 * /api/mcp/search; any failure waits (1 min doubling to 15, timers only) and tries again until every tool is in.
 */

const TOOLS = [
  { name: 'search_listings', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'get_listing_details', description: 'Details', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  // A tool the server does NOT mark read-only: never offered to the page's agent.
  { name: 'post_listing', description: 'Writes', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
]

function okFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; params: { name?: string } }
    const result = body.method === 'tools/list'
      ? { tools: TOOLS }
      : { content: [{ type: 'text', text: `called ${body.params.name}` }], structuredContent: { ok: true } }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } })
  })
}
const listCalls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.filter(([, init]) => JSON.parse(String((init as RequestInit).body)).method === 'tools/list').length
const names = (registerTool: ReturnType<typeof vi.fn>) => registerTool.mock.calls.map((c) => c[0].name)
const flush = () => vi.advanceTimersByTimeAsync(0)

async function fresh() {
  vi.resetModules() // the module-level loop and registry start clean in each test
  return import('./webmcp-tools')
}
function withContext(registerTool: ReturnType<typeof vi.fn>, on: 'document' | 'navigator' = 'document') {
  ;((on === 'document' ? document : navigator) as unknown as { modelContext: unknown }).modelContext = { registerTool }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (document as unknown as { modelContext?: unknown }).modelContext
  delete (navigator as unknown as { modelContext?: unknown }).modelContext
})

describe('WebMCP', () => {
  it('does nothing — not one request — in a browser without modelContext', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const { WebMcpTools } = await fresh()
    render(<WebMcpTools />)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('registers the server\'s read-only tools once each — never a writing one — and calls them cookie-less', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    const { WebMcpTools, startWebMcp } = await fresh()
    const { unmount } = render(<WebMcpTools />)
    await flush()
    unmount()
    render(<WebMcpTools />) // a remount
    startWebMcp() // and a direct second start: still one loop
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
    expect(listCalls(fetch)).toBe(1)

    const tool = registerTool.mock.calls[0][0]
    expect(tool.inputSchema).toEqual(TOOLS[0].inputSchema)
    expect(tool.annotations.readOnlyHint).toBe(true) // the server's own label
    expect((await tool.execute({ q: 'iphone' })).content[0].text).toBe('called search_listings')
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe('/api/mcp/search')
      expect((init as RequestInit).credentials).toBe('omit')
    }
    expect(JSON.parse(String((fetch.mock.calls.at(-1)![1] as RequestInit).body)).params).toEqual({ name: 'search_listings', arguments: { q: 'iphone' } })
  })

  it('a modelContext that appears a moment after load is still found', async () => {
    vi.stubGlobal('fetch', okFetch())
    const registerTool = vi.fn()
    const { startWebMcp } = await fresh()
    startWebMcp()
    await vi.advanceTimersByTimeAsync(5_000)
    withContext(registerTool) // the agent extension arrives
    await vi.advanceTimersByTimeAsync(10_000)
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('reads every page of tools/list (nextCursor)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(String(init.body)) as { params: { cursor?: string } }
      const result = params.cursor === 'p2' ? { tools: [TOOLS[1]] } : { tools: [TOOLS[0]], nextCursor: 'p2' }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } })
    }))
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
  })

  it('a failure that never changes ends after ten attempts', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    withContext(vi.fn())
    const { startWebMcp } = await fresh()
    startWebMcp()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(10)
  })

  it('a registerTool that returns a rejected Promise counts as refused — retried, not taken as registered', async () => {
    vi.stubGlobal('fetch', okFetch())
    let refuse = true
    const registerTool = vi.fn(async (tool: { name: string }) => { if (tool.name === 'search_listings' && refuse) throw new Error('async refusal') })
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    refuse = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details', 'search_listings'])
  })

  it('a document.modelContext without registerTool does not hide a usable navigator one', async () => {
    vi.stubGlobal('fetch', okFetch())
    const registerTool = vi.fn()
    ;(document as unknown as { modelContext: unknown }).modelContext = {}
    withContext(registerTool, 'navigator')
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('⛔ a failing endpoint: one tools/list per window, doubling to 15 min — and the tools arrive when it recovers, with no navigation', async () => {
    let down = true
    const ok = okFetch()
    const fetch = vi.fn(async (url: string, init: RequestInit) => (down ? new Response('slow down', { status: 429 }) : ok(url, init)))
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetch).toHaveBeenCalledTimes(1) // inside the first window
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2) // 1 min
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetch).toHaveBeenCalledTimes(3) // + 2 min
    await vi.advanceTimersByTimeAsync(240_000 + 480_000)
    expect(fetch).toHaveBeenCalledTimes(5) // + 4, + 8
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(6) // capped at 15
    down = false
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(registerTool).toHaveBeenCalledTimes(2) // the 7th attempt: well inside the ten
  })

  it('offline or a timeout, then back: the same loop recovers on its own', async () => {
    let offline = true
    const ok = okFetch()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (offline) throw new TypeError('offline')
      return ok(url, init)
    }))
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(registerTool).not.toHaveBeenCalled()
    offline = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('one tool the browser refuses never stops the others; it is tried again later, never twice once in', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    let refuse = true
    const registerTool = vi.fn((tool: { name: string }) => { if (tool.name === 'search_listings' && refuse) throw new Error('schema rejected') })
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details'])
    refuse = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(names(registerTool)).toEqual(['search_listings', 'get_listing_details', 'search_listings'])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(listCalls(fetch)).toBe(2) // all in: the loop has stopped
  })

  it('an SSE stream the server keeps OPEN after its reply still answers at once', async () => {
    const reply = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: TOOLS } })}\n\n`
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(reply)) /* never closed */ } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('reads SSE events by the format: multi-line data joined, a notification before the reply skipped', async () => {
    const reply = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: TOOLS } }, null, 2) // spans many lines
    const sse = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\n${reply.split('\n').map((l) => `data: ${l}`).join('\n')}\n\n`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })))
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('a failed call answers as a tool error, never a thrown promise', async () => {
    const fetch = okFetch()
    vi.stubGlobal('fetch', fetch)
    const registerTool = vi.fn()
    withContext(registerTool)
    const { startWebMcp } = await fresh()
    startWebMcp()
    await flush()
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'rate limited' } })))
    const result = await registerTool.mock.calls[0][0].execute({ q: 'x' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('rate limited')
  })
})
