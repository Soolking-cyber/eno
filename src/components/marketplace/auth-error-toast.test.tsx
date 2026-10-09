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
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => h.params,
  usePathname: () => '/',
  useRouter: () => ({ replace: h.replace }),
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, openSignIn: h.openSignIn }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: h.error }) }))

const { AuthErrorToast } = await import('./auth-error-toast')

beforeEach(() => {
  h.params = new URLSearchParams('auth_error=signup_disabled&q=bike')
  h.user = null
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

  it('strips the flag from the address (a reload must not announce it again) and keeps the rest', () => {
    render(<AuthErrorToast />)
    expect(h.replace).toHaveBeenCalledWith('/?q=bike', { scroll: false })
  })
})
