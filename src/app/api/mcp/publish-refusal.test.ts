import { describe, expect, it, vi } from 'vitest'

/**
 * A PUBLISH REFUSAL IS AN ANSWER, NOT A CRASH (2026-11-14). A listing with no photo, too few angles or no location used to
 * come back as `internal_error` — ChatGPT told a seller "the connection returned an internal error". Now every
 * PublishBlockedError answers with its code, `detail` and the same sentence /api/v1 sends (lib/api/publish-blocked-message.ts).
 * A genuine crash still answers `internal_error`.
 */

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 59, limit: 60, resetSec: 60, windowSec: 60 })),
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: vi.fn(async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599 } })),
  API_RATE_PER_MIN: 600,
  API_RATE_WINDOW_SEC: 60,
}))
vi.mock('@/lib/mcp/tools', async () => {
  const { z } = await import('zod')
  const { PublishBlockedError } = await import('@/lib/publish-guard')
  class ToolError extends Error {
    constructor(public code: string, message: string, public detail?: string) { super(message) }
  }
  const throwing = (e: () => Error) => ({ scope: 'listings:write', input: z.object({}), handler: async () => { throw e() } })
  return {
    ToolError,
    toolDescriptors: () => [],
    TOOLS_BY_NAME: new Map([
      ['no_photo', throwing(() => new PublishBlockedError('photos_min'))],
      ['no_location', throwing(() => new PublishBlockedError('location_required'))],
      ['bad_name', throwing(() => new PublishBlockedError('contact_in_name', 'phone'))],
      ['crash', throwing(() => new Error('db exploded'))],
    ]),
  }
})

const { POST } = await import('./route')
const call = async (name: string) => {
  const res = await POST(new Request('https://eno.vn/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer eno_live_test' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: {} } }),
  }) as never)
  const body = await res.json()
  return { isError: body.result.isError, payload: JSON.parse(body.result.content[0].text) }
}

describe('POST /api/mcp — a publish refusal', () => {
  it('names the code and what to fix, never internal_error', async () => {
    expect(await call('no_photo')).toEqual({ isError: true, payload: { error: { code: 'photos_min', message: 'At least 3 images from different angles are required (the same photo repeated counts as one).' } } })
    expect((await call('no_location')).payload.error).toEqual({ code: 'location_required', message: 'A location is required: give the district or area where the item is.' })
  })

  it('passes `detail` on, and a name problem is not called contact info in the listing text', async () => {
    const { payload } = await call('bad_name')
    expect(payload.error.code).toBe('contact_in_name')
    expect(payload.error.detail).toBe('phone')
    expect(payload.error.message).not.toMatch(/title\/description/)
  })

  it('a genuine crash still answers internal_error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call('crash')).payload.error.code).toBe('internal_error')
    err.mockRestore()
  })
})
