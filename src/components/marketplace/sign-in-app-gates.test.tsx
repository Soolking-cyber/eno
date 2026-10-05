// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── App Store review gates on the sign-in form (src/lib/app-review-gates.ts, plan R2 / R7 / R13) ──────
// Every gate is DORMANT: with NEXT_PUBLIC_APP_REVIEW_GATES unset, the form is byte-for-byte what it was
// in every context. With a gate on, only the context it names changes.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))
const browserOpen = vi.fn(async (_options: unknown) => {})
vi.mock('@capacitor/browser', () => ({ Browser: { open: (o: unknown) => browserOpen(o), close: async () => {} } }))

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

async function renderForm() {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <SignInForm />
    </LanguageProvider>,
  )
  await act(async () => {}) // let the mount effect read the platform
}
const google = () => screen.queryByRole('button', { name: /Continue with Google/ })
const legal = (name: string) => screen.getByRole('link', { name })

beforeEach(() => {
  browserOpen.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
})

describe('with every gate OFF (the shipped default)', () => {
  it.each(['ios-app', 'android-app', 'web'] as const)('%s: Google is offered and legal links open a new tab', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    context(kind)
    await renderForm()
    expect(google()).toBeTruthy()
    expect(google()!.className).not.toContain('ios-app-hidden')
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
    expect(document.querySelector('.native-app-hidden')).toBeNull()
  })
})

describe('ios-hide-google (Guideline 4.8)', () => {
  it('removes Google in the iOS app — the email form shows at once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('ios-app')
    await renderForm()
    expect(google()).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
  })

  it.each(['android-app', 'web'] as const)('keeps Google on %s', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context(kind)
    await renderForm()
    expect(google()).toBeTruthy()
  })

  it('marks the server-rendered button with the iOS-only CSS hook, so the first frame is already right', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('web')
    await renderForm()
    // On the web the hook is inert (globals.css scopes it to html.native-ios) — but it must be there.
    expect(google()!.className).toContain('ios-app-hidden')
  })
})

describe('app-signin-tidy (R7 / R13)', () => {
  it('in an app: the disabled "Phone · soon" strip is hooked out and the legal links stay in the app', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('android-app')
    await renderForm()
    const strip = screen.getByRole('tablist')
    expect(strip.className).toContain('native-app-hidden')
    for (const name of ['Terms', 'Operating regulations', 'Privacy Policy']) expect(legal(name).getAttribute('target')).toBeNull()
  })

  it('in an app: a legal link opens the in-app browser sheet, so a half-finished sign-in survives', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('ios-app')
    await renderForm()
    const link = legal('Terms')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    // Marked as the app's sheet: the sheet runs with the browser's UA, so the page needs the marker to
    // behave as the app for consent and analytics (app-review-gates.ts IN_APP_SHEET_PARAM).
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: `${window.location.origin}/terms?app_sheet=1` }))
  })

  it('if the sheet fails to open, it falls back to a NEW window, never this one', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('ios-app')
    browserOpen.mockRejectedValueOnce(new Error('plugin missing'))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await renderForm()
    legal('Privacy Policy').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    // The fallback is the system browser, not the app — it gets the plain URL, no sheet marker.
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(`${window.location.origin}/privacy`, '_blank', 'noreferrer'))
  })

  it('an app page with NO bridge keeps target=_blank — a same-window link would lose the sign-in', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('android-app')
    delete (window as unknown as Win).Capacitor // the UA says app, but this origin got no bridge
    await renderForm()
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    legal('Terms').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('on the web: links still open a new tab (the CSS hook is inert without html.native)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('web')
    await renderForm()
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
  })
})
