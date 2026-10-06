// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── App Store gate `ios-hide-kyc` (split from ios-hide-visa 2026-10-06) on the verification hub ──────────
// The hub stays in the iOS app (the status is the person's own); what goes is the way into the capture —
// "Verify yourself" — replaced by a line saying the check is done in a web browser on the build's own site.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => '/dashboard/verification' }))
vi.mock('@/components/marketplace/section-header', () => ({ SectionHeader: () => null }))
vi.mock('@/components/marketplace/business-verification-panel', () => ({ BusinessVerificationPanel: () => null }))

import { VerificationClient } from './verification-client'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
type Win = { Capacitor?: { getPlatform?: () => string } }

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'unverified', gate: false }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
})

async function open(platform: 'ios' | 'android') {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  ;(window as unknown as Win).Capacitor = { getPlatform: () => platform }
  render(<LanguageProvider initialLang="en" initialViDict={{}}><VerificationClient /></LanguageProvider>)
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
const verifyLink = () => screen.queryByRole('link', { name: 'Verify yourself' })
const NOTE = 'Identity verification is available on our website, in a web browser: www.eno.forum'

describe('verification hub × ios-hide-kyc', () => {
  it('gate OFF, iOS app: "Verify yourself" goes to the capture', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    await open('ios')
    expect(verifyLink()?.getAttribute('href')).toBe('/dashboard/account/verify')
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it('gate ON, iOS app: no way into the capture, the line instead — the status stays', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    await open('ios')
    expect(verifyLink()).toBeNull()
    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(screen.getByText('Step 1 — verify yourself')).toBeTruthy()
  })

  it('gate ON, Android: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    await open('android')
    expect(verifyLink()?.getAttribute('href')).toBe('/dashboard/account/verify')
  })

  it('⛔ ios-hide-visa alone (an env line from before the split), iOS app: still no way into the capture', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    await open('ios')
    expect(verifyLink()).toBeNull()
    expect(screen.getByText(NOTE)).toBeTruthy()
  })
})
