// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.eno.vn/listings/abc"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consentAnswered,
  hasAdConsent,
  hasAnalyticsConsent,
  personalizationAllowed,
  readConsent,
  setConsent,
  syncConsentStorage,
} from './consent'
import { applyConsentMode, cookieDomainCandidates, enforceConsentCleanup } from './consent-runtime'
import { CONSENT_MAX_AGE_S, parseConsentV2, serializeConsent } from './consent-value'
import { captureFirstTouch, getAttribution } from './attribution'
import { getViewedListingIds, recordView, recordViewedListing } from './reco-signals'
import { GA_ID } from './analytics'

/**
 * Consent v2 in the browser: the stored answer, the legacy slots old tabs read, the per-load cleanup,
 * and the writers that must stay silent without their purpose. The page runs at www.eno.vn (a host
 * UNDER the configured domain) so the domain-scoped cookie and the registrable-domain delete are real.
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

/** Every `document.cookie = …` write, attributes included (the getter only shows name=value). */
let cookieWrites: string[] = []
const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!

function clearAllCookies() {
  for (const c of cookieDesc.get!.call(document).split(';')) {
    const n = c.split('=')[0].trim()
    if (!n) continue
    for (const d of ['', '; domain=eno.vn', '; domain=www.eno.vn']) cookieDesc.set!.call(document, `${n}=; path=/; max-age=0${d}`)
  }
}
const cookieNames = () => document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean)
const cookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null

let beacons: Array<{ url: string; body: Record<string, unknown> }> = []

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  clearAllCookies()
  cookieWrites = []
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => cookieDesc.get!.call(document),
    set: (v: string) => { cookieWrites.push(v); cookieDesc.set!.call(document, v) },
  })
  beacons = []
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, blob: Blob) => {
      // Blob.text() is async, so the payload lands a tick later — the test waits for it.
      void blob.text().then((t) => beacons.push({ url, body: JSON.parse(t) }))
      return true
    },
  })
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
  delete (window as unknown as { dataLayer?: unknown }).dataLayer
  delete (window as unknown as { __enoCm?: unknown }).__enoCm
})

