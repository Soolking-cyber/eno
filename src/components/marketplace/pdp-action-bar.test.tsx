// @vitest-environment jsdom
/**
 * THE PINNED LISTING ACTION (owner, 2026-11-10: item 1 of the decision scorecard). jsdom draws nothing, so these hold
 * the rules that are decisions rather than pixels:
 *   · WHEN it may show: the page's control has scrolled off the top AND the tab bar has left; never otherwise (the
 *     July 2026 bar was reverted for taking the tabs away);
 *   · WHAT it is: a mirror of the page's own control (its words; a button is pressed through, a link keeps its address
 *     and its rel), never a second action with rules of its own. The one change of words: a 'buy' link reads "Visit shop"
 *     with "Source: <shop>" under the price (owner, 2026-11-12), checked against the real buy box (AffiliateBooking);
 *   · WHO is left out: a commission link, an e-visa block, a disabled or unrendered control.
 * The geometry (the slot, the tab bar's breakpoint, the motion) was measured on the build; the commit has the numbers.
 */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ hidden: false, lang: 'en' }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => h.hidden }))
// English, or the page's authored Vietnamese: a pair's own `vi`, and for <Tr> (the buy box's "Buy on") the curated
// vi-overrides the real <Tr> reads.
vi.mock('@/context/language-context', async () => {
  const { VI_OVERRIDES } = await import('@/generated/vi-overrides')
  return {
    useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi != null ? vi : en) }),
    Tr: ({ text }: { text: string }) => (h.lang === 'vi' ? VI_OVERRIDES[text] ?? text : text),
  }
})
vi.mock('@/components/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ArrowUpRight: (p: React.SVGProps<SVGSVGElement>) => <svg data-arrow="" {...p} />,
  MessageCircle: (p: React.SVGProps<SVGSVGElement>) => <svg data-bubble="" {...p} />,
}))

import { PdpActionBar, readPrimary } from './pdp-action-bar'
import { AffiliateBooking } from './affiliate-booking'

/** The words on the page (constants: the repo's lint allows no string literal inside JSX, tests included). */
const T = {
  price: '12M đ / month', title: 'Studio  near the river', chat: 'Chat now', chatSpaced: '  Chat   now ', teacher: 'Contact teacher',
  rent: 'Rent on GoPlus', apply: 'Apply on VietnamWorks', buy: 'Buy on Shopee', opening: 'Opening chat…', own: 'This is your listing.', plan: 'Plan my trip in chat',
  shop: 'Tuấn Nguyễn Mobile',
}

/** An IntersectionObserver the test drives: `fire(el, entry)` calls every observer watching `el`. */
type Cb = (entries: Array<{ isIntersecting: boolean; boundingClientRect: { bottom: number } }>) => void
const observers: Array<{ cb: Cb; els: Element[] }> = []
class FakeIO {
  private rec: { cb: Cb; els: Element[] }
  constructor(cb: Cb) { this.rec = { cb, els: [] }; observers.push(this.rec) }
  observe(el: Element) { this.rec.els.push(el) }
  disconnect() { this.rec.els.length = 0 }
  unobserve() {}
  takeRecords() { return [] }
}
const fire = (el: Element, isIntersecting: boolean, bottom: number) =>
  act(() => { for (const o of observers) if (o.els.includes(el)) o.cb([{ isIntersecting, boundingClientRect: { bottom } }]) })

