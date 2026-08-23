import { describe, expect, it } from 'vitest'
import { OAUTH_SCOPES, OAUTH_ISSUER } from '@/lib/api/oauth'
import { toolDescriptors } from '@/lib/mcp/tools'

/**
 * The agent-discovery documents published on 2026-08-23 in response to the audit scan whose nginx
 * log is quoted at the head of each route: `/.well-known/ai-catalog.json`, `/agents.md`,
 * `/index.md` and `/auth.md`.
 *
 * ⚠️ ONE FILE FOR FOUR ROUTES, AND IT LIVES UNDER src/app/md/ THOUGH IT ALSO COVERS A ROUTE UNDER
 * src/app/api/well-known/. They are one contract: the catalogue's job is to point at the other
 * three, so the assertion that matters most — "every URL this deployment advertises is a URL this
 * deployment serves" — can only be made where all four are in scope. Splitting them would leave
 * that assertion in neither file.
 *
 * ⛔ WHAT THIS FILE IS ACTUALLY FOR, IN ORDER OF HOW EXPENSIVE THE FAILURE IS:
 *   1. THE EDITION LEAK. vitest pins NEXT_PUBLIC_ENO_EDITION='services' and deliberately does not
 *      pin NEXT_PUBLIC_APP_URL, so every module under test resolves to the eno.forum identity. A
 *      literal 'eno.vn' surviving into any of these four documents is therefore a test failure
 *      rather than a production discovery. That leak has shipped FOUR times in this repo (the
 *      static llms.txt, the OpenAPI title, /developers, an ApiStatus description) and each time a
 *      human found it by curling the live domain. This is the first gate that can see it.
 *   2. THE DANGLING ADVERTISEMENT. A catalogue is fetched by machines with no human in the loop, so
 *      an entry pointing at a 404 is worse than an omission. The MCP entry in particular depends on
 *      a route added by a SIBLING change in the same batch; that dependency is pinned here.
 *   3. THE HEADER CONTRACT. `markdownResponse()` carries `no-store` (the mechanism that stops a
 *      shared cache serving markdown to browsers from an HTML URL) and, deliberately, NO
 *      `x-robots-tag`. Both are asserted, because both are the kind of header an optimisation pass
 *      "cleans up".
 *
 * ⚠️ THE REWRITE WIRING IS *NOT* ASSERTED HERE, AND THAT IS A SCOPE BOUNDARY, NOT AN OPINION.
 * `/agents.md` -> `/md/agents` (and the two siblings, and the five `.well-known` sources) live in
 * next.config.ts, which this change may not edit — they are handed over in its notes. Once they
 * land, add the assertion below to src/app/md/not-found/route.test.ts, which already imports the
 * config and owns exactly this class of check:
 *
 *     it('routes the dotted agent documents to their /md handlers', () => {
 *       const pairs = rewrites.afterFiles.map((r) => [r.source, r.destination])
 *       expect(pairs).toEqual(expect.arrayContaining([
 *         ['/agents.md', '/md/agents'],
 *         ['/index.md', '/md/index'],
 *         ['/auth.md', '/md/auth'],
 *       ]))
 *     })
 *
 * ⛔ Do NOT write that assertion as a `beforeFiles` entry. These sources are not real pages, so
 * `afterFiles` is right — and a `beforeFiles` entry here would sit beside the Accept-header
 * negotiation for `/`, `/privacy` and `/terms`, one reordering away from eating them.
 */

/** Serialised body of a markdown route, plus its response, so header and body assertions share one call. */
async function md(mod: { GET: () => Promise<Response> }) {
  const res = await mod.GET()
  return { res, body: await res.text() }
}

const load = {
  catalog: () => import('../api/well-known/ai-catalog/route'),
  agents: () => import('./agents/route'),
  auth: () => import('./auth/route'),
  index: () => import('./index/route'),
  llms: () => import('../llms.txt/route'),
}