afterEach(() => {
  delete (document as unknown as { cookie?: unknown }).cookie
  clearAllCookies()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const decide = (p: boolean, a: boolean, d: boolean) =>
  setConsent({ p, a, d }, { surface: 'banner', action: 'save', locale: 'en' })

describe('reading', () => {
  it('nothing stored → not answered, and NOTHING is allowed (silence is not consent)', () => {
    expect(readConsent()).toBeNull()
    expect(consentAnswered()).toBe(false)
    expect(personalizationAllowed()).toBe(false)
    expect(hasAnalyticsConsent()).toBe(false)
    expect(hasAdConsent()).toBe(false)
  })

  it('⛔ a v1 "all" (e2e and old visitors) is NOT an answer and grants nothing', () => {
    localStorage.setItem('eno-cookie-consent', 'all')
    document.cookie = 'eno-consent=all; path=/'
    expect(consentAnswered()).toBe(false)
    expect(hasAdConsent()).toBe(false)
    expect(personalizationAllowed()).toBe(false)
  })

  it('a v1 "essential" (what e2e seeds) is an answer: a refusal, never re-asked', () => {
    localStorage.setItem('eno-cookie-consent', 'essential')
    expect(consentAnswered()).toBe(true)
    expect(personalizationAllowed()).toBe(false)
  })

  it('⛔ v1 "accepted" is a refusal too — it used to keep personalization ON', () => {
    localStorage.setItem('eno-cookie-consent', 'accepted')
    expect(consentAnswered()).toBe(true)
    expect(personalizationAllowed()).toBe(false)
  })
})

describe('setConsent — the one write path', () => {
  it('each purpose maps to its own flag, and only to it', () => {
    decide(false, true, false)
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([false, true, false])
    decide(true, false, false)
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([true, false, false])
    decide(false, false, true)
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([false, false, true])
  })

  it('writes ONE domain-scoped v2 cookie and the localStorage copy', () => {
    decide(true, false, true)
    const v2Writes = cookieWrites.filter((w) => w.startsWith('eno-consent-v2='))
    expect(v2Writes).toHaveLength(1)
    expect(v2Writes[0]).toContain('domain=eno.vn')
    expect(parseConsentV2(cookie('eno-consent-v2'))).toMatchObject({ p: true, a: false, d: true })
    expect(localStorage.getItem('eno-consent-v2')).toBe(cookie('eno-consent-v2'))
  })

  it('⛔ stamps the literal "essential" into all three v1 slots — on a refusal AND on a grant', () => {
    for (const [p, a, d] of [[false, false, false], [true, true, true]] as const) {
      decide(p, a, d)
      expect(localStorage.getItem('eno-cookie-consent')).toBe('essential')
      expect(cookieWrites.some((w) => w.startsWith('eno-cookie-consent=essential') && !w.includes('domain='))).toBe(true)
      expect(cookieWrites.some((w) => w.startsWith('eno-consent=essential') && w.includes('domain=eno.vn'))).toBe(true)
    }
  })

  it('keeps the same consent id across changes, so every record links to the first', () => {
    const first = decide(true, true, true)
    const second = decide(false, false, false)
    expect(second.cid).toBe(first.cid)
  })

  it('announces the change and records it (sendBeacon → /api/consent)', async () => {
    const seen: unknown[] = []
    window.addEventListener('eno:consent', (e) => seen.push((e as CustomEvent).detail), { once: true })
    const stored = setConsent({ p: true, a: false, d: false }, { surface: 'settings', action: 'save', locale: 'vi' })
    expect(seen).toEqual([{ p: true, a: false, d: false }])
    await vi.waitFor(() => expect(beacons).toHaveLength(1))
    expect(beacons[0].url).toBe('/api/consent')
    expect(beacons[0].body).toEqual({
      cid: stored.cid, p: true, a: false, d: false, v: 2, copy: expect.any(String),
      surface: 'settings', action: 'save', locale: 'vi', ts: stored.ts,
    })
  })

  it('the cookie lives what is LEFT of the 12 months, and re-syncing never extends it', () => {
    const old = Math.floor(Date.now() / 1000) - 100 * 24 * 3600
    localStorage.setItem('eno-consent-v2', serializeConsent({ p: true, a: false, d: false, ts: old, cid: 'abcdefgh-1234' }))
    syncConsentStorage()
    const w = cookieWrites.find((x) => x.startsWith('eno-consent-v2='))!
    const maxAge = Number(/max-age=(\d+)/.exec(w)![1])
    expect(maxAge).toBeLessThanOrEqual(CONSENT_MAX_AGE_S - 100 * 24 * 3600)
    expect(maxAge).toBeGreaterThan(CONSENT_MAX_AGE_S - 101 * 24 * 3600)
  })

  it('a host OUTSIDE the configured domain gets a host-only cookie (a rejected domain cookie would persist nothing)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.forum')
    decide(true, false, false)
    const w = cookieWrites.find((x) => x.startsWith('eno-consent-v2='))!
    expect(w).not.toContain('domain=')
    expect(personalizationAllowed()).toBe(true)
  })
})

describe('syncConsentStorage', () => {
  it('the cookie wins: a withdrawal made on another host overwrites this origin’s stale copy', () => {
    decide(true, true, true)
    const cid = readConsent()!.cid!
    const withdrawn = serializeConsent({ p: false, a: false, d: false, ts: Math.floor(Date.now() / 1000), cid })
    document.cookie = `eno-consent-v2=${withdrawn}; path=/; domain=eno.vn` // written by a storefront
    syncConsentStorage()
    expect(localStorage.getItem('eno-consent-v2')).toBe(withdrawn)
    expect(hasAnalyticsConsent()).toBe(false)
  })

  it('a valid localStorage copy restores a cleared cookie', () => {
    decide(true, false, false)
    clearAllCookies()
    syncConsentStorage()
    expect(parseConsentV2(cookie('eno-consent-v2'))).toMatchObject({ p: true })
  })

  it('an expired answer is left alone and reads as "ask again"', () => {
    const ts = Math.floor(Date.now() / 1000) - CONSENT_MAX_AGE_S - 10
    localStorage.setItem('eno-consent-v2', serializeConsent({ p: true, a: true, d: true, ts, cid: 'abcdefgh-1234' }))
    localStorage.setItem('eno-cookie-consent', 'essential')
    syncConsentStorage()
    expect(cookie('eno-consent-v2')).toBeNull()
    expect(consentAnswered()).toBe(false)
  })
})

