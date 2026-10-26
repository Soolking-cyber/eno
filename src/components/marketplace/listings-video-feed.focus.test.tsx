// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The Video view is a modal takeover (sweep 2026-10-22): focus stayed on the "Video view" button under the black layer,
 * Tab walked the hidden page and the takeover's own controls came last. It is a dialog now: focus goes in, Tab stays in,
 * a dialog opened from it (sign-in) keeps its own Tab, and on close focus returns to the opener.
 */
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }), useTr: () => (en: string) => en }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/components/native/native-bootstrap', () => ({ pushBlackStatusBar: () => () => {} }))

import { VideoFeed } from './listings-video-feed'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // stays loading: the shell and its Close are what is under test
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function open() {
  const opener = document.createElement('button')
  opener.textContent = 'Video view'
  document.body.appendChild(opener)
  opener.focus()
  const after = document.createElement('a')
  after.href = '/footer'
  document.body.appendChild(after)
  const client = new QueryClient()
  const view = render(<QueryClientProvider client={client}><VideoFeed baseParams="q=bike" onOpen={() => {}} onClose={() => {}} /></QueryClientProvider>)
  return { opener, after, view }
}
const tab = (shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  window.dispatchEvent(e)
  return e
}

describe('Video view — a modal takeover', () => {
  it('is a dialog; focus moves in, Tab wraps inside it, and close gives focus back to the opener', () => {
    const { opener, view } = open()
    const dialog = screen.getByRole('dialog', { name: 'Videos' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    expect(tab().defaultPrevented).toBe(true) // the last control wraps to the first, never out into the page
    expect(dialog.contains(document.activeElement)).toBe(true)
    act(() => view.unmount())
    expect(document.activeElement).toBe(opener)
  })

  it('a dialog opened from the takeover keeps its own Tab and Escape', () => {
    const onClose = vi.fn()
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><VideoFeed baseParams="q=bike" onOpen={() => {}} onClose={onClose} /></QueryClientProvider>)
    const signIn = document.createElement('div')
    signIn.setAttribute('role', 'dialog')
    const field = document.createElement('input')
    signIn.appendChild(field)
    document.body.appendChild(signIn)
    field.focus()
    expect(tab().defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(field)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    field.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