describe('/.well-known/ai-catalog.json — ARD catalogue', () => {
  it('serves a cacheable JSON document with the ARD required root fields', async () => {
    const res = await (await load.catalog()).GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    // Same hour as the two OAuth metadata documents — build-constant, public.
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')

    const doc = await res.json()
    // ARD v0.9: specVersion, host and entries are the three required root fields.
    expect(doc.specVersion).toBe('1.0')
    expect(typeof doc.host.displayName).toBe('string')
    expect(typeof doc.host.identifier).toBe('string')
    expect(Array.isArray(doc.entries)).toBe(true)
    expect(doc.entries.length).toBeGreaterThan(0)
  })

  it('gives every entry a conforming URN, a media type, and EXACTLY ONE of url/data', async () => {
    const doc = await (await (await load.catalog()).GET()).json()
    for (const e of doc.entries) {
      // urn:air:<publisher>:<namespace>:<name>
      expect(e.identifier).toMatch(/^urn:air:[A-Za-z0-9.-]+:[a-z0-9-]+:[a-z0-9-]+$/)
      expect(typeof e.displayName).toBe('string')
      // An IANA media type, not a free-text label.
      expect(e.type).toMatch(/^[a-z]+\/[A-Za-z0-9.+-]+$/)
      // ⛔ The spec's one structural rule about an entry's payload. Both, or neither, is invalid.
      expect(Number('url' in e) + Number('data' in e)).toBe(1)
    }
  })

  /**
   * ⛔ THE LEAK GATE. See note 1 at the head of this file. Under vitest this deployment IS the
   * services edition, so the licensed marketplace's hostname has no business anywhere in the bytes.
   * ⚠️ Asserted on the SERIALISED document, not field by field — the leak has previously arrived in
   * a description string, a title and a fallback constant, none of which a per-field check covered.
   */
  it('never names the other edition', async () => {
    const raw = await (await (await load.catalog()).GET()).text()
    expect(raw).not.toContain('eno.vn')
    expect(raw).toContain(OAUTH_ISSUER)
  })

  /**
   * ⛔ NO COMPLIANCE CLAIMS. `trustManifest` carries attestations — SOC2, SPIFFE, GDPR — and this
   * deployment holds none; the services edition's operating entity is still pending. This is the
   * single worst field in the schema to fill in speculatively, so its absence is pinned rather than
   * left to a reviewer to notice.
   */
  it('publishes no trustManifest anywhere', async () => {
    const raw = await (await (await load.catalog()).GET()).text()
    expect(raw).not.toContain('trustManifest')
    expect(raw).not.toContain('attestations')
  })

  /**
   * ⛔ THE CROSS-CHANGE DEPENDENCY, MADE MECHANICAL. The MCP entry uses `url` rather than an
   * embedded card so that this deployment has exactly one server card; that card is published by a
   * sibling route in the same batch. If that route is dropped, the catalogue starts advertising a
   * 404 — the exact failure it was written to remove — and this test is what says so.
   */
  it('points the MCP entry at the server card route that actually exists', async () => {
    const doc = await (await (await load.catalog()).GET()).json()
    const mcp = doc.entries.find((e: { identifier: string }) => e.identifier.includes(':server:'))
    expect(mcp.url).toBe(`${OAUTH_ISSUER}/.well-known/mcp.json`)
    // Byte-identical to CARD_TYPE in that route — ARD requires `url` to point at a document OF the
    // declared type, so the two strings agreeing IS the contract.
    // ⚠️ 'application/json' — what a DEFAULT fetch of that URL receives, which is what ARD's
    // `type` describes. The card route content-negotiates and emits
    // 'application/mcp-server-card+json' ONLY when the request asks for it; a client reading a
    // catalogue to DISCOVER the card by definition does not yet know to ask.
    expect(mcp.type).toBe('application/json')
    const card = await import('../api/well-known/mcp-server-card/route')
    expect(typeof card.GET).toBe('function')
  })

  /**
   * ⛔ NO TOOL MAY BE ADVERTISED THAT THE SERVER DOES NOT EXPOSE. `capabilities` is what a discovery
   * service matches a user's task against, so a stale name routes work here and then fails it.
   * Derived from `toolDescriptors()` in the route for exactly this reason; asserted against the same
   * function so a hand-edit is caught.
   */
  it('lists exactly the MCP tools the server exposes, by name', async () => {
    const doc = await (await (await load.catalog()).GET()).json()
    const mcp = doc.entries.find((e: { identifier: string }) => e.identifier.includes(':server:'))
    expect(mcp.capabilities).toEqual(toolDescriptors().map((t) => t.name))
    // 2-5 natural-language examples, per the spec.
    expect(mcp.representativeQueries.length).toBeGreaterThanOrEqual(2)
    expect(mcp.representativeQueries.length).toBeLessThanOrEqual(5)
  })

  it('advertises only paths this deployment serves', async () => {
    const doc = await (await (await load.catalog()).GET()).json()
    const paths = doc.entries
      .filter((e: { url?: string }) => e.url)
      .map((e: { url: string }) => new URL(e.url).pathname)
      .sort()
    /**
     * ⚠️ AN EXACT LIST, NOT A SUBSET CHECK — the point is to make ADDING an entry a deliberate act
     * that someone has to curl first. Every path here was verified 200 on both live hosts on
     * 2026-08-23, except the three published by this batch (`/agents.md`, `/auth.md`,
     * `/.well-known/mcp.json`).
     */
    expect(paths).toEqual([
      '/.well-known/mcp.json',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/agents.md',
      '/api/v1/status',
      '/auth.md',
      '/llms.txt',
      '/openapi.json',
    ])
  })
})

