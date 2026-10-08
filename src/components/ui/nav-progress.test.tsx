// @vitest-environment jsdom
import * as React from 'react'
import { Suspense, startTransition, use, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavProgress } from './nav-progress'
import { onRouterTransitionStart } from '@/instrumentation-client'

/**
 * FAST-2 (UX3, 2026-10-05): one app-wide bar while a client navigation is pending. These drive it the way
 * Next does — `onRouterTransitionStart` called INSIDE the navigation's startTransition, while the router's
 * state update suspends on the pending page — and pin when it leaves: on commit, on popstate, on a bfcache
 * restore — never on an unrelated error. When it is SEEN (after 400ms, swept, reduced motion) is CSS, pinned at the end.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

afterEach(cleanup)

const bar = () => document.querySelector('[data-nav-progress]')

/** A stand-in for Next's router: its state is a promise the page "suspends" on until the server answers. */
function Router({ expose }: { expose: (go: (p: Promise<string>) => void) => void }) {
  const [page, setPage] = useState<Promise<string>>(() => Promise.resolve('home'))
  expose((p) => setPage(p))
  return <Page page={page} />
}
function Page({ page }: { page: Promise<string> }) {
  return <p data-page>{use(page)}</p>
}

function setup() {
  let navigate!: (p: Promise<string>) => void
  const view = render(
    <>
      <NavProgress />
      <Suspense fallback={null}>
        <Router expose={(go) => { navigate = go }} />
      </Suspense>
    </>,
  )
  /**
   * A <Link> tap: Next's hook runs inside the same transition that sets the router's pending state. Returns
   * the server's answer — awaiting it commits the new page. (Awaited `act` both ways: the transition
   * suspends on the pending page, and React retries it only from an awaited scope.)
   */
  const tap = async (type: 'push' | 'replace' = 'push') => {
    let resolve!: (v: string) => void
    const next = new Promise<string>((r) => { resolve = r })
    await act(async () => {
      startTransition(() => {
        onRouterTransitionStart('/listings/x', type)
        navigate(next)
      })
    })
    return async () => { await act(async () => { resolve('listing') }) }
  }
  return { view, tap }
}

describe('NavProgress', () => {
  it('renders nothing while idle', async () => {
    await act(async () => { setup() })
    expect(bar()).toBeNull()
  })

  it('is there for the whole pending window and leaves when the navigation commits', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    const commit = await s.tap()
    expect(bar()).not.toBeNull()
    expect(bar()!.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('[data-page]')!.textContent).toBe('home') // the old page stays up meanwhile
    await commit()
    expect(document.querySelector('[data-page]')!.textContent).toBe('listing')
    expect(bar()).toBeNull()
  })

  it('a replace (router.replace) counts; back/forward does not show it', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    const commit = await s.tap('replace')
    expect(bar()).not.toBeNull()
    await commit()
    act(() => { startTransition(() => { onRouterTransitionStart('/', 'traverse') }) })
    expect(bar()).toBeNull()
  })

  it('popstate clears it at once, though the navigation it belonged to never settles — and the next tap shows it again', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    await s.tap()
    expect(bar()).not.toBeNull()
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(bar()).toBeNull()
    const commit = await s.tap()
    expect(bar()).not.toBeNull()
    await commit()
    expect(bar()).toBeNull()
  })

  it('a bfcache restore (pageshow, persisted) clears it; an ordinary pageshow does not', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    await s.tap()
    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false })) })
    expect(bar()).not.toBeNull()
    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })) })
    expect(bar()).toBeNull()
  })

  it('an UNRELATED script error or rejected promise does not hide it (codex + opus, gate 2026-10-05)', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    await s.tap()
    act(() => { window.dispatchEvent(new Event('error')) })
    act(() => { window.dispatchEvent(new Event('unhandledrejection')) })
    expect(bar()).not.toBeNull()
  })

  it('a navigation that never settles is removed at 16 s — no invisible sweep left running (codex, gate)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let s!: ReturnType<typeof setup>
      await act(async () => { s = setup() })
      await s.tap()
      expect(bar()).not.toBeNull()
      act(() => { vi.advanceTimersByTime(15_900) })
      expect(bar()).not.toBeNull()
      act(() => { vi.advanceTimersByTime(200) })
      expect(bar()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a second navigation during a slow one gets its OWN element, so its delay and sweep start fresh', async () => {
    let s!: ReturnType<typeof setup>
    await act(async () => { s = setup() })
    await s.tap()
    const first = bar()
    expect(first).not.toBeNull()
    await s.tap()
    const second = bar()
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
  })

  it('a start reported outside any transition never leaves a bar behind', async () => {
    await act(async () => { setup() })
    act(() => { onRouterTransitionStart('/x', 'push') })
    expect(bar()).toBeNull()
  })
})

describe('when it is seen is CSS (globals.css) — and the one mount', () => {
  const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

  it('hidden for the first 400ms (fast navigations show nothing), faded out at 15s whatever happens', () => {
    expect(CSS).toMatch(/\.nav-progress \{\s*animation:\s*nav-progress-in 160ms ease-out 400ms both,\s*nav-progress-out 240ms var\(--ease-out-strong\) 15s forwards;/) // an exit eases OUT (Emil audit, tier 4)
    expect(CSS).toMatch(/@keyframes nav-progress-in \{\s*from \{ opacity: 0; \}/)
  })

  it('an indeterminate sweep — and under reduced motion a full bar that pulses instead of travelling', () => {
    expect(CSS).toMatch(/\.nav-progress-bar \{\s*animation: nav-progress-sweep [^;]* infinite;/)
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.nav-progress-bar \{\s*width: 100% !important;\s*transform: none !important;\s*animation: reduced-motion-pulse 1\.6s ease-in-out infinite !important;/)
    // The pulse it borrows is the kill switch's own loader pulse.
    expect(CSS).toMatch(/@keyframes reduced-motion-pulse/)
  })

  it('is mounted exactly once, in the providers the root layout renders on every page', () => {
    const PROVIDERS = readFileSync(join(process.cwd(), 'src/app/[lang]/providers.tsx'), 'utf8')
    expect(PROVIDERS.match(/<NavProgress \/>/g)).toHaveLength(1)
  })
})
