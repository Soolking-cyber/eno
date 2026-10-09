// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ── Sign in with Apple (plan §7.17): Settings › Account names the account's linked sign-ins ─────────────────
// From app_metadata.providers. Shown only when Apple or Google is among them — an email-code account's Settings
// read exactly as before. It is also how a tester tells an Apple-only account from one that also holds an email
// identity before deleting it (D15).

const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi', appMetadata: {} as Record<string, unknown> }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', app_metadata: h.appMetadata }, loading: false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock('@/hooks/use-dashboard', () => ({
  useDashboard: () => ({ dash: { tier: 'individual', seller: null, profile: { email: 'x@privaterelay.appleid.com', displayName: 'A', businessName: null } }, refresh: () => {}, error: null }),
}))
vi.mock('@/components/marketplace/change-email-form', () => ({ ChangeEmailForm: () => <div data-testid="change-email" /> }))
vi.mock('@/components/marketplace/set-password-form', () => ({ SetPasswordForm: () => null }))
vi.mock('@/components/marketplace/account-type-switcher', () => ({ AccountTypeSwitcher: () => null }))
vi.mock('@/components/marketplace/delete-account', () => ({ DeleteAccount: () => null }))
vi.mock('@/components/marketplace/dashboard-fetch-error', () => ({ DashboardFetchError: () => null }))

const { SettingsClient } = await import('./settings-client')
const { PHONE_OTP_ENABLED } = await import('@/lib/auth-policy')

afterEach(() => { cleanup(); h.lang = 'en'; h.appMetadata = {} })

const line = () => screen.queryByText(/^(Linked to|Đã liên kết với):/)

describe('Settings › Account — sign-in methods', () => {
  it.each([
    [{ provider: 'apple', providers: ['apple'] }, 'Linked to: Apple'],
    [{ provider: 'email', providers: ['email', 'apple'] }, 'Linked to: Apple, email'],
    [{ provider: 'google', providers: ['google'] }, 'Linked to: Google'],
    [{ provider: 'apple', providers: ['google', 'apple', 'email'] }, 'Linked to: Apple, Google, email'],
    [{ provider: 'apple' }, 'Linked to: Apple'], // an older session with no providers list
  ])('%j → "%s"', (appMetadata, text) => {
    h.appMetadata = appMetadata
    render(<SettingsClient embedded section="account" />)
    expect(line()?.textContent).toBe(text)
    // It sits in the Email group, above the change-email form.
    expect(line()!.compareDocumentPosition(screen.getByTestId('change-email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Review, 2026-10-08: phone sign-in is off (PHONE_OTP_ENABLED), so a phone identity is not a way in to name here.
  it('names the phone number only while phone sign-in is on', () => {
    h.appMetadata = { provider: 'google', providers: ['google', 'phone', 'email'] }
    render(<SettingsClient embedded section="account" />)
    expect(line()?.textContent).toBe(PHONE_OTP_ENABLED ? 'Linked to: Google, email, phone number' : 'Linked to: Google, email')
  })

  it('an email-code account (no Apple, no Google) shows no line — Settings unchanged', () => {
    h.appMetadata = { provider: 'email', providers: ['email'] }
    render(<SettingsClient embedded section="account" />)
    expect(line()).toBeNull()
  })

  it('Vietnamese', () => {
    h.lang = 'vi'
    h.appMetadata = { provider: 'apple', providers: ['apple', 'email'] }
    render(<SettingsClient embedded section="account" />)
    expect(line()?.textContent).toBe('Đã liên kết với: Apple, email')
  })
})
