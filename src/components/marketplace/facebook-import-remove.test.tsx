// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => true, facebookIosApp: () => false, FACEBOOK_DIALOG: 'https://www.facebook.com/dialog/oauth' }))
vi.mock('sonner', () => ({ toast: t }))
vi.mock('./area-filter', async (orig) => ({ ...(await orig<typeof import('./area-filter')>()), AreaFilter: () => null }))
const { FacebookImportPanel } = await import('./facebook-import-panel')
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
vi.setConfig({ testTimeout: 30_000 })

const draft = (id: string) => ({ id, status: 'draft', title: `Item ${id}`, description: 'Fine', titleVi: null, descriptionVi: null, fbTitle: `Item ${id}`, fresh: true, price: 1_000_000, fbPrice: null, district: 'Quận 12', city: 'Hồ Chí Minh', categorySlug: 'electronics', subcategorySlug: null, listingType: 'sell', attributes: null, reason: null, listingId: null, photo: null, photoCount: 1 })

// The server as the panel sees it: a PATCH with skip sets the draft's status, and the next read shows it.
const server = (fail = false) => {
  const items = [draft('a'), draft('b')]
  return vi.fn(async (u: string, init?: RequestInit) => {
    const m = String(u).match(/\/api\/fb-import\/items\/(\w+)$/)
    if (m && init?.method === 'PATCH') {
      if (fail) return new Response('{}', { status: 500 })
      const it = items.find((i) => i.id === m[1])!
      it.status = JSON.parse(String(init.body)).skip ? 'skipped' : 'draft'
      return new Response(JSON.stringify({ id: it.id, status: it.status }))
    }
    if (String(u).endsWith('/publish')) return new Response(JSON.stringify({ ok: true }), { status: 201 })
    if (String(u).startsWith('/api/geocode')) return new Response(JSON.stringify({ results: [] }))
    return new Response(JSON.stringify({ on: true, connected: true, phone: '0901234567', job: { id: 'j1', status: 'ready', createdAt: new Date().toISOString(), items: items.map((i) => ({ ...i })) } }))
  })
}
const titles = () => screen.queryAllByRole('textbox', { name: 'Title' }).map((e) => (e as HTMLInputElement).value)

// Owner, 2026-11-08: "add small x to remove unwanted imports".
describe('Import review: ✕ removes a draft', () => {
  it('✕ hides that one draft at once, tells the server to skip it, and it leaves the Publish count', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    render(<FacebookImportPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Item a' }))
    expect(titles()).toEqual(['Item b'])
    await waitFor(() => expect(t.success).toHaveBeenCalledWith('Removed from this import.', expect.anything()))
    const patch = f.mock.calls.find(([u, i]) => String(u).endsWith('/items/a') && (i as RequestInit)?.method === 'PATCH')!
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ skip: true })
    fireEvent.click(screen.getByRole('checkbox', { name: 'This location is right' }))
    expect(await screen.findByRole('button', { name: 'Publish 1' })).toBeTruthy()
  })
  it('Undo brings it back, ticked as it was', async () => {
    vi.stubGlobal('fetch', server())
    render(<FacebookImportPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Item a' }))
    await waitFor(() => expect(t.success).toHaveBeenCalled())
    t.success.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(titles()).toEqual(['Item a', 'Item b']))
    expect(screen.getByRole('checkbox', { name: 'Item a' }).getAttribute('aria-checked')).toBe('true')
  })
  it('a failed save puts the draft back', async () => {
    vi.stubGlobal('fetch', server(true))
    render(<FacebookImportPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Item a' }))
    await waitFor(() => expect(t.error).toHaveBeenCalled())
    await waitFor(() => expect(titles()).toEqual(['Item a', 'Item b']))
    expect(t.success).not.toHaveBeenCalled()
  })
})
