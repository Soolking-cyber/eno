// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

/**
 * My listings › Import from Facebook for a visitor who is NOT signed in (owner, 2026-11-13: "make it visible without signing and when
 * users press the signup or login page shows up, we run ads on fb … users should see how it looks upon landing there").
 */
const a = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, here: true, search: '', replace: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: a.user, loading: a.loading }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: a.replace }), useSearchParams: () => new URLSearchParams(a.search) }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => a.here, facebookIosApp: () => false, FACEBOOK_DIALOG: 'https://www.facebook.com/dialog/oauth' }))
vi.mock('sonner', () => ({ toast: a.toast }))
vi.mock('./area-filter', async (orig) => ({ ...(await orig<typeof import('./area-filter')>()), AreaFilter: () => null }))
const { FacebookImportPanel } = await import('./facebook-import-panel')
const { safeNextPath } = await import('@/lib/url')
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); a.user = null; a.loading = false; a.here = true; a.search = '' })
vi.setConfig({ testTimeout: 30_000 })

const SIGNIN = '/signin?next=%2Fdashboard%2Flistings%3Ftab%3Dfacebook'
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u]) => String(u))

describe('Import from Facebook, not signed in', () => {
  it('shows the import\'s intro and a "Connect Facebook and import" link to sign up or sign in, coming back to this tab', async () => {
    const f = answer({ on: true })
    vi.stubGlobal('fetch', f)
    render(<FacebookImportPanel />)
    expect(await screen.findByRole('heading', { name: 'Import your Facebook Marketplace listings' })).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'Connect Facebook and import' })
    expect(cta.getAttribute('href')).toBe(SIGNIN)
    expect(screen.getByText(/Import only your own listings/)).toBeTruthy()
    // only the public on/off answer is asked for — never the signed-in import (it carries the seller's phone, jobs and drafts)
    expect(urls(f)).toEqual(['/api/fb-import/available'])
  })

  it('sign-in sends them back to THIS tab: the return address keeps ?tab=facebook through safeNextPath (commit gate 2026-11-13)', () => {
    const next = new URLSearchParams(SIGNIN.split('?')[1]).get('next')
    expect(safeNextPath(next, 'https://eno.vn')).toBe('/dashboard/listings?tab=facebook')
  })

  it('import switched off: says so, with no button', async () => {
    vi.stubGlobal('fetch', answer({ on: false }))
    render(<FacebookImportPanel />)
    expect(await screen.findByText('Import from Facebook isn’t available right now.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Connect Facebook and import' })).toBeNull()
  })

  it('a failed or refused answer settles on "isn\'t available" — never an empty tab (codex plan review 2026-11-13)', async () => {
    vi.stubGlobal('fetch', answer({ error: 'x' }, 500))
    render(<FacebookImportPanel />)
    expect(await screen.findByText('Import from Facebook isn’t available right now.')).toBeTruthy()
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    render(<FacebookImportPanel />)
    expect(await screen.findByText('Import from Facebook isn’t available right now.')).toBeTruthy()
  })

  it('where Facebook\'s dialog cannot run (the app\'s own webview), says to open eno.vn in the browser', async () => {
    a.here = false
    vi.stubGlobal('fetch', answer({ on: true }))
    render(<FacebookImportPanel />)
    expect(await screen.findByText('Open eno.vn in your browser to import from Facebook.')).toBeTruthy()
  })

  it('while sign-in is still being read: nothing shown and nothing asked (a signed-in seller never sees the guest view flash)', async () => {
    a.loading = true
    const f = answer({ on: true })
    vi.stubGlobal('fetch', f)
    const { container } = render(<FacebookImportPanel />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.innerHTML).toBe('')
    expect(f).not.toHaveBeenCalled()
  })

  it('an answer that never comes settles on "isn\'t available" after 8 s — the tab is never left empty (commit gate 2026-11-13)', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })))
      const { container } = render(<FacebookImportPanel />)
      await act(async () => { await vi.advanceTimersByTimeAsync(7_000) })
      expect(container.innerHTML).toBe('')
      await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
      expect(screen.getByText('Import from Facebook isn’t available right now.')).toBeTruthy()
    } finally { vi.useRealTimers() }
  })

  it('another seller signing in on the same page never sees the last one\'s import, not even while theirs loads (commit gate 2026-11-13)', async () => {
    a.user = { id: 'seller-a' }
    const item = { id: 'i1', status: 'draft', title: 'Seller A scooter', description: 'x', titleVi: null, descriptionVi: null, fbTitle: 'Seller A scooter', fresh: true, price: 1_000_000, fbPrice: null, categorySlug: null, subcategorySlug: null, photo: null, reason: null, attributes: {} }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ on: true, connected: true, phone: '0901234567', job: { id: 'j1', status: 'ready', createdAt: new Date().toISOString(), items: [item] } }))))
    const { rerender } = render(<FacebookImportPanel />)
    expect(await screen.findByDisplayValue('Seller A scooter')).toBeTruthy()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // seller B's import never arrives
    a.user = { id: 'seller-b' }
    rerender(<FacebookImportPanel />)
    expect(screen.queryByDisplayValue('Seller A scooter')).toBeNull()
  })

  it('seller A\'s import that arrives AFTER seller B signed in is never shown (codex + opus commit gate 2026-11-13)', async () => {
    a.user = { id: 'seller-a' }
    const item = { id: 'i1', status: 'draft', title: 'Seller A scooter', description: 'x', titleVi: null, descriptionVi: null, fbTitle: 'Seller A scooter', fresh: true, price: 1_000_000, fbPrice: null, categorySlug: null, subcategorySlug: null, photo: null, reason: null, attributes: {} }
    let answerA: (r: Response) => void = () => {}
    const forA = new Promise<Response>((res) => { answerA = res })
    vi.stubGlobal('fetch', vi.fn(() => forA))
    const { rerender } = render(<FacebookImportPanel />)
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // seller B's import never arrives
    a.user = { id: 'seller-b' }
    rerender(<FacebookImportPanel />)
    await act(async () => { answerA(new Response(JSON.stringify({ on: true, connected: true, phone: '0901234567', job: { id: 'j1', status: 'ready', createdAt: new Date().toISOString(), items: [item] } }))) })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByDisplayValue('Seller A scooter')).toBeNull()
    expect(screen.queryByText(/0901234567/)).toBeNull()
  })

  it('seller A\'s late answer never blanks or replaces seller B\'s import that already loaded (codex + opus commit gate 2026-11-13)', async () => {
    const item = (id: string, title: string) => ({ id, status: 'draft', title, description: 'x', titleVi: null, descriptionVi: null, fbTitle: title, fresh: true, price: 1_000_000, fbPrice: null, categorySlug: null, subcategorySlug: null, photo: null, reason: null, attributes: {} })
    const body = (it: ReturnType<typeof item>) => JSON.stringify({ on: true, connected: true, phone: '0901234567', job: { id: `j-${it.id}`, status: 'ready', createdAt: new Date().toISOString(), items: [it] } })
    a.user = { id: 'seller-a' }
    let answerA: (r: Response) => void = () => {}
    const forA = new Promise<Response>((res) => { answerA = res })
    vi.stubGlobal('fetch', vi.fn(() => forA))
    const { rerender } = render(<FacebookImportPanel />)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body(item('b1', 'Seller B bike')))))
    a.user = { id: 'seller-b' }
    rerender(<FacebookImportPanel />)
    expect(await screen.findByDisplayValue('Seller B bike')).toBeTruthy()
    await act(async () => { answerA(new Response(body(item('a1', 'Seller A scooter')))) })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByDisplayValue('Seller B bike')).toBeTruthy()
    expect(screen.queryByDisplayValue('Seller A scooter')).toBeNull()
  })

  it('a seller back from Facebook\'s Connect gets the result in THEIR panel — nothing mounts while sign-in loads (opus commit gate 2026-11-13)', async () => {
    a.loading = true
    a.search = 'fbi=queued'
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(String(u).endsWith('/available') ? { on: true } : { on: true, connected: true, phone: null, job: { id: 'j1', status: 'queued', createdAt: new Date().toISOString(), items: [] } })))
    vi.stubGlobal('fetch', f)
    const { rerender } = render(<FacebookImportPanel />)
    await new Promise((r) => setTimeout(r, 50))
    expect(a.toast.success).not.toHaveBeenCalled()
    expect(a.replace).not.toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
    a.loading = false
    a.user = { id: 'u1' }
    rerender(<FacebookImportPanel />)
    await waitFor(() => expect(a.toast.success).toHaveBeenCalledTimes(1))
    expect(a.replace).toHaveBeenCalledTimes(1)
    expect(urls(f)).toContain('/api/fb-import')
    expect(urls(f)).not.toContain('/api/fb-import/available')
  })

  it('signing out again asks afresh — never the last visitor\'s answer (commit gate 2026-11-13)', async () => {
    let on = true
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(String(u).endsWith('/available') ? { on } : { on: true, connected: false, phone: null, job: null })))
    vi.stubGlobal('fetch', f)
    const { rerender } = render(<FacebookImportPanel />)
    expect(await screen.findByRole('link', { name: 'Connect Facebook and import' })).toBeTruthy()
    a.user = { id: 'u1' }
    rerender(<FacebookImportPanel />)
    expect(await screen.findByRole('button', { name: 'Connect Facebook and import' })).toBeTruthy()
    on = false
    a.user = null
    rerender(<FacebookImportPanel />)
    expect(await screen.findByText('Import from Facebook isn’t available right now.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Connect Facebook and import' })).toBeNull()
    expect(urls(f).filter((u) => u.endsWith('/available'))).toHaveLength(2)
  })

  it('signing in on the page: the seller\'s own import takes over, with the real Connect button', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(String(u).endsWith('/available')
      ? { on: true }
      : { on: true, connected: false, phone: null, job: null })))
    vi.stubGlobal('fetch', f)
    const { rerender } = render(<FacebookImportPanel />)
    expect(await screen.findByRole('link', { name: 'Connect Facebook and import' })).toBeTruthy()
    a.user = { id: 'u1' }
    rerender(<FacebookImportPanel />)
    await waitFor(() => expect(urls(f)).toContain('/api/fb-import'))
    expect(await screen.findByRole('button', { name: 'Connect Facebook and import' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Connect Facebook and import' })).toBeNull()
  })
})
