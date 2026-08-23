import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * WHAT THE SERVER CARD PROMISES, CHECKED AGAINST THE SERVER IT DESCRIBES.
 *
 * ⛔ THE FAILURE THIS FILE EXISTS TO PREVENT IS A CARD THAT IS *PLAUSIBLE*. A manifest advertising a
 * transport, a protocol version or a credential the route does not implement is worse than no
 * manifest at all: the agent connects, fails, and has no way to tell whether the fault is ours or
 * its own. So the assertions below are not "the JSON has the right keys" — each one re-derives the
 * claim from the thing that would have to change for the claim to become false.
 *
 * ⚠️ THE ROUTE IS READ AS SOURCE TEXT, ON PURPOSE. src/app/api/mcp/route.ts cannot be imported here
 * — Next route modules may not export anything but handlers and config, so `SUPPORTED` and
 * `serverInfo` are module-private by construction, and importing the module would drag in
 * resolveApiKey → db. Reading the file is the only mechanism that couples the two, and it fails
 * loudly (the regex misses) rather than silently if the route is restructured. That is the same
 * trade src/lib/sync-pairs.test.ts makes for the visa file pairs.
 *
 * ⚠️ EACH EDITION CASE RE-IMPORTS WITH `vi.resetModules()`, for the reason spelled out in
 * src/app/developers/reference.test.ts: `@/lib/edition` reads NEXT_PUBLIC_ENO_EDITION and
 * `@/lib/api/oauth` folds NEXT_PUBLIC_APP_URL into OAUTH_ISSUER at IMPORT time, so a constant bound
 * by an earlier import cannot be re-pointed by mutating the variable afterwards.
 */

const MCP_ROUTE_SRC = readFileSync(fileURLToPath(new URL('../../mcp/route.ts', import.meta.url)), 'utf8')
const TOOLS_SRC = readFileSync(fileURLToPath(new URL('../../../../lib/mcp/tools.ts', import.meta.url)), 'utf8')

const ENV = ['NEXT_PUBLIC_ENO_EDITION', 'NEXT_PUBLIC_APP_URL'] as const

type Card = {
  $schema: string
  name: string
  version: string
  description: string
  title: string
  websiteUrl: string
  remotes: Array<{
    type: string
    url: string
    supportedProtocolVersions: string[]
    headers: Array<{ name: string; isRequired?: boolean; isSecret?: boolean; value?: string; variables?: Record<string, unknown> }>
  }>
  _meta: Record<string, Record<string, unknown>>
}

async function load(edition: 'marketplace' | 'services', appUrl: string | undefined) {
  vi.resetModules()
  const prev = Object.fromEntries(ENV.map((k) => [k, process.env[k]])) as Record<string, string | undefined>
  process.env.NEXT_PUBLIC_ENO_EDITION = edition
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = appUrl
  try {
    return await import('./route')
  } finally {
    for (const k of ENV) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k] as string
    }
  }
}

/** Fetch the card the way a client does. `accept` defaults to the spec media type. */
async function card(edition: 'marketplace' | 'services', appUrl: string | undefined, accept = 'application/mcp-server-card+json') {
  const mod = await load(edition, appUrl)
  const res = mod.GET(new Request('https://example.test/.well-known/mcp.json', { headers: { accept } }) as never)
  return { res, doc: (await res.json()) as Card }
}

afterEach(() => {
  vi.resetModules()
})

describe('MCP server card — conforms to the Server Card shape', () => {
  it('carries the exact $schema identifier the schema pins', async () => {
    // ServerCard.$schema in modelcontextprotocol/experimental-ext-server-card/schema.ts is
    // `@pattern`-locked to this one string. ⚠️ It 404s today (curled 2026-08-23) — it is an
    // identifier a validator compares, not a URL anyone dereferences. Do not "fix" it.
    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.$schema).toBe('https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json')
  })

  it('satisfies every length and format constraint the schema imposes', async () => {
    for (const [edition, url] of [['marketplace', 'https://eno.vn'], ['services', 'https://www.eno.forum']] as const) {
      const { doc } = await card(edition, url)
      // Reverse-DNS, EXACTLY one slash. The pattern is copied from schema.ts verbatim; a hostname
      // that gains a label (www.) or a hyphenated edition name still has to satisfy it.
      expect(doc.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)
      expect(doc.name.length).toBeGreaterThanOrEqual(3)
      expect(doc.name.length).toBeLessThanOrEqual(200)
      // 100 is a HARD cap, and it is the constraint most likely to be blown by a well-meaning edit
      // to the description — which is why it is asserted rather than trusted.
      expect(doc.description.length).toBeGreaterThan(0)
      expect(doc.description.length).toBeLessThanOrEqual(100)
      expect(doc.title.length).toBeLessThanOrEqual(100)
      // Version ranges are rejected by the schema (`^1.2.3`, `~1.2.3`, `1.x`, …).
      expect(doc.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(() => new URL(doc.websiteUrl)).not.toThrow()
    }
  })

  it('names one remote, with the transport the route actually speaks', async () => {
    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.remotes).toHaveLength(1)
    // "streamable-http" | "sse" are the only two values schema.ts allows.
    expect(doc.remotes[0].type).toBe('streamable-http')
  })
})

