// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── <BlockUserButton> — App Store gate `ugc-safety` (plan R3) ──────────────────────────────────────

const openSignIn = vi.fn()
const auth = vi.hoisted(() => ({ sellerId: null as string | null }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ openSignIn, user: { id: 'u1' }, sellerId: auth.sellerId }) }))
// The instant hide (src/lib/hidden-sellers.ts): the shop goes the moment the block answers, then a sync.
const hidden = vi.hoisted(() => ({ now: [] as string[], synced: [] as Array<string | null>, owner: 'u1' as string | null }))
vi.mock('@/lib/hidden-sellers', () => ({
  hiddenSellersOwner: () => hidden.owner,
  hideSellerNow: (id: string, uid: string) => { hidden.now.push(`${id}@${uid}`) },
  syncHiddenSellers: async (uid: string | null) => { hidden.synced.push(uid) },
}))
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: vi.fn() } }))

import { BlockUserButton } from './block-user-button'

const fetchMock = vi.fn()
function mount(props: React.ComponentProps<typeof BlockUserButton>) {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <BlockUserButton {...props} />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  auth.sellerId = null
  hidden.now = []; hidden.synced = []; hidden.owner = 'u1'
  fetchMock.mockReset()
  toastSuccess.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('BlockUserButton', () => {
  it('renders NOTHING while the gate is off', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const { container } = mount({ conversationId: 'c1', name: 'Lan' })
    expect(container.textContent).toBe('')
  })

  it('confirms, then blocks by THREAD (never a profile id) and reports back', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ blocked: true }) })
    const onBlocked = vi.fn()
    mount({ conversationId: 'c1', name: 'Lan', onBlocked })
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    expect(await screen.findByRole('alertdialog', { name: 'Block Lan?' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!) })
    expect(fetchMock).toHaveBeenCalledWith('/api/blocks', expect.objectContaining({ method: 'POST', body: JSON.stringify({ conversationId: 'c1', blocked: true }) }))
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalled()
    // A chat block promises the chat, not the listings (it hides the thread's shop only for its buyer — review).
    expect(toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('listings'))
  })

  it('⛔ on a listing page: names the shop AND the listing, hides the shop at once, then syncs (App Store 1.2)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ blocked: true }) })
    mount({ sellerId: 's1', listingId: 'l1', name: 'Lan' })
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('They will not be able to message you')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!) })
    expect(fetchMock.mock.calls[0]![1].body).toBe(JSON.stringify({ sellerId: 's1', listingId: 'l1', blocked: true }))
    await vi.waitFor(() => expect(hidden.now).toEqual(['s1@u1']))
    expect(hidden.synced).toEqual(['u1'])
  })

  it('a Block that answers after the hidden list changed hands (sign-out, another account) touches nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    let answer: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise((r) => { answer = r }))
    mount({ sellerId: 's1', listingId: 'l1', name: 'Lan' })
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!)
    hidden.owner = 'u2'
    await act(async () => { answer({ ok: true, status: 200, json: async () => ({ blocked: true }) }) })
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(hidden.now).toEqual([])
    expect(hidden.synced).toEqual([])
  })

  it('a shop nobody blockable runs: the dialog promises only what a shop block does', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ blocked: true }) })
    mount({ sellerId: 'linked', shopOnly: true, name: "Jan's Motorbike" })
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    const dialog = await screen.findByRole('alertdialog', { name: "Block Jan's Motorbike?" })
    expect(dialog.textContent).toContain("This shop's listings disappear from everything you browse")
    expect(dialog.textContent).not.toContain('message you')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!) })
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("This shop's listings are hidden")))
  })

  it('survives the viewer becoming the shop\'s owner and back while mounted (no conditional hook)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const ui = (p: React.ComponentProps<typeof BlockUserButton>) => (
      <LanguageProvider initialLang="en" initialViDict={{}}><BlockUserButton {...p} /></LanguageProvider>
    )
    const { rerender, container } = render(ui({ sellerId: 'mine', name: 'Shop' }))
    expect(container.textContent).toContain('Block')
    auth.sellerId = 'mine'
    rerender(ui({ sellerId: 'mine', name: 'Shop' }))
    expect(container.textContent).toBe('')
    auth.sellerId = null
    rerender(ui({ sellerId: 'mine', name: 'Shop' }))
    expect(container.textContent).toContain('Block')
  })

  it('renders nothing on the viewer\'s OWN shop or listing', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    auth.sellerId = 'mine'
    const { container } = mount({ sellerId: 'mine', listingId: 'l1', name: 'My shop' })
    expect(container.textContent).toBe('')
  })

  it('says so when the target is your own shop', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'cannot_block_self' }) })
    mount({ sellerId: 's1', name: 'My shop' })
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    await screen.findByRole('alertdialog')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Block' }).at(-1)!) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('This is your own account.')
  })
})
