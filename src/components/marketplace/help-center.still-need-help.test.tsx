// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * HELP CARRIES SUPPORT CHAT ON A PHONE (owner, 2026-11-08). The floating support bubble left phones (back-to-top.tsx),
 * so "Still need help?" — on /help and Account › Help — is where a signed-in person opens the support thread, the same
 * one the desktop bubble opens. A failed open falls back to the email, never to an error page; a guest is offered
 * sign-in; and while auth loads nobody signed in is told to sign in.
 */

const h = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  pathname: '/help',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => h.pathname }))
vi.mock('next/link', () => ({ default: ({ href, children, prefetch: _p, ...rest }: { href: string; prefetch?: boolean; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, loading: h.loading }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { StillNeedHelp } from './help-center'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => { h.user = null; h.loading = false; h.pathname = '/help'; h.push.mockClear() })

describe('Help — Still need help? (2026-11-08)', () => {
  it('signed in: "Message support" opens the support thread in /messages, with the email beside it', async () => {
    h.user = { id: 'u1' }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'c42' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<StillNeedHelp />)
    expect(screen.queryByText('Sign in')).toBeNull()
    expect(screen.getByRole('link', { name: /@/ }).getAttribute('href')).toMatch(/^mailto:/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Message support' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/support/thread', { method: 'POST' })
    expect(h.push).toHaveBeenCalledWith('/messages/c42')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a failed open names the email instead, and pushes nowhere', async () => {
    h.user = { id: 'u1' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    render(<StillNeedHelp />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Message support' })) })
    expect(h.push).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/Email us instead/)
  })

  /** A POST that settles only when the test says so. */
  const slowOpen = () => {
    let resolve!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r })))
    return (r: Response) => act(async () => { resolve(r) })
  }
  const made = () => new Response(JSON.stringify({ id: 'c42' }), { status: 200 })

  it('an open that settles after the person navigated pushes nowhere, and a failure then shows no fallback (review r1)', async () => {
    h.user = { id: 'u1' }
    for (const settle of [made, () => new Response('no', { status: 500 })]) {
      h.pathname = '/help'
      const finish = slowOpen()
      const view = render(<StillNeedHelp />)
      fireEvent.click(screen.getByRole('button', { name: 'Message support' }))
      h.pathname = '/listings/abc'
      view.rerender(<StillNeedHelp />)
      await finish(settle())
      expect(h.push).not.toHaveBeenCalled()
      expect(screen.queryByRole('status')).toBeNull()
      view.unmount()
    }
  })

  it('leaving Help and coming back before the open settles does not revive it (review r2)', async () => {
    h.user = { id: 'u1' }
    const finish = slowOpen()
    const first = render(<StillNeedHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Message support' }))
    first.unmount() // left Help…
    render(<StillNeedHelp />) // …and came back to /help: same pathname, a new Help
    await finish(made())
    expect(h.push).not.toHaveBeenCalled()
  })

  it('a round trip while the asker STAYS mounted (the desktop bubble, across pages) voids the ask too (review r3)', async () => {
    h.user = { id: 'u1' }
    h.pathname = '/saved'
    const finish = slowOpen()
    const view = render(<StillNeedHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Message support' }))
    h.pathname = '/help'
    view.rerender(<StillNeedHelp />)
    h.pathname = '/saved'
    view.rerender(<StillNeedHelp />)
    await finish(made())
    expect(h.push).not.toHaveBeenCalled()
  })

  it('staying put: a slow open still lands in the thread', async () => {
    h.user = { id: 'u1' }
    const finish = slowOpen()
    const view = render(<StillNeedHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Message support' }))
    view.rerender(<StillNeedHelp />)
    await finish(made())
    expect(h.push).toHaveBeenCalledWith('/messages/c42')
  })

  it('a guest gets the email and a sign-in link that comes back to Help, and no chat button', () => {
    render(<StillNeedHelp />)
    expect(screen.queryByRole('button', { name: 'Message support' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin?next=/help')
    expect(screen.getByRole('link', { name: /@/ }).getAttribute('href')).toMatch(/^mailto:/)
  })

  it('while auth loads: the email only — no sign-in prompt flashes at someone signed in', () => {
    h.loading = true
    render(<StillNeedHelp />)
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Message support' })).toBeNull()
    expect(screen.getByRole('link', { name: /@/ })).toBeTruthy()
  })
})
