// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/** The Facebook-import ad landing (owner 2026-11-17, "Ad landing page"; src/lib/fb-import/landing.ts). */
const a = vi.hoisted(() => ({ ios: false, user: null as null | { id: string }, loading: false, here: true, on: true as boolean | 'fail', replace: vi.fn(), open: vi.fn(), form: vi.fn() }))
vi.mock('@/lib/facebook-signin', () => ({ facebookAvailableHere: () => a.here, facebookIosApp: () => a.ios }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: a.user, loading: a.loading }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: a.replace }) }))
vi.mock('@/lib/signin-gates', () => ({ noteGateOpen: a.open }))
vi.mock('@/components/marketplace/sign-in-form', () => ({ SignInForm: (p: { gate?: string }) => { a.form(p); return <form aria-label="sign in" /> } }))
const { FacebookImportLanding } = await import('./facebook-import-landing')
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); a.user = null; a.loading = false; a.here = true; a.on = true; a.ios = false })
const stubOn = () => vi.stubGlobal('fetch', vi.fn(async () => (a.on === 'fail' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ on: a.on })))))

describe('the Facebook-import ad landing', () => {
  it('says what eno is in two lines and asks for sign-in right there, as its own gate — counted once', () => {
    stubOn()
    const { rerender } = render(<FacebookImportLanding />)
    expect(screen.getByRole('heading', { level: 1, name: 'Post your Marketplace listings on eno.vn, free' })).toBeTruthy()
    expect(screen.getByText(/no retyping/)).toBeTruthy()
    expect(screen.getByRole('form', { name: 'sign in' })).toBeTruthy()
    expect(a.form).toHaveBeenCalledWith(expect.objectContaining({ gate: 'fb_import' }))
    rerender(<FacebookImportLanding />)
    expect(a.open).toHaveBeenCalledTimes(1)
    expect(a.open).toHaveBeenCalledWith('fb_import')
    expect(a.replace).not.toHaveBeenCalled()
  })

  it('signed in: on to the import — once, after the on/off answer — and no gate opening counted', async () => {
    a.user = { id: 'u1' }
    stubOn()
    render(<FacebookImportLanding />)
    // no sign-in form to press while it waits for the on/off answer
    expect(screen.queryByRole('form', { name: 'sign in' })).toBeNull()
    await waitFor(() => expect(a.replace).toHaveBeenCalledWith('/dashboard/listings?tab=facebook'))
    expect(a.replace).toHaveBeenCalledTimes(1)
    expect(a.open).not.toHaveBeenCalled()
  })

  it.each([
    ['switched off', () => { a.on = false }],
    ['the answer fails', () => { a.on = 'fail' }],
    ['Facebook\'s dialog can\'t run in this browser', () => { a.here = false }],
  ])('import %s: the line says so, and a sign-in goes on to the post form — never into a dead end', async (_n, set) => {
    set()
    stubOn()
    const { rerender } = render(<FacebookImportLanding />)
    expect(await screen.findByText(/isn’t available here right now, but you can post with the form/)).toBeTruthy()
    a.user = { id: 'u1' }
    rerender(<FacebookImportLanding />)
    await waitFor(() => expect(a.replace).toHaveBeenCalledWith('/post'))
  })

  it('one action first while the import can run — painted before the answer; today\'s whole form once it cannot (owner 2026-11-20)', async () => {
    stubOn()
    render(<FacebookImportLanding />)
    expect(a.form).toHaveBeenLastCalledWith(expect.objectContaining({ gate: 'fb_import', facebookAction: 'Connect Facebook to import' }))
    cleanup(); vi.clearAllMocks()
    a.on = false
    stubOn()
    render(<FacebookImportLanding />)
    await waitFor(() => expect(a.form).toHaveBeenLastCalledWith(expect.objectContaining({ gate: 'fb_import', facebookAction: undefined })))
    cleanup(); vi.clearAllMocks()
    a.here = false
    stubOn()
    render(<FacebookImportLanding />)
    await waitFor(() => expect(a.form).toHaveBeenLastCalledWith(expect.objectContaining({ facebookAction: undefined })))
    cleanup(); vi.clearAllMocks()
    // The iOS app: Facebook only beside Apple (Guideline 4.8) — the whole form, even with the import on.
    a.here = false; a.ios = true; a.on = true
    stubOn()
    render(<FacebookImportLanding />)
    await waitFor(() => expect(a.form).toHaveBeenLastCalledWith(expect.objectContaining({ facebookAction: undefined })))
  })

  it('while sign-in is being read: the words and the form, nothing counted or moved yet', () => {
    a.loading = true
    stubOn()
    render(<FacebookImportLanding />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(a.open).not.toHaveBeenCalled()
    expect(a.replace).not.toHaveBeenCalled()
  })
})
