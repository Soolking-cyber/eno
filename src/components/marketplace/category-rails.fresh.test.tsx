// @vitest-environment jsdom
import { useMemo } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
// The card as a marker carrying its id, the title it was handed (the fresh answer's copy replaces the server's) and the title
// translations it carries.
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string; titleI18n?: Record<string, string> } }) => (
    <i data-card={listing.id} data-title={listing.title} data-i18n={Object.keys(listing.titleI18n ?? {}).sort().join(',')} />
  ),
}))
/** The reader's UI language: a test switches it and re-renders, as the language context does. */
const ui = vi.hoisted(() => ({ lang: 'en' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: ui.lang, tr: (en: string) => en, t: (en: string) => en }) }))

import { CategoryLane, CategoryRails, freshenLanes, useFreshCategoryLanes, visibleCategoryRails, type CategoryRailData } from './category-rails'

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
  ui.lang = 'en'
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
    expect(out[0].items.map((i) => (i as SerializedListingCard).title)).toEqual(['a now', 'b now', 'c now', 'd now'])
    expect(out[1].items.map((i) => i.id)).toEqual(['e', 'f'])
  })
  it("keeps the server copy's title translations under the answer's (the answer carries only the asking reader's)", () => {
    const withAll = [{ slug: 'rentals', listings: [{ ...listing('a'), titleI18n: { ko: 'ko-a', de: 'de-a' } }, listing('b'), listing('c')] }] as unknown as CategoryRailData[]
    const out = freshenLanes(visibleCategoryRails(withAll, cats), [{ slug: 'rentals', listings: [{ ...listing('a', 'a now'), titleI18n: { de: 'de-a now' } }] }] as never)
    const a = out[0].items[0] as SerializedListingCard
    expect(a.title).toBe('a now')
    expect(a.titleI18n).toEqual({ ko: 'ko-a', de: 'de-a now' })
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

/**
 * ⛔ THE LANES THE PAGE SENDS AS IDS (owner, 2026-11-17 — src/lib/home-lanes.ts slimHomeRails): only the first product lane's
 * cards are whole in the HTML. Every other lane holds ids, in their places, and draws them from the SAME one check's answer —
 * no second request, still once per snapshot — keeping its same-size placeholders, open or not, until the answer has them.
 */
describe('a lane of ids — drawn from the check, never a second ask', () => {
  const ids = (slug: string, list: string[]) => ({ slug, listings: list.map((id) => ({ id })) }) as unknown as CategoryRailData
  const SLIM: CategoryRailData[] = [rail('rentals', ['a', 'b', 'c', 'd']), ids('jobs', ['e', 'f', 'g', 'h'])]
  /** The second lane's same-size card placeholders (listing-card-skeleton.tsx). */
  const placeholders = (el: Element) => el.querySelectorAll('section')[1].querySelectorAll('.skeleton-photo').length

  it('placeholders until the answer, then the answer\'s copies in the SERVER\'s order; a gone id leaves; one ask for every lane', async () => {
    // The answer: another order, a new card ('n', never brought in), and 'g' gone.
    answer = { rails: [rail('rentals', ['a', 'b', 'c', 'd']), rail('jobs', ['h', 'n', 'f', 'e'], (id) => `${id} now`)] }
    const { container } = render(<Lanes renderedAt={Date.now() - 3600_000} rails={SLIM} />)
    expect(cardsOf(container)).toEqual([['rentals', ['a', 'b', 'c', 'd']], ['jobs', []]])
    expect(placeholders(container)).toBe(4)
    // Open before the answer is in: still placeholders, and the lane asks at once — the one ask the whole page makes.
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await waitFor(() => expect(cardsOf(container)[1]).toEqual(['jobs', ['e', 'f', 'h']]))
    expect([...container.querySelectorAll('section')[1].querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-title'))).toEqual(['e now', 'f now', 'h now'])
    await settle()
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
  })

  it('a lane of ids asks the moment it opens — not at the idle after `load` like a lane whose cards are in the page', async () => {
    const ready = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState')!
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
    try {
      const renderedAt = Date.now() - 3600_000
      function One({ rails }: { rails: CategoryRailData[] }) {
        const server = useMemo(() => visibleCategoryRails(rails, cats), [rails])
        const { lanes, check } = useFreshCategoryLanes(server, renderedAt)
        return <CategoryLane cat={lanes[1].cat} listings={lanes[1].items} onCategory={() => {}} look="lane" onDrawn={check} liveMedia={PHONE} />
      }
      // A whole lane opened before `load` waits for it…
      const whole = render(<One rails={SERVER} />)
      await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
      await settle()
      expect(fetch).not.toHaveBeenCalled()
      whole.unmount()
      fire = []
      // …a lane of ids does not: nothing else would ever draw its cards.
      answer = { rails: [rail('jobs', ['e', 'f', 'g', 'h'])] }
      const { container } = render(<One rails={SLIM} />)
      await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
      expect(asks()).toEqual(['/api/category-rails?lang=en'])
      await waitFor(() => expect(container.querySelectorAll('[data-card]')).toHaveLength(4))
    } finally {
      Object.defineProperty(document, 'readyState', ready)
      delete (document as { readyState?: unknown }).readyState
    }
  })

  it('a failed ask leaves the placeholders (an id is never drawn as a card) and is tried once more; past that, see "lost"', async () => {
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, json: async () => ({}) }) as Response)
    const { container } = render(<Lanes renderedAt={Date.now() - 3600_000} rails={SLIM} />)
    for (let i = 0; i < 3; i++) {
      await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
      await settle()
    }
    // Two asks, and no third within 5 s of the last failure, however often the lanes report.
    expect(asks()).toHaveLength(2)
    expect(cardsOf(container)).toEqual([['rentals', ['a', 'b', 'c', 'd']], ['jobs', []]])
    expect(placeholders(container)).toBe(4)
  })
})

/**
 * ⛔ NEVER PLACEHOLDERS FOR THE VISIT (commit gate, 2026-11-17 — shelf.tsx useLostPlace). Once both tries for a snapshot's ids
 * have failed, each lane still holding ids is LOST: it leaves the first time it is wholly below the screen (nothing on screen
 * moves), stays while on screen or above it (removing it there would move what the reader looks at), and asks once more each
 * time it comes back on screen — never sooner than 5 s after a failure, four asks in all. A snapshot of whole lanes keeps two.
 */
describe('a lost lane of ids', () => {
  type Obs = { cb: (e: unknown[]) => void; el?: Element }
  let observers: Obs[] = []
  const ids = (slug: string, list: string[]) => ({ slug, listings: list.map((id) => ({ id })) }) as unknown as CategoryRailData
  const JOBS: CategoryRailData[] = [ids('jobs', ['e', 'f', 'g'])]
  const at = Date.now() - 3600_000
  function One() {
    const server = useMemo(() => visibleCategoryRails(JOBS, cats), [])
    const { lanes, check } = useFreshCategoryLanes(server, at)
    return <>{lanes.map((l) => <CategoryLane key={l.slug} cat={l.cat} listings={l.items} onCategory={() => {}} look="lane" onDrawn={check} liveMedia={PHONE} lost={l.lost} />)}</>
  }
  /** Tell the observers on `tag` elements (the lane's scroller gate: DIV; its place: SECTION) where their target is. */
  const report = (tag: string, entry: Record<string, unknown>) => act(async () => { for (const o of [...observers]) if (o.el?.tagName === tag) o.cb([entry]) })
  const onScreen = { isIntersecting: true, boundingClientRect: { top: 100, height: 400 }, rootBounds: { bottom: 844 } }
  const below = { isIntersecting: false, boundingClientRect: { top: 1200, height: 400 }, rootBounds: { bottom: 844 } }
  const above = { isIntersecting: false, boundingClientRect: { top: -900, height: 400 }, rootBounds: { bottom: 844 } }
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    observers = []
    vi.stubGlobal('IntersectionObserver', class {
      o: Obs
      constructor(cb: (e: unknown[]) => void) { this.o = { cb }; observers.push(this.o) }
      observe(el: Element) { this.o.el = el }
      unobserve() {}
      disconnect() { this.o.el = undefined }
    })
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, json: async () => ({}) }) as Response)
  })
  afterEach(() => { vi.useRealTimers() })

  /** Open the lane, fail its ask and the retry 5 s later: lost. */
  async function loseIt() {
    const r = render(<One />)
    await report('DIV', { isIntersecting: true })
    await tick(10)
    expect(asks()).toHaveLength(1)
    await tick(5_000)
    expect(asks()).toHaveLength(2)
    return r
  }

  it('leaves the first time it is wholly below the screen; on screen or above it, it stays', async () => {
    const { container } = await loseIt()
    await report('SECTION', above)
    expect(container.querySelector('section')).not.toBeNull()
    await report('SECTION', onScreen)
    expect(container.querySelector('section')).not.toBeNull()
    await report('SECTION', below)
    expect(container.querySelector('section')).toBeNull()
  })

  it('back on screen it asks again — not within 5 s of a failure, and four asks in all', async () => {
    const { container } = await loseIt()
    await report('SECTION', onScreen)
    expect(asks()).toHaveLength(2) // the last failure is under 5 s old
    for (const n of [3, 4]) {
      await tick(5_000)
      await report('SECTION', onScreen)
      await tick(10)
      expect(asks()).toHaveLength(n)
    }
    await tick(5_000)
    await report('SECTION', onScreen)
    await tick(10)
    expect(asks()).toHaveLength(4)
    expect(container.querySelectorAll('.skeleton-photo')).toHaveLength(3)
  })

  it('an answer that lands on a later try draws the cards, and the lane stays', async () => {
    const { container } = await loseIt()
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, json: async () => ({ rails: [rail('jobs', ['e', 'f', 'g'])] }) }) as Response)
    await tick(5_000)
    await report('SECTION', onScreen)
    await tick(10)
    expect([...container.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))).toEqual(['e', 'f', 'g'])
    await report('SECTION', below)
    expect(container.querySelector('section')).not.toBeNull()
  })
})

