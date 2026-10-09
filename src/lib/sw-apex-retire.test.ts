import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/**
 * ⛔ public/sw.js — THE FORUM APEX RETIRES ITS PUSH SUBSCRIPTION. next.config.ts moves eno.forum's pages to www, so a
 * subscription made on the apex origin could no longer be signed out, guarded (push-account-guard.ts) or managed from
 * any page: on a shared device it would keep showing one account's notifications. The apex's worker unsubscribes it on
 * activation; every other host keeps its own. Run in a sandbox like sw-push-click.test.ts (the file is plain JS that no
 * bundler touches).
 */
type ActivateEvent = { waitUntil: (p: Promise<unknown>) => void }

async function activate(hostname: string, sub: { unsubscribe: () => Promise<boolean> } | null | 'throws') {
  const handlers: Record<string, (e: ActivateEvent) => void> = {}
  const getSubscription = vi.fn(async () => { if (sub === 'throws') throw new Error('push service down'); return sub })
  const skipWaiting = vi.fn()
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (type: string, fn: (e: ActivateEvent) => void) => { handlers[type] = fn }, location: { hostname }, registration: { pushManager: { getSubscription } }, navigator: {}, skipWaiting },
    clients: {},
  })
  handlers.install?.({ waitUntil: () => {} })
  let done: Promise<unknown> = Promise.resolve()
  handlers.activate({ waitUntil: (p) => { done = p } })
  return { result: await done, getSubscription, skipWaiting }
}

describe('public/sw.js activate — the forum apex retires its push subscription', () => {
  it('⛔ on eno.forum (the apex) the subscription is unsubscribed', async () => {
    const sub = { unsubscribe: vi.fn(async () => true) }
    await activate('eno.forum', sub)
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('on the apex the new worker skips waiting — a tab left open across the deploy cannot hold the retirement back', async () => {
    expect((await activate('eno.forum', null)).skipWaiting).toHaveBeenCalledTimes(1)
    expect((await activate('www.eno.forum', null)).skipWaiting).not.toHaveBeenCalled()
  })

  it('every other host keeps its subscription — www.eno.forum, eno.vn, a shop subdomain, a local preview', async () => {
    for (const host of ['www.eno.forum', 'eno.vn', 'www.eno.vn', 'shop.eno.vn', 'localhost']) {
      const sub = { unsubscribe: vi.fn(async () => true) }
      const { getSubscription } = await activate(host, sub)
      expect(sub.unsubscribe, host).not.toHaveBeenCalled()
      expect(getSubscription, host).not.toHaveBeenCalled()
    }
  })

  it('no subscription, or a push service that fails, never rejects the activation', async () => {
    await expect(activate('eno.forum', null).then((r) => r.result)).resolves.toBe(false)
    await expect(activate('eno.forum', 'throws').then((r) => r.result)).resolves.toBe(false)
  })
})
