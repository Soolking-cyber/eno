// @vitest-environment jsdom
/**
 * THESE TWO CLIENT-CLOCK BADGES NEVER MISMATCH THEIR SERVER HTML ON AN ISR PAGE (Emil-skills audit, 2026-10-06).
 *
 * The PDP and the feeds are ISR-cached, so the HTML was rendered at GENERATION time and is hydrated at the
 * visitor's NOW. Two components read `Date.now()` during render and so disagreed with their own HTML once
 * the page aged: the price-drop "N days left" suffix (and its element, once the window lapsed) and the card's
 * "New" chip (under 48h at generation, older now). A structural mismatch makes React throw the server HTML
 * away and client-render the region. Each is now decided after mount (use-mounted.ts), as RelativeTime and
 * LiveUntil already were.
 *
 * The test renders on the server at one time and hydrates at a later one, collecting recoverable errors —
 * a hydration mismatch is one — and then checks what the live clock shows after mount.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
}))

const { DropCountdown } = await import('./drop-countdown')
const { CardBadges } = await import('./card-badges')

const DAY = 86_400_000
const GENERATED = Date.parse('2026-10-01T12:00:00.000Z')
const roots: Root[] = []

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** Server-render at `serverNow`, hydrate the same element at `clientNow`; return the errors and the result. */
async function renderThenHydrate(element: React.ReactElement, serverNow: number, clientNow: number) {
  const now = vi.spyOn(Date, 'now').mockReturnValue(serverNow)
  const html = renderToString(element)
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  now.mockReturnValue(clientNow)
  const recoverable: unknown[] = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await act(async () => {
    roots.push(hydrateRoot(container, element, { onRecoverableError: (e) => { recoverable.push(e) } }))
  })
  return { html, recoverable, text: container.textContent ?? '' }
}

describe('DropCountdown on a page generated days earlier', () => {
  const expiresAt = new Date(GENERATED + 2.5 * DAY).toISOString()

  it('⛔ a window that has LAPSED since generation hydrates without a mismatch, and shows nothing', async () => {
    const r = await renderThenHydrate(<DropCountdown expiresAt={expiresAt} />, GENERATED, GENERATED + 3 * DAY)
    expect(r.html).toBe('') // the server never commits to a count the visitor's clock may contradict
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('')
  })

  it('a window still open shows the LIVE count after mount', async () => {
    const r = await renderThenHydrate(<DropCountdown expiresAt={expiresAt} />, GENERATED, GENERATED + DAY)
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('· 2 days left')
  })
})

describe('CardBadges "New" on a feed generated days earlier', () => {
  const listing = (postedAt: number) => ({ urgent: false, prevPrice: null, price: 1_000_000, postedAt: new Date(postedAt).toISOString(), listingType: 'sell' }) as never

  it('⛔ a listing that was new at generation and is not now hydrates without a mismatch, and has no chip', async () => {
    const r = await renderThenHydrate(<CardBadges listing={listing(GENERATED - 3_600_000)} />, GENERATED, GENERATED + 3 * DAY)
    expect(r.html).not.toContain('New')
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('')
  })

  it('a listing still under 48h gets its "New" chip after mount', async () => {
    const r = await renderThenHydrate(<CardBadges listing={listing(GENERATED - 3_600_000)} />, GENERATED, GENERATED + 3_600_000)
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('New')
  })
})