/** jsdom has no layout: every element "has no boxes". Rendered here = not marked `data-unrendered`. */
const realRects = HTMLElement.prototype.getClientRects
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO)
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return (this.closest('[data-unrendered]') ? [] : [{}]) as unknown as DOMRectList
  }
})
/** The tab bar's breakpoint (`pc`): false = a phone or a touch tablet, where the tab bar exists. */
let pc = false
const pcListeners = new Set<() => void>()
/** Cross the breakpoint while the page is open (a window dragged wider, a tablet gaining a mouse). */
const setPc = (v: boolean) => act(() => { pc = v; for (const l of Array.from(pcListeners)) l() })
beforeEach(() => {
  pc = false; pcListeners.clear()
  window.matchMedia = ((q: string) => ({
    get matches() { return pc && q === '(min-width: 64rem) and (pointer: fine)' }, media: q,
    addEventListener: (_: string, l: () => void) => { pcListeners.add(l) }, removeEventListener: (_: string, l: () => void) => { pcListeners.delete(l) },
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  cleanup()
  observers.length = 0
  h.hidden = false
  h.lang = 'en'
  HTMLElement.prototype.getClientRects = realRects
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** The page: a title, the contact block with `inner` as its control, and the bar. */
function Page({ children, price = <span>{T.price}</span>, noPin = false, hideWhile }: { children: React.ReactNode; price?: React.ReactNode; noPin?: boolean; hideWhile?: string }) {
  return (
    <main>
      <h1>{T.title}</h1>
      <div id="contact" data-no-pin={noPin ? '' : undefined}>{children}</div>
      <div id="lower" />
      <PdpActionBar price={price} hideWhile={hideWhile} />
    </main>
  )
}
const bar = () => document.querySelector('[data-slot="sticky-action-bar"]')
const contact = () => document.getElementById('contact')!

/** Scroll the page's control off the top and retract the tab bar: the two conditions, in the order a reader meets them.
 *  ⚠️ Every rerender passes a CLONE: React skips a rerender handed the very same element, and the mocked scroll signal
 *  would never be read again. */
async function scrollPast(view: { rerender: (ui: React.ReactElement) => void }, ui: React.ReactElement) {
  await fire(contact(), false, -40)
  h.hidden = true
  await act(async () => { view.rerender(React.cloneElement(ui)) })
}

describe('PdpActionBar: when it may show', () => {
  const onChat = vi.fn()
  const ui = <Page><button data-pdp-primary="chat" onClick={onChat}>{T.chat}</button></Page>
  beforeEach(() => onChat.mockClear())

  it('is absent on arrival, and while the page\'s own button is still on screen', async () => {
    const view = render(ui)
    expect(bar()).toBeNull()
    h.hidden = true // the tab bar has left, but the button is in view
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    expect(bar()).toBeNull()
  })

  it('is absent while the tab bar is on screen, however far down the reader is', async () => {
    render(ui)
    await fire(contact(), false, -40)
    expect(bar()).toBeNull()
  })

  it('is absent when the block is out of view BELOW the screen (not reached yet)', async () => {
    const view = render(ui)
    await fire(contact(), false, 1400)
    h.hidden = true
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    expect(bar()).toBeNull()
  })

  it('shows once the button is above the screen and the tab bar has left; goes, after its slide, when the tabs return', async () => {
    vi.useFakeTimers()
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()).not.toBeNull()
    expect(bar()!.className).toContain('pc:hidden')
    expect(bar()!.className).not.toContain('pointer-events-none')

    h.hidden = false // a scroll up: the tab bar is back
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    // Still in the DOM for the slide, and no longer takes a tap, a key press or focus.
    expect(bar()).not.toBeNull()
    expect(bar()!.closest('[data-pdp-bar]')!.hasAttribute('inert')).toBe(true)
    expect(bar()!.className).toContain('pointer-events-none')
    expect(bar()!.className).toContain('translate-y-full')
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(bar()).toBeNull()
  })

  it('comes straight back if the reader turns down again during the slide', async () => {
    vi.useFakeTimers()
    const view = render(ui)
    await scrollPast(view, ui)
    h.hidden = false
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    h.hidden = true
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(bar()).not.toBeNull()
    expect(bar()!.className).not.toContain('pointer-events-none')
  })

  it('never mounts where there is no tab bar (a desktop pointer at 64rem and up)', async () => {
    pc = true
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()).toBeNull()
  })

  it('follows a window dragged across that breakpoint, without waiting for the next scroll', async () => {
    vi.useFakeTimers()
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()).not.toBeNull()
    await setPc(true)
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(bar()).toBeNull()
    await setPc(false)
    expect(bar()).not.toBeNull()
  })

  it('reads the LATEST of several queued scroll reports (a fling past the block and back)', async () => {
    const view = render(ui)
    // One callback, two entries: gone above the screen, then back in view. The reader is looking at the button.
    await act(() => { for (const o of observers) if (o.els.includes(contact())) o.cb([{ isIntersecting: false, boundingClientRect: { bottom: -40 } }, { isIntersecting: true, boundingClientRect: { bottom: 300 } }]) })
    h.hidden = true
    await act(async () => { view.rerender(React.cloneElement(ui)) })
    expect(bar()).toBeNull()
  })

  it('stays away while the element named by `hideWhile` is on screen', async () => {
    const withLower = <Page hideWhile="#lower"><button data-pdp-primary="teacher">{T.teacher}</button></Page>
    const view = render(withLower)
    await fire(document.getElementById('lower')!, true, 300)
    await scrollPast(view, withLower)
    expect(bar()).toBeNull()
    await fire(document.getElementById('lower')!, false, 900)
    expect(bar()).not.toBeNull()
  })
})

describe('PdpActionBar: a mirror of the page\'s own control', () => {
  it('a button: the same words, the price and the page title beside it, and a press goes through the page\'s button', async () => {
    const onChat = vi.fn()
    const ui = <Page><button data-pdp-primary="chat" onClick={onChat}>{T.chatSpaced}</button></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLElement
    expect(action.tagName).toBe('BUTTON')
    expect(action.textContent).toBe('Chat now')
    expect(action.querySelector('[data-bubble]')).not.toBeNull()
    const leading = bar()!.querySelector('[data-slot="sticky-action-bar-leading"]')!
    expect(leading.querySelector('[data-pdp-bar-price]')!.textContent).toBe('12M đ / month')
    expect(leading.querySelector('p')!.textContent).toBe('Studio near the river')
    fireEvent.click(action)
    expect(onChat).toHaveBeenCalledTimes(1)
  })

  it('a button React has since replaced is still the one pressed', async () => {
    const first = vi.fn(); const second = vi.fn()
    const ui = (fn: () => void, key: string) => <Page><button key={key} data-pdp-primary="chat" onClick={fn}>{T.chat}</button></Page>
    const view = render(ui(first, 'a'))
    await scrollPast(view, ui(first, 'a'))
    await act(async () => { view.rerender(ui(second, 'b')) })
    fireEvent.click(bar()!.querySelector('[data-action="primary"]')!)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a link: the same address, the same rel, the same words, marked as a REPEAT so the page still has one booking CTA', async () => {
    const ui = <Page><a data-affiliate-cta="true" data-commission="false" href="https://partner.example/room/7" target="_blank" rel="sponsored nofollow noopener noreferrer">{T.rent}</a></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLAnchorElement
    expect(action.tagName).toBe('A')
    expect(action.href).toBe('https://partner.example/room/7')
    expect(action.rel).toBe('sponsored nofollow noopener noreferrer')
    // …and it opens where the page's own link opens (this one: a new tab).
    expect(action.target).toBe('_blank')
    expect(action.textContent!.trim()).toBe('Rent on GoPlus')
    expect(action.getAttribute('data-affiliate-cta-repeat')).toBe('true')
    expect(document.querySelectorAll('[data-affiliate-cta]')).toHaveLength(1)
  })

  it('a job\'s link keeps the job rel (no "sponsored": a job board pays nothing)', async () => {
    const ui = <Page price={null}><a data-affiliate-cta="true" data-commission="false" href="https://jobs.example/p/1" rel="nofollow noopener">{T.apply}</a></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLAnchorElement
    expect(action.rel).toBe('nofollow noopener')
    // The page's link names no target, so neither does the copy.
    expect(action.hasAttribute('target')).toBe(false)
    // No figure: no leading block, the action takes the whole row, and the row is still the 68px one.
    expect(bar()!.querySelector('[data-slot="sticky-action-bar-leading"]')).toBeNull()
    expect(action.className.split(' ')).toContain('flex-1')
    expect(bar()!.querySelector('[data-slot="sticky-action-bar-panel"]')!.className).toContain('py-2.5')
  })

  it('gives the action the whole row when its words would need a third line beside the price', async () => {
    // jsdom has no layout: say the action stands 72px tall (three lines) while a price is beside it, 48px without one.
    const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) {
      return this.getAttribute('data-action') === 'primary' ? (this.closest('[data-slot="sticky-action-bar"]')!.querySelector('[data-slot="sticky-action-bar-leading"]') ? 72 : 48) : 0
    } })
    try {
      const ui = <Page><a data-affiliate-cta="true" data-commission="false" data-cta-verb="buy" data-cta-shop="Shopee" href="https://shop.example/p/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>
      const view = render(ui)
      await scrollPast(view, ui)
      expect(bar()!.querySelector('[data-slot="sticky-action-bar-leading"]')).toBeNull()
      const action = bar()!.querySelector('[data-action="primary"]') as HTMLElement
      expect(action.className.split(' ')).toContain('flex-1')
      // Still the 68px row. And a 'buy' link whose caption ("Source: Shopee") went with the price carries the page's own
      // words again, which name the shop: "Visit shop" with the shop named nowhere on the bar is never shown.
      expect(bar()!.querySelector('[data-slot="sticky-action-bar-panel"]')!.className).toContain('py-2.5')
      expect(action.textContent!.trim()).toBe(T.buy)
      expect(action.hasAttribute('aria-label')).toBe(false)
    } finally {
      if (real) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', real)
    }
  })

  it('reads the control when it is about to show, not at mount: what the page says by then is what the bar says', async () => {
    const ui = (label: string) => <Page><button data-pdp-primary="chat">{label}</button></Page>
    const view = render(ui('Chat now'))
    await act(async () => { view.rerender(ui('Plan my trip in chat')) })
    await scrollPast(view, ui('Plan my trip in chat'))
    expect(bar()!.querySelector('[data-action="primary"]')!.textContent).toBe('Plan my trip in chat')
  })
})

