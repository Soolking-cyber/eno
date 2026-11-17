// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

/**
 * ⛔ THE HOME PAGE SENDS "OUTSTANDING BUSINESSES" AS IDS (owner, 2026-11-17 — src/lib/home-lanes.ts slimHomeRails): the first
 * paint draws none of its cards, so it carries none. The rail keeps its same-size placeholders and asks GET /api/home/cards
 * for them once they are due — the phone lane when its gate opens, the desktop shelf when it mounts — in the server's order;
 * a card the server no longer shows leaves its place, never the rail (the floor is the first paint's). One more try 5 s after
 * a failure; past that the rail is LOST (shelf.tsx useLostPlace): it leaves once wholly below the screen, and asks again each
 * time it comes back on screen (5 s apart, four asks in all). A whole seed (or none) works exactly as before.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string; titleI18n?: Record<string, string> } }) => (
    <i data-card={listing.id} data-title={listing.title} data-i18n={Object.keys(listing.titleI18n ?? {}).sort().join(',')} />
  ),
}))
/** The reader's UI language: a test switches it and re-renders, as the language context does. */
const ui = vi.hoisted(() => ({ lang: 'ko' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: ui.lang, tr: (en: string) => en, t: (en: string) => en }) }))

import { BusinessRail } from './business-rail'

const card = (id: string) => ({ id, title: `Card ${id}`, sellerId: `s-${id}`, images: [] }) as unknown as SerializedListingCard
const ids = (...xs: string[]) => xs.map((id) => ({ id }))

let answer: { ok: boolean; body: unknown }
type Obs = { cb: (e: unknown[]) => void; el?: Element }
let observers: Obs[] = []
const asks = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
const drawn = (el: Element) => [...el.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))
const placeholders = (el: Element) => el.querySelectorAll('.skeleton-photo').length

beforeEach(() => {
  ui.lang = 'ko'
  answer = { ok: true, body: { cards: [] } }
  observers = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class {
    o: Obs
    constructor(cb: (e: unknown[]) => void) { this.o = { cb }; observers.push(this.o) }
    observe(el: Element) { this.o.el = el }
    unobserve() {}
    disconnect() { this.o.el = undefined }
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: answer.ok, json: async () => answer.body }) as Response))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

