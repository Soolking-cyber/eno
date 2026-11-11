import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * /.well-known/api-catalog against RFC 9727 (the route's header lists each requirement), and every href against a route
 * that exists in this build. OAUTH_ISSUER folds NEXT_PUBLIC_APP_URL in at import time, so each case re-imports.
 */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function load(app = 'https://eno.vn') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', app)
  return import('./route')
}

type Link = { href: string; type?: string }
type Ctx = { anchor: string } & Record<string, Link[] | string>

const NEXT_CONFIG = readFileSync(fileURLToPath(new URL('../../../../../next.config.ts', import.meta.url)), 'utf8')

describe('/.well-known/api-catalog (RFC 9727)', () => {
  it('GET: a Linkset, with the RFC 9727 profile on the media type and the api-catalog Link (§2, §4.2)', async () => {
    const { GET } = await load()
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
    expect(res.headers.get('link')).toBe('<https://eno.vn/.well-known/api-catalog>; rel="api-catalog"')
    const body = (await res.json()) as { linkset: Ctx[] }
    expect(Array.isArray(body.linkset)).toBe(true)
    for (const ctx of body.linkset) expect(typeof ctx.anchor).toBe('string')
  })

  it('HEAD: no body, and the same headers as GET (§2)', async () => {
    const { GET, HEAD } = await load()
    const head = HEAD()
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    for (const h of ['content-type', 'link', 'cache-control', 'access-control-allow-origin']) expect(head.headers.get(h)).toBe(GET().headers.get(h))
  })

  it('links both API endpoints from the catalogue anchor, and describes each (§4.1)', async () => {
    const { GET } = await load()
    const { linkset } = (await GET().json()) as { linkset: Ctx[] }
    const self = linkset.find((c) => c.anchor === 'https://eno.vn/.well-known/api-catalog')!
    expect((self.item as Link[]).map((l) => l.href)).toEqual(['https://eno.vn/api/v1', 'https://eno.vn/api/mcp'])
    const rest = linkset.find((c) => c.anchor === 'https://eno.vn/api/v1')!
    expect(rest['service-desc']).toEqual([{ href: 'https://eno.vn/openapi.json', type: 'application/vnd.oai.openapi+json' }])
    expect(rest['service-doc']).toEqual([{ href: 'https://eno.vn/developers', type: 'text/html' }])
    expect(rest.status).toEqual([{ href: 'https://eno.vn/api/v1/status', type: 'application/json' }])
    expect(rest['service-meta']).toEqual([{ href: 'https://eno.vn/.well-known/oauth-protected-resource/api/v1', type: 'application/json' }])
    const mcp = linkset.find((c) => c.anchor === 'https://eno.vn/api/mcp')!
    expect(mcp['service-doc']).toEqual([{ href: 'https://eno.vn/developers/mcp', type: 'text/html' }])
  })

  it("names only the edition's own origin", async () => {
    const { GET } = await load('https://www.eno.forum')
    const text = await GET().text()
    expect(text).not.toContain('eno.vn')
    expect(text).toContain('https://www.eno.forum/api/v1')
  })

  it('every href is a route in this build: a rewrite in next.config.ts or a page/route file', async () => {
    const { GET } = await load()
    const { linkset } = (await GET().json()) as { linkset: Ctx[] }
    const paths = new Set<string>()
    for (const ctx of linkset) {
      paths.add(new URL(ctx.anchor).pathname)
      for (const v of Object.values(ctx)) if (Array.isArray(v)) for (const l of v) paths.add(new URL(l.href).pathname)
    }
    const app = fileURLToPath(new URL('../../../', import.meta.url))
    const { existsSync } = await import('node:fs')
    const routed = (p: string) =>
      NEXT_CONFIG.includes(`source: "${p}"`) ||
      existsSync(`${app}${p.slice(1)}/route.ts`) ||
      existsSync(`${app}[lang]${p}/page.tsx`) ||
      // RFC 9728 path-inserted form: the `:path*` rewrite.
      (p.startsWith('/.well-known/oauth-protected-resource/') && NEXT_CONFIG.includes('source: "/.well-known/oauth-protected-resource/:path*"'))
    for (const p of paths) expect(routed(p), p).toBe(true)
  })

  it('answers OPTIONS for browser clients, and the rewrite points at this route', async () => {
    const { OPTIONS } = await load()
    expect(OPTIONS().status).toBe(204)
    expect(NEXT_CONFIG).toContain('{ source: "/.well-known/api-catalog", destination: "/api/well-known/api-catalog" }')
  })
})
