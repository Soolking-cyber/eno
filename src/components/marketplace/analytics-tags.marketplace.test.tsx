// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.eno.vn/listings/abc"}
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

/**
 * GA DUAL-SEND ON eno.vn (owner, 2026-10-05). The SEO tool reads GA4 property 553789942, whose web stream is
 * G-0EXQ7Q17YN, and showed 0 rows — production configured only G-CKTZK62B0X. On the MARKETPLACE edition the
 * GA bootstrap now configures both ids, behind the same consent gate, and the consent runtime flips the
 * kill switch for both. eno.forum's single id is pinned in analytics-tags.test.tsx (the services suite).
 */

// The edition is read when src/lib/edition.ts loads, so it is set before the imports below (vi.hoisted runs
// first); afterEach's unstubAllEnvs puts the suite default back for the files that follow.
vi.hoisted(() => { vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace') })

/** next/script, rendered as inspectable markup: its id or src, and its inline body as text. */
vi.mock('next/script', () => ({
  default: ({ id, src, children }: { id?: string; src?: string; children?: React.ReactNode }) => (
    <div data-script={id ?? src}>{children}</div>
  ),
}))

import { AnalyticsTags } from './analytics-tags'
import { setConsent } from '@/lib/consent'
import { GA_ID, GA_IDS, GA_SEO_ID } from '@/lib/analytics'
import { IS_MARKETPLACE } from '@/lib/edition'

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
const scriptText = (id: string) => document.querySelector(`[data-script="${id}"]`)?.textContent ?? ''
const killSwitch = (id: string) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`]
const interact = () => act(() => { window.dispatchEvent(new Event('pointerdown')) })
const mount = () => act(() => { render(<AnalyticsTags />) })
const grant = (p: boolean, a: boolean, d: boolean) =>
  act(() => { setConsent({ p, a, d }, { surface: 'banner', action: 'save', locale: 'en' }) })

/** Runs the GA bootstrap against a fake window and returns what it pushed to the dataLayer. */
function runBootstrap(text: string, cm?: Record<string, string>): unknown[][] {
  const fakeWin: Record<string, unknown> = cm ? { __enoCm: cm } : {}
  new Function('window', `with (window) { ${text} }`)(fakeWin)
  return ((fakeWin.dataLayer as unknown[]) ?? []).map((e) => [...(e as IArguments)])
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  clearAllCookies()
  delete (window as unknown as { dataLayer?: unknown }).dataLayer
  delete (window as unknown as { __enoCm?: unknown }).__enoCm
  for (const id of [GA_ID, GA_SEO_ID]) delete (window as unknown as Record<string, unknown>)[`ga-disable-${id}`]
})
afterEach(() => {
  cleanup()
  clearAllCookies()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AnalyticsTags on eno.vn — two GA4 properties, one consent gate', () => {
  it('this file really is the marketplace build', () => {
    expect(IS_MARKETPLACE).toBe(true)
    expect(GA_IDS).toEqual(['G-CKTZK62B0X', 'G-0EXQ7Q17YN'])
  })

  it('⛔ no Analytics purpose → neither property loads, even after an interaction', async () => {
    await grant(true, false, true)
    await mount()
    await interact()
    expect(scriptText('ga-init')).toBe('')
    expect(document.querySelector(`[data-script^="https://www.googletagmanager.com/gtag/js"]`)).toBeNull()
  })

  it('with it: ONE gtag.js (the primary id) and a `config` for each property, after the denied default', async () => {
    await grant(false, true, false)
    await mount()
    await interact()
    expect(document.querySelectorAll(`[data-script^="https://www.googletagmanager.com/gtag/js"]`)).toHaveLength(1)
    expect(document.querySelector(`[data-script="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"]`)).not.toBeNull()
    const pushed = runBootstrap(scriptText('ga-init'), { analytics_storage: 'granted' })
    const iDefault = pushed.findIndex((e) => e[0] === 'consent' && e[1] === 'default')
    const configs = pushed.flatMap((e, i) => (e[0] === 'config' ? [{ id: e[1], i }] : []))
    expect(configs.map((c) => c.id)).toEqual(['G-CKTZK62B0X', 'G-0EXQ7Q17YN'])
    expect(iDefault).toBe(0)
    for (const c of configs) expect(c.i).toBeGreaterThan(iDefault)
  })

  it('⛔ the kill switch covers BOTH properties — off with consent, on when it is withdrawn', async () => {
    await grant(false, true, false)
    await mount()
    expect(killSwitch('G-CKTZK62B0X')).toBe(false)
    expect(killSwitch('G-0EXQ7Q17YN')).toBe(false)
    await grant(false, false, false)
    expect(killSwitch('G-CKTZK62B0X')).toBe(true)
    expect(killSwitch('G-0EXQ7Q17YN')).toBe(true)
  })

  it('eno.vn loads no Tag Manager container, as before', async () => {
    await mount()
    expect(scriptText('gtm-init')).toBe('')
  })
})
