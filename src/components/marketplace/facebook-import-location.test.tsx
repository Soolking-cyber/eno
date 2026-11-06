// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => true, facebookIosApp: () => false, FACEBOOK_DIALOG: 'https://www.facebook.com/dialog/oauth' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const { FacebookImportPanel } = await import('./facebook-import-panel')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
// The whole panel, taxonomy and all: its first render is slow under a loaded runner.
vi.setConfig({ testTimeout: 30_000 })

const draft = (id: string, district: string | null) => ({ id, status: 'draft', title: `Item ${id}`, description: 'Fine', titleVi: null, descriptionVi: null, fbTitle: `Item ${id}`, fresh: true, price: 1_000_000, fbPrice: null, district, city: 'Hồ Chí Minh', categorySlug: 'electronics', subcategorySlug: null, listingType: 'sell', attributes: null, reason: null, listingId: null, photo: null, photoCount: 1 })
const state = { on: true, connected: true, phone: '0901234567', job: { id: 'j1', status: 'ready', createdAt: new Date().toISOString(), items: [draft('a', 'Quận 12'), draft('b', 'Quận 12'), draft('c', 'Quận 7')] } }

// Owner, 2026-11-07: one location for the whole import, from Facebook, that the seller must check before the one Publish button works.
describe('Import review: the location', () => {
  it('starts as the place most listings had, and Publish says "Check the location first" until it is ticked; then it sends that place', async () => {
    const f = vi.fn(async (u: string, init?: RequestInit) => new Response(JSON.stringify(u.endsWith('/publish') ? { ok: true, listingId: 'L' } : state), { status: init?.method === 'POST' ? 201 : 200 }))
    vi.stubGlobal('fetch', f)
    render(<FacebookImportPanel />)
    const box = await screen.findByRole('textbox', { name: /Location of these listings/ }) as HTMLInputElement
    expect(box.value).toBe('Quận 12, Hồ Chí Minh')
    const button = screen.getByRole('button', { name: 'Check the location first' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'This location is right' }))
    await screen.findByRole('button', { name: 'Publish 3' })
    // Changing the text unticks it: the tick is for the text as shown.
    fireEvent.change(box, { target: { value: 'Thảo Điền, Hồ Chí Minh' } })
    expect(screen.getByRole('button', { name: 'Check the location first' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'This location is right' }))
    const publish = await screen.findByRole('button', { name: 'Publish 3' }) as HTMLButtonElement
    expect(publish.disabled).toBe(false)
    fireEvent.click(publish)
    await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u).endsWith('/publish'))).toHaveLength(3))
    for (const [, init] of f.mock.calls.filter(([u]) => String(u).endsWith('/publish'))) expect(JSON.parse(String((init as RequestInit).body)).area).toBe('Thảo Điền, Hồ Chí Minh')
  })
  it('no per-listing area box any more', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state))))
    render(<FacebookImportPanel />)
    await screen.findByRole('textbox', { name: /Location of these listings/ })
    expect(screen.queryByRole('textbox', { name: 'Area (ward or district)' })).toBeNull()
  })
})
