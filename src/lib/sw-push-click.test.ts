import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * public/sw.js — WHERE A PUSH OPENS (A1-LANG). The saved-search cron runs on eno.vn and writes `/vi?…` for a
 * Vietnamese recipient, but a push subscription belongs to the origin that registered it: on eno.forum,
 * which has no `/vi` pilot, that URL is a 404, so the worker opens the plain path there. eno.vn and its
 * subdomains keep the twin (a shop's host 308s it to the apex — src/proxy.ts), as does a local preview.
 *
 * The real file runs in a sandbox with a fake `self` and `clients` — the worker is plain JS that no
 * bundler touches, so this is the only way to pin what it does.
 */
type ClickEvent = { notification: { close: () => void; data: { url?: string } }; waitUntil: (p: Promise<unknown>) => void }

function worker(hostname: string, windows: { navigate?: (u: string) => Promise<unknown>; focus: () => unknown }[] = []) {
  const handlers: Record<string, (e: ClickEvent) => void> = {}
  const opened: string[] = []
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (type: string, fn: (e: ClickEvent) => void) => { handlers[type] = fn }, location: { hostname }, registration: {}, navigator: {} },
    clients: { matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u) } },
  })
  return {
    opened,
    async click(url?: string) {
      let done: Promise<unknown> = Promise.resolve()
      handlers.notificationclick({ notification: { close: () => {}, data: url === undefined ? {} : { url } }, waitUntil: (p) => { done = p } })
      await done
      return opened.at(-1)
    },
  }
}

describe('public/sw.js notificationclick — a /vi twin only where it resolves', () => {
  it('on eno.forum (no pilot) a /vi… URL opens its plain path — query and hash kept', async () => {
    for (const host of ['eno.forum', 'www.eno.forum']) {
      const w = worker(host)
      expect(await w.click('/vi?category=rentals&district=d2'), host).toBe('/?category=rentals&district=d2')
      expect(await w.click('/vi'), host).toBe('/')
      expect(await w.click('/vi/c/furniture-appliances?sort=recent'), host).toBe('/c/furniture-appliances?sort=recent')
      expect(await w.click('/vi#top'), host).toBe('/#top')
    }
  })

  it('on eno.vn, a shop subdomain and a local preview the twin is kept', async () => {
    for (const host of ['eno.vn', 'www.eno.vn', 'sdcstore.eno.vn', 'localhost', '127.0.0.1']) {
      expect(await worker(host).click('/vi?category=rentals'), host).toBe('/vi?category=rentals')
    }
  })

  it('anything that is not a /vi twin is untouched anywhere, and the default is still /dashboard', async () => {
    const w = worker('eno.forum')
    for (const u of ['/vietnam-evisa', '/messages/t1', '/listings/abc', '/?q=vi']) expect(await w.click(u), u).toBe(u)
    expect(await w.click()).toBe('/dashboard')
  })

  it('an open tab is navigated to the same mapped URL', async () => {
    const navigated: string[] = []
    const w = worker('eno.forum', [{ navigate: async (u) => { navigated.push(u) }, focus: () => undefined }])
    await w.click('/vi?category=rentals')
    expect(navigated).toEqual(['/?category=rentals'])
    expect(w.opened).toEqual([])
  })
})
