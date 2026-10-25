// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * ⚠️ A GUEST SIGNS IN BEFORE THE REPORT FORM (sweep, 2026-10-22). A report needs an account: a guest used to fill in the
 * reason and the details, press Submit, and see the form vanish into a generic sign-in sheet — after a Google, Apple or
 * Facebook sign-in (a full-page redirect) the typed report was gone. And a session that expired meanwhile is told the
 * report was NOT sent.
 */
const h = vi.hoisted(() => ({ auth: { user: null as { id: string } | null, loading: false, openSignIn: vi.fn() } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))

const { ReportButton } = await import('./report-button')

beforeEach(() => { h.auth = { user: null, loading: false, openSignIn: vi.fn() } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Report — guests', () => {
  it('⚠️ a guest is asked to sign in with a reason, and no form opens to be filled in for nothing', async () => {
    render(<ReportButton listingId="L1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Report' }))
    expect(h.auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(h.auth.openSignIn.mock.calls[0][0]).toMatchObject({ note: expect.stringContaining('Sign in to report') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tap while the session is still resolving opens the form — and it closes for sign-in the moment that resolves to a guest', async () => {
    h.auth = { user: null, loading: true, openSignIn: vi.fn() }
    const view = render(<ReportButton listingId="L1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Report' }))
    expect(h.auth.openSignIn).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    h.auth = { ...h.auth, loading: false }
    view.rerender(<ReportButton listingId="L1" />)
    expect(h.auth.openSignIn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a caller that opens the dialog itself (controlled) gets the same gate: no form for a guest', async () => {
    const onOpenChange = vi.fn()
    render(<ReportButton conversationId="C1" open onOpenChange={onOpenChange} />)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.auth.openSignIn).toHaveBeenCalledTimes(1)
  })

  it('signed in: the form opens; a session that expired meanwhile is told the report was not sent', async () => {
    h.auth = { user: { id: 'u1' }, loading: false, openSignIn: vi.fn() }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'auth_required' }) })))
    const user = userEvent.setup()
    render(<ReportButton listingId="L1" />)
    await user.click(screen.getByRole('button', { name: 'Report' }))
    expect(h.auth.openSignIn).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await user.click(dialog.querySelectorAll('[role="radio"]')[0] as HTMLElement)
    await user.click(screen.getByRole('button', { name: /^(Submit|Send)/ }))
    expect(h.auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(h.auth.openSignIn.mock.calls[0][0]).toMatchObject({ note: expect.stringContaining('was not sent') })
  })
})