describe('MCP server card — every claim matches src/app/api/mcp/route.ts', () => {
  it('publishes the version the server reports in serverInfo', async () => {
    // docs/discovery.md, "Consistency with Runtime Behavior": the serverInfo a client observes AFTER
    // connecting SHOULD NOT contradict the card it read BEFORE connecting. This is the only thing
    // holding those two numbers together — bump them in the same commit.
    // ⚠️ `[^}]*` USED TO BREAK HERE. `serverInfo.name` became a template literal
    // (`${SITE_NAME} Partner API`) when the hardcoded 'eno.vn Partner API' was removed — and a
    // template literal contains `}`, so the negated class stopped before reaching `version` and
    // this pin went vacuous. It failed loudly only because of the assertion on the next line;
    // without that guard the whole test would have passed while checking nothing.
    const m = /serverInfo:\s*\{[\s\S]*?version:\s*'([^']+)'/.exec(MCP_ROUTE_SRC)
    expect(m, 'serverInfo.version not found in api/mcp/route.ts — the pin below is now vacuous').toBeTruthy()
    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.version).toBe(m![1])
  })

  it('publishes exactly the protocol versions the route negotiates, newest first', async () => {
    // route.ts: `const SUPPORTED = new Set([...])`, and `initialize` echoes the client's request only
    // when it is a member. Advertising anything outside this set makes a conforming client negotiate
    // a version the server then silently downgrades — the exact confusion the card exists to remove.
    const block = /const SUPPORTED = new Set\(\[([^\]]+)\]\)/.exec(MCP_ROUTE_SRC)
    expect(block, 'SUPPORTED not found in api/mcp/route.ts').toBeTruthy()
    const fromRoute = [...block![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(fromRoute.length).toBeGreaterThan(0)

    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.remotes[0].supportedProtocolVersions).toEqual(fromRoute)

    // ⚠️ AND IT IS NOT THE LATEST MCP REVISION. The spec is at 2026-07-28; this server is not. The
    // assertion is here so that "update the protocol version" is a change to route.ts first.
    expect(doc.remotes[0].supportedProtocolVersions).not.toContain('2026-07-28')
  })

  it('claims no SSE stream, because GET on the endpoint is a 405', async () => {
    // The route's GET says so in as many words: 405 + `Allow: POST, OPTIONS` + "No server-initiated
    // stream". A card listing an `sse` remote would send every client that prefers streaming
    // straight into that 405.
    expect(MCP_ROUTE_SRC).toMatch(/status:\s*405/)
    expect(MCP_ROUTE_SRC).toContain("Allow: 'POST, OPTIONS'")
    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.remotes.map((r) => r.type)).not.toContain('sse')
  })

  it('points at the endpoint that exists, on this deployment', async () => {
    const mkt = await card('marketplace', 'https://eno.vn')
    expect(mkt.doc.remotes[0].url).toBe('https://eno.vn/api/mcp')
    const svc = await card('services', 'https://www.eno.forum')
    expect(svc.doc.remotes[0].url).toBe('https://www.eno.forum/api/mcp')
  })

  it('describes the credential the route accepts — a Bearer header, marked secret', async () => {
    // resolveApiKey reads `Authorization: Bearer <…>` and NOTHING else: no query parameter, no form
    // field (the RFC 9728 sibling document says the same with bearer_methods_supported: ['header']).
    // Both accepted forms — a raw eno_live_ key and an OAuth access token minted from one — ride
    // this one header, which is why one entry is complete rather than lossy.
    expect(MCP_ROUTE_SRC).toContain('resolveApiKey')
    const { doc } = await card('marketplace', 'https://eno.vn')
    const [h] = doc.remotes[0].headers
    expect(doc.remotes[0].headers).toHaveLength(1)
    expect(h.name).toBe('Authorization')
    expect(h.value).toBe('Bearer {api_key}')
    expect(h.isRequired).toBe(true)
    // ⛔ THE WHOLE POINT. The key lives in the client's connection config, never in a tool argument,
    // so it never reaches the model (src/lib/mcp/tools.ts header). isSecret is what tells a client
    // to mask it and keep it out of logs.
    expect(h.isSecret).toBe(true)
    expect((h.variables as Record<string, { isSecret?: boolean }>).api_key.isSecret).toBe(true)
  })

  it('enumerates NO tools, even though the server has them', async () => {
    // Deliberate, and the opposite of an oversight: the WG omits primitives from the card because
    // tools/list is the authority. tools/call is ALSO scope-gated per tool, so a flat card-level
    // list would advertise calls a given key provably cannot make.
    expect(MCP_ROUTE_SRC).toContain("case 'tools/list'")
    expect(TOOLS_SRC).toContain('export const TOOLS')
    const { doc } = await card('marketplace', 'https://eno.vn')
    const json = JSON.stringify(doc)
    expect(doc).not.toHaveProperty('tools')
    expect(doc).not.toHaveProperty('capabilities')
    for (const toolName of ['create_listing', 'sync_catalogue', 'analytics_summary', 'register_webhook']) {
      expect(json).not.toContain(toolName)
    }
  })

  it('routes a 401 back to the OAuth metadata, with the scope list the token endpoint enforces', async () => {
    const { doc } = await card('marketplace', 'https://eno.vn')
    const meta = doc._meta['vn.eno/partner-api'] as { scopes: string[]; protectedResourceMetadata: string; authorizationServer: string }
    // Not a retyped list — OAUTH_SCOPES, the same constant both .well-known OAuth documents publish
    // and resolveApiKey checks `tool.scope` against.
    expect(meta.scopes).toEqual(['listings:read', 'listings:write', 'analytics:read', 'media:write'])
    expect(meta.protectedResourceMetadata).toBe('https://eno.vn/.well-known/oauth-protected-resource')
    expect(meta.authorizationServer).toBe('https://eno.vn')
    // `_meta` prefix rules reserve anything ending in `mcp` or `modelcontextprotocol` for MCP itself.
    for (const key of Object.keys(doc._meta)) expect(key).not.toMatch(/(^|\.)(mcp|modelcontextprotocol)\//)
  })
})