/** Tell the observers on `tag` elements (the lane's scroller gate: DIV; the rail's place: SECTION) where their target is. */
const report = (tag: string, entry: Record<string, unknown>) => act(async () => { for (const o of [...observers]) if (o.el?.tagName === tag) o.cb([entry]) })
const open = () => report('DIV', { isIntersecting: true })
const onScreen = { isIntersecting: true, boundingClientRect: { top: 100, height: 400 }, rootBounds: { bottom: 844 } }
const below = { isIntersecting: false, boundingClientRect: { top: 1200, height: 400 }, rootBounds: { bottom: 844 } }
const above = { isIntersecting: false, boundingClientRect: { top: -900, height: 400 }, rootBounds: { bottom: 844 } }
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('BusinessRail — a seed of ids', () => {
  it('in the server HTML: the heading and placeholders, no card and no id in a link', () => {
    const html = renderToString(<BusinessRail initial={ids('b1', 'b2', 'b3', 'b4', 'b5')} look="lane" />)
    expect(html).toContain('Outstanding businesses')
    expect(html).not.toContain('data-card')
    expect(html.match(/skeleton-photo/g)).toHaveLength(4)
  })

  it('the phone lane asks once its gate opens, with the ids in order and the reader\'s language; the cards land in the SERVER\'s order', async () => {
    answer = { ok: true, body: { cards: [card('b3'), card('b1'), card('b4')] } } // b2 is gone; the answer's own order differs
    const { container } = render(<BusinessRail initial={ids('b1', 'b2', 'b3', 'b4')} look="lane" />)
    expect(fetch).not.toHaveBeenCalled()
    expect(placeholders(container)).toBe(4)
    await open()
    await waitFor(() => expect(drawn(container)).toEqual(['b1', 'b3', 'b4']))
    expect(asks()).toEqual(['/api/home/cards?rail=businesses&lang=ko&ids=b1%2Cb2%2Cb3%2Cb4'])
  })

  it('the desktop shelf (no gate of its own: DeferredShelf mounts it when due) asks at mount', async () => {
    answer = { ok: true, body: { cards: [card('b1'), card('b2'), card('b3')] } }
    const { container } = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} />)
    await waitFor(() => expect(drawn(container)).toEqual(['b1', 'b2', 'b3']))
    expect(asks()).toHaveLength(1)
  })

  it('the floor is the first paint\'s: one card left keeps the rail; none left takes it away', async () => {
    answer = { ok: true, body: { cards: [card('b2')] } }
    const one = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} />)
    await waitFor(() => expect(drawn(one.container)).toEqual(['b2']))
    expect(one.container.querySelector('h2')?.textContent).toBe('Outstanding businesses')
    one.unmount()
    answer = { ok: true, body: { cards: [] } }
    const none = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} />)
    await waitFor(() => expect(none.container.querySelector('section')).toBeNull())
  })

  it('a failed ask keeps the placeholders and is tried once more 5 s later by itself — not a third time by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer = { ok: false, body: {} }
    const { container } = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} />)
    await tick(10)
    expect(asks()).toHaveLength(1)
    await tick(5_000)
    expect(asks()).toHaveLength(2)
    await tick(20_000)
    expect(asks()).toHaveLength(2)
    expect(drawn(container)).toEqual([])
    expect(placeholders(container)).toBe(3)
  })

  it('⛔ lost (both tries failed): it leaves the first time it is wholly below the screen — on screen or above it, it stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer = { ok: false, body: {} }
    const { container } = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} look="lane" />)
    await open()
    await tick(5_010)
    expect(asks()).toHaveLength(2)
    await report('SECTION', above)
    await report('SECTION', onScreen)
    expect(container.querySelector('section')).not.toBeNull()
    await report('SECTION', below)
    expect(container.querySelector('section')).toBeNull()
  })

  it('lost, back on screen it asks again — 5 s after a failure, four asks in all — and an answer then draws the cards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer = { ok: false, body: {} }
    const { container } = render(<BusinessRail initial={ids('b1', 'b2', 'b3')} />)
    await tick(5_010)
    expect(asks()).toHaveLength(2)
    await report('SECTION', onScreen)
    expect(asks()).toHaveLength(2) // under 5 s since the failure
    await tick(5_000)
    await report('SECTION', onScreen)
    await tick(10)
    expect(asks()).toHaveLength(3)
    answer = { ok: true, body: { cards: [card('b1'), card('b2'), card('b3')] } }
    await tick(5_000)
    await report('SECTION', onScreen)
    await tick(10)
    expect(asks()).toHaveLength(4)
    expect(drawn(container)).toEqual(['b1', 'b2', 'b3'])
    await report('SECTION', below)
    expect(container.querySelector('section')).not.toBeNull()
  })

  it('⛔ a language switch after the cards came asks once more in it and takes only the titles; en / vi and a repeat ask nothing', async () => {
    const titled = (code: string, list: string[]) => list.map((id) => ({ ...card(id), titleI18n: { [code]: `${code}:${id}` } }))
    answer = { ok: true, body: { cards: titled('ko', ['b1', 'b2', 'b3']) } }
    const seed = ids('b1', 'b2', 'b3')
    const view = render(<BusinessRail initial={seed} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3))
    // Japanese: the answer has lost b2 — the card stays; only titles are taken.
    answer = { ok: true, body: { cards: titled('ja', ['b1', 'b3']) } }
    ui.lang = 'ja'
    // A new seed array only to re-render the memoised rail here: the real language context re-renders every reader of it.
    view.rerender(<BusinessRail initial={[...seed]} />)
    const marks = () => [...view.container.querySelectorAll('[data-card]')].map((c) => [c.getAttribute('data-card'), c.getAttribute('data-i18n')])
    await waitFor(() => expect(marks()).toEqual([['b1', 'ja,ko'], ['b2', 'ko'], ['b3', 'ja,ko']]))
    expect(asks()).toEqual([
      '/api/home/cards?rail=businesses&lang=ko&ids=b1%2Cb2%2Cb3',
      '/api/home/cards?rail=businesses&lang=ja&ids=b1%2Cb2%2Cb3',
    ])
    for (const code of ['ko', 'vi', 'en', 'ja']) {
      ui.lang = code
      view.rerender(<BusinessRail initial={[...seed]} />)
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    }
    expect(asks()).toHaveLength(2)
  })

  it('a whole seed asks nothing and draws at once, as before', async () => {
    const { container } = render(<BusinessRail initial={[card('b1'), card('b2'), card('b3')]} />)
    expect(drawn(container)).toEqual(['b1', 'b2', 'b3'])
    await open()
    expect(fetch).not.toHaveBeenCalled()
  })
})