/**
 * ⛔ THE DESKTOP'S SHELVES UNDER THE FEED FILL TOO (commit gate, 2026-11-17). listings-explorer.tsx renders
 * <DeferredCategoryRails lanes={categoryLanes} onDrawn={checkCategoryLanes} />, which renders <CategoryRails lanes onDrawn />:
 * every lane there gets the same `check`, with no `liveMedia` (its place is `max-sm:hidden`, so a phone never draws it).
 */
describe('on a desktop: CategoryRails draws lanes of ids from the one check', () => {
  const ids = (slug: string, list: string[]) => ({ slug, listings: list.map((id) => ({ id })) }) as unknown as CategoryRailData
  const RAILS = [rail('rentals', ['a', 'b', 'c', 'd']), ids('jobs', ['e', 'f', 'g', 'h']), ids('services', ['i', 'j', 'k'])]

  it("placeholders until the lanes open, one ask, then every lane whole in the server's order", async () => {
    phone = false
    answer = { rails: [rail('rentals', ['a', 'b', 'c', 'd']), rail('jobs', ['h', 'g', 'f', 'e']), rail('services', ['k', 'i'])] }
    const renderedAt = Date.now() - 3600_000
    function Fixed() {
      const server = useMemo(() => visibleCategoryRails(RAILS, cats), [])
      const { lanes, check } = useFreshCategoryLanes(server, renderedAt)
      return <CategoryRails lanes={lanes} onCategory={() => {}} onDrawn={check} />
    }
    const { container } = render(<Fixed />)
    expect(cardsOf(container)).toEqual([['rentals', []], ['jobs', []], ['services', []]])
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await waitFor(() => expect(cardsOf(container)).toEqual([['rentals', ['a', 'b', 'c', 'd']], ['jobs', ['e', 'f', 'g', 'h']], ['services', ['i', 'k']]]))
    await settle()
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
  })
})

