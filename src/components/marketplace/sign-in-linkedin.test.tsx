// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── SIGN IN WITH LINKEDIN in the sign-in form (owner, 2026-10-15) ───────────────────────────────────────────────────
// Offered only where a teacher page switched it on (the server's GoTrue probe) AND in a real browser; its notice stands
// beside it (LinkedIn API Terms 5.2); the tap goes to the server start route with the notice version and the SAME `next`
// Google's button uses, so the teacher form's sign-in mark rides back.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'
import { setLinkedInSignInHere } from '@/lib/linkedin-flag'
import { LINKEDIN_NOTICE_LEAD, LINKEDIN_NOTICE_VERSION } from '@/lib/teachers/import-notice'

const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]'
const assign = vi.fn()
const realLocation = window.location
let ua = CHROME
const loc = { pathname: '/teachers/join', search: '?teacher_signin=1&utm_source=fb', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/teachers/join?teacher_signin=1&utm_source=fb', assign, reload: vi.fn() }

const popup = () => render(
  <LanguageProvider initialLang="en" initialViDict={{}}>
    <SignInDialog open onOpenChange={() => {}} gate="page" />
  </LanguageProvider>,
)

beforeEach(() => {
  ua = CHROME
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
  assign.mockReset()
})
afterEach(() => {
  act(() => setLinkedInSignInHere(false))
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('Sign in with LinkedIn in the sign-in form', () => {
  it('is absent unless a teacher page switched it on', async () => {
    popup()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Sign in with LinkedIn/ })).toBeNull()
  })

  it('shows with its notice, and goes to the start route with the notice version and the form’s own next', async () => {
    act(() => setLinkedInSignInHere(true))
    popup()
    await act(async () => {})
    const button = screen.getByRole('button', { name: /Sign in with LinkedIn/ })
    const note = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(note?.textContent).toBe(LINKEDIN_NOTICE_LEAD.en)
    fireEvent.click(button)
    expect(assign).toHaveBeenCalledWith(`/auth/linkedin/start?n=${LINKEDIN_NOTICE_VERSION}&next=${encodeURIComponent('/teachers/join?teacher_signin=1&utm_source=fb')}`)
  })

  it('never in an in-app browser (no LinkedIn session there; LinkedIn’s Google sign-in is refused in a webview)', async () => {
    ua = FACEBOOK
    act(() => setLinkedInSignInHere(true))
    popup()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Sign in with LinkedIn/ })).toBeNull()
  })
})
