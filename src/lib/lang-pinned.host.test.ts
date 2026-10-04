import { afterEach, describe, expect, it, vi } from 'vitest'
import { hereVariant, hrefHere, pilotOnHost } from './lang-pinned'

/**
 * The `/vi` pilot lives on the site's own host and nowhere else: a storefront's host (`<label>.eno.vn`)
 * pins nothing and only bounces a live `/vi` twin to the apex (proxy.vi-pilot.test.ts), so a handler that
 * would navigate to `/vi…` there uses the plain URL instead and keeps the reader on the shop's host
 * (header.tsx — A1-LANG: the header's search, brand, map and area navigations).
 */
describe('pilotOnHost — where a `/vi…` link resolves', () => {
  it('the apex and www keep the pilot, whatever the configured spelling', () => {
    for (const app of ['https://eno.vn', 'https://www.eno.vn']) {
      expect(pilotOnHost('eno.vn', app), app).toBe(true)
      expect(pilotOnHost('www.eno.vn', app), app).toBe(true)
    }
  })

  it('a storefront host has none (its /vi only bounces to the apex)', () => {
    expect(pilotOnHost('sdcstore.eno.vn', 'https://eno.vn')).toBe(false)
    expect(pilotOnHost('Apple.Eno.VN', 'https://eno.vn')).toBe(false)
  })

  it('localhost, an unrelated host or an unreadable app URL changes nothing', () => {
    expect(pilotOnHost('localhost', 'https://eno.vn')).toBe(true)
    expect(pilotOnHost('noteno.vn', 'https://eno.vn')).toBe(true)
    expect(pilotOnHost('eno.vn', undefined)).toBe(true)
    expect(pilotOnHost('sdcstore.eno.vn', 'not a url')).toBe(true)
  })
})

/** The build's lists decide (a build without the pilot is eno.forum); the host does not — see below. */
describe('hrefHere — a stored /vi link, opened where its twin may not exist', () => {
  const ON = { live: ['/', '/c/furniture-appliances'], retired: [] as string[] }
  const OFF = { live: [] as string[], retired: [] as string[] }

  it('keeps a live twin on a host and build that have it', () => {
    expect(hrefHere('/vi?category=rentals&district=d2', ON)).toBe('/vi?category=rentals&district=d2')
    expect(hrefHere('/vi', ON)).toBe('/vi')
  })

  it('opens the plain URL in a build without the pilot (eno.forum), query and hash kept', () => {
    expect(hrefHere('/vi?category=rentals', OFF)).toBe('/?category=rentals')
    expect(hrefHere('/vi/c/furniture-appliances#x', OFF)).toBe('/c/furniture-appliances#x')
    expect(hrefHere('/vi', OFF)).toBe('/')
  })

  it('leaves everything that is not a /vi twin alone', () => {
    for (const h of ['/?category=rentals', '/listings/abc', '/messages/t1', '/vietnam-evisa', '#', 'https://eno.vn/vi']) {
      expect(hrefHere(h, OFF), h).toBe(h)
    }
  })
})

/** On a shop's host (a `window` stubbed onto the node environment): a handler drops the twin, a stored link keeps it. */
describe('on a storefront host', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  const at = (hostname: string) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    vi.stubGlobal('window', { location: { hostname } })
  }

  it('hereVariant: plain on sdcstore.eno.vn, unchanged on eno.vn', () => {
    at('sdcstore.eno.vn')
    expect(hereVariant('vi')).toBe('en')
    at('eno.vn')
    expect(hereVariant('vi')).toBe('vi')
  })

  it('hrefHere: a stored link KEEPS its live twin there — the proxy sends it on to the apex, where a marketplace-wide search belongs', () => {
    at('sdcstore.eno.vn')
    expect(hrefHere('/vi?category=rentals', { live: ['/'], retired: [] })).toBe('/vi?category=rentals')
  })
})
