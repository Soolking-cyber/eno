// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── The "Join eno" prompt rides THE sign-in popup: the provider's half of that contract ──────────
// The popup is stubbed to a probe that shows which presentation it was handed and closes the way the
// visitor would (onOpenChange(false)). What is pinned: the prompt reaches the popup; a visitor's close
// is reported as a dismissal exactly once; the context survives the close (so the exit animation keeps
// its frame) and never leaks into the NEXT, unrelated open.

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('@/lib/analytics', () => ({ trackSignUp: vi.fn() }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: () => Promise.resolve() }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function Popup(p: { open: boolean; onOpenChange: (o: boolean) => void; prompt?: unknown; note?: string }) {
      return (
        <div data-testid="popup" data-open={p.open ? 'yes' : 'no'} data-join={p.prompt ? 'yes' : 'no'}>
          <button type="button" onClick={() => p.onOpenChange(false)}>visitor closes</button>
        </div>
      )
    },
}))

import { AuthProvider, useAuth } from './auth-context'

const onDismiss = vi.fn()
const onMethod = vi.fn()

function Probe() {
  const { openSignIn } = useAuth()
  return (
    <>
      <button type="button" onClick={() => openSignIn({ prompt: { onDismiss, onMethod } })}>join</button>
      <button type="button" onClick={() => openSignIn()}>plain</button>
    </>
  )
}
const click = (name: string) => act(async () => { screen.getByRole('button', { name }).click() })
const popup = () => screen.getByTestId('popup')

beforeEach(() => {
  onDismiss.mockReset()
  onMethod.mockReset()
  render(<AuthProvider><Probe /></AuthProvider>)
})
afterEach(() => cleanup())

describe('AuthProvider — the join presentation of the one popup', () => {
  it('openSignIn({ prompt }) hands the prompt to THE popup', async () => {
    await click('join')
    expect(popup().dataset.open).toBe('yes')
    expect(popup().dataset.join).toBe('yes')
  })

  it('⛔ a close the visitor makes is reported as the prompt’s dismissal, once', async () => {
    await click('join')
    await click('visitor closes')
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(popup().dataset.open).toBe('no')
  })

  it('⚠️ the context outlives the close — the exit animation keeps the join frame — and the next plain open drops it', async () => {
    await click('join')
    await click('visitor closes')
    expect(popup().dataset.join).toBe('yes') // still the join frame while it fades out
    await click('plain')
    expect(popup().dataset.join).toBe('no')
    await click('visitor closes')
    expect(onDismiss).toHaveBeenCalledTimes(1) // closing a plain sign-in popup is not the prompt's dismissal
  })

  it('⛔ eno:require-signin opens the PLAIN popup, never a stale join presentation', async () => {
    await click('join')
    await click('visitor closes')
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:require-signin')) })
    expect(popup().dataset.open).toBe('yes')
    expect(popup().dataset.join).toBe('no')
  })
})
