// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ── UX3 J7f: the app-install card and the "Join eno" prompt never ask in the same page view ─────────
// ── and, since 2026-10-18 (owner: "one per visit, no floaters"), the visit's one interruption ────────

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
}))
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
vi.mock('@/components/marketplace/art-image', () => ({ ArtImage: () => null }))
// Has the visitor answered the cookie consent? The card never asks while it is unanswered (the bar is due then).
const consent = vi.hoisted(() => ({ answered: true }))
vi.mock('@/lib/consent', () => ({ consentAnswered: () => consent.answered }))

import { InstallHint } from './install-hint'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk, noteSessionAsk, sessionAsk } from '@/lib/page-asks'

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
const card = () => screen.queryByRole('dialog', { name: 'Get the eno app' })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetPageAsksForTests()
  nav.pathname = '/'
  consent.answered = true
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('InstallHint × the join prompt', () => {
  it('shows at its usual time when nothing else asked in this visit — and takes the visit: the prompt may not', async () => {
    render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
    expect(card()).not.toBeNull()
    expect(sessionAsk()).toBe('install')
    expect(mayAsk('join', '/')).toBe(false)
    expect(mayAsk('join', '/c/phones')).toBe(false) // not on the next page either: the whole session
  })

  it('⛔ due after the join prompt asked in this visit: it waits for a later session — the next page is not enough', async () => {
    askShown('join', '/')
    const r = render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
    expect(card()).toBeNull()
    askHidden('join') // closed — but it had this session
    nav.pathname = '/c/phones'
    r.rerender(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(card()).toBeNull()
  })
})

describe('InstallHint × the cookie bar (owner, 2026-10-18: one per visit)', () => {
  it('⛔ never while the consent is unanswered — the bar is due in this session, and it is the law\'s', async () => {
    consent.answered = false
    const r = render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(card()).toBeNull()
    nav.pathname = '/c/phones'
    r.rerender(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(card()).toBeNull()
  })

  it('⛔ a session the bar appeared in gets no card, even once the consent is answered', async () => {
    noteSessionAsk('consent') // what cookie-consent.tsx records when its bar shows on its own
    const r = render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
    expect(card()).toBeNull()
    nav.pathname = '/c/phones'
    r.rerender(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(card()).toBeNull()
  })
})
