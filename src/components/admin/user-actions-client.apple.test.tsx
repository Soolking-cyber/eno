// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * ADMIN ERASE — WHAT HAPPENED TO THE PERSON'S SIGN IN WITH APPLE (plan §7.11, D9). The route answers
 * `{ ok, purge, apple }`; the console shows `apple`, and for `queued` / `manual` hands the moderator the line the
 * support reply must carry (the person still has to remove eno in their Apple Account), with Apple's page in both
 * languages. `none` leaves for the user list at once, as before.
 */

const h = vi.hoisted(() => ({ push: (_to: string) => {}, refresh: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (to: string) => h.push(to), refresh: () => h.refresh() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { UserActionsClient } from './user-actions-client'

let apple: string | undefined
beforeEach(() => {
  h.push = vi.fn()
  apple = undefined
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, purge: 0, ...(apple ? { apple } : {}) }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function erase(status?: string) {
  apple = status
  render(<UserActionsClient profileId="p1" email="x@privaterelay.appleid.com" phone={null} verificationStatus="none" enforcementState="active" isAdmin={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Erase account (PDPL)' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Confirm the account' }), { target: { value: 'x@privaterelay.appleid.com' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'ticket 42' } })
  fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('admin erase — the Sign in with Apple outcome', () => {
  it.each(['manual', 'queued'] as const)('`%s`: the outcome and the support reply line stay on screen until Done', async (status) => {
    await erase(status)
    expect(await screen.findByText('Account erased')).toBeTruthy()
    expect(screen.getByText(/^Sign in with Apple:/).textContent).toMatch(status === 'manual' ? /no revocable token/ : /retried daily for 14 days/)
    const reply = screen.getByRole('textbox', { name: 'Support reply line' }) as HTMLTextAreaElement
    expect(reply.value).toContain('https://support.apple.com/en-us/102571')
    expect(reply.value).toContain('https://support.apple.com/vi-vn/102571')
    expect(h.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(h.push).toHaveBeenCalledWith('/admin/users')
  })

  it('`revoked`: the outcome is shown, with no reply line to send', async () => {
    await erase('revoked')
    expect(screen.getByText(/^Sign in with Apple:/).textContent).toMatch(/revoked/)
    expect(screen.queryByRole('textbox', { name: 'Support reply line' })).toBeNull()
  })

  it('`none` (no Apple sign-in): straight back to the user list, as before', async () => {
    await erase('none')
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith('/admin/users'))
    expect(screen.queryByText(/^Sign in with Apple:/)).toBeNull()
  })
})
