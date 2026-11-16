// @vitest-environment jsdom
import { useMemo } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
// The card as a marker carrying its id and the title it was handed (the fresh answer's copy replaces the server's).
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string } }) => <i data-card={listing.id} data-title={listing.title} />,
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en }) }))

import { CategoryLane, freshenLanes, useFreshCategoryLanes, visibleCategoryRails, type CategoryRailData } from './category-rails'

/**
 * ⛔ THE SERVER'S LANES ARE CHECKED ONCE AFTER THE PAINT (commit review, 2026-11-14 — category-rails.tsx
 * useFreshCategoryLanes). The home's category lanes ride its 6h ISR document, and not every takedown purges '/'. The lanes
 * keep their server first paint, and once drawn ask /api/category-rails (only where shown, once per server snapshot, one
 * retry after a failure): a card the fresh answer no longer carries leaves; nothing new comes in.
 */
const PHONE = '(max-width: 39.99rem)'
const cat = (slug: string) => ({ id: `c-${slug}`, slug, name: slug, nameVi: slug, icon: 'Home' }) as unknown as SerializedCategory
const cats = ['rentals', 'jobs', 'services'].map(cat)
const listing = (id: string, title = id) => ({ id, title, sellerId: 's', images: [] }) as unknown as SerializedListingCard
const rail = (slug: string, ids: string[], title?: (id: string) => string) => ({ slug, listings: ids.map((id) => listing(id, title?.(id) ?? id)) })

const SERVER: CategoryRailData[] = [rail('rentals', ['a', 'b', 'c', 'd']), rail('jobs', ['e', 'f', 'g'])]

let answer: unknown
let phone = true
let fire: Array<(e: { isIntersecting: boolean }[]) => void> = []
const asks = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  answer = { rails: SERVER }
  phone = true
  fire = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // A lane below the first screen opens only when the test says it nears the screen.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { fire.push(cb) }
    observe() {} unobserve() {} disconnect() {}
  })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === PHONE ? phone : !phone, media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0) as unknown as number)
  vi.stubGlobal('cancelIdleCallback', (id: number) => clearTimeout(id))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => answer }) as Response))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** The home's phone lanes as the explorer wires them: the first drawn in the server HTML, the rest behind the gate. */
