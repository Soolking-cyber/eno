import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: true, resetSec: 1 })) }))
vi.mock('@/app/api/mcp/search/tools', () => ({ SearchToolError: class extends Error {}, SEARCH_TOOLS_BY_NAME: new Map() }))

const { ucpPost } = await import('./http')
const { UcpRequestError } = await import('./catalog')

const post = (body: string) => new Request('https://eno.vn/api/ucp/catalog/search', { method: 'POST', body, headers: { 'content-type': 'application/json' } })

describe('ucpPost', () => {
  it('answers JSON with open CORS, a UCP error for bad JSON, a 400 for a bad request and a 500 for ours', async () => {
    const ok = await ucpPost(post('{"query":"x"}'), 'cap', async (b) => ({ echo: b }))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('*')
    expect(await ok.json()).toEqual({ echo: { query: 'x' } })
    const bad = await ucpPost(post('{nope'), 'cap', async () => ({}))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ucp: { status: 'error' }, messages: [{ type: 'error', code: 'invalid_request' }] })
    const req = await ucpPost(post('{}'), 'cap', async () => { throw new UcpRequestError('invalid_request', 'no ids') })
    expect(req.status).toBe(400)
    const ours = await ucpPost(post('{}'), 'cap', async () => { throw new Error('boom') })
    expect(ours.status).toBe(500)
    expect(await ours.json()).toMatchObject({ messages: [{ code: 'internal_error' }] })
  })
})
