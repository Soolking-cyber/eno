// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A failed sign-in lands on `/?auth_error=…` (the callback's redirect), and this is the only thing that says so.
 * ⛔ It is a refusal with a step: Sign in, on a toast that lasts long enough to read and reach for it
 * (src/lib/refusal-toast.ts). It used to vanish after 4s — a 27-word sentence on a page the visitor did not choose.
 */

const h = vi.hoisted(() => ({
  params: new URLSearchParams('auth_error=signup_disabled&q=bike'),
  replace: vi.fn(),
  openSignIn: vi.fn(),
  error: vi.fn(),
  user: null as { id: string } | null,
  loading: false,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params,
  usePathname: () => '/',
  useRouter: () => ({ replace: h.replace }),
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, loading: h.loading, openSignIn: h.openSignIn }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: h.error }) }))

const { AuthErrorToast } = await import('./auth-error-toast')

beforeEach(() => {
  h.params = new URLSearchParams('auth_error=signup_disabled&q=bike')
  h.user = null
  h.loading = false
  h.replace.mockClear(); h.openSignIn.mockClear(); h.error.mockClear()
})
afterEach(cleanup)

describe('AuthErrorToast', () => {
  it('⛔ says why, offers Sign in, and stays long enough to read and reach for it', () => {
    render(<AuthErrorToast />)
    expect(h.error).toHaveBeenCalledTimes(1)
    const [message, opts] = h.error.mock.calls[0] as [string, { duration: number; action: { label: string; onClick: () => void } }]
    expect(message).toMatch(/^New sign-ups are closed at the moment/)
    expect(opts.duration).toBeGreaterThanOrEqual(8000)
    expect(opts.duration).toBeLessThanOrEqual(15_000)
    expect(opts.action.label).toBe('Sign in')
    opts.action.onClick()
    expect(h.openSignIn).toHaveBeenCalledTimes(1)
  })

  it('a SECOND failure with the same code, after the flag was stripped, is announced again — not swallowed', () => {
    const view = render(<AuthErrorToast />)
    expect(h.error).toHaveBeenCalledTimes(1)
    h.params = new URLSearchParams('q=bike') // the strip landed
    view.rerender(<AuthErrorToast />)
    h.params = new URLSearchParams('auth_error=signup_disabled') // the retry failed the same way
    view.rerender(<AuthErrorToast />)
    expect(h.error).toHaveBeenCalledTimes(2)
  })

  it('someone already signed in gets the sentence without a Sign in step (nothing to retry)', () => {
    h.user = { id: 'u1' }
    render(<AuthErrorToast />)
    const opts = h.error.mock.calls[0][1] as { action?: unknown }
    expect(opts.action).toBeUndefined()
  })

  // Sweep 2026-10-22: the step was chosen on the FIRST render, while a session still reads as signed out (the idle
  // boot), so a signed-in visitor was offered "Sign in". It waits for auth now — and strips nothing until then.
  it('⛔ waits for auth before choosing the step: a session resolved as signed in gets no Sign in', () => {
    h.loading = true
    const view = render(<AuthErrorToast />)
    expect(h.error).not.toHaveBeenCalled()
    expect(h.replace).not.toHaveBeenCalled()
    h.loading = false
    h.user = { id: 'u1' }
    view.rerender(<AuthErrorToast />)
    expect(h.error).toHaveBeenCalledTimes(1)
    expect((h.error.mock.calls[0][1] as { action?: unknown }).action).toBeUndefined()
  })

  it('strips the flag from the address (a reload must not announce it again) and keeps the rest', () => {
    render(<AuthErrorToast />)
    expect(h.replace).toHaveBeenCalledWith('/?q=bike', { scroll: false })
  })

  // Owner, 2026-10-17: "if no email register with number" → "Email code now" (the filed Quy chế: a verified phone
  // or email; phone codes are not live). Facebook sharing no email opens THE popup on the emailed code.
  it('⛔ Facebook shared no email, signed out: the popup opens on the emailed code (note + emailLead), no toast', () => {
    h.params = new URLSearchParams('auth_error=no_email&q=bike')
    render(<AuthErrorToast />)
    expect(h.error).not.toHaveBeenCalled()
    expect(h.openSignIn).toHaveBeenCalledTimes(1)
    const ctx = h.openSignIn.mock.calls[0][0] as { note: string; emailLead: boolean }
    expect(ctx.emailLead).toBe(true)
    expect(ctx.note).toMatch(/^Facebook didn’t share your email address\. Continue with your email instead — we’ll send you a code\.$/)
    expect(h.replace).toHaveBeenCalledWith('/?q=bike', { scroll: false })
  })

  it('Facebook shared no email, already signed in: the sentence, no popup', () => {
    h.params = new URLSearchParams('auth_error=no_email')
    h.user = { id: 'u1' }
    render(<AuthErrorToast />)
    expect(h.openSignIn).not.toHaveBeenCalled()
    expect(h.error).toHaveBeenCalledTimes(1)
    // The whole sentence: someone signed in is never told to sign in, nor that an account could not be made.
    expect(h.error.mock.calls[0][0]).toBe('Facebook didn’t share an email address with us, so that sign-in didn’t go through.')
    expect((h.error.mock.calls[0][1] as { action?: unknown }).action).toBeUndefined()
  })

  it('⛔ waits until the session is known: a signed-in visitor still loading must not get the popup', () => {
    h.params = new URLSearchParams('auth_error=no_email')
    h.loading = true
    const view = render(<AuthErrorToast />)
    expect(h.openSignIn).not.toHaveBeenCalled()
    expect(h.error).not.toHaveBeenCalled()
    expect(h.replace).not.toHaveBeenCalled()
    h.loading = false
    h.user = { id: 'u1' }
    view.rerender(<AuthErrorToast />)
    expect(h.openSignIn).not.toHaveBeenCalled()
    expect(h.error).toHaveBeenCalledTimes(1)
  })

  it('the other Facebook refusal (an existing account) is still the toast, not the popup', () => {
    h.params = new URLSearchParams('auth_error=facebook_linked')
    render(<AuthErrorToast />)
    expect(h.error).toHaveBeenCalledTimes(1)
    expect(h.error.mock.calls[0][0]).toMatch(/^We could not finish signing you in with Facebook/)
  })
})
