import { afterEach, describe, expect, it, vi } from 'vitest'
import { decide, run, INGEST_SWITCH, QUERY_SWITCH } from '../../infra/cloudflare/eno-agent-search-guard.js'

const DEC = new Date('2026-12-10T05:00:00Z')

describe('agent search guard (free AI Search allowance → eno.vn free search, automatically)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('changes nothing before billing starts on 1 Dec 2026', () => {
    expect(decide({ semantic: 99999, fulltext: 99999, tokens: 9e9 }, new Date('2026-11-30T23:59:00Z'))).toMatchObject({ redirect: false, paused: false })
  })

  it('switches queries to the free search at the line, and back below it', () => {
    expect(decide({ semantic: QUERY_SWITCH, fulltext: 0, tokens: 0 }, DEC).redirect).toBe(true)
    expect(decide({ semantic: 0, fulltext: QUERY_SWITCH, tokens: 0 }, DEC).redirect).toBe(true)
    expect(decide({ semantic: QUERY_SWITCH - 1, fulltext: QUERY_SWITCH - 1, tokens: 0 }, DEC).redirect).toBe(false)
  })

  it('pauses ingestion at the line and resumes below it (a new month)', () => {
    expect(decide({ semantic: 0, fulltext: 0, tokens: INGEST_SWITCH }, DEC)).toMatchObject({ paused: true, redirect: true })
    expect(decide({ semantic: 0, fulltext: 0, tokens: INGEST_SWITCH - 1 }, DEC).paused).toBe(false)
  })

  it('does nothing without its token', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run({}, DEC)
    expect(f).not.toHaveBeenCalled()
    expect(log.mock.calls[0][0]).toContain('inert')
  })

  it('fails closed from 1 Dec when usage cannot be read: redirect on, ingestion paused, each set on its own', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/graphql')) return new Response('{"errors":[{"message":"range too wide"}]}', { status: 400 })
      if (url.includes('/entrypoint')) return new Response('{"success":false}', { status: 500 }) // the redirect call fails…
      if (init.method === 'GET' && url.includes('/ai-search/instances/')) return new Response(JSON.stringify({ success: true, result: { paused: false } }))
      if (init.method === 'PUT') return new Response(JSON.stringify({ success: true, result: { paused: true } }))
      return new Response('{}', { status: 404 })
    }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run({ CF_GUARD_TOKEN: 't' }, DEC)
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ paused: true }) // …and the pause still happens
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string)
    expect(line.want).toMatchObject({ redirect: true, paused: true })
    expect(line.redirect).toMatch(/^error:/)
  })

  it('adds the redirect once queries cross the line, and pauses ingestion with a PUT of `paused` only', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: String(init.method), url, body })
      const ok = (result: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ success: true, result, ...extra }))
      if (url.endsWith('/graphql')) return new Response(JSON.stringify({ data: { viewer: { accounts: [{ sem: [{ count: 980 }], ft: [], ing: [{ sum: { tokens: 5_000_000 } }] }] } } }))
      if (url.includes('/entrypoint')) return ok({ id: 'rs1', rules: [{ id: 'www', description: 'www → apex', enabled: true }] })
      if (url.endsWith('/rulesets/rs1/rules')) return ok({})
      if (init.method === 'GET' && url.includes('/ai-search/instances/')) return ok({ paused: false })
      if (init.method === 'PUT') return ok({ paused: true })
      return new Response('{}', { status: 404 })
    }))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await run({ CF_GUARD_TOKEN: 't' }, DEC)
    const add = calls.find((c) => c.method === 'POST' && c.url.endsWith('/rulesets/rs1/rules'))!
    expect(add.body).toMatchObject({ enabled: true, action: 'redirect', expression: '(http.host eq "eno.vn" and http.request.uri.path eq "/.well-known/search")' })
    expect((add.body as { action_parameters: { from_value: { status_code: number; target_url: { value: string }; preserve_query_string: boolean } } }).action_parameters.from_value).toEqual({ status_code: 307, target_url: { value: 'https://eno.vn/api/agent-search' }, preserve_query_string: true })
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ paused: true })
  })
})
