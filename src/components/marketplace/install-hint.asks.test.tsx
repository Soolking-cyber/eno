// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// ── UX3 J7f: the app-install card and the "Join eno" prompt never ask in the same page view ─────────

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
}))
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
vi.mock('@/components/marketplace/art-image', () => ({ ArtImage: () => null }))

import { InstallHint } from './install-hint'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk } from '@/lib/page-asks'

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
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('InstallHint × the join prompt', () => {
  it('shows at its usual time when nothing else asked on this page — and then the prompt may not', async () => {
    render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
    expect(card()).not.toBeNull()
    expect(mayAsk('join', '/')).toBe(false)
  })

  it('⛔ due while the join prompt was asked in this page view: waits, and appears on the next page instead', async () => {
    askShown('join', '/')
    const r = render(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000) })
    expect(card()).toBeNull()
    askHidden('join') // closed — but it asked in this page view
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(card()).toBeNull()
    nav.pathname = '/c/phones'
    r.rerender(<InstallHint />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(card()).not.toBeNull()
  })
})
