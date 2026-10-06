// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── App Store gates on the components that START an application (`ios-hide-visa`) or CAPTURE a document
// (`ios-hide-kyc`, split out 2026-10-06) ──
// Off ⇒ each renders exactly as before, everywhere. On ⇒ only in the iOS app: no start button (visa), no camera, no
// upload (kyc) — and where it would have verified, a line saying it is done in a web browser. Each switch leaves the
// other's components alone: the owner keeps the e-Visa flow in both apps and takes only identity capture out of iOS.

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, loading: false, openSignIn: () => {} }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))

import { VisaInAppNote, VisaStart } from './visa-start'
import { KycCapture } from './kyc-capture'
import { BusinessVerificationPanel } from './business-verification-panel'
import { IosAppHidden } from './ios-app-hidden'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
type Win = { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }
function platform(kind: 'ios' | 'android') {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(kind === 'ios' ? IOS_APP : ANDROID_APP)
  ;(window as unknown as Win).Capacitor = { getPlatform: () => kind, isNativePlatform: () => true }
}
const wrap = (node: React.ReactNode) => <LanguageProvider initialLang="en" initialViDict={{}}>{node}</LanguageProvider>

let getUserMedia: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  getUserMedia = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ case: null, view: 'unverified', personGate: false, personVerified: true }) })))
  auth.user = { id: 'u1' }
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
})

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('VisaStart', () => {
  it.each([['iOS app', 'ios'], ['Android app', 'android']] as const)('gate OFF, %s: the button is there', async (_, kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    platform(kind)
    render(wrap(<VisaStart listingId="l1" />))
    expect(screen.getByRole('button', { name: /Apply in chat/ })).toBeTruthy()
  })

  it('gate ON: nothing in the iOS app, the button on Android', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    const ios = render(wrap(<VisaStart listingId="l1" />))
    expect(screen.queryByRole('button', { name: /Apply in chat/ })).toBeNull()
    ios.unmount()
    platform('android')
    render(wrap(<VisaStart listingId="l1" />))
    expect(screen.getByRole('button', { name: /Apply in chat/ })).toBeTruthy()
  })

  it('ios-hide-kyc alone (the 2026-10-06 plan): the button is there in the iOS app — the e-Visa flow stays', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    platform('ios')
    render(wrap(<VisaStart listingId="l1" />))
    expect(screen.getByRole('button', { name: /Apply in chat/ })).toBeTruthy()
  })

  it('server render (ISR HTML) keeps the button whatever the gate — the page wraps it in the CSS hook instead', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios') // ignored on the server: the server snapshot is false
    expect(renderToString(wrap(<VisaStart listingId="l1" />))).toContain('Apply in chat')
  })
})

describe('VisaInAppNote', () => {
  it('names where applying happens, in plain text (no link back into the app)', () => {
    const html = renderToString(wrap(<VisaInAppNote kind="apply" className="ios-app-only" />))
    expect(html).toContain('e-Visa applications are not available in the app. You can apply in a web browser.')
    expect(html).toContain('ios-app-only')
    expect(html).not.toContain('<a ')
  })
})

describe('KycCapture — no camera in the iOS app', () => {
  const capture = () => wrap(<KycCapture kind="document" guide="passport" onUploaded={() => {}} />)

  it('gate OFF: the camera is asked for, in the iOS app too', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    platform('ios')
    render(capture())
    await settle()
    expect(getUserMedia).toHaveBeenCalled()
  })

  it('gate ON, iOS app: the camera is NEVER asked for, and the line says where', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    platform('ios')
    render(capture())
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByText('Identity verification is available on our website, in a web browser: www.eno.forum')).toBeTruthy()
  })

  it('gate ON, Android: the camera is asked for', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    platform('android')
    render(capture())
    await settle()
    expect(getUserMedia).toHaveBeenCalled()
  })

  it('⛔ ios-hide-visa alone (an env line from before the split), iOS app: the camera is still never asked for', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    render(capture())
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })
})

describe('BusinessVerificationPanel — no document upload in the iOS app', () => {
  const fileInputs = () => document.querySelectorAll('input[type="file"]')

  it('gate OFF, iOS app: the two uploads and Submit are there', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    platform('ios')
    render(wrap(<BusinessVerificationPanel />))
    await settle()
    expect(fileInputs()).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Submit for verification/ })).toBeTruthy()
  })

  it('gate ON, iOS app: no file input, no Submit, the line says where', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    platform('ios')
    render(wrap(<BusinessVerificationPanel />))
    await settle()
    expect(fileInputs()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Submit for verification/ })).toBeNull()
    expect(screen.getByText('Business verification is available on our website, in a web browser: www.eno.forum')).toBeTruthy()
  })

  it('gate ON, Android: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    platform('android')
    render(wrap(<BusinessVerificationPanel />))
    await settle()
    expect(fileInputs()).toHaveLength(2)
  })

  it('⛔ ios-hide-visa alone (an env line from before the split), iOS app: still no document upload', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    render(wrap(<BusinessVerificationPanel />))
    await settle()
    expect(fileInputs()).toHaveLength(0)
  })
})

describe('IosAppHidden', () => {
  // Constants, not JSX text: react/jsx-no-literals applies to test files too.
  const LABEL = 'Chat'
  const X = 'x'
  it('off: a fragment — the markup is byte-identical to the children alone', () => {
    const child = <button type="button">{LABEL}</button>
    expect(renderToString(<IosAppHidden when={false}>{child}</IosAppHidden>)).toBe(renderToString(child))
  })
  it('on: the children inside the ios-app-hidden hook — a box-less wrapper (display: contents) off the app', () => {
    expect(renderToString(<IosAppHidden when>{<span>{X}</span>}</IosAppHidden>)).toBe('<div class="ios-app-hidden contents"><span>x</span></div>')
  })
})
