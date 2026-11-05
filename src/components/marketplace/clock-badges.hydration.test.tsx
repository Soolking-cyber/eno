// @vitest-environment jsdom
/**
 * THESE TWO CLIENT-CLOCK BADGES NEVER MISMATCH THEIR SERVER HTML ON AN ISR PAGE (Emil-skills audit, 2026-10-06).
 *
 * The PDP and the feeds are ISR-cached, so the HTML was rendered at GENERATION time and is hydrated at the
 * visitor's NOW. Two components read `Date.now()` during render and so disagreed with their own HTML once
 * the page aged: the price-drop "N days left" suffix (and its element, once the window lapsed) and the card's
 * "Just in" chip (under 24h at generation, older now). A structural mismatch makes React throw the server HTML
 * away and client-render the region. The countdown is decided after mount (use-mounted.ts). The "New" chip and the
 * relative time are now in the HTML and correct themselves with no state and no render (speed audit, 2026-11-03):
 * the chip is decided where the row is serialized, and hides itself when the HTML has outlived it.
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
const { RelativeTime } = await import('./relative-time')

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
  const listing = (postedAt: number, isNew: boolean | undefined) => ({ urgent: false, prevPrice: null, price: 1_000_000, postedAt: new Date(postedAt).toISOString(), listingType: 'sell', isNew }) as never
  const chip = () => document.body.querySelector('span')

  it('⛔ a listing that was new at generation and is not now hydrates without a mismatch, and its chip hides itself', async () => {
    const r = await renderThenHydrate(<CardBadges listing={listing(GENERATED - 3_600_000, true)} />, GENERATED, GENERATED + 3 * DAY)
    expect(r.html).toContain('Just in')
    expect(r.recoverable).toEqual([])
    expect(chip()?.hidden).toBe(true)
  })

  it('a listing still under 24h has its chip in the first paint, and keeps it', async () => {
    const r = await renderThenHydrate(<CardBadges listing={listing(GENERATED - 3_600_000, true)} />, GENERATED, GENERATED + 3_600_000)
    expect(r.html).toContain('Just in')
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('Just in')
    expect(chip()?.hidden).toBe(false)
  })

  it('⛔ in HTML that lives for weeks the chip claims nothing until the clock agrees', async () => {
    const stale = await renderThenHydrate(<CardBadges chipInHtml={false} listing={listing(GENERATED - 3_600_000, true)} />, GENERATED, GENERATED + 3 * DAY)
    expect(stale.html).toContain('hidden')
    expect(stale.html).not.toContain('Just in')
    expect(stale.recoverable).toEqual([])
    expect(chip()?.hidden).toBe(true)
    document.body.innerHTML = ''
    const fresh = await renderThenHydrate(<CardBadges chipInHtml={false} listing={listing(GENERATED - 3_600_000, true)} />, GENERATED, GENERATED + 3_600_000)
    expect(fresh.html).not.toContain('Just in')
    expect(fresh.recoverable).toEqual([])
    expect(chip()?.hidden).toBe(false)
    expect(fresh.text).toBe('Just in')
  })

  it('no chip when the row says no, or when a row kept from before the field does not say', async () => {
    for (const isNew of [false, undefined]) {
      const r = await renderThenHydrate(<CardBadges listing={listing(GENERATED - 3_600_000, isNew)} />, GENERATED, GENERATED)
      expect(r.html).not.toContain('Just in')
      expect(r.text).toBe('')
    }
  })
})

describe('RelativeTime on a page generated days earlier', () => {
  const iso = new Date(GENERATED - 3_600_000).toISOString()

  it('⛔ by default the HTML says the calendar day: a 30-day page must not tell a crawler "1h ago" for a month', async () => {
    const r = await renderThenHydrate(<RelativeTime iso={iso} />, GENERATED, GENERATED + 3 * DAY)
    expect(r.html).not.toContain('ago')
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('3d ago')
  })

  it('⛔ on a feed the label is in the first paint, hydrates without a mismatch, and is corrected in place', async () => {
    const r = await renderThenHydrate(<RelativeTime iso={iso} inHtml />, GENERATED, GENERATED + 3 * DAY)
    expect(r.html).toContain('1h ago')
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('3d ago')
  })

  it('a label that still reads true is left alone', async () => {
    const r = await renderThenHydrate(<RelativeTime iso={iso} inHtml />, GENERATED, GENERATED + 60_000)
    expect(r.recoverable).toEqual([])
    expect(r.text).toBe('1h ago')
  })
})
