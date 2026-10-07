// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ── UX3 J5: the PDP composer finishes a guest's chat / offer after sign-in — and never sends by itself ──

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (t: string) => t }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, prefetch: vi.fn(), replace: vi.fn() }) }))
const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  identityLoaded: false,
  accountType: null as string | null,
  openSignIn: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))

import { ContactComposer } from './contact-composer'
import { COMPOSE_KEY } from '@/lib/quick-contact'
import { __resetPendingIntentForTests, armIntent, readIntent, writeIntent } from '@/lib/pending-intent'

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

const OPENER = 'Hi! Is this still available?'
const composer = (props: Partial<React.ComponentProps<typeof ContactComposer>> = {}) =>
  render(<ContactComposer listingId="l1" listingTitle="Sofa" sellerName="An" currency="₫" price={1_000_000} negotiable {...props} />)
const signedIn = () => { auth.user = { id: 'u1' }; auth.identityLoaded = true; auth.accountType = 'individual' }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetPendingIntentForTests()
  auth.user = null
  auth.loading = false
  auth.identityLoaded = false
  auth.accountType = null
  auth.openSignIn.mockReset()
  push.mockReset()
  window.history.replaceState(null, '', '/listings/l1')
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the guest gates remember what was asked', () => {
  it('⛔ Chat now → sign-in with the "chat" gate and the opener as the pending intent', () => {
    composer()
    fireEvent.click(screen.getByRole('button', { name: /Chat now/ }))
    const ctx = auth.openSignIn.mock.calls[0][0]
    expect(ctx).toMatchObject({ gate: 'chat', listingTitle: 'Sofa' })
    expect(ctx.resume).toMatchObject({ kind: 'chat', payload: { listingId: 'l1', body: OPENER }, path: '/listings/l1' })
    expect(readIntent()?.nonce).toBe(ctx.resume.nonce)
  })

  it('"Sign in to make an offer" → the "offer" gate, no amount chosen yet', () => {
    composer()
    fireEvent.click(screen.getByRole('button', { name: /Sign in to make an offer/ }))
    expect(auth.openSignIn.mock.calls[0][0]).toMatchObject({ gate: 'offer', resume: { kind: 'offer', payload: { listingId: 'l1', offerAmount: null } } })
  })
})

describe('after sign-in, the composer finishes it — one tap, never by itself', () => {
  it('⛔ a chat proven by the sign-in return (resume=chat in the address): the opener ready, nothing sent until "Send"', async () => {
    writeIntent('chat', { listingId: 'l1', body: 'Chào bạn! Món này còn không?' }, '/listings/l1')
    window.history.replaceState(null, '', '/listings/l1?resume=chat')
    signedIn()
    composer()
    await settle()
    expect(screen.getByText('You’re signed in — send your message?')).toBeTruthy()
    expect(screen.getByText('Chào bạn! Món này còn không?')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(COMPOSE_KEY)).toBeNull()
    expect(window.location.search).toBe('') // the marker left the address
    expect(readIntent()).toBeNull() // spent
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(push).toHaveBeenCalledWith('/messages/pending')
    expect(JSON.parse(sessionStorage.getItem(COMPOSE_KEY)!)).toMatchObject({ listingId: 'l1', body: 'Chào bạn! Món này còn không?' })
    // The spinner is on the Send that was pressed, not on the offer row's Chat now (which only goes inert).
    expect(screen.getByRole('button', { name: /Chat now/ }).getAttribute('aria-busy')).not.toBe('true')
    expect(screen.getByRole('button', { name: /Chat now/ }).getAttribute('aria-disabled')).toBe('true')
  })

  it('an ARMED chat (signed in inside its own popup — no address marker) is finished the same way', async () => {
    const it = writeIntent('chat', { listingId: 'l1', body: OPENER }, '/listings/l1')
    armIntent(it.nonce)
    signedIn()
    composer()
    await settle()
    expect(screen.getByText('You’re signed in — send your message?')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('⛔ an offer from a card: the offer reopens at ITS amount (−10%), with a line saying it is their turn — not sent', async () => {
    writeIntent('offer', { listingId: 'l1', offerAmount: 900_000 }, '/listings/l1')
    window.history.replaceState(null, '', '/listings/l1?resume=offer')
    signedIn()
    composer()
    await settle()
    expect(screen.getByText('You’re signed in — check your offer, then tap Send offer.')).toBeTruthy()
    expect(document.body.textContent).toContain('−10%')
    expect(push).not.toHaveBeenCalled()
  })

  it('⛔ resume=chat with NOTHING stored (a crafted link; a magic link’s new tab): the default opener, one tap — nothing acted on', async () => {
    window.history.replaceState(null, '', '/listings/l1?resume=chat')
    signedIn()
    composer()
    await settle()
    expect(screen.getByText(OPENER)).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('an intent nobody proved (no marker, not armed), or another listing’s, does nothing here', async () => {
    writeIntent('chat', { listingId: 'l1', body: OPENER }, '/listings/l1')
    signedIn()
    composer()
    await settle()
    expect(screen.queryByText('You’re signed in — send your message?')).toBeNull()
    cleanup()
    const other = writeIntent('chat', { listingId: 'l2', body: OPENER }, '/listings/l2')
    armIntent(other.nonce)
    composer()
    await settle()
    expect(screen.queryByText('You’re signed in — send your message?')).toBeNull()
    expect(readIntent()?.nonce).toBe(other.nonce) // still l2's, for l2's page
  })

  it('waits for the profile (identity + account type) — a new account goes through /onboard first', async () => {
    const it = writeIntent('chat', { listingId: 'l1', body: OPENER }, '/listings/l1')
    armIntent(it.nonce)
    auth.user = { id: 'u1' }
    const r = composer()
    await settle()
    expect(screen.queryByText('You’re signed in — send your message?')).toBeNull()
    auth.identityLoaded = true
    auth.accountType = 'individual'
    r.rerender(<ContactComposer listingId="l1" listingTitle="Sofa" sellerName="An" currency="₫" price={1_000_000} negotiable />)
    await settle()
    expect(screen.getByText('You’re signed in — send your message?')).toBeTruthy()
  })

  it('a guest who lands on a resume= link: the marker is removed, nothing is shown', async () => {
    window.history.replaceState(null, '', '/listings/l1?resume=chat')
    composer()
    await settle()
    expect(window.location.search).toBe('')
    expect(screen.queryByText('You’re signed in — send your message?')).toBeNull()
  })
})
