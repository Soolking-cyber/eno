import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * docs.<base> and api.<base> are NAMES for /developers (2026-11-11): both served the whole homepage (src/lib/docs-host.ts).
 * A GET/HEAD page request 302s to the app origin — `/` to /developers, any other path kept — while `/api/*`,
 * `/.well-known/*` and every other method are served in place exactly as before. Both editions.
 */
const ed = vi.hoisted(() => ({ services: false }))
vi.mock('@/lib/edition', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/edition')>()
  return { ...real, get IS_SERVICES() { return ed.services }, get IS_MARKETPLACE() { return !ed.services } }
})

afterEach(() => { vi.unstubAllEnvs(); ed.services = false })

const run = async (path: string, init: { method?: string; host?: string; app?: string; origin?: string } = {}) => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', init.app ?? 'https://eno.vn')
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('./proxy')
  const host = init.host ?? 'docs.eno.vn'
  const headers: Record<string, string> = { host }
  if (init.origin) headers.origin = init.origin
  const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers }))
  return { status: res.status, location: res.headers.get('location') }
}

describe('docs.<base> and api.<base>', () => {
  it('302s the root to /developers and keeps every other path and the query', async () => {
    expect(await run('/')).toMatchObject({ status: 302, location: 'https://eno.vn/developers' })
    expect(await run('/', { host: 'api.eno.vn' })).toMatchObject({ status: 302, location: 'https://eno.vn/developers' })
    expect(await run('/developers/mcp')).toMatchObject({ status: 302, location: 'https://eno.vn/developers/mcp' })
    expect(await run('/?utm_source=x')).toMatchObject({ status: 302, location: 'https://eno.vn/developers?utm_source=x' })
    expect((await run('/', { method: 'HEAD' })).status).toBe(302)
  })

  it('on eno.forum too, onto its own origin (www kept)', async () => {
    ed.services = true
    expect(await run('/', { host: 'docs.eno.forum', app: 'https://www.eno.forum' })).toMatchObject({ status: 302, location: 'https://www.eno.forum/developers' })
  })

  it('⛔ never leaves the domain: a protocol-relative path stays a path', async () => {
    const r = await run('//evil.example/x')
    expect(r.status).toBe(302)
    expect(new URL(r.location!).host).toBe('eno.vn')
  })

  it('serves /api/*, /.well-known/* and non-GET requests in place, as before', async () => {
    expect((await run('/api/v1/status', { host: 'api.eno.vn' })).status).not.toBe(302)
    expect((await run('/.well-known/api-catalog')).status).not.toBe(302)
    expect((await run('/', { method: 'POST', origin: 'https://docs.eno.vn' })).status).not.toBe(302)
  })

  it('leaves other hosts alone', async () => {
    expect((await run('/developers', { host: 'eno.vn' })).location).toBeNull()
    expect((await run('/', { host: 'docsx.eno.vn' })).status).not.toBe(302)
    expect((await run('/', { host: 'docs.eno.vn.evil.example' })).status).not.toBe(302)
  })
})
