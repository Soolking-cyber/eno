// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── The post wizard's "resume Publish" survives the Google round trip (A5-SELL, sell-04) ──────────────
// The wizard's guest gate adds `?resume=publish` to the address (history.replaceState) and THEN opens the
// sign-in popup. The popup's Google button hands off to /auth/google/start?next=<path + query>, and that
// `next` must be read from window.location when the popup renders for THIS ask — after the param was
// added — never captured earlier or taken from the router's pathname (which carries no query at all).
// The address is a plain mutable object here, changed exactly the way setResumeParam changes the real one.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'

const assign = vi.fn()
const realLocation = window.location
const loc = { pathname: '/post', search: '', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/post', assign, reload: vi.fn() }

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

/** What post-wizard.tsx setResumeParam(true) does to the address, right before openSignIn(). */
const addResumeParam = () => Object.assign(loc, { search: '?resume=publish', href: 'http://localhost:3000/post?resume=publish' })

const popup = (open: boolean, note = 'Last step: sign in to publish.') => (
  <LanguageProvider initialLang="en">
    <SignInDialog open={open} onOpenChange={() => {}} note={note} />
  </LanguageProvider>
)
const google = () => screen.getByRole('button', { name: /^Continue with Google$/ })

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.assign(loc, { pathname: '/post', search: '', href: 'http://localhost:3000/post' })
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
  assign.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('sign-in popup — the Google round trip keeps ?resume=publish', () => {
  it('⛔ returns to /post?resume=publish when the param is added before the gate opens the popup', () => {
    const r = render(popup(false))
    addResumeParam()
    r.rerender(popup(true))
    fireEvent.click(google())
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Fpost%3Fresume%3Dpublish')
  })

  it('…also when the popup was mounted by an EARLIER ask (the AI gate): the next open reads the address again', () => {
    const r = render(popup(true, 'AI help is free with an account.'))
    r.rerender(popup(false, 'AI help is free with an account.'))
    addResumeParam()
    r.rerender(popup(true))
    fireEvent.click(google())
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Fpost%3Fresume%3Dpublish')
  })

  it('CONTROL: without the param the round trip returns to the bare /post', () => {
    render(popup(true))
    fireEvent.click(google())
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Fpost')
  })
})
