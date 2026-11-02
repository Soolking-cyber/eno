// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "Is Facebook sign-in on?" is warmed before a sign-in popup can open, so Facebook does not join the form ~1 s late — but
// only for someone who can be shown that form, and as soon as that is known (speed audit 2026-11-01).

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; email: string } } }))
const warm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/facebook-flag', () => ({ warmFacebookSignIn: warm }))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: session.current } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }))
vi.mock('@/lib/analytics', () => ({ trackSignUp: vi.fn() }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: () => Promise.resolve() }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))

import { AuthProvider } from './auth-context'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  warm.mockReset()
  session.current = null
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('warming the Facebook sign-in flag', () => {
  it('a guest: as soon as auth has resolved, with no further wait', async () => {
    render(<AuthProvider><div /></AuthProvider>)
    await settle()
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('a member is never shown a sign-in form, so nothing is asked', async () => {
    document.cookie = 'sb-sb-auth-token=x; path=/'
    session.current = { user: { id: 'u1', email: 'a@example.com' } }
    render(<AuthProvider><div /></AuthProvider>)
    await settle()
    await settle()
    expect(warm).not.toHaveBeenCalled()
    document.cookie = 'sb-sb-auth-token=; path=/; max-age=0'
  })
})
