// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.eno.vn/listings/abc"}
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

/**
 * <AnalyticsTags/> is where consent v2 is ENFORCED on every page, so each of these is a behaviour the
 * unit tests of src/lib/consent*.ts cannot see — they prove the functions work, not that anything
 * calls them:
 *   · Google Analytics is not even loaded without the Analytics purpose;
 *   · the cleanup runs on MOUNT (every page load), not only when a choice changes;
 *   · both bootstraps push the all-denied Consent Mode default BEFORE gtm.js / config;
 *   · a withdrawal made in ANOTHER TAB reaches this one.
 */

// GTM_ID is read when the module loads, so it is set before the import below (vi.hoisted runs first).
// The suite runs as the services edition (vitest.config.ts), the one edition with a container.
vi.hoisted(() => { process.env.NEXT_PUBLIC_GTM_ID = 'GTM-TEST1' })

/** next/script, rendered as inspectable markup: its id or src, and its inline body as text. */
vi.mock('next/script', () => ({
  default: ({ id, src, children }: { id?: string; src?: string; children?: React.ReactNode }) => (
    <div data-script={id ?? src}>{children}</div>
  ),
}))

import { AnalyticsTags } from './analytics-tags'
import { setConsent } from '@/lib/consent'
import { GA_ID } from '@/lib/analytics'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function clearAllCookies() {
  for (const c of document.cookie.split(';')) {
    const n = c.split('=')[0].trim()
    if (!n) continue
    for (const d of ['', '; domain=eno.vn', '; domain=www.eno.vn']) document.cookie = `${n}=; path=/; max-age=0${d}`
  }
}
const cookieNames = () => document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean)
const gaScript = () => document.querySelector(`[data-script="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"]`)
const scriptText = (id: string) => document.querySelector(`[data-script="${id}"]`)?.textContent ?? ''
const killSwitch = () => (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]

/** The first-interaction gate GA waits behind. */
const interact = () => act(() => { window.dispatchEvent(new Event('pointerdown')) })
const mount = () => act(() => { render(<AnalyticsTags />) })
const grant = (p: boolean, a: boolean, d: boolean) =>
  act(() => { setConsent({ p, a, d }, { surface: 'banner', action: 'save', locale: 'en' }) })

/**
 * What ANOTHER TAB's setConsent() leaves behind: the shared cookie and the localStorage copy changed,
 * and — this is the point — no `eno:consent` in THIS window, because that event is same-tab only.
 */
function otherTabWrites(bits: string) {
  const value = `v2.${bits}.${Math.floor(Date.now() / 1000)}.c0ffee00-1234-4abc-8def-001122334455`
  // Scoped exactly as setConsent() scopes it under the pinned NEXT_PUBLIC_APP_URL, so it REPLACES this
  // tab's cookie. A host-only write beside a domain-scoped one would be two cookies of one name.
  document.cookie = `eno-consent-v2=${value}; path=/; domain=eno.vn`
  localStorage.setItem('eno-consent-v2', value)
}

/** Runs an inline bootstrap against a fake window, and returns what it pushed to the dataLayer. */
function runBootstrap(text: string, cm?: Record<string, string>): unknown[][] {
  const inserted: unknown[] = []
  const fakeDoc = {
    getElementsByTagName: () => [{ parentNode: { insertBefore: (el: unknown) => inserted.push(el) } }],
    createElement: () => ({}),
  }
  const fakeWin: Record<string, unknown> = cm ? { __enoCm: cm } : {}
  // The GA bootstrap reads the bare global `dataLayer`, so the fake window is also the scope.
  new Function('window', 'document', `with (window) { ${text} }`)(fakeWin, fakeDoc)
  return ((fakeWin.dataLayer as unknown[]) ?? []).map((e) =>
    Array.isArray(e) || typeof e !== 'object' || e === null || !('length' in (e as object)) ? [e] : [...(e as IArguments)],
  )
}

const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }

