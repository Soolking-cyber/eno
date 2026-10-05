// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

// ── UX2 W2 B2-NOTIFY: Settings › Notifications is called that, and lists exactly what sends a push ────────

const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock('@/hooks/use-dashboard', () => ({
  useDashboard: () => ({ dash: { tier: 'individual', seller: null, profile: { email: 'a@b.c', displayName: 'A', businessName: null } }, refresh: () => {}, error: null }),
}))
// The sections this tab does not render, and the device row (its own test: reminder-settings.test.tsx).
vi.mock('@/components/marketplace/reminder-settings', () => ({ ReminderSettings: () => <div data-testid="reminder-row" /> }))
vi.mock('@/components/marketplace/profile-editor', () => ({ ProfileEditor: () => null }))
vi.mock('@/components/marketplace/storefront-banner-editor', () => ({ StorefrontBannerEditor: () => null }))
vi.mock('@/components/marketplace/business-profile-editor', () => ({ BusinessProfileEditor: () => null }))
vi.mock('@/components/marketplace/business-verification-panel', () => ({ BusinessVerificationPanel: () => null }))
vi.mock('@/components/marketplace/handle-settings', () => ({ HandleSettings: () => null }))
vi.mock('@/components/marketplace/change-email-form', () => ({ ChangeEmailForm: () => null }))
vi.mock('@/components/marketplace/set-password-form', () => ({ SetPasswordForm: () => null }))
vi.mock('@/components/marketplace/account-type-switcher', () => ({ AccountTypeSwitcher: () => null }))
vi.mock('@/components/marketplace/delete-account', () => ({ DeleteAccount: () => null }))
vi.mock('@/components/marketplace/dashboard-fetch-error', () => ({ DashboardFetchError: () => null }))

const { SettingsClient } = await import('./settings-client')

afterEach(() => { cleanup(); h.lang = 'en' })

const EVENTS_EN = [
  'A listing of yours gets its first message',
  'Someone sends you an offer or a counter-offer, or accepts or declines yours',
  'Your listings need an availability check (at most once a day)',
  'A saved search has new matches',
  'The price drops on a listing you messaged about or whose contact you viewed',
  'A dispute case you are part of is updated',
  'Our moderation team sends a notice about your account (a pause, a review, an appeal decision)',
  'Your identity or storefront verification is reviewed',
]

describe('Settings › Notifications', () => {
  it('the group is "Notifications", not "Reminders", and it lists exactly the pushes the server sends', () => {
    render(<SettingsClient embedded section="notifications" />)
    const group = screen.getByRole('heading', { level: 2, name: 'Notifications' }).closest('section')!
    expect(screen.queryByText('Reminders')).toBeNull()
    const items = within(group).getAllByRole('listitem').map((li) => li.textContent)
    // Vitest builds eno.forum (services): its list adds the one generic line for its order/application pushes.
    expect(items).toEqual([...EVENTS_EN, 'Updates on your orders, applications and account'])
    // What does NOT push is said too: the inbox badge carries chat, not a notification.
    expect(group.textContent).toContain('Ordinary chat messages don’t send a notification')
    // ⛔ Nothing on eno.vn may name the services edition's pushes (visa, payout).
    expect(group.textContent).not.toMatch(/visa|payout|payment/i)
    // The device switch (and the reminders/digest rows) still live in this group, under the list.
    expect(within(group).getByTestId('reminder-row')).toBeTruthy()
  })

  it('Vietnamese: "Thông báo", and the list in Vietnamese', () => {
    h.lang = 'vi'
    render(<SettingsClient embedded section="notifications" />)
    const group = screen.getByRole('heading', { level: 2, name: 'Thông báo' }).closest('section')!
    expect(screen.queryByText('Nhắc nhở')).toBeNull()
    const items = within(group).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toHaveLength(EVENTS_EN.length + 1)
    expect(items[items.length - 1]).toBe('Cập nhật về đơn hàng, hồ sơ và tài khoản của bạn')
    expect(items[0]).toBe('Tin đăng của bạn nhận tin nhắn đầu tiên')
    expect(items[1]).toBe('Có người trả giá hoặc trả giá lại với bạn, hoặc chấp nhận hay từ chối giá bạn đưa ra')
    expect(within(group).getByText('Khi nào bạn nhận được thông báo')).toBeTruthy()
  })
})
