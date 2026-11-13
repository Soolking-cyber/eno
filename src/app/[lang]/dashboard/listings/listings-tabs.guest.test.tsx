// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * The Facebook ads' landing address, /dashboard/listings?tab=facebook, for a visitor who is NOT signed in (owner, 2026-11-13):
 * the page shows the import's intro — it never sends the visitor to sign in before they press the button (commit gate 2026-11-13:
 * the panel's own tests mount it alone; this mounts the real tab page).
 */
const nav = vi.hoisted(() => ({ replace: vi.fn(), listingsMounted: false }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/dashboard/listings',
  useSearchParams: () => new URLSearchParams('tab=facebook'),
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: null, loading: false, error: null }) }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => true, facebookIosApp: () => false, FACEBOOK_DIALOG: 'https://www.facebook.com/dialog/oauth' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The All tab's client sends a guest to sign in when it mounts: record whether it does.
vi.mock('./listings-client', () => ({ ListingsClient: () => { nav.listingsMounted = true; return null } }))
vi.mock('../bulk/bulk-client', () => ({ BulkClient: () => null }))
const { ListingsTabs } = await import('./listings-tabs')
afterEach(() => { cleanup(); vi.unstubAllGlobals(); nav.replace.mockClear(); nav.listingsMounted = false })

describe('/dashboard/listings?tab=facebook, not signed in', () => {
  it('opens on Import from Facebook with its intro and the sign-in button; nothing redirects, the All tab is not mounted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ on: true }))))
    render(<ListingsTabs />)
    expect(await screen.findByRole('heading', { name: 'Import your Facebook Marketplace listings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Connect Facebook and import' }).getAttribute('href')).toBe('/signin?next=%2Fdashboard%2Flistings%3Ftab%3Dfacebook')
    expect(nav.listingsMounted).toBe(false)
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
