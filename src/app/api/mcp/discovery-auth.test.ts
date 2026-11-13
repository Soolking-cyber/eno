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

/**
 * ⚠️ 20s, NOT THE 5s DEFAULT, AND THE REASON IS COLD IMPORTS UNDER LOAD — not a slow assertion.
 * `beforeEach(vi.resetModules)` means every `await import('./route')` below pays the FULL module
 * graph again, and that graph reaches `root-segments.ts`, which `readdirSync`-walks every route
 * directory in the app. Measured 2026-09-19: this file runs in 2.4s on its own (80ms of import),
 * and times out at 5s inside the 306-file suite, where vitest reports ~122s of import time
 * competing across workers. Adding twenty route directories in one commit was enough to tip it.
 *
 * ⛔ IT SITS ON THE `describe`, NOT ONE `it`. A reviewer caught that the first fix contradicted its
 * own diagnosis: if `resetModules` makes EVERY test in this block pay the full import, then pinning
 * the budget on a single test just moves which one fails next. The whole block shares the cost, so
 * the whole block gets the allowance.
 *
 * ⛔ THE BUDGET WAS THE BUG, NOT THE CODE. Nothing here got slower per se — the timeout was set
 * close enough to the cold-import cost that ordinary growth in the app crosses it, which makes this
 * test fail for reasons unrelated to what it asserts. The assertions are unchanged.
 */
describe('MCP discovery is open', { timeout: 20_000 }, () => {
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
    // What directories show for the server (Manufact, mcptry, 2026-11-13): title, description, website and an icon of at
    // least 128px — the website and icon on THIS deployment's origin, never another edition's.
    const info = body.result.serverInfo
    expect(info.title).toBe(`${SITE_NAME} Partner API`)
    expect(info.description.length).toBeGreaterThan(40)
    expect(new URL(info.websiteUrl).host).toBe(new URL(info.icons[0].src).host)
    // …and that origin is THIS edition's own host (apex or www) — eno.vn's server must never point at eno.forum.
    expect([SITE_NAME, `www.${SITE_NAME}`]).toContain(new URL(info.websiteUrl).host)
    expect(info.websiteUrl).toMatch(/\/developers\/mcp$/)
    expect(info.icons[0]).toMatchObject({ mimeType: 'image/png', sizes: ['512x512'] })
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

  it('tools/list describes every argument and carries read/write hints that match the scopes', async () => {
    // Directories (mcptry, 2026-11-13) score both, and an agent picks a tool and fills its arguments from this text
    // alone. Every property at every depth (the listing rows of bulk/sync too) needs a description.
    const { POST } = await import('./route')
    const { TOOLS } = await import('@/lib/mcp/tools')
    const res = await POST(post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }))
    const { result } = await res.json()
    type Schema = { properties?: Record<string, Schema & { description?: string }>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[] }
    const undescribed = (s: Schema | undefined, at: string): string[] => !s ? [] : [
      ...Object.entries(s.properties ?? {}).flatMap(([k, p]) => [...(p.description ? [] : [`${at}.${k}`]), ...undescribed(p, `${at}.${k}`)]),
      ...undescribed(s.items, `${at}[]`),
      ...[...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])].flatMap((x) => undescribed(x, at)),
    ]
    expect(result.tools.flatMap((t: { name: string; inputSchema: Schema }) => undescribed(t.inputSchema, t.name))).toEqual([])
    for (const t of result.tools) {
      const scope = TOOLS.find((x) => x.name === t.name)!.scope
      // A hint is not enforcement (the key's scopes are), but a read hint on a write tool would let a client skip asking.
      expect(t.annotations?.readOnlyHint, `${t.name}: readOnlyHint must say what its scope says`).toBe(scope.endsWith(':read'))
      // ChatGPT's review wants all three hints as booleans on EVERY tool, a read included; Claude's directory wants a title.
      for (const hint of ['openWorldHint', 'destructiveHint', 'idempotentHint']) {
        expect(typeof t.annotations?.[hint], `${t.name} needs ${hint}`).toBe('boolean')
      }
      if (t.annotations.readOnlyHint) expect(t.annotations.destructiveHint, `${t.name}: a read cannot be destructive`).toBe(false)
      expect(t.title, `${t.name} needs a title`).toBeTruthy()
      // structuredContent MUST conform to the outputSchema: a closed object (additionalProperties:false) anywhere in it
      // would make a validating client reject the day a result gains a field.
      expect(t.outputSchema?.type, `${t.name} needs an outputSchema`).toBe('object')
      expect(JSON.stringify(t.outputSchema), `${t.name}: output objects stay open`).not.toContain('"additionalProperties":false')
      expect(t.outputSchema.$schema, `${t.name}: no meta-schema URI for a client validator to choke on`).toBeUndefined()
      expect(t.title.length, `${t.name}: a title is a short label`).toBeLessThanOrEqual(40)
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

  it('a browser opening the server URL is sent to the setup page; an MCP client GET still gets 405', async () => {
    const { GET } = await import('./route')
    const { OAUTH_ISSUER } = await import('@/lib/api/oauth')
    const get = (accept: string) => GET(new Request('https://eno.vn/api/mcp', { headers: { accept } }) as never)
    const browser = await get('text/html,application/xhtml+xml,*/*;q=0.8')
    expect(browser.status).toBe(302)
    expect(browser.headers.get('location')).toBe(`${OAUTH_ISSUER}/developers/mcp`)
    const { SITE_NAME } = await import('@/lib/edition')
    expect([SITE_NAME, `www.${SITE_NAME}`]).toContain(new URL(browser.headers.get('location')!).host)
    expect(browser.headers.get('vary')).toBe('Accept')
    expect((await get('text/event-stream')).headers.get('vary')).toBe('Accept')
    // The transport spec has a client's GET ask for a stream; this server has none, so that stays a 405.
    expect((await get('text/event-stream')).status).toBe(405)
    expect((await get('application/json, text/event-stream')).status).toBe(405)
    expect((await get('')).status).toBe(405)
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
