// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── UX3 J1 + J5: the provider classifies and counts each sign-in gate, and binds a gate's pending
// action to its own popup (dropped on close, armed by a sign-in inside it, a card's taken to its listing).

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  push: vi.fn(),
  replace: vi.fn(),
  pathname: '/',
}))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => { h.authCb = cb; return { data: { subscription: { unsubscribe: () => {} } } } },
    },
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: h.push, refresh: vi.fn() }),
  usePathname: () => h.pathname,
}))
vi.mock('@/lib/analytics', () => ({ trackSignUp: vi.fn() }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: () => Promise.resolve() }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function Popup(p: { open: boolean; onOpenChange: (o: boolean) => void; gate?: string; resume?: { nonce: string } | null }) {
      return (
        <div data-testid="popup" data-open={p.open ? 'yes' : 'no'} data-gate={p.gate ?? ''} data-resume={p.resume?.nonce ?? ''}>
          <button type="button" onClick={() => p.onOpenChange(false)}>visitor closes</button>
        </div>
      )
    },
}))

import { AuthProvider, useAuth } from './auth-context'
import { __resetPendingIntentForTests, readIntent, writeIntent } from '@/lib/pending-intent'
import { GATE_RECORD_KEY } from '@/lib/signin-gates'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
let beacons: Array<Record<string, string>> = []

const onReplaced = vi.fn()
const onPromptDismiss = vi.fn()
function Probe() {
  const { openSignIn } = useAuth()
  return (
    <>
      <header id="app-header"><button type="button" onClick={() => openSignIn()}>header sign in</button></header>
      <button type="button" onClick={() => openSignIn()}>plain</button>
      <button type="button" onClick={() => openSignIn({ prompt: { onReplaced, onDismiss: onPromptDismiss } })}>join</button>
      <button
        type="button"
        onClick={() => openSignIn({ listingTitle: 'Sofa', gate: 'chat', resume: writeIntent('chat', { listingId: 'l9', body: 'hi' }, '/listings/l9', { away: true }) })}
      >card chat</button>
      <button
        type="button"
        onClick={() => openSignIn({ listingTitle: 'Sofa', gate: 'chat', resume: writeIntent('chat', { listingId: 'l9', body: 'hi' }, '/listings/l9') })}
      >pdp chat</button>
    </>
  )
}
const press = (name: string) => act(async () => {
  const b = screen.getByRole('button', { name })
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  b.click()
})
const popup = () => screen.getByTestId('popup')
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(url === '/api/me' ? { user: { id: 'u1', accountType: 'individual', sellerId: null } } : {}),
  })))
  __resetPendingIntentForTests()
  onReplaced.mockReset()
  onPromptDismiss.mockReset()
  beacons = []
  h.authCb = null
  h.push.mockReset()
  h.replace.mockReset()
  h.pathname = '/'
  window.history.replaceState(null, '', '/')
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_u: string, b: Blob) => { void b.text().then((t) => beacons.push(JSON.parse(t))); return true },
  })
  render(<AuthProvider><Probe /></AuthProvider>)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AuthProvider — which gate asked, counted once per opening (UX3 J1)', () => {
  it('a named gate reaches the popup and is counted as an opening', async () => {
    await press('card chat')
    await settle()
    expect(popup().dataset.gate).toBe('chat')
    expect(beacons).toContainEqual(expect.objectContaining({ g: 'chat', a: 'open' }))
  })

  it('a sign-in opened from the header is the "nav" gate; one with no clue is "other"', async () => {
    await press('header sign in')
    expect(popup().dataset.gate).toBe('nav')
    await press('visitor closes')
    await press('plain')
    expect(popup().dataset.gate).toBe('other')
  })

  it('⛔ the timed prompt is "timed" and sends no gate event — it counts itself', async () => {
    await press('join')
    await settle()
    expect(popup().dataset.gate).toBe('timed')
    expect(beacons.filter((b) => b.g)).toEqual([])
  })

  it('⛔ eno:require-signin opens the popup even as the FIRST open (it never set everOpened) — an "other" gate', async () => {
    await act(async () => { window.dispatchEvent(new Event('eno:require-signin')) })
    expect(popup().dataset.open).toBe('yes')
    expect(popup().dataset.gate).toBe('other')
  })
})

describe('AuthProvider — a gate’s pending action is bound to its own popup (UX3 J5)', () => {
  it('⛔ closed without signing in: the action is dropped', async () => {
    await press('card chat')
    expect(readIntent()).not.toBeNull()
    await press('visitor closes')
    expect(readIntent()).toBeNull()
  })

  it('⛔ an unrelated sign-in (an ask without a resume) supersedes a pending one', async () => {
    writeIntent('saveSearch', { params: { q: 'sofa' } }, '/?q=sofa')
    await press('plain')
    expect(readIntent()).toBeNull()
  })

  it('⛔ signed in INSIDE its popup: armed — and a card’s chat takes the visitor to its listing, once', async () => {
    await press('card chat')
    await settle()
    expect(h.authCb).not.toBeNull()
    await act(async () => { h.authCb!('SIGNED_IN', { user: { id: 'u1', created_at: '2020-01-01T00:00:00Z' }, access_token: 'a', refresh_token: 'r' }) })
    await settle()
    expect(readIntent()).toMatchObject({ armed: true, routed: true, path: '/listings/l9' })
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.push).toHaveBeenCalledWith('/listings/l9')
  })

  it('⛔ a chat asked on the listing’s OWN page is never routed anywhere (only a card’s, "away", is)', async () => {
    await press('pdp chat')
    await settle()
    await act(async () => { h.authCb!('SIGNED_IN', { user: { id: 'u1' }, access_token: 'a', refresh_token: 'r' }) })
    h.pathname = '/c/phones' // the visitor moved on before the profile loaded
    await settle()
    expect(readIntent()).toMatchObject({ armed: true })
    expect(h.push).not.toHaveBeenCalled()
  })

  it('⛔ a gate method followed by a sign-in is that gate’s completion, counted once', async () => {
    localStorage.setItem(GATE_RECORD_KEY, JSON.stringify({ g: 'save_search', at: Date.now() - 60_000 }))
    await press('plain')
    await settle()
    await act(async () => { h.authCb!('SIGNED_IN', { user: { id: 'u1' }, access_token: 'a', refresh_token: 'r' }) })
    await settle()
    expect(beacons).toContainEqual(expect.objectContaining({ g: 'save_search', a: 'completed' }))
    expect(localStorage.getItem(GATE_RECORD_KEY)).toBeNull()
  })
})

describe('AuthProvider — the "Join eno" ask taken over by another sign-in (review, 2026-10-05)', () => {
  it('⛔ another open while the prompt is up tells it so (onReplaced) — and is never reported as its dismissal', async () => {
    await press('join')
    await settle()
    await act(async () => { window.dispatchEvent(new Event('eno:require-signin')) })
    expect(onReplaced).toHaveBeenCalledTimes(1)
    await press('visitor closes')
    expect(onPromptDismiss).not.toHaveBeenCalled()
  })

  it('a plain open after the prompt was CLOSED replaces nothing', async () => {
    await press('join')
    await press('visitor closes')
    await press('plain')
    expect(onReplaced).not.toHaveBeenCalled()
  })
})