describe('the markdown documents — shared header contract', () => {
  for (const [name, loader] of [
    ['/agents.md', load.agents],
    ['/auth.md', load.auth],
    ['/index.md', load.index],
  ] as const) {
    it(`${name} carries markdownResponse's headers and no x-robots-tag`, async () => {
      const { res, body } = await md(await loader())
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
      expect(res.headers.get('vary')).toBe('Accept')
      /**
       * ⛔ `no-store` IS THE SAFETY MECHANISM. Read markdown-response.ts: these bytes can be served
       * from the same URL as an HTML page, so a cacheable markdown response is the shortest path to
       * a shared cache handing markdown to every browser.
       */
      expect(res.headers.get('cache-control')).toBe('no-store')
      /**
       * ⛔ AND NO NOINDEX. The same helper serves the NEGOTIATED response at `/`, so an
       * `x-robots-tag: noindex` on it is a noindex on the home page. The duplicate these documents
       * do create is handled in src/app/robots.txt/route.ts, where it can be aimed at the right URLs.
       */
      expect(res.headers.get('x-robots-tag')).toBeNull()
      // A real document, not a stub.
      expect(body.startsWith('# ')).toBe(true)
      expect(body.length).toBeGreaterThan(600)
    })

    it(`${name} never names the other edition`, async () => {
      const { body } = await md(await loader())
      expect(body).not.toContain('eno.vn')
    })
  }
})

describe('/auth.md', () => {
  it('documents every scope the API enforces, and no scope it does not', async () => {
    const { body } = await md(await load.auth())
    for (const s of OAUTH_SCOPES) expect(body).toContain(`\`${s}\``)
    /**
     * ⛔ THE REVERSE DIRECTION IS THE ONE THAT COSTS A PARTNER A DAY. Advertising a scope nothing
     * enforces means they mint a token that appears to carry a permission and then eat a 403 from a
     * route they were told they could call. `orders:*` and `payments:*` are the plausible
     * inventions — there is no checkout here at all.
     */
    expect(body).not.toMatch(/`(orders|payments|users|escrow):[a-z]+`/)
  })

  it('states the grant, the TTL and the absence of a refresh token', async () => {
    const { body } = await md(await load.auth())
    expect(body).toContain('client_credentials')
    expect(body).toContain('/api/v1/oauth/token')
    // The route returns access_token/token_type/expires_in/scope and nothing else.
    expect(body).toContain('no refresh token')
    // ⚠️ No sandbox exists; saying otherwise sends a partner looking for one.
    expect(body).toContain('no sandbox')
  })
})

describe('/agents.md', () => {
  it('names every MCP tool the server exposes', async () => {
    const { body } = await md(await load.agents())
    for (const t of toolDescriptors()) expect(body).toContain(`\`${t.name}\``)
  })

  /**
   * ⛔ IT DESCRIBES THE INTERFACE, NEVER THE CATALOGUE — the rule that keeps this file legal on the
   * licensed marketplace. "What this site sells" forks by edition and is answered by a LINK to
   * /llms.txt, which already forks correctly. A sentence about the catalogue typed here would
   * either fork a second time or ship services vocabulary into eno.vn's artifact.
   */
  it('delegates the site description to llms.txt instead of restating it', async () => {
    const { body } = await md(await load.agents())
    expect(body).toContain('/llms.txt')
    expect(body).not.toMatch(/\b(visa|e-visa|itinerary|PayPal)\b/i)
  })

  it('states the rules an agent must not guess at', async () => {
    const { body } = await md(await load.agents())
    // Contact details are never public; there is no checkout; robots.txt is binding.
    expect(body).toContain('robots.txt')
    expect(body).toContain('Contact details are never public')
    // ⚠️ NOT the old flat 'There is no checkout' — false on the services edition, which sells
    // services the operator provides itself. Same defect already fixed once in the markdown
    // /terms. Assert the half true on BOTH editions.
    expect(body).toContain('no checkout')
    expect(body).toContain('No escrow')
  })
})

describe('/index.md', () => {
  /**
   * ⛔ ONE DOCUMENT, THREE URLS. `/index.md`, `/md/home` and `/llms.txt` are byte-identical BY
   * CONSTRUCTION — the route re-serves llms.txt's own bytes rather than paraphrasing them, because
   * the site's self-description forks by edition and a second hand-maintained copy is a licensing
   * defect waiting for someone to edit one and not the other. This is the assertion that keeps it
   * that way; if it ever fails, the fix is to delete the divergence, not to update the expectation.
   */
  it('is byte-identical to /llms.txt', async () => {
    const { body } = await md(await load.index())
    const llms = await (await load.llms()).GET().text()
    expect(body).toBe(llms)
  })
})