function Lanes({ renderedAt, rails = SERVER }: { renderedAt?: number; rails?: CategoryRailData[] }) {
  const server = useMemo(() => visibleCategoryRails(rails, cats), [rails])
  const { lanes, check } = useFreshCategoryLanes(server, renderedAt)
  return (
    <>
      {lanes.map((l, i) => (
        <CategoryLane key={l.slug} cat={l.cat} listings={l.items} onCategory={() => {}} look="lane" initialShow={i === 0} onDrawn={check} liveMedia={PHONE} />
      ))}
    </>
  )
}
const cardsOf = (el: Element) => [...el.querySelectorAll('section')].map((s) => [s.querySelector('h2')?.textContent, [...s.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))])
/** Long enough for the idle callback (a 0ms timer here) and the answer's promise chain. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('freshenLanes — a gone card leaves, nothing comes in', () => {
  const lanes = visibleCategoryRails(SERVER, cats)

  it('drops the cards the fresh answer no longer carries, keeps the order, the lanes and their places', () => {
    const out = freshenLanes(lanes, [rail('rentals', ['d', 'NEW', 'a', 'c']), rail('jobs', ['e', 'f', 'g'])])
    expect(out.map((l) => [l.slug, l.items.map((i) => i.id)])).toEqual([['rentals', ['a', 'c', 'd']], ['jobs', ['e', 'f', 'g']]])
  })
  it("takes the fresh answer's copy of a kept card, and keeps a card the answer carries in another lane", () => {
    const out = freshenLanes(lanes, [rail('rentals', ['a', 'b', 'c', 'd', 'e', 'f'], (id) => `${id} now`)])
    expect(out[0].items.map((i) => i.title)).toEqual(['a now', 'b now', 'c now', 'd now'])
    expect(out[1].items.map((i) => i.id)).toEqual(['e', 'f'])
  })
  it("keeps the server copy's title translations under the answer's (the answer carries only the asking reader's)", () => {
    const withAll = [{ slug: 'rentals', listings: [{ ...listing('a'), titleI18n: { ko: 'ko-a', de: 'de-a' } }, listing('b'), listing('c')] }] as unknown as CategoryRailData[]
    const out = freshenLanes(visibleCategoryRails(withAll, cats), [{ slug: 'rentals', listings: [{ ...listing('a', 'a now'), titleI18n: { de: 'de-a now' } }] }] as unknown as CategoryRailData[])
    expect(out[0].items[0].title).toBe('a now')
    expect(out[0].items[0].titleI18n).toEqual({ ko: 'ko-a', de: 'de-a now' })
  })
  it('a lane under the floor stays with what it has; one with no card keeps its entry, empty', () => {
    const out = freshenLanes(lanes, [rail('rentals', ['b'])])
    expect(out.map((l) => [l.slug, l.items.map((i) => i.id)])).toEqual([['rentals', ['b']], ['jobs', []]])
  })
})

describe('useFreshCategoryLanes + CategoryLane — the check after the paint', () => {
  it('the answer is asked for exactly once, and a removed listing leaves its lane', async () => {
    answer = { rails: [rail('rentals', ['a', 'c', 'd', 'x']), rail('jobs', ['e', 'f', 'g'])] }
    const { container } = render(<Lanes renderedAt={Date.now() - 6 * 3600_000} />)
    // The server's lanes paint first (the hydration render is the HTML's).
    expect(cardsOf(container)[0]).toEqual(['rentals', ['a', 'b', 'c', 'd']])
    await waitFor(() => expect(cardsOf(container)[0]).toEqual(['rentals', ['a', 'c', 'd']]))
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
    // A second lane drawn later (its gate opens) does not ask again.
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await settle()
    expect(asks()).toHaveLength(1)
    expect(cardsOf(container)).toEqual([['rentals', ['a', 'c', 'd']], ['jobs', ['e', 'f', 'g']]])
  })

  it('a young answer is checked too: no age gate on the browser clock (a slow clock skipped it; a young page never re-checked)', async () => {
    render(<Lanes renderedAt={Date.now() + 3 * 3600_000} />) // a device clock three hours slow
    await settle()
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
  })

  it('new server lanes (a refresh) start over, and an answer applies only to the snapshot it was asked for', async () => {
    answer = { rails: [rail('rentals', ['a', 'c', 'd']), rail('jobs', ['e', 'f', 'g'])] }
    const t0 = Date.now() - 3600_000
    const { container, rerender } = render(<Lanes renderedAt={t0} />)
    await waitFor(() => expect(cardsOf(container)[0]).toEqual(['rentals', ['a', 'c', 'd']]))
    // A refreshed snapshot carrying a new card: the old answer is not applied to it (no valid card drops), and it asks anew.
    const next = [rail('rentals', ['a', 'b', 'n']), rail('jobs', ['e', 'f', 'g'])]
    answer = { rails: next }
    rerender(<Lanes renderedAt={t0 + 1000} rails={next} />)
    expect(cardsOf(container)[0]).toEqual(['rentals', ['a', 'b', 'n']])
    await settle()
    expect(asks()).toHaveLength(2)
    expect(cardsOf(container)[0]).toEqual(['rentals', ['a', 'b', 'n']])
  })

  it('no render time (a caller that passes none) asks nothing', async () => {
    render(<Lanes />)
    await settle()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("on a desktop the phone's copy (display:none there) never asks", async () => {
    phone = false
    render(<Lanes renderedAt={Date.now() - 6 * 3600_000} />)
    await settle()
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await settle()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a lane asks only once its cards are drawn: behind its gate, nothing until it nears the screen', async () => {
    // A later lane alone (no `initialShow`): its gate is closed until the observer says it nears the screen.
    // The render time stamped ONCE, as the server's is: a fresh Date.now() per render made the answer's re-render a new
    // snapshot that asked again a tick later (the CI flake, 2026-11-17).
    const renderedAt = Date.now() - 6 * 3600_000
    function Gated() {
      const server = useMemo(() => visibleCategoryRails(SERVER, cats), [])
      const { lanes, check } = useFreshCategoryLanes(server, renderedAt)
      return <CategoryLane cat={lanes[1].cat} listings={lanes[1].items} onCategory={() => {}} look="lane" onDrawn={check} liveMedia={PHONE} />
    }
    render(<Gated />)
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await settle()
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
  })

  it('a lane whose every card left draws nothing, and the lanes after it keep theirs', async () => {
    answer = { rails: [rail('jobs', ['e', 'f', 'g'])] }
    const { container } = render(<Lanes renderedAt={Date.now() - 6 * 3600_000} />)
    await waitFor(() => expect(cardsOf(container).map(([h]) => h)).toEqual(['jobs']))
    expect(container.querySelectorAll('section h2')).toHaveLength(1)
  })

  it('a failed ask keeps the server lanes; one more ask (the next lane, or by itself 5 s on), and never again', async () => {
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, json: async () => ({}) }) as Response)
    const { container } = render(<Lanes renderedAt={Date.now() - 6 * 3600_000} />)
    await settle()
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await settle()
    // Each lane tells once that it drew: the first asks, the failure frees the next one to ask again, and that is the last.
    expect(asks()).toHaveLength(2)
    for (let i = 0; i < 3; i++) {
      await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
      await settle()
    }
    expect(asks()).toHaveLength(2)
    expect(cardsOf(container)).toEqual([['rentals', ['a', 'b', 'c', 'd']], ['jobs', ['e', 'f', 'g']]])
  })
})
