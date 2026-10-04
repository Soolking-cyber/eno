// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── <BlockUserButton> — App Store gate `ugc-safety` (plan R3) ──────────────────────────────────────

const openSignIn = vi.fn()
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ openSignIn }) }))
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
