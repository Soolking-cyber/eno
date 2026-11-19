import { afterEach, describe, expect, it, vi } from 'vitest'
import { VI_PILOT_MARKETPLACE, VI_TWIN_FAMILIES, type ViPilot } from '@/lib/lang-pinned'

/**
 * ⛔ THE `/vi` PILOT, PROXY HALF (SEO wave B, V3a — merged switched OFF, decision V-h). The lists are
 * switched on here by a mock of the default argument; the merged constants are empty, so production
 * routing is the "lists off" block — which must be byte-for-byte today's behaviour.
 */
const pilot = vi.hoisted(() => ({ lists: { live: [], retired: [] } as import('@/lib/lang-pinned').ViPilot }))
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
/** What eno.vn ships: the pilot (`/`, `/c/furniture-appliances`, V-a) and the phase-1 families (2026-11-19). */
const ON: ViPilot = VI_PILOT_MARKETPLACE

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

  it('`/vi` + a phase-1 family path renders vi for everyone at the plain path\'s vi entry; the plain path negotiates', async () => {
    pilot.lists = ON
    const r = await run('/vi/c/rentals', { headers: { cookie: 'lang=en', 'accept-language': 'en-US' } })
    expect(r).toMatchObject({ status: 200, rewrite: '/vi/c/rentals', contentLanguage: 'vi', cdn: 'no-store', setCookie: null, location: null })
    for (const p of ['/vi/c/furniture-appliances/binh-trung?x=1', '/vi/c/rentals/binh-thanh', '/vi/help', '/vi/help/clx9a0b1c2', '/vi/schools', '/vi/schools/jane-doe-123', '/vi/schools/awards', '/vi/schools/awards/2026']) {
      expect((await run(p, { headers: { cookie: 'lang=en' } })).rewrite, p).toBe(p)
    }
    // the plain URL keeps today's cookie / Accept-Language behaviour (not V-a)
    expect((await run('/c/rentals', { headers: { cookie: 'lang=en', 'accept-language': 'vi' } })).rewrite).toBe('/en/c/rentals')
    expect((await run('/c/rentals/binh-thanh', { headers: { 'accept-language': 'vi-VN' } })).rewrite).toBe('/vi/c/rentals/binh-thanh')
    expect((await run('/help', { headers: { 'accept-language': 'en-US' } })).rewrite).toBe('/en/help')
    expect((await run('/schools/awards/2026', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/schools/awards/2026')
  })

  it('every other /vi… and public /en… still 404 — app and form pages, listings, sellers, deeper paths', async () => {
    pilot.lists = ON
    for (const p of ['/vi/vi', '/vi/en', '/en', '/en/c/furniture-appliances', '/en/c/rentals', '/vi/vi/c/furniture-appliances', '/vi/c', '/vi/c/rentals/binh-thanh/x', '/vi/dashboard', '/vi/dashboard/help', '/vi/schools/suggest', '/vi/schools/jane-doe-123/review', '/vi/help/x/y', '/vi/listings/abc', '/vi/listings/abc/edit', '/vi/sellers/x', '/vi/post', '/vi/account', '/vi/about']) {
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

  /**
   * ⛔ A SHOP'S HOST HAS NO PILOT OF ITS OWN, BUT ITS PAGES CARRY eno.vn's `/vi` LINKS (the HTML is shared
   * ISR: the logo, the Explore tab, the breadcrumbs, the 404 search form). Its `/` stays the shop; a live
   * `/vi` twin 308s to the same URL on the canonical apex instead of 404ing there.
   */
  it('storefront hosts are never pinned: their `/` is the shop, and a live `/vi` twin 308s to the apex', async () => {
    pilot.lists = ON
    expect((await run('/', { host: 'apple.eno.vn', headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/s/apple')
    const home = await run('/vi', { host: 'apple.eno.vn', headers: { cookie: 'lang=en' } })
    expect(home).toMatchObject({ status: 308, location: 'https://eno.vn/vi', cacheControl: 'public, max-age=86400', rewrite: null })
    const cat = await run('/vi/c/furniture-appliances', { host: 'apple.eno.vn' })
    expect(cat).toMatchObject({ status: 308, location: 'https://eno.vn/vi/c/furniture-appliances' })
  })

  it('…the query rides along (the 404 page\'s GET search form, a filtered explorer link) — www or apex config alike', async () => {
    pilot.lists = ON
    const q = await run('/vi?q=t%E1%BB%A7%20l%E1%BA%A1nh&category=furniture-appliances', { host: 'apple.eno.vn' })
    expect(q.status).toBe(308)
    expect(q.location).toBe('https://eno.vn/vi?q=t%E1%BB%A7%20l%E1%BA%A1nh&category=furniture-appliances')
    const www = await run('/vi?homes=1', { host: 'apple.eno.vn', app: 'https://www.eno.vn' })
    expect(www.location).toBe('https://eno.vn/vi?homes=1')
    expect((await run('/vi', { host: 'apple.eno.vn', method: 'HEAD' })).status).toBe(308)
  })

  it('…but only a pilot twin, only GET/HEAD, and never off a shop host', async () => {
    pilot.lists = ON
    // Not a twin: like every page path but `/` on a shop host, it goes to the apex (sweep, 2026-10-22; 301 since 2026-11-19)
    // — which answers it with the 404 every unpinned `/vi…` is there.
    for (const p of ['/vi/vi', '/vi/listings/abc', '/vi/dashboard', '/vi/schools/suggest']) {
      const r = await run(p, { host: 'apple.eno.vn', headers: { cookie: 'lang=en' } })
      expect(r.status, p).toBe(301)
      expect(r.location, p).toBe(`https://eno.vn${p}`)
    }
    // A phase-1 family twin is a twin: the bounded 308, like the pilot's (shop hosts are out of phase 1).
    expect(await run('/vi/c/rentals?q=x', { host: 'apple.eno.vn', headers: { cookie: 'lang=en' } })).toMatchObject({ status: 308, location: 'https://eno.vn/vi/c/rentals?q=x', cacheControl: 'public, max-age=86400' })
    // A write keeps its old route — no redirect for a Server Action's POST.
    const post = await run('/vi', { host: 'apple.eno.vn', method: 'POST', headers: { origin: 'https://eno.vn', cookie: 'lang=en' } })
    expect(post.location).toBeNull()
    expect(post.rewrite).toBe('/en/~/not-found')
    // The site's own host serves the twin, as before.
    expect((await run('/vi', { host: 'eno.vn', headers: { cookie: 'lang=en' } })).rewrite).toBe('/vi')
    // Lists off (eno.forum, or the pilot withdrawn): the shop's `/vi` is a page path like any other — to the apex.
    pilot.lists = { live: [], retired: [] }
    expect((await run('/vi', { host: 'apple.eno.vn', headers: { cookie: 'lang=en' } })).location).toBe('https://eno.vn/vi')
    expect((await run('/vi/c/rentals', { host: 'apple.eno.vn' })).status).toBe(301)
  })

  it('other pages keep negotiating', async () => {
    pilot.lists = ON
    expect((await run('/c/rentals', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/c/rentals')
    expect((await run('/about', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi/about')
  })
})

describe('retired (rollback V-R)', () => {
  it('on a shop host a withdrawn twin goes to the apex too (whose own rollback 308 finishes the job) — never a 404', async () => {
    pilot.lists = { live: [], retired: ['/', '/c/furniture-appliances'] }
    const r = await run('/vi/c/furniture-appliances?q=sofa', { host: 'apple.eno.vn', headers: { cookie: 'lang=vi' } })
    expect(r.status).toBe(308)
    expect(r.location).toBe('https://eno.vn/vi/c/furniture-appliances?q=sofa')
    expect(r.cacheControl).toBe('public, max-age=86400')
  })

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

  it('a withdrawn FAMILY 308s the same way; its app and form neighbours keep their 404', async () => {
    pilot.lists = { live: [], retired: [], retiredFamilies: VI_TWIN_FAMILIES }
    const a = await run('/vi/c/rentals/binh-thanh?sort=newest', { headers: { cookie: 'lang=vi' } })
    expect(a).toMatchObject({ status: 308, location: 'https://eno.vn/c/rentals/binh-thanh?sort=newest', cacheControl: 'public, max-age=86400' })
    expect((await run('/vi/schools/suggest', { headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
    expect((await run('/c/rentals', { headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/c/rentals')
  })
})

describe('eno.forum', () => {
  it('`/vi` 404s and `/` adapts with the real (empty) forum lists', async () => {
    // The real edition constant (the suite runs as the services edition, vitest.config.ts): even a
    // filled list yields no pilot here (review: an empty-list assertion alone would pass on either edition).
    const { viPilotFor } = await import('@/lib/lang-pinned')
    const { IS_SERVICES } = await import('@/lib/edition')
    expect(IS_SERVICES).toBe(true)
    expect(viPilotFor(IS_SERVICES, ['/', '/c/furniture-appliances'], ['/x'], VI_TWIN_FAMILIES)).toEqual({ live: [], retired: [], families: [], retiredFamilies: [] })
    pilot.lists = viPilotFor(IS_SERVICES, ['/', '/c/furniture-appliances'], ['/x'], VI_TWIN_FAMILIES)
    expect((await run('/vi', { host: 'www.eno.forum', app: 'https://www.eno.forum', headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
    expect((await run('/vi/c/rentals', { host: 'www.eno.forum', app: 'https://www.eno.forum', headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
    expect((await run('/', { host: 'www.eno.forum', app: 'https://www.eno.forum', headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi')
  })
})