describe('PdpActionBar: a \'buy\' link reads "Visit shop" and names the shop under the price (owner, 2026-11-12)', () => {
  /** The real buy box in the page's `#contact`, as the PDP renders it: the bar reads its marks, not a hand-made copy of them. */
  const shopPage = (p: { url?: string; partnerName?: string; rental?: boolean; booking?: boolean; job?: boolean } = {}) => (
    <Page>
      <AffiliateBooking url={p.url ?? 'https://shop.example/p/1'} partnerName={p.partnerName ?? T.shop} listingId="l1" booking={!!p.booking} rental={!!p.rental} job={!!p.job} />
    </Page>
  )
  const words = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const buyBox = () => document.querySelector('[data-affiliate-cta]') as HTMLAnchorElement
  const action = () => bar()!.querySelector('[data-action="primary"]') as HTMLAnchorElement
  const caption = () => bar()!.querySelector('[data-slot="sticky-action-bar-leading"] p')

  it.each([
    ['en', 'Visit shop', 'Source: Tuấn Nguyễn Mobile', 'Buy on Tuấn Nguyễn Mobile'],
    ['vi', 'Đến cửa hàng', 'Nguồn: Tuấn Nguyễn Mobile', 'Mua trên Tuấn Nguyễn Mobile'],
  ])('%s: the bar\'s button reads "%s", its name starts with those words and names the shop, the caption says "%s"', async (lang, visit, source, buyWords) => {
    h.lang = lang
    const ui = shopPage()
    const view = render(ui)
    await scrollPast(view, ui)
    expect(buyBox().getAttribute('data-cta-verb')).toBe('buy')
    expect(words(action())).toBe(visit)
    // Label in name (WCAG 2.5.3): the visible words first, then the shop they lead to.
    expect(action().getAttribute('aria-label')).toBe(`${visit}: ${T.shop}`)
    expect(action().getAttribute('aria-label')!.startsWith(words(action()))).toBe(true)
    expect(action().querySelector('[data-arrow]')).not.toBeNull()
    // The price stays, and the caption under it is Seller information's "Source" row in place of the title.
    expect(bar()!.querySelector('[data-pdp-bar-price]')!.textContent).toBe(T.price)
    expect(words(caption())).toBe(source)
    // Still the same link: address, rel and target are the buy box's, marked as its repeat.
    expect(action().href).toBe(buyBox().href)
    expect(action().rel).toBe('sponsored nofollow noopener noreferrer')
    expect(action().target).toBe('_blank')
    expect(action().getAttribute('data-affiliate-cta-repeat')).toBe('true')
    expect(document.querySelectorAll('[data-affiliate-cta]')).toHaveLength(1)
    // The buy box itself keeps its full words: the listing still names its source site on its button.
    expect(words(buyBox())).toBe(buyWords)
  })

  it.each([
    ['rent', { rental: true }, 'en', 'Rent on GoPlus'],
    ['rent', { rental: true }, 'vi', 'Thuê trên GoPlus'],
    ['book', { booking: true }, 'en', 'Book on GoPlus'],
    ['book', { booking: true }, 'vi', 'Đặt trên GoPlus'],
    ['apply', { job: true }, 'en', 'Apply on GoPlus'],
    ['apply', { job: true }, 'vi', 'Ứng tuyển trên GoPlus'],
    // A job is applied for whatever else it says it is (CtaLabel's order).
    ['apply', { job: true, rental: true, booking: true }, 'en', 'Apply on GoPlus'],
  ] as const)('a \'%s\' link is pinned word for word (%j, %s): "%s", the title under the price, no name of its own', async (verb, props, lang, pinned) => {
    h.lang = lang
    const ui = shopPage({ partnerName: 'GoPlus', ...props })
    const view = render(ui)
    await scrollPast(view, ui)
    expect(buyBox().getAttribute('data-cta-verb')).toBe(verb)
    expect(words(buyBox())).toBe(pinned)
    expect(words(action())).toBe(pinned)
    expect(action().hasAttribute('aria-label')).toBe(false)
    expect(words(caption())).toBe('Studio near the river')
  })

  it('⛔ a commission link is still never pinned, "buy" or not', async () => {
    const ui = shopPage({ url: 'https://shorten.asia/abc123' })
    const view = render(ui)
    await scrollPast(view, ui)
    expect(buyBox().getAttribute('data-commission')).toBe('true')
    expect(buyBox().getAttribute('data-cta-verb')).toBe('buy')
    expect(bar()).toBeNull()
  })

  it('a \'buy\' link with no price beside it keeps the page\'s words (the shop would be named nowhere on the bar)', async () => {
    const ui = <Page price={null}><a data-affiliate-cta="true" data-commission="false" data-cta-verb="buy" data-cta-shop="Shopee" href="https://shop.example/p/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()!.querySelector('[data-slot="sticky-action-bar-leading"]')).toBeNull()
    expect(words(action())).toBe(T.buy)
    expect(action().hasAttribute('aria-label')).toBe(false)
  })

  it('a \'buy\' link that does not name its shop keeps the page\'s words and the title', async () => {
    const ui = <Page><a data-affiliate-cta="true" data-commission="false" data-cta-verb="buy" data-cta-shop=" " href="https://shop.example/p/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    expect(words(action())).toBe(T.buy)
    expect(action().hasAttribute('aria-label')).toBe(false)
    expect(words(caption())).toBe('Studio near the river')
  })

  it('a link that does not say which action it is keeps the page\'s words (the words themselves are never parsed)', async () => {
    const ui = <Page><a data-affiliate-cta="true" data-commission="false" href="https://shop.example/p/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    expect(words(action())).toBe(T.buy)
    expect(words(caption())).toBe('Studio near the river')
  })

  it('follows the shop the page names while the bar is up', async () => {
    const ui = (shop: string) => <Page><a data-affiliate-cta="true" data-commission="false" data-cta-verb="buy" data-cta-shop={shop} href="https://shop.example/p/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>
    const view = render(ui('Shopee'))
    await scrollPast(view, ui('Shopee'))
    expect(words(caption())).toBe('Source: Shopee')
    await act(async () => { view.rerender(ui('Lazada')) })
    await act(async () => { await Promise.resolve() })
    expect(words(caption())).toBe('Source: Lazada')
    expect(action().getAttribute('aria-label')).toBe('Visit shop: Lazada')
  })
})

