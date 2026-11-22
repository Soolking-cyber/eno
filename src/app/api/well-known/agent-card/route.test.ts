import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const load = async (edition = 'marketplace', origin = 'https://eno.vn') => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
  vi.resetModules()
  return { card: await import('./route'), poppy: await import('../poppy/route') }
}

describe('/.well-known/agent-card.json', () => {
  it('serves the card with a max-age and an ETag, and answers 304 to a matching If-None-Match (§8.6.1)', async () => {
    const { card } = await load()
    const res = await card.GET(new Request('https://eno.vn/.well-known/agent-card.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/)
    const etag = res.headers.get('etag')!
    const body = await res.json()
    expect(body.supportedInterfaces[0].url).toBe('https://eno.vn/api/a2a')
    const again = await card.GET(new Request('https://eno.vn/.well-known/agent-card.json', { headers: { 'If-None-Match': etag } }))
    expect(again.status).toBe(304)
    // The edge's weakened form, in a list, still matches.
    const weak = await card.GET(new Request('https://eno.vn/.well-known/agent-card.json', { headers: { 'If-None-Match': `"x", W/${etag}` } }))
    expect(weak.status).toBe(304)
  })
})

describe('/.well-known/poppy.json', () => {
  it('is website-only discovery naming this host, with no API or agent it would need an issuer binding for', async () => {
    const { poppy } = await load()
    const body = await (await poppy.GET()).json()
    expect(body).toMatchObject({ protocol_version: '1.0', organization: { name: 'ENO Company Limited', domain: 'eno.vn' }, web: {} })
    expect(Object.keys(body).sort()).toEqual(['auth', 'organization', 'protocol_version', 'web'])
    // No API or agent entry: each would have to accept the protocol's Session header (1.0 §7), which ours do not.
    expect(body).not.toHaveProperty('apis')
    expect(body).not.toHaveProperty('agent')
    // Every scope the sign-in can grant is described, with both hints (1.0 §4.7).
    const { SIGN_IN_SCOPES } = await import('@/lib/api/oauth')
    expect(Object.keys(body.auth.scopes).sort()).toEqual([...SIGN_IN_SCOPES].sort())
    for (const s of SIGN_IN_SCOPES) {
      expect(body.auth.scopes[s].length, s).toBeGreaterThan(10)
      expect(body.auth.scope_hints[s], s).toEqual({ changes: expect.stringMatching(/^(none|reversible|irreversible)$/), personal_data: expect.any(Boolean) })
    }
  })
})

describe('one organization across the agent surfaces (ora 2026-11-17, "PAP agrees with ARD")', () => {
  it('the ARD catalog names its host by the operating company, as poppy.json and the A2A card do', async () => {
    const { poppy } = await load()
    const { GET } = await import('@/app/api/well-known/ai-catalog/route')
    const catalog = await (await GET()).json()
    const p = await (await poppy.GET()).json()
    expect(catalog.host.displayName).toBe(p.organization.name)
    expect(catalog.host.identifier).toBe('eno.vn')
  })

  it('the MCP server entry carries eno\'s own unsigned trust manifest: where the server is published, nothing more', async () => {
    await load()
    const { GET } = await import('@/app/api/well-known/ai-catalog/route')
    const { MCP_REGISTRY_URL } = await import('@/lib/mcp-registry')
    const catalog = await (await GET()).json()
    const mcp = catalog.entries.find((e: { identifier: string }) => e.identifier === 'urn:air:eno.vn:server:partner-mcp')
    expect(mcp.trustManifests).toEqual([
      { contributor: 'https://eno.vn', provenance: [{ relation: 'publishedFrom', sourceId: 'https://eno.vn/api/mcp', registryUri: MCP_REGISTRY_URL }] },
    ])
  })
})

describe('the operator these documents name', () => {
  it("is each edition's own: the services build never names eno.vn's licensed company (site-legal.ts OPERATORS)", async () => {
    const { card, poppy } = await load('services', 'https://www.eno.forum')
    const c = await (await card.GET(new Request('https://www.eno.forum/.well-known/agent-card.json'))).json()
    const p = await (await poppy.GET()).json()
    expect(c.provider.organization).not.toBe('ENO Company Limited')
    expect(p.organization.name).not.toBe('ENO Company Limited')
    expect(c.provider.organization.length).toBeGreaterThan(0)
    expect(p.organization.name).toBe(c.provider.organization)
    // 1.0: the exact host that serves the document, www. kept (it was stripped under the 0.1 draft).
    expect(p.organization.domain).toBe('www.eno.forum')
    expect(c.supportedInterfaces[0].url).toBe('https://www.eno.forum/api/a2a')
  })
})
