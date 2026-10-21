import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * ⛔ THE LINK-JUNK REDIRECT, PRODUCTION-SHAPED, THROUGH NEXT'S OWN ADAPTER (review, 2026-10-21; src/lib/link-junk.ts).
 * proxy() alone answers an absolute URL built from req.nextUrl, and behind nginx that URL carries the INTERNAL host
 * (127.0.0.1:3001) while the Host header is the public one. Next's adapter (server/web/adapter.js) is what turns a
 * redirect to the request's own host into a RELATIVE Location, which keeps the browser on teacher.eno.vn — so this runs
 * the adapter itself. Measured the same on the production build, 2026-10-21: `Location: /?zarsrc=30…`.
 * ⚠️ ITS OWN FILE: Next's server puts AsyncLocalStorage on globalThis before any of its modules load, and those modules
 * come through Node's require cache, which vi.resetModules() does not clear — so nothing may load Next before this line.
 */
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage

afterEach(() => vi.unstubAllEnvs())

describe('the link-junk redirect through Next\'s adapter', () => {
  const hit = async (url: string, host: string) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { adapter } = await import('next/dist/server/web/adapter')
    const { proxy } = await import('./proxy')
    const { response } = await adapter({
      handler: proxy as never,
      page: '/proxy',
      request: { url, method: 'GET', headers: { host }, nextConfig: {}, signal: new AbortController().signal },
    })
    return { status: response.status, location: response.headers.get('location'), cache: response.headers.get('cache-control') }
  }

  it('nginx\'s internal URL and the public Host answer a RELATIVE Location, the query kept, private to the browser', async () => {
    expect(await hit('http://127.0.0.1:3001/,?zarsrc=30&utm_source=zalo', 'teacher.eno.vn'))
      .toEqual({ status: 301, location: '/?zarsrc=30&utm_source=zalo', cache: 'private, max-age=86400' })
    expect(await hit('http://127.0.0.1:3001/teachers/join.)', 'eno.vn'))
      .toEqual({ status: 301, location: '/teachers/join', cache: 'private, max-age=86400' })
  })

  it('the teacher host\'s own move to the apex stays absolute — it IS another host', async () => {
    expect(await hit('http://127.0.0.1:3001/c/teachers', 'teacher.eno.vn')).toMatchObject({ status: 301, location: 'https://eno.vn/c/teachers' })
  })
})