describe('⛔ inside the native apps analytics and advertising are always off', () => {
  it('Capacitor', () => {
    decide(true, true, true)
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([true, false, false])
  })

  it('the SwiftUI app’s web tabs (UA marker only)', () => {
    decide(true, true, true)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) EnoNativeTabs/1')
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([true, false, false])
  })
})

describe('enforceConsentCleanup — by STATE, on every load', () => {
  const plant = () => {
    // GA writes on the registrable domain ("auto"); eno_attr and the pixel ids host-only.
    document.cookie = '_ga=GA1.2.111.222; path=/; domain=eno.vn'
    document.cookie = `_ga_${GA_ID.replace(/^G-/, '')}=GS1.1.333; path=/; domain=eno.vn`
    document.cookie = '_gid=GA1.2.444; path=/'
    document.cookie = 'eno_attr=%7B%22s%22%3A%22facebook%22%7D; path=/'
    document.cookie = '_fbp=fb.1.2.3; path=/; domain=eno.vn'
    document.cookie = '_gcl_au=1.1.9; path=/'
    document.cookie = '_gac_UA-1-1=1.2.gclid; path=/; domain=eno.vn'
    localStorage.setItem('eno:viewed', JSON.stringify([{ c: 'phones' }]))
    localStorage.setItem('eno:viewed_ids', JSON.stringify(['l1', 'l2']))
    sessionStorage.setItem('eno_attr_pending', '{"s":"google"}')
  }

  it('⛔ THE SKEPTIC’S CASE: a v1 "all" + eno_attr + _ga → "Decline all" → every one of them is gone', () => {
    localStorage.setItem('eno-cookie-consent', 'all')
    plant()
    setConsent({ p: false, a: false, d: false }, { surface: 'banner', action: 'decline_all', locale: 'en' })
    enforceConsentCleanup() // what the eno:consent listener runs
    const names = cookieNames()
    for (const n of ['_ga', `_ga_${GA_ID.replace(/^G-/, '')}`, '_gid', 'eno_attr', '_fbp', '_gcl_au', '_gac_UA-1-1']) expect(names).not.toContain(n)
    expect(localStorage.getItem('eno:viewed')).toBeNull()
    expect(localStorage.getItem('eno:viewed_ids')).toBeNull()
    expect(sessionStorage.getItem('eno_attr_pending')).toBeNull()
  })

  it('runs WITHOUT any change: an unanswered visitor loses the leftovers on the next page load', () => {
    localStorage.setItem('eno-cookie-consent', 'personalized')
    plant()
    enforceConsentCleanup()
    expect(cookieNames()).not.toContain('_ga')
    expect(cookieNames()).not.toContain('eno_attr')
    expect(localStorage.getItem('eno:viewed_ids')).toBeNull()
    // Not answered yet: the staged first-touch may still be promoted by a later "yes".
    expect(sessionStorage.getItem('eno_attr_pending')).not.toBeNull()
  })

  it('keeps what each GRANTED purpose owns, and only that', () => {
    plant()
    decide(true, true, false)
    enforceConsentCleanup()
    const names = cookieNames()
    expect(names).toContain('_ga')
    expect(names).toContain('eno_attr')
    expect(names).not.toContain('_fbp')
    expect(names).not.toContain('_gcl_au')
    expect(localStorage.getItem('eno:viewed_ids')).not.toBeNull()
  })

  it('Advertising without Analytics keeps the ad ids but still drops every Analytics cookie (incl. _gac_)', () => {
    plant()
    decide(false, false, true)
    enforceConsentCleanup()
    const names = cookieNames()
    expect(names).toContain('_fbp')
    for (const n of ['_ga', '_gid', 'eno_attr', '_gac_UA-1-1']) expect(names).not.toContain(n)
  })

  it('domain candidates: this host and every parent with two or more labels', () => {
    expect(cookieDomainCandidates('gmbr.eno.vn')).toEqual(['gmbr.eno.vn', 'eno.vn'])
    expect(cookieDomainCandidates('www.eno.forum')).toEqual(['www.eno.forum', 'eno.forum'])
    expect(cookieDomainCandidates('localhost')).toEqual([])
    expect(cookieDomainCandidates('127.0.0.1')).toEqual([])
  })
})

