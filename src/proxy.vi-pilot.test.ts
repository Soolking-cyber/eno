import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE `/vi` PILOT, PROXY HALF (SEO wave B, V3a — merged switched OFF, decision V-h). The lists are
 * switched on here by a mock of the default argument; the merged constants are empty, so production
 * routing is the "lists off" block — which must be byte-for-byte today's behaviour.
 */
const pilot = vi.hoisted(() => ({ lists: { live: [] as string[], retired: [] as string[] } }))
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...real, pinnedRoute: (p: string, l?: Parameters<typeof real.pinnedRoute>[1]) => real.pinnedRoute(p, l ?? pilot.lists) }
})

afterEach(() => { vi.unstubAllEnvs(); pilot.lists = { live: [], retired: [] } })

const run = async (path: string, init: { method?: string; host?: string; headers?: Record<string, string>; app?: string } = {}) => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', init.app ?? 'https://eno.vn')
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('./proxy')
  const host = init.host ?? 'eno.vn'
  const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers: { host, ...(init.headers ?? {}) } }))
  const target = res.headers.get('x-middleware-rewrite')
  return {
    status: res.status,
    rewrite: target ? new URL(target).pathname + new URL(target).search : null,
    contentLanguage: res.headers.get('content-language'),
    cdn: res.headers.get('cloudflare-cdn-cache-control'),
    setCookie: res.headers.get('set-cookie'),
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
  }
}
const ON = { live: ['/', '/c/furniture-appliances'], retired: [] as string[] }

describe('lists off (the merged state)', () => {
  it('`/vi` and `/vi/c/furniture-appliances` 404, and `/` adapts to the visitor as today', async () => {
    expect((await run('/vi', { headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
    expect((await run('/vi/c/furniture-appliances', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi/~/not-found')
    expect((await run('/', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi')
    expect((await run('/', { headers: { cookie: 'lang=en', 'accept-language': 'vi' } })).rewrite).toBe('/en')
    expect((await run('/c/furniture-appliances', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/c/furniture-appliances')
  })
})

describe('lists on (V5, locally only)', () => {
  it('plain `/` with cookie vi AND Accept-Language vi renders en: content-language en, no-store, no cookie, no redirect', async () => {
    pilot.lists = ON
    const r = await run('/', { headers: { cookie: 'lang=vi', 'accept-language': 'vi-VN,vi;q=0.9' } })
    expect(r).toMatchObject({ status: 200, rewrite: '/en', contentLanguage: 'en', cdn: 'no-store', setCookie: null, location: null })
    expect((await run('/c/furniture-appliances?sort=newest', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/en/c/furniture-appliances?sort=newest')
  })

  it('`/vi` with cookie en renders vi at the plain path\'s vi entry: content-language vi, no-store', async () => {
    pilot.lists = ON
    const r = await run('/vi', { headers: { cookie: 'lang=en', 'accept-language': 'en-US' } })
    expect(r).toMatchObject({ status: 200, rewrite: '/vi', contentLanguage: 'vi', cdn: 'no-store', setCookie: null, location: null })
    expect((await run('/vi/c/furniture-appliances?x=1', { headers: { cookie: 'lang=en' } })).rewrite).toBe('/vi/c/furniture-appliances?x=1')
  })

  it('every other /vi… and public /en… still 404', async () => {
    pilot.lists = ON
    for (const p of ['/vi/c/rentals', '/vi/c/furniture-appliances/binh-trung', '/vi/vi', '/vi/en', '/en', '/en/c/furniture-appliances', '/vi/vi/c/furniture-appliances']) {
      expect((await run(p, { headers: { cookie: 'lang=en' } })).rewrite, p).toBe('/en/~/not-found')
    }
    // …and a path that merely starts with the letters is an ordinary page
    expect((await run('/vietnam-evisa', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/vietnam-evisa')
  })

  it('POST requests are pinned too, and the write guard still runs first', async () => {
    pilot.lists = ON
    expect((await run('/', { method: 'POST', headers: { origin: 'https://eno.vn', cookie: 'lang=vi' } })).rewrite).toBe('/en')
    expect((await run('/vi', { method: 'POST', headers: { origin: 'https://eno.vn', cookie: 'lang=en' } })).rewrite).toBe('/vi')
    expect((await run('/vi', { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('storefront hosts are never pinned: their `/` is the shop, their `/vi` a 404', async () => {
    pilot.lists = ON
    expect((await run('/', { host: 'apple.eno.vn', headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/s/apple')
    expect((await run('/vi', { host: 'apple.eno.vn', headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
  })

  it('other pages keep negotiating', async () => {
    pilot.lists = ON
    expect((await run('/c/rentals', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/c/rentals')
    expect((await run('/about', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi/about')
  })
})

describe('retired (rollback V-R)', () => {
  it('a withdrawn /vi URL answers 308 to the plain path on the canonical origin, query kept — never 404', async () => {
    pilot.lists = { live: [], retired: ['/', '/c/furniture-appliances'] }
    const a = await run('/vi?utm_source=x', { headers: { cookie: 'lang=vi' } })
    expect(a.status).toBe(308)
    expect(a.location).toBe('https://eno.vn/?utm_source=x')
    expect(a.cacheControl).toBe('public, max-age=86400')
    const b = await run('/vi/c/furniture-appliances', { host: 'www.eno.vn' })
    expect(b.status).toBe(308)
    expect(b.location).toBe('https://eno.vn/c/furniture-appliances')
    // the plain path adapts again
    expect((await run('/', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi')
  })
})

describe('eno.forum', () => {
  it('`/vi` 404s and `/` adapts with the real (empty) forum lists', async () => {
    // The real edition constant (the suite runs as the services edition, vitest.config.ts): even a
    // filled list yields no pilot here (review: an empty-list assertion alone would pass on either edition).
    const { viPilotFor } = await import('@/lib/lang-pinned')
    const { IS_SERVICES } = await import('@/lib/edition')
    expect(IS_SERVICES).toBe(true)
    expect(viPilotFor(IS_SERVICES, ['/', '/c/furniture-appliances'], ['/x'])).toEqual({ live: [], retired: [] })
    expect((await run('/vi', { host: 'www.eno.forum', app: 'https://www.eno.forum', headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
    expect((await run('/', { host: 'www.eno.forum', app: 'https://www.eno.forum', headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi')
  })
})
