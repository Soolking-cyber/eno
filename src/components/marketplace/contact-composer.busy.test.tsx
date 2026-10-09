// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * THE PDP'S OFFER ROW — Emil-skills audit, contact:
 *  · the two buttons a buyer presses to make an offer (Send offer, Chat now) showed nothing on the press and were
 *    40px tall; the one pressed now carries ui/button's spinner, the other goes inert, and both reach 44px;
 *  · while auth was still loading, EVERY visitor got the signed-in offer slider, which then collapsed into "Sign in
 *    to make an offer" for a guest. The cookie decides it now (`no-session`, set before paint).
 */

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (t: string) => t }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, prefetch: vi.fn(), replace: vi.fn() }) }))
const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  identityLoaded: false,
  accountType: null as string | null,
  openSignIn: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))

import { ContactComposer } from './contact-composer'

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

const composer = () =>
  render(<ContactComposer listingId="l1" listingTitle="Sofa" sellerName="An" currency="₫" price={1_000_000} negotiable />)

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  auth.user = { id: 'u1' }
  auth.loading = false
  auth.identityLoaded = true
  auth.accountType = 'individual'
  push.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const sendOffer = () => screen.getByRole('button', { name: /Send offer/ })
const chatNow = () => screen.getByRole('button', { name: /Chat now/ })

describe('the offer row', () => {
  it('⛔ Send offer: the pressed button shows it is working (aria-busy), the other goes inert — one send', () => {
    composer()
    fireEvent.click(sendOffer())
    expect(sendOffer().getAttribute('aria-busy')).toBe('true')
    expect(chatNow().getAttribute('aria-disabled')).toBe('true')
    expect(chatNow().getAttribute('aria-busy')).not.toBe('true')
    fireEvent.click(chatNow()) // a second tap during the wait
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('Chat now: the spinner is on Chat now, and Send offer goes inert', () => {
    composer()
    fireEvent.click(chatNow())
    expect(chatNow().getAttribute('aria-busy')).toBe('true')
    expect(sendOffer().getAttribute('aria-disabled')).toBe('true')
    expect(sendOffer().getAttribute('aria-busy')).not.toBe('true')
  })

  it('both reach the 44px floor (they measured 40px: py-2.5 around a 20px line)', () => {
    composer()
    for (const b of [sendOffer(), chatNow()]) expect(b.className.split(/\s+/)).toContain('min-h-11')
  })
})

describe('while auth is still loading, the cookie decides the panel', () => {
  it('⛔ both panels are there, each shown only for its case: the offer row unless `no-session`, the guest row only then', () => {
    auth.user = null
    auth.loading = true
    composer()
    const guest = screen.getByRole('button', { name: /Sign in to make an offer/ }).closest('.no-session\\:block')
    const offer = sendOffer().closest('.no-session\\:hidden')
    expect(guest).not.toBeNull()
    expect(guest!.className.split(/\s+/)).toContain('hidden') // a cookie (or JS) without `no-session`: not the guest row
    expect(offer).not.toBeNull()
    expect(document.querySelector('[data-auth-settled]')).toBeNull() // not yet the signal the e2e gate waits for
  })

  it('⛔ when auth answers "signed in", the offer row is the SAME element — never rebuilt (a drag or focus would be lost)', () => {
    auth.user = null
    auth.loading = true
    const view = composer()
    const before = sendOffer()
    before.focus()
    auth.user = { id: 'u1' }
    auth.loading = false
    view.rerender(<ContactComposer listingId="l1" listingTitle="Sofa" sellerName="An" currency="₫" price={1_000_000} negotiable />)
    expect(sendOffer()).toBe(before)
    expect(document.activeElement).toBe(before)
    expect(screen.queryByRole('button', { name: /Sign in to make an offer/ })).toBeNull() // the guest copy is gone
  })

  it('…and when it answers "guest", the guest row is the same element, now marked settled', () => {
    auth.user = null
    auth.loading = true
    const view = composer()
    const before = screen.getByRole('button', { name: /Sign in to make an offer/ })
    auth.loading = false
    view.rerender(<ContactComposer listingId="l1" listingTitle="Sofa" sellerName="An" currency="₫" price={1_000_000} negotiable />)
    const after = screen.getByRole('button', { name: /Sign in to make an offer/ })
    expect(after).toBe(before)
    expect(after.closest('[data-auth-settled]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Send offer/ })).toBeNull()
  })

  it('once auth has answered, only the right panel is rendered', async () => {
    auth.user = null
    auth.loading = false
    composer()
    expect(screen.queryByRole('button', { name: /Send offer/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Sign in to make an offer/ }).closest('[data-auth-settled]')).not.toBeNull()
    await act(async () => {})
  })
})