describe('PdpActionBar: it keeps reading the page\'s control while it is up', () => {
  /** A MutationObserver reports in a microtask: let it, inside act. */
  const settle = () => act(async () => { await Promise.resolve() })

  it('a control that is busy when the bar appears: the bar says so in the page\'s words and takes no press', async () => {
    const onChat = vi.fn()
    const ui = <Page><button data-pdp-primary="chat" aria-disabled="true" onClick={onChat}>{T.opening}</button></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLButtonElement
    expect(action.textContent).toBe(T.opening)
    expect(action.disabled).toBe(true)
    expect(action.querySelector('[data-bubble]')).toBeNull()
    fireEvent.click(action)
    expect(onChat).not.toHaveBeenCalled()
  })

  it('a press that makes the page\'s button busy: the bar follows, and a second press does nothing', async () => {
    const onChat = vi.fn()
    const ui = (busy: boolean) => <Page><button data-pdp-primary="chat" aria-disabled={busy || undefined} onClick={onChat}>{busy ? T.opening : T.chat}</button></Page>
    const view = render(ui(false))
    await scrollPast(view, ui(false))
    fireEvent.click(bar()!.querySelector('[data-action="primary"]')!)
    expect(onChat).toHaveBeenCalledTimes(1)
    await act(async () => { view.rerender(ui(true)) })
    await settle()
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLButtonElement
    expect(action.textContent).toBe(T.opening)
    expect(action.disabled).toBe(true)
    fireEvent.click(action)
    expect(onChat).toHaveBeenCalledTimes(1)
  })

  it('new words on the page\'s control (sign-in, a language switch) are the bar\'s words at once', async () => {
    const ui = (label: string) => <Page><button data-pdp-primary="chat">{label}</button></Page>
    const view = render(ui(T.chat))
    await scrollPast(view, ui(T.chat))
    await act(async () => { view.rerender(ui(T.plan)) })
    await settle()
    expect(bar()!.querySelector('[data-action="primary"]')!.textContent).toBe(T.plan)
  })

  it('a control that goes away takes the bar with it, and a press caught in between clicks nothing', async () => {
    const onChat = vi.fn()
    const withControl = <Page><button data-pdp-primary="chat" onClick={onChat}>{T.chat}</button></Page>
    const without = <Page><p>{T.own}</p></Page>
    const view = render(withControl)
    await scrollPast(view, withControl)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLButtonElement
    await act(async () => { view.rerender(without) })
    // Before the observer has reported, the bar is still there: its press must find no control and do nothing.
    fireEvent.click(action)
    expect(onChat).not.toHaveBeenCalled()
    await settle()
    expect(bar()).toBeNull()
  })

  it('a control the page HIDES while the bar is up is not pressed (nothing inside the block changed, so only the press can know)', async () => {
    const onChat = vi.fn()
    const ui = <Page><div data-wrap=""><button data-pdp-primary="chat" onClick={onChat}>{T.chat}</button></div></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    // The page hides the control from outside the block's own tree of attributes the bar could cheaply watch for.
    document.querySelector('[data-wrap]')!.setAttribute('data-unrendered', '')
    fireEvent.click(bar()!.querySelector('[data-action="primary"]')!)
    expect(onChat).not.toHaveBeenCalled()
  })

  it('the teacher\'s button in its own kept block: re-mounted by the page, it is still followed, pressed and tracked', async () => {
    const first = vi.fn(); const second = vi.fn()
    const page = (fn: () => void, key: string, label: string) => (
      <main>
        <h1>{T.title}</h1>
        <div data-pdp-action-block=""><button key={key} data-pdp-primary="teacher" onClick={fn}>{label}</button></div>
        <PdpActionBar block="[data-pdp-action-block]" control='[data-pdp-primary="teacher"]' price={<span>{T.price}</span>} />
      </main>
    )
    const view = render(page(first, 'a', T.teacher))
    const block = document.querySelector('[data-pdp-action-block]')!
    await fire(block, false, -40)
    h.hidden = true
    await act(async () => { view.rerender(page(first, 'a', T.teacher)) })
    expect(bar()!.querySelector('[data-action="primary"]')!.textContent).toBe(T.teacher)
    await act(async () => { view.rerender(page(second, 'b', T.chat)) })
    await settle()
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLElement
    expect(action.textContent).toBe(T.chat)
    fireEvent.click(action)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    // The block is the same node after the re-mount, so its position is still the one being watched.
    expect(document.querySelector('[data-pdp-action-block]')).toBe(block)
    expect(observers.some((o) => o.els.includes(block))).toBe(true)
  })

  it('a resize that hides the page\'s control (a breakpoint, not a mutation) takes the bar with it', async () => {
    const ui = <Page><div data-wrap=""><button data-pdp-primary="chat">{T.chat}</button></div></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()).not.toBeNull()
    document.querySelector('[data-wrap]')!.setAttribute('data-unrendered', '')
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    expect(bar()).toBeNull()
  })

  it('a copied link is not followed once the page has hidden its own (asked on the click, as a button\'s press is)', async () => {
    const ui = <Page><div data-wrap=""><a data-affiliate-cta="true" data-commission="false" href="https://partner.example/room/7" target="_blank" rel="sponsored nofollow noopener noreferrer">{T.rent}</a></div></Page>
    const view = render(ui)
    await scrollPast(view, ui)
    const action = bar()!.querySelector('[data-action="primary"]') as HTMLAnchorElement
    // While the page shows its link the copy is an ordinary link: the click is not cancelled.
    expect(fireEvent.click(action)).toBe(true)
    document.querySelector('[data-wrap]')!.setAttribute('data-unrendered', '')
    expect(fireEvent.click(action)).toBe(false)
  })

  it('a link whose address changes is followed too', async () => {
    const ui = (href: string) => <Page><a data-affiliate-cta="true" data-commission="false" href={href} target="_blank" rel="sponsored nofollow noopener noreferrer">{T.rent}</a></Page>
    const view = render(ui('https://partner.example/room/7'))
    await scrollPast(view, ui('https://partner.example/room/7'))
    await act(async () => { view.rerender(ui('https://partner.example/room/8')) })
    await settle()
    expect((bar()!.querySelector('[data-action="primary"]') as HTMLAnchorElement).href).toBe('https://partner.example/room/8')
  })
})

