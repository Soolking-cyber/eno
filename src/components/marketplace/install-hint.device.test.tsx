// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ── The install card names the phone's OWN store (owner, 2026-11-08: "apple device should be shown ios download and ──
// ── android one the android version"); a desktop and our own app get no card ────────────────────────────────────────

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/components/marketplace/art-image', () => ({ ArtImage: () => null }))
vi.mock('@/lib/consent', () => ({ consentAnswered: () => true }))

import { InstallHint } from './install-hint'
import { __resetPageAsksForTests } from '@/lib/page-asks'

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
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  enoTabs: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1.0.3',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}
async function cardAs(ua: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua)
  render(<InstallHint />)
  await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
  const card = screen.queryByRole('dialog', { name: 'Get the eno app' })
  return card ? card.querySelector('a[href]')?.getAttribute('href') ?? '' : null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetPageAsksForTests()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('InstallHint — the phone\'s own store', () => {
  it('Android → Google Play', async () => {
    expect(await cardAs(UA.android)).toBe('https://play.google.com/store/apps/details?id=eno.vn')
  })
  it('an iPhone, in Safari or in Chrome → the App Store', async () => {
    expect(await cardAs(UA.iphoneSafari)).toBe('https://apps.apple.com/app/id6819638569')
    cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); __resetPageAsksForTests()
    expect(await cardAs(UA.iphoneChrome)).toBe('https://apps.apple.com/app/id6819638569')
  })
  it('a desktop → no card (it was offered Google Play before)', async () => {
    expect(await cardAs(UA.windows)).toBeNull()
  })
  it('inside the eno iOS app (native tabs, no Capacitor bridge) → no card', async () => {
    expect(await cardAs(UA.enoTabs)).toBeNull()
  })
  it('inside the Capacitor shell (an iPhone agent, the bridge present) → no card', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
    expect(await cardAs(UA.iphoneSafari)).toBeNull()
  })
  it('in the app\'s page sheet (a frame: no bridge, the inherited `native` class) → no card', async () => {
    document.documentElement.classList.add('native')
    try { expect(await cardAs(UA.iphoneSafari)).toBeNull() } finally { document.documentElement.classList.remove('native') }
  })
})