describe('MCP server card — HTTP contract', () => {
  it('negotiates the card media type, and answers plain JSON to everyone else', async () => {
    // Two populations, one document, identical bytes: a spec client sends
    // `Accept: application/mcp-server-card+json`; an audit scanner fetching /.well-known/mcp.json
    // sends `*/*` and some of them literally test for application/json.
    const spec = await card('marketplace', 'https://eno.vn', 'application/mcp-server-card+json')
    expect(spec.res.headers.get('content-type')).toBe('application/mcp-server-card+json; charset=utf-8')

    const scanner = await card('marketplace', 'https://eno.vn', '*/*')
    expect(scanner.res.headers.get('content-type')).toBe('application/json; charset=utf-8')

    // Same document either way — the label moves, the body does not.
    expect(scanner.doc).toEqual(spec.doc)
    // Vary is correct even though Cloudflare ignores it for Accept; every other cache honours it.
    expect(spec.res.headers.get('vary')).toBe('Accept')
  })

  it('is readable cross-origin — a MUST for a hosted card, and safe because it is public metadata', async () => {
    const { res } = await card('marketplace', 'https://eno.vn')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')

    const mod = await load('marketplace', 'https://eno.vn')
    const pre = mod.OPTIONS()
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('MCP server card — edition boundary', () => {
  it('⛔ the services edition NEVER says eno.vn — the leak class this repo has shipped four times', async () => {
    const { doc } = await card('services', 'https://www.eno.forum')
    expect(doc.name).toBe('forum.eno/partner-api')
    expect(doc.title).toBe('eno.forum Partner API')
    // The blanket assertion, because the failure was never one field: /developers had a correct
    // <title> above 49 occurrences of the other host.
    expect(JSON.stringify(doc)).not.toContain('eno.vn')
  })

  it('the marketplace edition names eno.vn everywhere it names itself', async () => {
    const { doc } = await card('marketplace', 'https://eno.vn')
    expect(doc.name).toBe('vn.eno/partner-api')
    expect(doc.title).toBe('eno.vn Partner API')
    expect(doc.websiteUrl).toBe('https://eno.vn/developers')
    expect(JSON.stringify(doc)).not.toContain('eno.forum')
  })

  it('falls back to its OWN domain when NEXT_PUBLIC_APP_URL is unset, never to eno.vn', async () => {
    // The branch a misconfigured deployment actually takes, and where a hardcoded default does its
    // damage silently. OAUTH_ISSUER's fallback is `https://${SITE_NAME}`, which stays edition-correct.
    const svc = await card('services', undefined)
    expect(svc.doc.remotes[0].url).toBe('https://eno.forum/api/mcp')
    expect(JSON.stringify(svc.doc)).not.toContain('eno.vn')
  })

  it('⛔ names no visa, itinerary or PayPal surface — this document ships in the LICENSED build', async () => {
    const { doc } = await card('marketplace', 'https://eno.vn')
    const everything = JSON.stringify(doc).toLowerCase()
    for (const banned of ['visa', 'itinerary', 'paypal']) expect(everything).not.toContain(banned)
  })
})