describe('PdpActionBar: who is left out', () => {
  const none = async (ui: React.ReactElement) => {
    const view = render(ui)
    await scrollPast(view, ui)
    expect(bar()).toBeNull()
  }
  it('a commission link: its disclosure sentence cannot ride in the bar', () =>
    none(<Page><a data-affiliate-cta="true" data-commission="true" href="https://go.example/t/1" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>))
  it('⛔ a booking link that does not say whether it pays commission (fail closed: only "false" is copied)', () =>
    none(<Page><a data-affiliate-cta="true" href="https://go.example/t/2" rel="sponsored nofollow noopener noreferrer">{T.buy}</a></Page>))
  it('an e-visa block (`data-no-pin`): the action follows its disclaimer', () =>
    none(<Page noPin><button data-pdp-primary="chat">{T.chat}</button></Page>))
  it('a disabled control', () =>
    none(<Page><button data-pdp-primary="chat" disabled>{T.chat}</button></Page>))
  it('a control the page does not render (the iOS app hides some contact blocks with CSS)', () =>
    none(<Page><div data-unrendered=""><button data-pdp-primary="chat">{T.chat}</button></div></Page>))
  it('a page with no control at all (the seller on their own listing, a closed job)', () =>
    none(<Page><p>{T.own}</p></Page>))
})

