// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/components/marketplace/help-feedback', () => ({ HelpFeedback: () => null }))

import { BackToTop } from './back-to-top'

/**
 * THE FLOATING CLUSTER'S BEHAVIOUR (owner, 2026-09-25): "back-to-top arrow shows ONLY while the user
 * scrolls UP (hidden while scrolling down and near the top), and both it and the support bubble never
 * overlap the right column's save hearts and lift above the product page's sticky buy/CTA bar".
 *
 * jsdom lays nothing out, so the geometry the component reads is stubbed with the numbers measured on
 * a 390x844 phone: the column at x 330–374, the chevron slot at y 666–710 and the support mark at
 * 720–764 (offsets inside a column whose top is 666). rAF runs on the fake clock.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */
afterEach(cleanup)

let y = 0
let desktop = false
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('64rem') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }))
  y = 0
  desktop = false
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.querySelectorAll('main').forEach((m) => m.remove())
})

const chevron = () => document.querySelector<HTMLElement>('.back-to-top-chevron')!
const support = () => document.querySelector<HTMLElement>('.support-mark')!
const column = () => chevron().parentElement as HTMLElement
const scrollTo = (to: number) => act(() => { y = to; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20) })
const rest = () => act(() => { vi.advanceTimersByTime(200) })

/** Lay the cluster out where it sits on a phone (jsdom has no layout). */
function layOut() {
  const col = column()
  col.getBoundingClientRect = () => ({ top: 666, bottom: 764, left: 330, right: 374, width: 44, height: 98, x: 330, y: 666, toJSON() {} }) as DOMRect
  const place = (el: HTMLElement, top: number) => {
    Object.defineProperty(el, 'offsetTop', { configurable: true, value: top })
    Object.defineProperty(el, 'offsetLeft', { configurable: true, value: 0 })
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 44 })
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 44 })
  }
  place(chevron(), 0)
  place(support(), 54)
}
/** A page control at a viewport rect, inside <main> like the feed's hearts and the PDP's CTA. */
function control(rect: { top: number; bottom: number; left: number; right: number }) {
  let main = document.querySelector('main')
  if (!main) { main = document.createElement('main'); document.body.prepend(main) }
  const b = document.createElement('button')
  b.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect
  main.appendChild(b)
  return b
}

describe('BackToTop — the chevron shows only while scrolling UP', () => {
  it('is hidden deep in the page until an upward scroll, hidden again on the way down and near the top', () => {
    y = 3000
    render(<BackToTop />)
    act(() => { vi.advanceTimersByTime(20) })
    // Deep in the page, but nobody has scrolled up: the old rule (scrollY > 700) showed it here.
    expect(chevron().hasAttribute('inert')).toBe(true)
    scrollTo(3400) // down
    expect(chevron().hasAttribute('inert')).toBe(true)
    scrollTo(3200) // up
    expect(chevron().hasAttribute('inert')).toBe(false)
    expect(chevron().className).toContain('opacity-100')
    scrollTo(3300) // down again
    expect(chevron().hasAttribute('inert')).toBe(true)
    scrollTo(3000) // up
    scrollTo(500) // still up, but near the top
    expect(chevron().hasAttribute('inert')).toBe(true)
  })
})

describe('BackToTop — the support mark', () => {
  it('rides away with the tab bar on a phone', () => {
    y = 2000
    render(<BackToTop />)
    act(() => { vi.advanceTimersByTime(20) })
    scrollTo(2100) // the tab bar's hook anchors on its first scroll frame
    scrollTo(2400)
    expect(support().hasAttribute('inert')).toBe(true)
  })

  it('stays usable on a desktop after a scroll down — the hide classes are max-lg, and now inert is too', () => {
    desktop = true
    y = 2000
    render(<BackToTop />)
    act(() => { vi.advanceTimersByTime(20) })
    scrollTo(2100)
    scrollTo(2400)
    expect(support().hasAttribute('inert')).toBe(false)
  })
})