describe('applyConsentMode', () => {
  it('pushes a Consent Mode update as an ARGUMENTS object and flips GA’s kill switch', () => {
    const dl: unknown[] = []
    ;(window as unknown as { dataLayer: unknown[] }).dataLayer = dl
    decide(false, true, false)
    applyConsentMode()
    const last = dl.at(-1) as IArguments
    expect(Array.isArray(last)).toBe(false) // gtag.js ignores arrays
    expect([...last]).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }])
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(false)
    expect(window.__enoCm?.analytics_storage).toBe('granted')

    decide(false, false, false)
    applyConsentMode()
    expect([...(dl.at(-1) as IArguments)][2]).toMatchObject({ analytics_storage: 'denied' })
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true)
  })

  it('does not create a dataLayer (or window.gtag) when none exists', () => {
    decide(true, true, true)
    applyConsentMode()
    expect((window as unknown as { dataLayer?: unknown }).dataLayer).toBeUndefined()
    expect(window.gtag).toBeUndefined()
    expect(window.__enoCm?.ad_storage).toBe('granted')
  })
})

describe('writers that must stay silent without their purpose', () => {
  it('⛔ the view history is not even SAVED without Personalization', () => {
    recordView('phones', 'apple')
    recordViewedListing('l1')
    expect(localStorage.getItem('eno:viewed')).toBeNull()
    expect(localStorage.getItem('eno:viewed_ids')).toBeNull()
    decide(true, false, false)
    recordView('phones', 'apple')
    recordViewedListing('l1')
    expect(JSON.parse(localStorage.getItem('eno:viewed')!)).toEqual([{ c: 'phones', b: 'apple' }])
    expect(getViewedListingIds()).toEqual(['l1'])
  })

  it('recordView recovers from the pre-v2 dedup MAP that shared its key', () => {
    decide(true, false, false)
    localStorage.setItem('eno:viewed', JSON.stringify({ l1: Date.now() }))
    recordView('cars')
    expect(JSON.parse(localStorage.getItem('eno:viewed')!)).toEqual([{ c: 'cars' }])
  })

  it('⛔ eno_attr is written only with ANALYTICS — Personalization alone no longer writes it', () => {
    decide(true, false, true)
    captureFirstTouch()
    expect(cookieNames()).not.toContain('eno_attr')
    expect(getAttribution()).toBeNull()
  })

  it('⛔ a first-touch cookie left from an earlier answer is not READ once Analytics is off', () => {
    decide(false, true, false)
    captureFirstTouch()
    const left = document.cookie.split('; ').find((c) => c.startsWith('eno_attr='))
    expect(left).toBeDefined()
    decide(true, false, true)
    // Re-plant it as a cookie the cleanup has not reached yet (a v1 visitor's, or another tab's).
    document.cookie = `${left}; path=/`
    expect(cookieNames()).toContain('eno_attr')
    expect(getAttribution()).toBeNull()
  })

  it('an unanswered visitor’s first touch stays ephemeral, then is promoted by an Analytics "yes"', () => {
    captureFirstTouch()
    expect(cookieNames()).not.toContain('eno_attr')
    expect(sessionStorage.getItem('eno_attr_pending')).not.toBeNull()
    decide(false, true, false)
    captureFirstTouch()
    expect(cookieNames()).toContain('eno_attr')
    expect(getAttribution()).toMatchObject({ source: 'direct' })
  })
})
