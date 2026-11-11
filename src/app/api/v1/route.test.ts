import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/v1, the API root, is GET /status's document (route.ts says why): the same body, headers and per-IP bucket.
 */
const h = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async (name: string) => {
    h.calls.push(name)
    return { success: true, limit: 60, remaining: 59, resetSec: 37, windowSec: 60 }
  }),
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const req = (path: string) => new Request(`https://eno.vn${path}`, { headers: { 'cf-connecting-ip': '203.0.113.7' } }) as never

beforeEach(() => {
  h.calls = []
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/v1 (the API root)', () => {
  it('answers 200 with the service document /status answers, no credential, from the same bucket', async () => {
    vi.resetModules()
    const root = await import('./route')
    const status = await import('./status/route')
    const a = await root.GET(req('/api/v1'))
    const b = await status.GET(req('/api/v1/status'))
    expect(a.status).toBe(200)
    const [ja, jb] = [await a.json(), await b.json()]
    delete ja.time
    delete jb.time
    expect(ja).toEqual(jb)
    expect(h.calls[0]).toBe(h.calls[1])
    for (const k of ['cache-control', 'link', 'ratelimit-policy']) expect(a.headers.get(k)).toBe(b.headers.get(k))
    expect(a.headers.get('cache-control')).toBe('no-store')
  })

  it('⛔ every other method keeps the catch-all\'s JSON not_found envelope (never Next\'s empty 405)', async () => {
    vi.resetModules()
    const root = await import('./route')
    const { NextRequest } = await import('next/server')
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const res = await root[m](new NextRequest('https://eno.vn/api/v1', { method: m }))
      expect(res.status, m).toBe(404)
      expect(res.headers.get('content-type'), m).toContain('application/json')
      expect((await res.json()).error.code, m).toBe('not_found')
    }
  })

  it('⛔ is NOT a path in the spec: OpenAPI joins servers[0].url and "/" into …/api/v1/, which 308s (trailingSlash off)', async () => {
    const { SPEC } = await import('./openapi.json/route')
    expect(Object.keys((SPEC as unknown as { paths: Record<string, unknown> }).paths)).not.toContain('/')
  })
})