/**
 * ⛔ A LANGUAGE SWITCH AFTER THE ANSWER (commit gate, 2026-11-17 — useFreshCategoryLanes): a card that came as an id carries only
 * the asker's title translations, where the page's own copy carried every one. Switching to a machine-translated language asks
 * once more in it and takes ONLY the titles — no card comes, goes or moves. Never without a switch, never for en / vi, never
 * twice for one language, and never for a snapshot whose lanes were all whole (their own copies carry every language).
 */
describe('a language switch after the answer', () => {
  const ids = (slug: string, list: string[]) => ({ slug, listings: list.map((id) => ({ id })) }) as unknown as CategoryRailData
  const SLIM: CategoryRailData[] = [rail('rentals', ['a', 'b', 'c', 'd']), ids('jobs', ['e', 'f', 'g', 'h'])]
  const titled = (code: string, list: string[], extra: string[] = []) => ({
    rails: [rail('rentals', ['a', 'b', 'c', 'd']), { slug: 'jobs', listings: [...list, ...extra].map((id) => ({ ...listing(id), titleI18n: code === 'en' ? undefined : { [code]: `${code}:${id}` } })) }],
  })
  const jobs = (el: Element) => [...el.querySelectorAll('section')[1].querySelectorAll('[data-card]')].map((c) => [c.getAttribute('data-card'), c.getAttribute('data-i18n')])

  it('asks again once in a machine-translated language and takes only its titles', async () => {
    const renderedAt = Date.now() - 3600_000
    answer = titled('en', ['e', 'f', 'g', 'h'])
    const view = render(<Lanes renderedAt={renderedAt} rails={SLIM} />)
    await act(async () => { for (const f of fire) f([{ isIntersecting: true }]) })
    await waitFor(() => expect(jobs(view.container)).toEqual([['e', ''], ['f', ''], ['g', ''], ['h', '']]))
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
    // Korean: one more ask. Its answer has lost 'g' and gained 'n' — neither moves anything; only titles are taken.
    answer = titled('ko', ['e', 'f', 'h'], ['n'])
    ui.lang = 'ko'
    view.rerender(<Lanes renderedAt={renderedAt} rails={SLIM} />)
    await waitFor(() => expect(jobs(view.container)).toEqual([['e', 'ko'], ['f', 'ko'], ['g', ''], ['h', 'ko']]))
    expect(asks()).toEqual(['/api/category-rails?lang=en', '/api/category-rails?lang=ko'])
    // Japanese adds its titles to Korean's; back to Korean, Vietnamese or English asks nothing more.
    answer = titled('ja', ['e', 'f', 'g', 'h'])
    ui.lang = 'ja'
    view.rerender(<Lanes renderedAt={renderedAt} rails={SLIM} />)
    await waitFor(() => expect(jobs(view.container)[0]).toEqual(['e', 'ja,ko']))
    for (const code of ['ko', 'vi', 'en']) {
      ui.lang = code
      view.rerender(<Lanes renderedAt={renderedAt} rails={SLIM} />)
      await settle()
    }
    expect(asks()).toHaveLength(3)
  })

  it('a snapshot of whole lanes asks nothing on a switch (its cards carry every language already)', async () => {
    const renderedAt = Date.now() - 3600_000
    const view = render(<Lanes renderedAt={renderedAt} />)
    await settle()
    expect(asks()).toEqual(['/api/category-rails?lang=en'])
    ui.lang = 'ko'
    view.rerender(<Lanes renderedAt={renderedAt} />)
    await settle()
    expect(asks()).toHaveLength(1)
  })
})
