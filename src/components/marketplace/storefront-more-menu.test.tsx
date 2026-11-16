// @vitest-environment jsdom
/**
 * ⛔ THE STOREFRONT'S ⋯ (owner, 2026-11-16 — hub Q21; storefront-more-menu.tsx). App Store 1.2 / Play UGC: Report and Block are
 * REACHABLE FROM THE ⋯, NEVER REMOVED — one tap opens it (an anchored menu from sm, the action sheet on a phone), its rows say
 * exactly what the old pills said ("Report", "Block"), and each opens the SAME dialog the pill opened: the report form (a
 * guest is asked to sign in first, with the same note), the block confirmation with the same title, words and request.
 * Block is a row exactly where the pill rendered: the `ugc-safety` gate on, and not the viewer's own shop.
 */
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'

const h = vi.hoisted(() => ({ auth: { user: { id: 'u1' } as { id: string } | null, loading: false, sellerId: null as string | null, openSignIn: (() => {}) as (o?: unknown) => void } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/lib/hidden-sellers', () => ({ hiddenSellersOwner: () => 'u1', hideSellerNow: () => {}, syncHiddenSellers: async () => {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { StorefrontMoreMenu } from './storefront-more-menu'

beforeAll(() => installDrawerPolyfills())
beforeEach(() => {
  h.auth = { user: { id: 'u1' }, loading: false, sellerId: null, openSignIn: vi.fn() }
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

function mount(props: Partial<React.ComponentProps<typeof StorefrontMoreMenu>> = {}) {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <StorefrontMoreMenu sellerId="seller-1" name="VinWonders" {...props} />
    </LanguageProvider>,
  )
}
const more = () => screen.getByRole('button', { name: 'More actions' })

describe('StorefrontMoreMenu — Report and Block behind the ⋯', () => {
  it('one 44px ⋯, named "More actions" (the menu sheet\'s own words); no Report or Block pill on the page', () => {
    mount()
    expect(more().getAttribute('class')).toEqual(expect.stringContaining('size-11'))
    expect(screen.queryByRole('button', { name: /Report/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Block/ })).toBeNull()
  })

  it('⛔ one tap opens it: Report and Block, in those words, Report in the red', async () => {
    mount()
    await userEvent.setup().click(more())
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Report', 'Block'])
    expect(items[0].getAttribute('data-variant')).toBe('destructive')
  })

  it('⛔ Report opens the same report form ("Report this seller"), and sends what the pill sent', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'case-1' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    mount()
    await user.click(more())
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Report' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report this seller' })
    await user.click(within(dialog).getByRole('radio', { name: 'Scam' }))
    await user.click(within(dialog).getByRole('button', { name: /Send|Submit/ }))
    expect(fetchMock).toHaveBeenCalledWith('/api/report', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ sellerId: 'seller-1', reason: 'scam' })
  })

  it('a guest who taps Report is asked to sign in first, with the pill\'s own note — no form to fill for nothing', async () => {
    h.auth = { user: null, loading: false, sellerId: null, openSignIn: vi.fn() }
    const user = userEvent.setup()
    mount()
    await user.click(more())
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Report' }))
    await vi.waitFor(() => expect(h.auth.openSignIn).toHaveBeenCalledTimes(1))
    expect((h.auth.openSignIn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ note: expect.stringContaining('Sign in to report') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('⛔ Block opens the same confirmation ("Block VinWonders?"), and a shop nobody runs is blocked as a shop', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ blocked: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    mount({ shopOnly: true })
    await user.click(more())
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Block' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Block VinWonders?' })
    expect(confirm.textContent).toContain('This shop\'s listings disappear from everything you browse')
    await act(async () => { await user.click(within(confirm).getByRole('button', { name: 'Block' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/blocks', expect.objectContaining({ body: JSON.stringify({ sellerId: 'seller-1', blocked: true }) }))
  })

  it('Block is a row exactly where the pill rendered: not while `ugc-safety` is off, not on the viewer\'s own shop — Report always', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const user = userEvent.setup()
    const view = mount()
    await user.click(more())
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Report'])
    view.unmount()
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.auth = { ...h.auth, sellerId: 'seller-1' }
    mount()
    await user.click(more())
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Report'])
  })

  it('on a phone the same ⋯ opens the action sheet, and its Report row opens the same form', async () => {
    setViewport('phone')
    const user = userEvent.setup()
    mount()
    await user.click(more())
    const sheet = await screen.findByRole('dialog', { name: 'More actions' })
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(expect.arrayContaining(['Report', 'Block']))
    await user.click(within(sheet).getByRole('button', { name: 'Report' }))
    expect(await screen.findByRole('dialog', { name: 'Report this seller' })).toBeTruthy()
  })
})
