// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The F7 wiring: every sign-in in a page asks whether the browser's Web Push subscription is this account's
 * (push-account-guard.ts holds the contract and its own tests). Harness after auth-context.test.tsx.
 */

const KEY = 'sb-xihiryllwmjoouipkyhw-auth-token'
const createSupabaseBrowser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }))
vi.mock('@/lib/analytics', () => ({ trackSignUp: vi.fn() }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: vi.fn(() => Promise.resolve()) }))
const guard = vi.hoisted(() => ({ calls: [] as { account: string; stillCurrent: () => boolean }[] }))
vi.mock('@/lib/push-account-guard', () => ({
  dropForeignPushSubscription: async (account: string, stillCurrent: () => boolean) => { guard.calls.push({ account, stillCurrent }); return 'kept' },
}))

import { AuthProvider } from './auth-context'

let emit: ((event: string, session: unknown) => void) | null = null
const session = (id: string) => ({ user: { id, email: `${id}@example.com`, user_metadata: {}, app_metadata: {} } })

beforeEach(() => {
  vi.useFakeTimers()
  guard.calls = []
  emit = null
  createSupabaseBrowser.mockReset()
  createSupabaseBrowser.mockImplementation(() => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: session('u-a') } }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { emit = cb; return { data: { subscription: { unsubscribe: () => {} } } } },
    },
  }))
  document.cookie = `${KEY}=x; path=/` // a session cookie: the provider boots supabase-js
})
afterEach(() => {
  cleanup()
  document.cookie = `${KEY}=; path=/; max-age=0`
  vi.useRealTimers()
})

describe('AuthProvider asks about the browser\'s push subscription on every sign-in (F7)', () => {
  it('for the account that arrives, again on every auth event (a failed check is retried) — and a question made before a switch is stale', async () => {
    render(<AuthProvider><div /></AuthProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(guard.calls.map((c) => c.account)).toEqual(['u-a'])
    expect(guard.calls[0].stillCurrent()).toBe(true)
    await act(async () => { emit!('TOKEN_REFRESHED', session('u-a')); await vi.advanceTimersByTimeAsync(10) }) // same account
    expect(guard.calls.map((c) => c.account)).toEqual(['u-a', 'u-a']) // asked again (free once a "mine" is remembered)
    await act(async () => { emit!('SIGNED_IN', session('u-b')); await vi.advanceTimersByTimeAsync(10) }) // a switch, no sign-out
    expect(guard.calls.map((c) => c.account)).toEqual(['u-a', 'u-a', 'u-b'])
    expect(guard.calls[1].stillCurrent()).toBe(false) // A's question, if it answers now, drops nothing
    expect(guard.calls[2].stillCurrent()).toBe(true)
  })
})
