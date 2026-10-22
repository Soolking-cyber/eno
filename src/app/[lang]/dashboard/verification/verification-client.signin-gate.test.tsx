// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE VERIFICATION HUB SENDS A SIGNED-OUT VISITOR TO SIGN IN, like every sibling dashboard section. The KYC outcome
 * email links here, and an email is often opened in a browser with no session: the hub then drew step 1 as never
 * started ("Verify yourself") over an approval or a rejection reason, and step 2's panel a "Try again" that could only
 * 401 again. Signed out, nothing that needs the session is read or drawn.
 */

const h = vi.hoisted(() => ({
  // A stable object per test (the real context keeps its user between renders too).
  auth: { user: null as { id: string } | null, loading: false },
  replace: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: h.replace }), usePathname: () => '/dashboard/verification' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/components/marketplace/section-header', () => ({ SectionHeader: () => null }))
// Counts its mounts, so a test can tell a fresh panel from one that kept another account's state.
const panel = vi.hoisted(() => ({ mounts: 0 }))
vi.mock('@/components/marketplace/business-verification-panel', async () => {
  const React = await import('react')
  return {
    BusinessVerificationPanel: () => {
      React.useEffect(() => { panel.mounts++ }, [])
      return <div data-testid="business-panel" />
    },
  }
})
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => false }))

const { VerificationClient } = await import('./verification-client')

const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'unverified', gate: false }) }))

beforeEach(() => {
  h.auth = { user: null, loading: false }
  h.replace.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState(null, '', '/dashboard/verification')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open() {
  render(<VerificationClient />)
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}

describe('verification hub — the sign-in gate', () => {
  it('⛔ signed out: straight to sign-in, back here after — no status read, no "Verify yourself", no step-2 panel', async () => {
    await open()
    expect(h.replace).toHaveBeenCalledWith('/signin?next=%2Fdashboard%2Fverification')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Verify yourself' })).toBeNull()
    expect(screen.queryByTestId('business-panel')).toBeNull()
    // What shows meanwhile is the loading shape, not a verdict.
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeTruthy()
  })

  it('while the session is still resolving: no redirect and no read yet', async () => {
    h.auth = { user: null, loading: true }
    await open()
    expect(h.replace).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('business-panel')).toBeNull()
  })

  it('a query on the way in survives sign-in', async () => {
    window.history.replaceState(null, '', '/dashboard/verification?from=email')
    await open()
    expect(h.replace).toHaveBeenCalledWith('/signin?next=%2Fdashboard%2Fverification%3Ffrom%3Demail')
  })

  /**
   * ⚠️ A DIFFERENT ACCOUNT NEVER SEES THE LAST ONE'S VERDICT (commit-gate review, 2026-10-22). The hub is keyed on the
   * account, so the change is a fresh hub IN THE SAME RENDER — asserted right after the rerender, with no wait for an
   * effect — and a read that answers after the account changed lands on the replaced hub, never on the new one.
   */
  it('⚠️ signing out drops the last account’s verdict in the same render', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'rejected', reason: 'blurry', note: 'A’s private note', gate: false }) }))
    h.auth = { user: { id: 'a' }, loading: false }
    const view = render(<VerificationClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.body.textContent).toContain('A’s private note')
    h.auth = { user: null, loading: false }
    view.rerender(<VerificationClient />)
    expect(document.body.textContent).not.toContain('A’s private note')
    expect(screen.queryByTestId('business-panel')).toBeNull()
  })

  it('⚠️ a switch from account A to B is a fresh hub: no A verdict in the first B render, and the business panel is remounted', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'rejected', reason: 'blurry', note: 'A’s private note', gate: false }) }))
    h.auth = { user: { id: 'a' }, loading: false }
    const view = render(<VerificationClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.body.textContent).toContain('A’s private note')
    const mountsForA = panel.mounts
    h.auth = { user: { id: 'b' }, loading: false }
    view.rerender(<VerificationClient />)
    expect(document.body.textContent).not.toContain('A’s private note')
    expect(panel.mounts).toBe(mountsForA + 1)
  })

  it('⚠️ a read that answers after the account changed is dropped', async () => {
    let answerA: (v: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise((r) => { answerA = r as (v: unknown) => void }))
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'verified', gate: false }) }))
    h.auth = { user: { id: 'a' }, loading: false }
    const view = render(<VerificationClient />)
    h.auth = { user: { id: 'b' }, loading: false }
    view.rerender(<VerificationClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    // A's read answers last, with A's rejection — B's screen must not take it.
    await act(async () => {
      answerA({ ok: true, status: 200, json: () => Promise.resolve({ status: 'rejected', reason: 'blurry', note: 'A’s private note', gate: false }) })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(document.body.textContent).not.toContain('A’s private note')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('signed in: the status is read and both steps are drawn, as before', async () => {
    h.auth = { user: { id: 'p1' }, loading: false }
    await open()
    expect(h.replace).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/seller/identity/status', { cache: 'no-store' })
    expect(screen.getByRole('link', { name: 'Verify yourself' }).getAttribute('href')).toBe('/dashboard/account/verify')
    expect(screen.getByTestId('business-panel')).toBeTruthy()
  })
})
