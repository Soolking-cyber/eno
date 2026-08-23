import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ⛔ THE AUTH BOUNDARY OF THE MCP SERVER, PINNED IN BOTH DIRECTIONS.
 *
 * Discovery (`initialize`, `ping`, `tools/list`) is OPEN; execution (`tools/call`) is NOT.
 * Both halves matter and they fail in opposite ways:
 *
 *  · Close discovery and the server becomes invisible. It was closed until 2026-08-23, and the
 *    cost was measured: the is-agentic audit reported "MCP manifest found at
 *    /.well-known/mcp.json but PROTOCOL HANDSHAKE FAILED", then scored `MCP tool listing`,
 *    `MCP tool descriptions`, `MCP resources exposed` and `Listed in MCP registries` as
 *    "No MCP server detected" — four checks at zero for a server that was running fine.
 *  · Open execution and any anonymous caller acts on a real shop.
 *
 * A test that only checked one direction would pass while the other regressed, which is why both
 * are here.
 *
 * ⚠️ THE REFUSAL IS AT THE TRANSPORT (401), NOT PER-MESSAGE — and an earlier version of this very
 * comment claimed the opposite while the tests below asserted `status === 401`. A reviewer caught
 * the contradiction twice, in two files. 401 + `WWW-Authenticate: Bearer` is deliberate: it is how
 * an MCP client discovers the OAuth authorization server. The cost is that a batch mixing open and
 * gated methods loses its open answers too, which is the right trade for a credential error.
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

const post = (body: unknown) =>
  new Request('https://eno.vn/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

describe('MCP discovery is open', () => {
  beforeEach(() => vi.resetModules())

  it('initialize completes without a credential — the handshake the auditor could not finish', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    // ⛔ THIS ASSERTION WAS VACUOUS AND FABLE CAUGHT IT. It read
    //     expect(name).not.toBe('eno.vn Partner API is hardcoded')
    // — comparing against a sentence that could never be the value, so it passed forever,
    // INCLUDING on a services build that really does hardcode 'eno.vn Partner API'. It claimed to
    // pin the fifth instance of this repo's recurring edition leak and pinned nothing at all, on a
    // licensing-adjacent invariant. A test that cannot fail is worse than no test: it reads as
    // covered.
    // The real pin: the name must be DERIVED from SITE_NAME, so on the services edition it must
    // say eno.forum and must not contain the marketplace's domain anywhere.
    const { SITE_NAME } = await import('@/lib/edition')
    expect(body.result.serverInfo.name).toBe(`${SITE_NAME} Partner API`)
    if (SITE_NAME !== 'eno.vn') {
      expect(JSON.stringify(body.result)).not.toContain('eno.vn')
    }
  })

  it('tools/list enumerates every tool without a credential', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    expect(res.status).toBe(200)
    const { result } = await res.json()
    expect(result.tools.length).toBeGreaterThan(0)
    for (const t of result.tools) {
      expect(t.name, 'every tool needs a name').toBeTruthy()
      expect(t.description, `${t.name} needs a description — the audit scores descriptions`).toBeTruthy()
    }
  })

  it('⛔ tools/list never advertises a services surface — the licensing pin', async () => {
    // codex's catch, and it is the right one to make: opening tools/list means the tool registry
    // is now published to every ANONYMOUS caller on BOTH editions. The blanket 401 used to hide
    // whatever was in it. `src/lib/mcp/tools.ts` has no edition filter at all — verified — so the
    // ONLY thing keeping eno.vn compliant is that every tool is a generic storefront operation.
    // That is true today (15 tools: get_shop … delete_webhook, zero services vocabulary) and this
    // is what makes it stay true: add a visa/itinerary/PayPal tool to the shared registry and the
    // marketplace edition starts advertising it to crawlers, silently.
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', id: 9, method: 'tools/list' }))
    const blob = JSON.stringify((await res.json()).result).toLowerCase()
    for (const word of ['visa', 'itinerary', 'paypal', 'e-visa', 'evisa']) {
      expect(blob, `tools/list must never name "${word}" — eno.vn may not describe that surface`).not.toContain(word)
    }
  })

  it('ping answers without a credential', async () => {
    const { POST } = await import('./route')
    expect((await POST(post({ jsonrpc: '2.0', id: 3, method: 'ping' }))).status).toBe(200)
  })
})

describe('MCP execution stays closed', () => {
  beforeEach(() => vi.resetModules())

  it('⛔ tools/call without a credential is refused', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_listings', arguments: {} } }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('⛔ a batch mixing open and gated methods does not smuggle the gated one through', async () => {
    const { POST } = await import('./route')
    const res = await POST(post([
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_listings', arguments: {} } },
    ]))
    // The presence of ANY tools/call makes the whole request require a credential.
    expect(res.status).toBe(401)
  })
})
