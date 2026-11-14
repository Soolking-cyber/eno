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

// ⛔ "JUST IN" IS GONE (owner-approved 2026-11-14, cook r05: '"Just in" → hidden'): never rendered, on the server or the client,
// so it can no longer mismatch. What is left on the photo — Urgent and the price drop — reads no clock at all.
describe('CardBadges on a feed generated days earlier', () => {
  const listing = (patch: Record<string, unknown>) => ({ urgent: false, prevPrice: null, price: 1_000_000, postedAt: new Date(GENERATED - 3_600_000).toISOString(), listingType: 'sell', isNew: true, ...patch }) as never

  it('⛔ a fresh listing (isNew) renders no "Just in" / "Mới đăng" — not in the server HTML, not after hydration', async () => {
    for (const clientNow of [GENERATED + 3_600_000, GENERATED + 3 * DAY]) {
      const r = await renderThenHydrate(<CardBadges listing={listing({})} />, GENERATED, clientNow)
      expect(r.html).toBe('')
      expect(r.recoverable).toEqual([])
      expect(r.text).toBe('')
      expect(r.text).not.toContain('Just in')
      expect(r.html).not.toContain('Mới đăng')
      document.body.innerHTML = ''
    }
  })

  it('Urgent and a price drop hydrate identically whatever the clock says, as the white photo pill', async () => {
    for (const patch of [{ urgent: true }, { prevPrice: 1_500_000 }]) {
      const r = await renderThenHydrate(<CardBadges listing={listing(patch)} />, GENERATED, GENERATED + 3 * DAY)
      expect(r.recoverable).toEqual([])
      expect(r.html).toContain('photo-badge')
      expect(r.text).toBe(new DOMParser().parseFromString(r.html, 'text/html').body.textContent)
      document.body.innerHTML = ''
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
