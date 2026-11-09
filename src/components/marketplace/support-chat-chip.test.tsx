// @vitest-environment jsdom
/**
 * CONTACT'S "Chat with support" (UI climb 2026-11-09): a guest is sent to sign in and back to Contact; a signed-in reader opens the
 * support thread through the shared hook, and a failure shows the email line, never an error page; nothing renders while auth loads.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

const AUTH: { user: { id: string } | null; loading: boolean } = { user: null, loading: false }
vi.mock('@/context/auth-context', () => ({ useAuth: () => AUTH }))
const hook = vi.hoisted(() => ({ open: vi.fn(async () => true), opening: false }))
vi.mock('./use-open-support-thread', () => ({ useOpenSupportThread: () => hook }))

const { SupportChatChip } = await import('./support-chat-chip')
const mount = () => render(<LanguageProvider initialLang="en" initialViDict={{}}><SupportChatChip /></LanguageProvider>)

beforeEach(() => {
  AUTH.user = null
  AUTH.loading = false
  hook.open.mockReset()
  hook.open.mockResolvedValue(true)
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('SupportChatChip', () => {
  it('a guest gets a link to sign in that comes back to Contact', () => {
    mount()
    const link = screen.getByRole('link', { name: 'Chat with support' })
    expect(link.getAttribute('href')).toBe('/signin?next=/contact')
  })

  it('renders nothing while auth is still loading (no guest chip flashing for a signed-in reader)', () => {
    AUTH.loading = true
    const { container } = mount()
    expect(container.textContent).toBe('')
  })

  it('a signed-in reader opens the support thread', async () => {
    AUTH.user = { id: 'u1' }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with support' }))
    await waitFor(() => expect(hook.open).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a failed open shows the email line, not an error page', async () => {
    AUTH.user = { id: 'u1' }
    hook.open.mockResolvedValue(false)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with support' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Email us instead/))
  })
})