describe('BackToTop — at rest, never on a page control', () => {
  it('the measured steal (a heart under the support mark): the mark yields in place — faded, inert — and nothing moves', () => {
    control({ left: 338, right: 370, top: 730, bottom: 762 }) // heart centred at y=746, x=354
    render(<BackToTop />)
    layOut()
    rest()
    expect(support().hasAttribute('inert')).toBe(true)
    expect(support().className).toContain('opacity-0')
    expect(column().style.translate).toBe('')
    // …and it comes straight back once the page moves.
    scrollTo(40)
    expect(support().hasAttribute('inert')).toBe(false)
  })

  it('a heart under the CHEVRON while scrolling up: the chevron yields, the support mark stays', () => {
    control({ left: 338, right: 370, top: 672, bottom: 704 }) // centred at y=688, on the chevron slot
    y = 3000
    render(<BackToTop />)
    act(() => { vi.advanceTimersByTime(20) })
    scrollTo(3400)
    scrollTo(3200) // up → chevron shown
    layOut()
    rest()
    expect(chevron().hasAttribute('inert')).toBe(true)
    // It fades where it is — no 8px sink, which is the scrolled-away motion, not a yield's.
    expect(chevron().className).toContain('translate-y-0')
    expect(chevron().className).not.toContain('translate-y-2')
    expect(support().hasAttribute('inert')).toBe(false)
  })

  it('rises above the PDP CTA (a full-width bar) when it is under the cluster, and comes back down once it has gone', () => {
    const cta = control({ left: 12, right: 378, top: 700, bottom: 748 })
    render(<BackToTop />)
    layOut()
    rest()
    expect(column().style.translate).toBe('0 -72px') // the support mark's bottom 764 → 8px above the CTA's 700
    expect(support().hasAttribute('inert')).toBe(false)
    // The browser now reports the column where the rise put it; the next rest must undo that, not
    // compound it (→ 144) or lose it (→ 0, which would put the mark back on the CTA).
    const col = column()
    col.getBoundingClientRect = () => ({ top: 594, bottom: 692, left: 330, right: 374, width: 44, height: 98, x: 330, y: 594, toJSON() {} }) as DOMRect
    act(() => { window.dispatchEvent(new Event('resize')) })
    rest()
    expect(column().style.translate).toBe('0 -72px')
    cta.getBoundingClientRect = () => ({ top: 200, bottom: 248, left: 12, right: 378, width: 366, height: 48, x: 12, y: 200, toJSON() {} }) as DOMRect
    scrollTo(40)
    rest()
    expect(column().style.translate).toBe('')
  })

  it('ignores a card-sized stretched link, a control outside its column, an sr-only one and an inert one', () => {
    control({ left: 201, right: 378, top: 500, bottom: 800 }) // the right card's own link
    control({ left: 149, right: 181, top: 730, bottom: 762 }) // left-column heart
    control({ left: 354, right: 355, top: 740, bottom: 741 }) // sr-only: 1x1
    control({ left: 338, right: 370, top: 730, bottom: 762 }).setAttribute('inert', '') // inert heart
    render(<BackToTop />)
    layOut()
    rest()
    expect(column().style.translate).toBe('')
    expect(support().hasAttribute('inert')).toBe(false)
  })

  it('stands down — invisible and inert — when no clear place above the bars exists within the cap', () => {
    for (let i = 0; i < 8; i++) control({ left: 12, right: 378, top: 700 - i * 60, bottom: 748 - i * 60 })
    render(<BackToTop />)
    layOut()
    rest()
    expect(support().hasAttribute('inert')).toBe(true)
    expect(support().className).toContain('opacity-0')
    // …until the page moves: a reader scrolling must get the controls back.
    scrollTo(40)
    expect(support().hasAttribute('inert')).toBe(false)
  })
})
