import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * classroom.<base> is the ADDRESS of eno Classroom (2026-10-25): every GET/HEAD page path 302s to the app origin's
 * /classroom with the path and query kept; nothing else is served there. src/lib/classroom/host.ts says why it is not a
 * rewrite (the session cookie is host-scoped).
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
  const host = init.host ?? 'classroom.eno.vn'
  const headers: Record<string, string> = { host }
  if (init.origin) headers.origin = init.origin
  const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers }))
  const target = res.headers.get('x-middleware-rewrite')
  return { status: res.status, location: res.headers.get('location'), rewrite: target ? new URL(target).pathname : null }
}

describe('classroom.<base>', () => {
  it('302s the root, an invite link and a query to eno.vn/classroom…', async () => {
    expect(await run('/')).toMatchObject({ status: 302, location: 'https://eno.vn/classroom' })
    expect(await run('/join/AbC123xyz')).toMatchObject({ status: 302, location: 'https://eno.vn/classroom/join/AbC123xyz' })
    expect(await run('/?from=zalo')).toMatchObject({ status: 302, location: 'https://eno.vn/classroom?from=zalo' })
    expect((await run('/', { method: 'HEAD' })).status).toBe(302)
  })

  it('never doubles the prefix of a link built by hand', async () => {
    expect((await run('/classroom/join/x')).location).toBe('https://eno.vn/classroom/join/x')
  })

  it('keeps the app origin, www included', async () => {
    expect(await run('/', { host: 'classroom.example.vn', app: 'https://www.example.vn' })).toMatchObject({ status: 302, location: 'https://www.example.vn/classroom' })
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

  it('does nothing on eno.forum: the classroom is eno.vn\'s (the forum hands /classroom to eno.vn by path)', async () => {
    ed.services = true
    expect((await run('/', { host: 'classroom.eno.forum', app: 'https://www.eno.forum' })).location).toBeNull()
  })

  it('leaves other hosts alone', async () => {
    expect((await run('/classroom', { host: 'eno.vn' })).location).toBeNull()
    expect((await run('/', { host: 'classroomx.eno.vn' })).location).toBeNull()
  })
})
