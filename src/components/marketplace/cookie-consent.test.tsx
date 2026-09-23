// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { CookieConsent } from './cookie-consent'
import { getConsent } from '@/lib/consent'

// ── Consent must be GIVEN, never defaulted (audit #8) ─────────────────────────────────────────────
// The ad-personalization toggle used to start ON, so "Cookie settings" → Save on a first visit
// recorded consent to Meta/Google retargeting; and turning Personalized off with ads on saved 'all'.

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

async function openFirstVisitSettings() {
  render(<LanguageProvider><CookieConsent /></LanguageProvider>)
  await act(async () => { vi.advanceTimersByTime(5_000) })
  fireEvent.click(screen.getByRole('button', { name: /Cookie settings/ }))
}

const toggle = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => { vi.useFakeTimers(); clearConsent() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CookieConsent — settings view', () => {
  it('⛔ first visit → Cookie settings → Save records NO ad consent', async () => {
    await openFirstVisitSettings()
    expect(toggle(/Ad personalization/).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('personalized')
  })

  it('turning ads ON implies personalization on', async () => {
    await openFirstVisitSettings()
    fireEvent.click(toggle(/Personalized/)) // off
    fireEvent.click(toggle(/Ad personalization/)) // on → perso back on
    expect(toggle(/Personalized/).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('all')
  })

  it('⛔ turning Personalized OFF with ads on is a "no", not "all"', async () => {
    await openFirstVisitSettings()
    fireEvent.click(toggle(/Ad personalization/)) // on
    fireEvent.click(toggle(/Personalized/)) // off → ads off too
    expect(toggle(/Ad personalization/).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('essential')
  })
})
