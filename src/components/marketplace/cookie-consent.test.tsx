// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { CookieConsent } from './cookie-consent'
import { consentAnswered, hasAdConsent, hasAnalyticsConsent, personalizationAllowed, readConsent } from '@/lib/consent'
import { CONSENT_COPY_VERSION } from '@/lib/consent-value'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Consent v2: per-purpose, all OFF until chosen, refusing exactly as easy as accepting ─────────
// v1 pre-ticked "Personalized" for an unanswered visitor (and, until d2dcc590, the ad toggle), coupled
// the toggles, and offered one filled "Allow cookies" over a text-link "Decline".

// A fresh in-memory localStorage per test: the runtime's global one is not a full Storage here.
function clearConsent() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  })
  document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` })
}

let beacons: string[] = []

async function mountAndWait() {
  render(<LanguageProvider><CookieConsent /></LanguageProvider>)
  await act(async () => { vi.advanceTimersByTime(5_000) })
}

const sw = (name: RegExp) => screen.getByRole('switch', { name })
const btn = (name: RegExp) => screen.getByRole('button', { name })
const checked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true'

beforeEach(() => {
  vi.useFakeTimers()
  clearConsent()
  beacons = []
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (url: string) => { beacons.push(url); return true } })
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CookieConsent — first layer', () => {
  it('⛔ an unanswered visitor sees all three purposes, each with its own switch, ALL OFF', async () => {
    await mountAndWait()
    for (const n of [/^Personalization$/, /^Analytics$/, /^Advertising$/]) expect(checked(sw(n))).toBe(false)
  })

  it('names the vendors and the sensitive-data notice, and never promises "keep you signed in"', async () => {
    await mountAndWait()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Google Analytics')
    expect(text).toMatch(/sensitive personal data under Vietnamese law/)
    expect(text).toMatch(/including sign-in/)
    expect(text).not.toMatch(/keep you signed in/i)
  })

  it('⛔ Advertising alone reaches META: Google is named only "if Analytics is on too" (GA is never loaded without it)', async () => {
    await mountAndWait()
    const desc = document.getElementById(sw(/^Advertising$/).getAttribute('aria-describedby')!)!.textContent ?? ''
    expect(desc).toContain('with Meta (and with Google, if Analytics is on too)')
    expect(desc).not.toMatch(/Meta and Google/)
  })

  it('⛔ the Vietnamese says the email is HASHED ("băm"), never "mã hoá" — hashing is not encryption', async () => {
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><CookieConsent /></LanguageProvider>)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    const desc = document.getElementById(screen.getByRole('switch', { name: /^Quảng cáo$/ }).getAttribute('aria-describedby')!)!.textContent ?? ''
    expect(desc).toContain('được xáo trộn (băm)')
    expect(desc).toContain('nếu Phân tích cũng bật')
    expect(desc).not.toMatch(/mã hoá|mã hóa/)
  })

  it('⛔ the purpose descriptions — where each vendor is named — are text-xs body copy, not the card’s smallest type', async () => {
    await mountAndWait()
    for (const n of [/^Personalization$/, /^Analytics$/, /^Advertising$/]) {
      const cls = document.getElementById(sw(n).getAttribute('aria-describedby')!)!.className.split(/\s+/)
      expect(cls).toContain('text-xs')
      expect(cls).toContain('text-muted-foreground')
      expect(cls).not.toContain('text-2xs')
      expect(cls).not.toContain('text-ink-4')
    }
  })

  it('⛔ "Allow all" and "Decline all" carry EQUAL weight — same variant, same classes', async () => {
    await mountAndWait()
    expect(btn(/^Decline all$/).className).toBe(btn(/^Allow all$/).className)
  })

  it('⛔ Save with nothing switched on is a REFUSAL, not a yes', async () => {
    await mountAndWait()
    fireEvent.click(btn(/^Save my choices$/))
    expect(consentAnswered()).toBe(true)
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([false, false, false])
  })

  it.each([
    [/^Personalization$/, [true, false, false]],
    [/^Analytics$/, [false, true, false]],
    [/^Advertising$/, [false, false, true]],
  ] as const)('⛔ each switch maps ONLY to its own purpose (%s)', async (name, expected) => {
    await mountAndWait()
    fireEvent.click(sw(name))
    // Independent: flipping one never moves another (v1 coupled ads ⇒ personalized).
    const all = [sw(/^Personalization$/), sw(/^Analytics$/), sw(/^Advertising$/)].map(checked)
    expect(all).toEqual(expected)
    fireEvent.click(btn(/^Save my choices$/))
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual(expected)
  })

  it('"Allow all" grants all three; "Decline all" grants none — and both are recorded', async () => {
    await mountAndWait()
    fireEvent.click(btn(/^Allow all$/))
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([true, true, true])
    expect(beacons).toEqual(['/api/consent'])
    cleanup()
    clearConsent()
    await mountAndWait()
    fireEvent.click(btn(/^Decline all$/))
    expect(consentAnswered()).toBe(true)
    expect([personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]).toEqual([false, false, false])
    expect(beacons).toEqual(['/api/consent', '/api/consent'])
  })
})

describe('CookieConsent — who is asked', () => {
  it('⛔ a visitor holding a bare v1 "all" is ASKED AGAIN, and nothing is granted meanwhile', async () => {
    localStorage.setItem('eno-cookie-consent', 'all')
    document.cookie = 'eno-consent=all; path=/'
    expect(hasAdConsent()).toBe(false)
    await mountAndWait()
    expect(screen.queryByRole('button', { name: /^Allow all$/ })).not.toBeNull()
  })

  it('a visitor who answered "essential" under v1 is NOT asked again', async () => {
    localStorage.setItem('eno-cookie-consent', 'essential')
    await mountAndWait()
    expect(screen.queryByRole('button', { name: /^Allow all$/ })).toBeNull()
  })
})

describe('CookieConsent — re-open (footer / settings / privacy)', () => {
  it('pre-fills the switches from the stored answer and saves changes as a "settings" choice', async () => {
    render(<LanguageProvider><CookieConsent /></LanguageProvider>)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    fireEvent.click(sw(/^Analytics$/))
    fireEvent.click(btn(/^Save my choices$/))
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    expect(screen.getByText('Your choices')).toBeTruthy()
    expect([sw(/^Personalization$/), sw(/^Analytics$/), sw(/^Advertising$/)].map(checked)).toEqual([false, true, false])
    fireEvent.click(sw(/^Analytics$/)) // withdraw
    fireEvent.click(btn(/^Save my choices$/))
    expect(hasAnalyticsConsent()).toBe(false)
    expect(readConsent()).toMatchObject({ p: false, a: false, d: false, source: 'v2' })
  })
})

describe('CookieConsent — inside the native app', () => {
  it('⛔ analytics and advertising are shown LOCKED OFF, and "Allow all" grants personalization only', async () => {
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    await mountAndWait()
    expect((sw(/^Analytics$/) as HTMLElement).hasAttribute('data-disabled')).toBe(true)
    expect((sw(/^Advertising$/) as HTMLElement).hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(btn(/^Allow all$/))
    // Stored as p only — the record must not claim a grant the app can never act on.
    expect(readConsent()).toMatchObject({ p: true, a: false, d: false })
  })
})

describe('CookieConsent — a deliberate open inside the first-visit delay', () => {
  it('⛔ the pending auto-open does NOT wipe switches the visitor is setting', async () => {
    render(<LanguageProvider><CookieConsent /></LanguageProvider>)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    fireEvent.click(sw(/^Analytics$/))
    await act(async () => { vi.advanceTimersByTime(5_000) }) // the 4 s auto-open would have fired here
    expect(checked(sw(/^Analytics$/))).toBe(true)
    fireEvent.click(btn(/^Save my choices$/))
    expect(hasAnalyticsConsent()).toBe(true)
  })
})

/**
 * ⛔ THE RECORDED COPY VERSION MUST CHANGE WHEN THE WORDS DO. Every consent record carries
 * CONSENT_COPY_VERSION so it can say which notice a "yes" was given to; a copy edit under an unchanged
 * version makes every later record claim the OLD words. This fingerprints every tr() pair in the card
 * (English AND Vietnamese) and pins it to the version.
 * When this fails: bump CONSENT_COPY_VERSION in src/lib/consent-value.ts (and note why there), then
 * add the new version with the hash this test prints. Never just update the hash under the old version.
 */
const COPY_FINGERPRINTS: Record<string, string> = {
  '2026-09-24': '2a8cc32679e60f73',
}

describe('CookieConsent — the copy version is held to the words', () => {
  it('⛔ the card’s copy matches the fingerprint recorded for CONSENT_COPY_VERSION', () => {
    const src = readFileSync(join(__dirname, 'cookie-consent.tsx'), 'utf8')
    const pairs = [...src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,?\s*\)/g)].map((m) => [m[1], m[2]])
    expect(pairs.length).toBeGreaterThan(15) // the extractor is really reading the card
    // ⛔ …AND IT READS ALL OF IT. Copy written any other way — `<Tr>`, a template literal, a double-quoted
    // or three-argument tr() — would change the notice without moving the hash, so every tr( outside a
    // comment must be one the extractor matched, and the card must not use <Tr> at all.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code.match(/\btr\(/g)?.length, 'a tr() call the fingerprint cannot read').toBe(pairs.length)
    expect(code).not.toMatch(/<Tr\b/)
    const hash = createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16)
    expect({ version: CONSENT_COPY_VERSION, hash }).toEqual({ version: CONSENT_COPY_VERSION, hash: COPY_FINGERPRINTS[CONSENT_COPY_VERSION] })
  })
})
