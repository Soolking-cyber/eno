// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => true, facebookIosApp: () => false, FACEBOOK_DIALOG: 'https://www.facebook.com/dialog/oauth' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./area-filter', async (orig) => ({ ...(await orig<typeof import('./area-filter')>()), AreaFilter: () => null }))
const { FacebookImportPanel } = await import('./facebook-import-panel')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
// The whole panel, taxonomy and all: its first render is slow under a loaded runner.
vi.setConfig({ testTimeout: 30_000 })

const draft = (id: string, district: string | null) => ({ id, status: 'draft', title: `Item ${id}`, description: 'Fine', titleVi: null, descriptionVi: null, fbTitle: `Item ${id}`, fresh: true, price: 1_000_000, fbPrice: null, district, city: 'Hồ Chí Minh', categorySlug: 'electronics', subcategorySlug: null, listingType: 'sell', attributes: null, reason: null, listingId: null, photo: null, photoCount: 1 })
const state = { on: true, connected: true, phone: '0901234567', job: { id: 'j1', status: 'ready', createdAt: new Date().toISOString(), items: [draft('a', 'Quận 12'), draft('b', 'Quận 12'), draft('c', 'Quận 7')] } }

// Owner, 2026-11-07: one location for the whole import, from Facebook, that the seller must check before the one Publish button works.
describe('Import review: the location', () => {
  it('starts as the place most listings had, Publish says "Check the location first" until it is ticked, then sends that place', async () => {
    const f = vi.fn(async (u: string, init?: RequestInit) => new Response(JSON.stringify(
      u.endsWith('/publish') ? { ok: true, listingId: 'L' } : u.startsWith('/api/geocode/search') ? { results: [{ label: 'Quận 12', lat: 10.86, lng: 106.65 }] } : state,
    ), { status: init?.method === 'POST' ? 201 : 200 }))
    vi.stubGlobal('fetch', f)
    render(<FacebookImportPanel />)
    const picker = await screen.findByRole('button', { name: 'City and ward' })
    expect(picker.textContent).toContain('Quận 12, Hồ Chí Minh')
    const button = screen.getByRole('button', { name: 'Check the location first' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // The default's pin: one search for that place, not a stream.
    await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u).startsWith('/api/geocode/search'))).toHaveLength(1))
    fireEvent.click(screen.getByRole('checkbox', { name: 'This location is right' }))
    const publish = await screen.findByRole('button', { name: 'Publish 3' }) as HTMLButtonElement
    fireEvent.click(publish)
    await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u).endsWith('/publish'))).toHaveLength(3))
    for (const [, init] of f.mock.calls.filter(([u]) => String(u).endsWith('/publish'))) expect(JSON.parse(String((init as RequestInit).body)).place).toMatchObject({ province: 'Hồ Chí Minh', ward: 'Quận 12' })
  })
  it('no per-listing area box any more', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(String(u).startsWith('/api/geocode') ? { results: [] } : state))))
    render(<FacebookImportPanel />)
    await screen.findByRole('button', { name: 'City and ward' })
    expect(screen.queryByRole('textbox', { name: 'Area (ward or district)' })).toBeNull()
  })
})
