// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The Facebook-import ad landing (owner 2026-11-17, "Ad landing page"; src/lib/fb-import/landing.ts). Since 2026-11-22 (owner "go":
 * listings first, sign-in on the tap) it asks for nothing on arrival: one button opens the app's sign-in popup, gate fb_import.
 */
const a = vi.hoisted(() => ({ ios: false, user: null as null | { id: string }, here: true, on: true as boolean | 'fail', replace: vi.fn(), openSignIn: vi.fn() }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => a.here, facebookIosApp: () => a.ios }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: a.user, loading: false, openSignIn: a.openSignIn }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: a.replace }) }))
const { FacebookImportLanding } = await import('./facebook-import-landing')
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); a.user = null; a.here = true; a.on = true; a.ios = false })
const stubOn = () => vi.stubGlobal('fetch', vi.fn(async () => (a.on === 'fail' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ on: a.on })))))

describe('the Facebook-import ad landing', () => {
  it('says what eno is in two lines and asks for nothing on arrival: the popup opens only on the tap, as gate fb_import', () => {
    stubOn()
    render(<FacebookImportLanding />)
    expect(screen.getByRole('heading', { level: 1, name: 'Post your Marketplace listings on eno.vn, free' })).toBeTruthy()
    expect(screen.getByText(/no retyping/)).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(a.openSignIn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Import from Facebook' }))
    expect(a.openSignIn).toHaveBeenCalledTimes(1)
    expect(a.openSignIn).toHaveBeenCalledWith({ gate: 'fb_import' })
    expect(a.replace).not.toHaveBeenCalled()
  })

  it('signed in: on to the import — once, after the on/off answer — and no button to press meanwhile', async () => {
    a.user = { id: 'u1' }
    stubOn()
    render(<FacebookImportLanding />)
    expect(screen.queryByRole('button')).toBeNull()
    await waitFor(() => expect(a.replace).toHaveBeenCalledWith('/dashboard/listings?tab=facebook'))
    expect(a.replace).toHaveBeenCalledTimes(1)
    expect(a.openSignIn).not.toHaveBeenCalled()
  })

  it.each([
    ['switched off', () => { a.on = false }],
    ['the answer fails', () => { a.on = 'fail' }],
    ['Facebook\'s dialog can\'t run in this browser', () => { a.here = false }],
  ])('import %s: the line and the button say Post, and a sign-in goes on to the post form — never into a dead end', async (_n, set) => {
    set()
    stubOn()
    const { rerender } = render(<FacebookImportLanding />)
    expect(await screen.findByText(/isn’t available here right now, but you can post with the form/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Post a listing' })).toBeTruthy()
    a.user = { id: 'u1' }
    rerender(<FacebookImportLanding />)
    await waitFor(() => expect(a.replace).toHaveBeenCalledWith('/post'))
  })

  it('⛔ never an import button in the iOS app, even with the import on (the import hands back to the browser there)', async () => {
    a.here = false; a.ios = true; a.on = true
    stubOn()
    render(<FacebookImportLanding />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post a listing' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Import from Facebook' })).toBeNull()
  })
})
