// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { HandoffConfirm } from './handoff-confirm'
import { HandoffLaunch } from './handoff-launch'

// ── UX3 J2: the Google hand-off's REAL-BROWSER screens name where the visitor came from ─────────────
// They told Facebook and Zalo visitors to "go back to the eno app", which they were never in, and offered
// "email or phone" while phone sign-in is off. `via` (allow-listed) names the host; without it the copy is
// neutral ("where you started").

const NONCE = 'a'.repeat(43)
// ⚠️ initialViDict on every render: the vi dictionary is module state, seeded once (see sign-in-join.test.tsx).
const wrap = (node: React.ReactNode, lang: 'en' | 'vi' = 'en') => render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
const all = () => document.body.textContent ?? ''

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, pair: 'K7Q2M9' }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('HandoffConfirm', () => {
  it('⛔ names the host app (Zalo) in the question, the pairing screen and the expired screen — never "the eno app"', async () => {
    wrap(<HandoffConfirm nonce={NONCE} parked via="zalo" />)
    expect(all()).toContain(`Did you just choose to sign in to ${SITE_NAME} with Google in Zalo on this phone?`)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, that was me' }))
    await act(async () => {})
    expect(all()).toContain('Enter this code back in Zalo')
    expect(all()).toContain('Switch back to Zalo and type it in.')
    expect(all()).not.toMatch(/eno app/i)
  })

  it('without a known host: neutral words, still no "eno app" and no phone promise', () => {
    wrap(<HandoffConfirm nonce={null} parked={false} />)
    expect(all()).toContain('Go back to where you started and choose Google again — or sign in there with a code, no browser needed.')
    expect(all()).not.toMatch(/eno app|phone/i)
  })

  it('in Vietnamese, with the host: "trong Zalo", never "ứng dụng eno" or "SĐT"', () => {
    wrap(<HandoffConfirm nonce={NONCE} parked via="facebook" />, 'vi')
    expect(all()).toContain(`Bạn vừa chọn đăng nhập ${SITE_NAME} bằng Google trong Facebook trên điện thoại này phải không?`)
    expect(all()).not.toMatch(/ứng dụng eno|SĐT/)
  })

  it('a home-screen app (pwa) or an unnamed WebView gets the neutral copy', () => {
    wrap(<HandoffConfirm nonce={NONCE} parked via="pwa" />)
    expect(all()).toContain(`Did you just choose to sign in to ${SITE_NAME} with Google on this phone?`)
    cleanup()
    wrap(<HandoffConfirm nonce={NONCE} parked via="other" />)
    expect(all()).toContain(`Did you just choose to sign in to ${SITE_NAME} with Google on this phone?`)
  })
})

describe('HandoffLaunch (could not start Google)', () => {
  it('names the host, offers a code there, and labels its own button truthfully (it signs in THIS browser)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ready: false }) })))
    wrap(<HandoffLaunch nonce={NONCE} via="zalo" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000) })
    expect(all()).toContain('Go back to Zalo and try again — or sign in there with a code, no browser needed.')
    expect(screen.getByRole('button', { name: 'Sign in in this browser instead' })).toBeTruthy()
    expect(all()).not.toMatch(/eno app|phone/i)
  })
})