beforeEach(() => {
  /**
   * ⚠️ PINNED, NOT INHERITED: setConsent() scopes its cookie to the registrable domain of this URL, so
   * the suite's answer otherwise depends on the shell (one that exports the repo .env failed four tests
   * here while a clean one passed). Pinned to the production shape — domain-scoped — as in consent.test.ts.
   */
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  clearAllCookies()
  delete (window as unknown as { dataLayer?: unknown }).dataLayer
  delete (window as unknown as { __enoCm?: unknown }).__enoCm
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]
})
afterEach(() => {
  cleanup()
  clearAllCookies()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('AnalyticsTags — Google Analytics loads only with the Analytics purpose', () => {
  it('⛔ no Analytics → no gtag.js, even after the visitor interacts', async () => {
    await grant(true, false, true) // Personalization and Advertising, but not Analytics
    await mount()
    await interact()
    expect(gaScript()).toBeNull()
    expect(scriptText('ga-init')).toBe('')
  })

  it('an Analytics grant loads it in the same tab, without a reload', async () => {
    await mount()
    await interact()
    expect(gaScript()).toBeNull()
    await grant(false, true, false)
    expect(gaScript()).not.toBeNull()
    expect(scriptText('ga-init')).toContain(`gtag('config','${GA_ID}')`)
  })
})

describe('AnalyticsTags — the cleanup runs on EVERY load, not only on a change', () => {
  it('⛔ a v1 "all" holder with _ga, eno_attr and a view history loses them on mount — with no eno:consent at all', async () => {
    localStorage.setItem('eno-cookie-consent', 'all') // read as NOT ANSWERED by v2
    document.cookie = '_ga=GA1.2.111.222; path=/; domain=eno.vn'
    document.cookie = 'eno_attr=%7B%22s%22%3A%22facebook%22%7D; path=/'
    document.cookie = '_fbp=fb.1.2.3; path=/'
    localStorage.setItem('eno:viewed', JSON.stringify([{ c: 'phones' }]))
    localStorage.setItem('eno:viewed_ids', JSON.stringify(['l1']))
    const events: string[] = []
    const seen = (e: Event) => events.push(e.type)
    window.addEventListener('eno:consent', seen)
    await mount()
    window.removeEventListener('eno:consent', seen)
    expect(events).toEqual([]) // nothing changed — the cleanup ran because the page LOADED
    for (const n of ['_ga', 'eno_attr', '_fbp']) expect(cookieNames()).not.toContain(n)
    expect(localStorage.getItem('eno:viewed')).toBeNull()
    expect(localStorage.getItem('eno:viewed_ids')).toBeNull()
    expect(killSwitch()).toBe(true)
  })
})

describe('AnalyticsTags — Consent Mode starts all-denied in BOTH bootstraps', () => {
  it('⛔ eno.forum’s GTM snippet pushes the denied default BEFORE gtm.js, then the stored answer', async () => {
    await mount()
    const text = scriptText('gtm-init')
    expect(text).toContain('GTM-TEST1')
    const pushed = runBootstrap(text, { analytics_storage: 'granted', ad_storage: 'denied' })
    const iDefault = pushed.findIndex((e) => e[0] === 'consent' && e[1] === 'default')
    const iUpdate = pushed.findIndex((e) => e[0] === 'consent' && e[1] === 'update')
    const iStart = pushed.findIndex((e) => typeof e[0] === 'object' && e[0] !== null && 'gtm.start' in (e[0] as object))
    expect(pushed[iDefault]?.[2]).toMatchObject(DENIED)
    expect(iDefault).toBe(0)
    expect(iUpdate).toBeGreaterThan(iDefault)
    expect(iStart).toBeGreaterThan(iUpdate)
    expect(pushed[iUpdate][2]).toEqual({ analytics_storage: 'granted', ad_storage: 'denied' })
  })

  it('with no stored answer yet the GTM snippet stays denied (no update is invented)', async () => {
    await mount()
    const pushed = runBootstrap(scriptText('gtm-init'))
    expect(pushed.filter((e) => e[0] === 'consent').map((e) => e[1])).toEqual(['default'])
  })

  it('⛔ the GA bootstrap pushes the denied default before `config`', async () => {
    await grant(false, true, false)
    await mount()
    await interact()
    const pushed = runBootstrap(scriptText('ga-init'), { analytics_storage: 'granted' })
    const iDefault = pushed.findIndex((e) => e[0] === 'consent' && e[1] === 'default')
    const iConfig = pushed.findIndex((e) => e[0] === 'config')
    expect(iDefault).toBe(0)
    expect(pushed[iDefault][2]).toMatchObject(DENIED)
    expect(iConfig).toBeGreaterThan(iDefault)
  })
})

describe('⛔ AnalyticsTags — a withdrawal in ANOTHER tab reaches this one', () => {
  const planted = () => { document.cookie = '_ga=GA1.2.111.222; path=/; domain=eno.vn' }

  it('immediately, through the storage event: kill switch on, _ga deleted, gtag.js unmounted', async () => {
    await grant(true, true, true)
    await mount()
    await interact()
    planted()
    expect(gaScript()).not.toBeNull()
    expect(killSwitch()).toBe(false)
    otherTabWrites('000')
    await act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'eno-consent-v2' })) })
    expect(killSwitch()).toBe(true)
    expect(cookieNames()).not.toContain('_ga')
    expect(gaScript()).toBeNull()
    expect(window.__enoCm?.analytics_storage).toBe('denied')
  })

  it('an unrelated storage key does nothing', async () => {
    await grant(true, true, true)
    await mount()
    planted()
    otherTabWrites('000')
    await act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'eno:viewed' })) })
    expect(cookieNames()).toContain('_ga')
  })

  it.each([
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('with localStorage blocked, on %s: the cookie is re-read when the tab is looked at again', async (_l, fire) => {
    await grant(true, true, true)
    await mount()
    planted()
    // The other tab's cookie only (its localStorage write failed): scoped as setConsent() scopes it.
    document.cookie = `eno-consent-v2=v2.000.${Math.floor(Date.now() / 1000)}.c0ffee00-1234-4abc-8def-001122334455; path=/; domain=eno.vn`
    await act(() => { fire() })
    expect(killSwitch()).toBe(true)
    expect(cookieNames()).not.toContain('_ga')
  })
})
