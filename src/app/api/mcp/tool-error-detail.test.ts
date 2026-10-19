import { describe, expect, it, vi } from 'vitest'

/**
 * A ToolError's `detail` REACHES THE AGENT (2026-10-18). The job-text screen's refusal of a hiring post carries
 * '<field>:<snippet>' — the field and the words to take out (src/lib/mcp/job-text.test.ts) — and the route's tool-error
 * envelope must pass it on beside the code and the message, or the agent is back to guessing. A ToolError without one
 * answers exactly as before: `{ error: { code, message } }`.
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
  class ToolError extends Error {
    constructor(public code: string, message: string, public detail?: string) { super(message) }
  }
  const failing = (detail?: string) => ({
    scope: 'listings:write',
    input: z.object({}),
    handler: async () => { throw new ToolError('job_residence_wording', 'Job ads on eno can’t mention visas or residence cards — remove that line.', detail) },
  })
  return {
    ToolError,
    toolDescriptors: () => [],
    TOOLS_BY_NAME: new Map([['with_detail', failing('description:Visa')], ['without_detail', failing()]]),
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
  return { status: res.status, isError: body.result.isError, payload: JSON.parse(body.result.content[0].text) }
}

describe('POST /api/mcp — a ToolError’s detail', () => {
  it('rides in the error envelope beside the code and the message', async () => {
    expect(await call('with_detail')).toEqual({
      status: 200,
      isError: true,
      payload: { error: { code: 'job_residence_wording', message: 'Job ads on eno can’t mention visas or residence cards — remove that line.', detail: 'description:Visa' } },
    })
  })

  it('a ToolError without one answers exactly as before — no detail key', async () => {
    const { payload } = await call('without_detail')
    expect(payload).toEqual({ error: { code: 'job_residence_wording', message: 'Job ads on eno can’t mention visas or residence cards — remove that line.' } })
  })
})