describe('readPrimary', () => {
  const el = (html: string) => { document.body.innerHTML = html; return document.body.firstElementChild }
  it('returns null for no block', () => expect(readPrimary(null, '[data-pdp-primary]')).toBeNull())
  it('accepts the block itself as the control', () => {
    const m = readPrimary(el('<button data-pdp-primary="teacher">Contact teacher</button>'), '[data-pdp-primary="teacher"]')
    expect(m).toMatchObject({ kind: 'button', what: 'teacher', label: 'Contact teacher' })
  })
  it('reads a link\'s action and shop from its marks, the shop\'s spacing tidied; \'\' for a link that does not say', () => {
    expect(readPrimary(el('<div><a data-affiliate-cta="true" data-commission="false" data-cta-verb="buy" data-cta-shop="  Tuấn   Nguyễn Mobile " href="https://x.example/">Buy on Tuấn Nguyễn Mobile</a></div>'), '[data-affiliate-cta]'))
      .toMatchObject({ kind: 'link', verb: 'buy', shop: 'Tuấn Nguyễn Mobile', label: 'Buy on Tuấn Nguyễn Mobile' })
    expect(readPrimary(el('<div><a data-affiliate-cta="true" data-commission="false" href="https://x.example/">Rent on GoPlus</a></div>'), '[data-affiliate-cta]'))
      .toMatchObject({ kind: 'link', verb: '', shop: '' })
  })
  it('prefers nothing over a link with no address or no words', () => {
    expect(readPrimary(el('<div><a data-affiliate-cta="true" data-commission="false">Rent</a></div>'), '[data-affiliate-cta]')).toBeNull()
    expect(readPrimary(el('<div><a data-affiliate-cta="true" data-commission="false" href="https://x.example/"> </a></div>'), '[data-affiliate-cta]')).toBeNull()
  })
})
