// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── `/signin?g=fallback` under `ios-hide-google` (Guideline 4.8, src/lib/app-review-gates.ts) ─────────
// The first-party Google flow hands back to /signin?g=fallback when it cannot run, and the form then
// starts Google ON MOUNT, with no tap. Hiding the button (sign-in-app-gates.test.tsx) does not close that
// way in: in the iOS app with the gate on, nothing may open Google. Android and the web keep the fallback.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))
// Every native web flow starts in nativeOAuth since Sign in with Apple (the provider is its second argument).
const nativeOAuth = vi.fn((_sb: unknown, _provider: string, _next: string) => Promise.resolve())
vi.mock('@/lib/native-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/native-auth')>()),
  nativeOAuth: (sb: unknown, provider: string, next: string) => nativeOAuth(sb, provider, next),
}))
const signInWithOAuth = vi.fn((_args: unknown) => Promise.resolve({ data: {}, error: null }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signInWithOAuth: (a: unknown) => signInWithOAuth(a) } }) }))

import { SignInForm } from './sign-in-form'

const IOS_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

type Win = { Capacitor?: { isNativePlatform: () => boolean; getPlatform: () => string } }
function context(kind: 'ios-app' | 'android-app' | 'web') {
  const ua = kind === 'ios-app' ? IOS_APP_UA : kind === 'android-app' ? ANDROID_APP_UA : DESKTOP_UA
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  if (kind === 'web') delete (window as unknown as Win).Capacitor
  else (window as unknown as Win).Capacitor = { isNativePlatform: () => true, getPlatform: () => (kind === 'ios-app' ? 'ios' : 'android') }
}

/** /signin as the first-party flow hands it back: the mount effects read the platform and catch the marker. */
async function renderFallback() {
  window.history.replaceState(null, '', '/signin?g=fallback')
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <SignInForm />
    </LanguageProvider>,
  )
  await act(async () => {})
}

beforeEach(() => {
  nativeOAuth.mockReset()
  signInWithOAuth.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
  window.history.replaceState(null, '', '/')
})

describe('ios-hide-google: the ?g=fallback retry, which starts Google with no tap', () => {
  it('in the iOS app it starts nothing, and the email form is left ready', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('ios-app')
    // Held open, so a start would stay visible on the form: it holds every control busy until it settles.
    nativeOAuth.mockImplementation(() => new Promise<void>(() => {}))
    await renderFallback()
    // The marker is still consumed, so a reload cannot retry it either.
    expect(new URLSearchParams(window.location.search).get('g')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'teacher@example.com' } })
    expect(screen.getByRole('button', { name: 'Send code' }).hasAttribute('disabled')).toBe(false)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(nativeOAuth).not.toHaveBeenCalled()
  })

  it('keeps it in the Android app', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('android-app')
    await renderFallback()
    await vi.waitFor(() => expect(nativeOAuth).toHaveBeenCalledWith(expect.anything(), 'google', '/'))
  })

  it('keeps it on the web', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('web')
    await renderFallback()
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' })))
  })

  it('is dormant with the gate OFF: the iOS app still runs it', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    context('ios-app')
    await renderFallback()
    await vi.waitFor(() => expect(nativeOAuth).toHaveBeenCalledWith(expect.anything(), 'google', '/'))
  })
})
