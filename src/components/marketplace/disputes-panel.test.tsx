// @vitest-environment jsdom
/**
 * A FAILED LOAD IS A FAULT, NEVER "No disputes" (pre-deploy review, 2026-11-09): a network failure used to set the list to []
 * and say the reader had no cases — under the lifebuoy mascot since batch 36, which the canon keeps off a fault — and an
 * error ANSWER left the skeleton up for good. A 401 asks for sign-in again (Try again could never fix a dead session); any
 * other non-2xx, or an answer with no `cases` list, is the fault coin with Try again. An account switch never shows the
 * previous account's cases. And the loading rows hold the empty state's height, so the footer does not jump when
 * "No disputes" arrives (measured CLS 0.22 on a phone before).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }))
// ONE user object per account, as the real context holds it in state: a fresh object per render would re-run the load effect.
const U1 = { id: 'u1' }
const AUTH: { user: { id: string } | null; loading: boolean; openSignIn: () => void; signOut: () => Promise<void> } =
  { user: U1, loading: false, openSignIn: () => {}, signOut: async () => {} }
vi.mock('@/context/auth-context', () => ({ useAuth: () => AUTH }))

const { DisputesPanel } = await import('./disputes-panel')

let answers: Array<() => Promise<Response>> = []
const fetchMock = vi.fn(() => (answers.shift() ?? (() => new Promise<Response>(() => {})))())
beforeEach(() => {
  answers = []
  AUTH.user = U1
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const panel = () => <LanguageProvider initialLang="en" initialViDict={{}}><DisputesPanel /></LanguageProvider>
const mount = () => render(panel())
const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }))
const mascot = (c: HTMLElement) => [...c.querySelectorAll('span[aria-hidden]')].find((s) => /mascots\//.test(s.getAttribute('style') ?? ''))
const FAULT = 'Couldn’t load your cases.'
const NOW = new Date().toISOString()
const CASE = {
  id: 'r1', role: 'reporter', reason: 'scam', status: 'open', stage: 'review', withdrawn: false, createdAt: NOW,
  evidenceUntil: null, lastActivityAt: NOW, messageCount: 0, listing: { id: 'l1', title: 'Studio in District 1', image: null },
}

describe('DisputesPanel', () => {
  it('no cases: "No disputes" under the lifebuoy mascot, at the height the skeleton kept', async () => {
    answers.push(json({ cases: [] }))
    const { container } = mount()
    await waitFor(() => expect(screen.getByText('No disputes')).toBeTruthy())
    expect(mascot(container)?.getAttribute('style')).toMatch(/mascots\/help\.svg/)
    expect(container.querySelector('[class*="min-h-[393px]"]')?.textContent).toMatch(/No disputes/)
  })

  it('a network failure is the fault with Try again — not "No disputes", and no mascot', async () => {
    answers.push(() => Promise.reject(new TypeError('Failed to fetch')))
    const { container } = mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(FAULT))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('No disputes')).toBeNull()
    expect(mascot(container)).toBeUndefined()
  })

  it('a 5xx is the fault, even when its body carries a `cases` list', async () => {
    answers.push(json({ cases: [] }, 500))
    mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(FAULT))
    expect(screen.queryByText('No disputes')).toBeNull()
  })

  it('a 2xx with no `cases` list is the fault, never an endless skeleton', async () => {
    answers.push(json({ ok: true }))
    mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(FAULT))
  })

  it('a 401 asks for sign-in again: the session is gone, so no Try again', async () => {
    answers.push(json({ error: 'unauthorized' }, 401))
    mount()
    await waitFor(() => expect(screen.getByText('Your session has expired')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('Try again loads again, and a good answer replaces the fault', async () => {
    answers.push(() => Promise.reject(new TypeError('Failed to fetch')), json({ cases: [] }))
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('No disputes')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an account switch never draws the previous account\'s cases — not even on the first render after it', async () => {
    answers.push(json({ cases: [CASE] }))
    const view = mount()
    await waitFor(() => expect(screen.getByText(/Studio in District 1/)).toBeTruthy())
    AUTH.user = { id: 'u2' } // the second account's answer never comes in this test
    view.rerender(panel())
    // Synchronously, before any effect could clear anything: the answer belongs to u1, so it is not drawn for u2.
    expect(screen.queryByText(/Studio in District 1/)).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('back to an account (A → B → A) never redraws A\'s OLD answer while A reloads', async () => {
    answers.push(json({ cases: [CASE] }))
    const view = mount()
    await waitFor(() => expect(screen.getByText(/Studio in District 1/)).toBeTruthy())
    AUTH.user = { id: 'u2' }
    view.rerender(panel())
    AUTH.user = { id: 'u1' } // A again; its reload never answers in this test
    view.rerender(panel())
    expect(screen.queryByText(/Studio in District 1/)).toBeNull()
  })

  it('signed out and back in as the same account: the old answer is gone too', async () => {
    answers.push(json({ error: 'unauthorized' }, 401))
    const view = mount()
    await waitFor(() => expect(screen.getByText('Your session has expired')).toBeTruthy())
    AUTH.user = null
    view.rerender(panel())
    AUTH.user = { id: 'u1' } // signed in again; the reload never answers in this test
    view.rerender(panel())
    expect(screen.queryByText('Your session has expired')).toBeNull()
  })

  it('a new user object for the SAME account (a token refresh) keeps the list and asks nothing again', async () => {
    answers.push(json({ cases: [CASE] }))
    const view = mount()
    await waitFor(() => expect(screen.getByText(/Studio in District 1/)).toBeTruthy())
    AUTH.user = { id: 'u1' }
    view.rerender(panel())
    expect(screen.getByText(/Studio in District 1/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed load keeps the height the skeleton held', async () => {
    answers.push(json({ error: 'boom' }, 500))
    const { container } = mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(FAULT))
    expect(container.querySelector('[class*="min-h-[393px]"]')?.textContent).toMatch(/Couldn’t load your cases/)
  })

  it('the loading rows hold the empty state\'s measured height (no footer jump when it arrives)', () => {
    mount() // the fetch never answers
    const busy = document.querySelector('[class*="min-h-[393px]"]')
    expect(busy?.className).toMatch(/sm:min-h-\[409px\]/)
    expect(busy?.tagName).toBe('UL')
  })
})
