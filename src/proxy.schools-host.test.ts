import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * schools.<base> is a NAME for /schools (2026-10-04): every GET/HEAD page path 302s to the app origin's
 * /schools with the path and query kept; nothing else is served there. src/lib/schools/host.ts says why
 * it is not a rewrite (the session cookie is host-scoped).
 */
// The redirect is MARKETPLACE ONLY; vitest runs as the services edition by default (vitest.config.ts).
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
  const host = init.host ?? 'schools.eno.vn'
  const headers: Record<string, string> = { host }
  if (init.origin) headers.origin = init.origin
  const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers }))
  const target = res.headers.get('x-middleware-rewrite')
  return { status: res.status, location: res.headers.get('location'), rewrite: target ? new URL(target).pathname : null }
}

describe('schools.<base>', () => {
  it('302s the root, a school page and a query to eno.vn/schools…', async () => {
    expect(await run('/')).toMatchObject({ status: 302, location: 'https://eno.vn/schools' })
    expect(await run('/ila-vietnam')).toMatchObject({ status: 302, location: 'https://eno.vn/schools/ila-vietnam' })
    expect(await run('/?kind=agency&sort=reviews')).toMatchObject({ status: 302, location: 'https://eno.vn/schools?kind=agency&sort=reviews' })
    expect((await run('/', { method: 'HEAD' })).status).toBe(302)
  })

  it('keeps the app origin, www included', async () => {
    expect(await run('/', { host: 'schools.example.vn', app: 'https://www.example.vn' })).toMatchObject({ status: 302, location: 'https://www.example.vn/schools' })
  })

  it('⛔ never leaves the domain: a protocol-relative path stays a path', async () => {
    const r = await run('//evil.example/x')
    expect(r.status).toBe(302)
    expect(new URL(r.location!).host).toBe('eno.vn')
  })

  it('refuses writes to page paths, and the host is not a storefront', async () => {
    expect((await run('/', { method: 'POST', origin: 'https://eno.vn' })).status).toBe(405)
    expect((await run('/')).rewrite).toBeNull()
  })

  it('does nothing on eno.forum: the directory is not promoted there (footer, sitemap and job links agree)', async () => {
    ed.services = true
    expect((await run('/', { host: 'schools.eno.forum', app: 'https://www.eno.forum' })).location).toBeNull()
  })

  it('leaves other hosts alone', async () => {
    expect((await run('/schools', { host: 'eno.vn' })).location).toBeNull()
    expect((await run('/', { host: 'schoolsx.eno.vn' })).location).toBeNull()
  })
})
