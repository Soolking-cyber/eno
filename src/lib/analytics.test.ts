// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.eno.vn/listings/abc"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackContactSeller, trackSearch, trackViewListing } from './analytics'
import { setConsent } from './consent'

/**
 * ⛔ EVERY EVENT RE-CHECKS CONSENT. The script loader is not enough: once gtag.js (or a GTM-loaded
 * Pixel) is on the page, a withdrawal in the same tab must stop the very next event — that is what
 * /privacy promises ("Turning a use off takes effect immediately … its tracking stops"). These tests
 * stand the vendors up as stubs and watch what reaches them.
 */

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

type Vendor = (...args: unknown[]) => void
let gtag: ReturnType<typeof vi.fn<Vendor>>
let fbq: ReturnType<typeof vi.fn<Vendor>>
/** Beacons OTHER than the consent record itself (which setConsent sends to /api/consent). */
let beacons: string[] = []

const decide = (p: boolean, a: boolean, d: boolean, action: 'allow_all' | 'decline_all' | 'save' = 'save') =>
  setConsent({ p, a, d }, { surface: 'banner', action, locale: 'en' })

const view = () => trackViewListing({ id: 'l1', title: 'iPhone 15', price: 12_000_000, currency: 'VND', category: 'phones' })

beforeEach(() => {
  // ⚠️ PINNED, NOT INHERITED — setConsent() scopes its cookie by this URL, so a shell exporting the repo
  // .env used to leave a domain-scoped answer behind that the host-only sweep below could not clear.
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  for (const c of document.cookie.split(';')) {
    const n = c.split('=')[0].trim()
    if (!n) continue
    for (const d of ['', '; domain=eno.vn', '; domain=www.eno.vn']) document.cookie = `${n}=; path=/; max-age=0${d}`
  }
  gtag = vi.fn<Vendor>()
  fbq = vi.fn<Vendor>()
  window.gtag = gtag
  window.fbq = fbq
  beacons = []
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string) => { if (url !== '/api/consent') beacons.push(url); return true },
  })
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})
afterEach(() => {
  delete window.gtag
  delete window.fbq
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('analytics — per-event consent checks', () => {
  it('with all three purposes a listing view reaches GA, the Pixel and the CAPI beacon', () => {
    decide(true, true, true, 'allow_all')
    view()
    expect(gtag).toHaveBeenCalledWith('event', 'view_item', expect.objectContaining({ value: 12_000_000 }))
    expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', expect.objectContaining({ content_ids: ['l1'] }), expect.objectContaining({ eventID: expect.any(String) }))
    expect(beacons).toEqual(['/api/track/view'])
  })

  it('⛔ "Decline all" in the SAME TAB stops all three on the very next event — the scripts are still loaded', () => {
    decide(true, true, true, 'allow_all')
    view()
    gtag.mockClear()
    fbq.mockClear()
    beacons = []
    decide(false, false, false, 'decline_all')
    view()
    trackSearch({ term: 'iphone', results: 3 })
    trackContactSeller({ id: 'l1' })
    expect(gtag).not.toHaveBeenCalled()
    expect(fbq).not.toHaveBeenCalled()
    expect(beacons).toEqual([])
  })

  it('⛔ Analytics alone: GA only — no Pixel, no CAPI beacon', () => {
    decide(false, true, false)
    view()
    trackSearch({ term: 'iphone' })
    expect(gtag).toHaveBeenCalledTimes(2)
    expect(fbq).not.toHaveBeenCalled()
    expect(beacons).toEqual([])
  })

  it('⛔ Advertising alone: the Pixel and the CAPI beacon — and GA gets nothing', () => {
    decide(false, false, true)
    view()
    trackSearch({ term: 'iphone' })
    expect(gtag).not.toHaveBeenCalled()
    expect(fbq).toHaveBeenCalledTimes(2)
    expect(beacons).toEqual(['/api/track/view'])
  })

  it('an unanswered visitor sends nothing, even with both vendors on the page', () => {
    view()
    trackSearch({ term: 'iphone' })
    expect(gtag).not.toHaveBeenCalled()
    expect(fbq).not.toHaveBeenCalled()
    expect(beacons).toEqual([])
  })

  it('⛔ inside the native app nothing goes out, whatever is stored', () => {
    decide(true, true, true, 'allow_all')
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    view()
    expect(gtag).not.toHaveBeenCalled()
    expect(fbq).not.toHaveBeenCalled()
    expect(beacons).toEqual([])
  })
})
