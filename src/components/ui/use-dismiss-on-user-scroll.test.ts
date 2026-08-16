// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { canConsumeScroll } from '@/components/ui/use-dismiss-on-user-scroll'

/**
 * THE ONE RULE THAT DECIDES WHETHER A SCROLL GESTURE BELONGS TO THE POPUP OR TO THE PAGE.
 *
 * ⛔ THIS IS UNIT-TESTED RATHER THAN e2e-TESTED ON PURPOSE, AND THE ATTEMPT THAT CAME FIRST IS THE
 * ARGUMENT FOR IT. As a Playwright case the same assertion was unstable for reasons that had
 * nothing to do with the rule: a synthetic `mouse.wheel` in a touch context reports the
 * full-viewport backdrop as its target, so the test failed on mobile while the product was correct.
 * The rule is a pure function of DOM geometry, so it is stated here where nothing can blur it.
 *
 * ⚠️ jsdom REPORTS EVERY scrollHeight AND clientHeight AS 0, so each test STAMPS them. Without the
 * stamps every assertion below would pass for the wrong reason — `0 > 0` is false, so everything
 * would read as "cannot scroll" and the suite would be green while testing nothing.
 */

function el(tag: string, opts: { scrollHeight?: number; clientHeight?: number; overflowY?: string } = {}) {
  const node = document.createElement(tag)
  Object.defineProperty(node, 'scrollHeight', { value: opts.scrollHeight ?? 0, configurable: true })
  Object.defineProperty(node, 'clientHeight', { value: opts.clientHeight ?? 0, configurable: true })
  if (opts.overflowY) node.style.overflowY = opts.overflowY
  return node
}

describe('canConsumeScroll — can the popup absorb this gesture, or is the page what moves?', () => {
  it('a popup with a genuinely overflowing list KEEPS its gesture', () => {
    const popup = el('div', { scrollHeight: 900, clientHeight: 300, overflowY: 'auto' })
    const item = el('div')
    popup.append(item)
    document.body.append(popup)

    expect(canConsumeScroll(item, popup)).toBe(true)
  })

  it('⛔ a popup that is overflow-y-auto but NOT overflowing does not — this is the reported bug', () => {
    // Every popup root in ui/ carries overflow-y-auto unconditionally, so overflow alone would call
    // a two-item menu scrollable. Measured on a phone: dragging inside the 136px price popover
    // scrolled the PAGE 227px while the popover stayed open. The pair of conditions is what closes it.
    const popup = el('div', { scrollHeight: 136, clientHeight: 136, overflowY: 'auto' })
    const text = el('p')
    popup.append(text)
    document.body.append(popup)

    expect(canConsumeScroll(text, popup)).toBe(false)
  })

  it('⛔ a 1px phantom overflow does not count — Chrome rounds the two metrics independently', () => {
    // Reviewer-caught. With a `> 0` test, any popup whose height lands on a fraction reports one
    // stray pixel of overflow, is judged scrollable, and silently stops dismissing on the viewports
    // that round that way — reintroducing the exact bug on a subset of devices.
    const popup = el('div', { scrollHeight: 137, clientHeight: 136, overflowY: 'auto' })
    const text = el('p')
    popup.append(text)
    document.body.append(popup)

    expect(canConsumeScroll(text, popup)).toBe(false)
  })

  it('overflowing content that is NOT scrollable (visible/hidden) does not', () => {
    for (const overflowY of ['visible', 'hidden']) {
      const popup = el('div', { scrollHeight: 900, clientHeight: 300, overflowY })
      const item = el('div')
      popup.append(item)
      document.body.append(popup)

      expect(canConsumeScroll(item, popup), `overflow-y: ${overflowY}`).toBe(false)
    }
  })

  it('a scrollable region NESTED inside the popup counts — the walk starts at the target', () => {
    const popup = el('div', { scrollHeight: 300, clientHeight: 300, overflowY: 'auto' })
    const scroller = el('div', { scrollHeight: 800, clientHeight: 200, overflowY: 'scroll' })
    const leaf = el('span')
    scroller.append(leaf)
    popup.append(scroller)
    document.body.append(popup)

    expect(canConsumeScroll(leaf, popup)).toBe(true)
  })

  it('⛔ the walk STOPS at the popup — a scrollable ancestor OUTSIDE it must never count', () => {
    // Otherwise the document itself (always scrollable when the page is long) would satisfy the
    // predicate for every gesture, and the dismissal would never fire at all.
    const outerScroller = el('div', { scrollHeight: 5000, clientHeight: 800, overflowY: 'auto' })
    const popup = el('div', { scrollHeight: 136, clientHeight: 136, overflowY: 'auto' })
    const text = el('p')
    popup.append(text)
    outerScroller.append(popup)
    document.body.append(outerScroller)

    expect(canConsumeScroll(text, popup)).toBe(false)
  })
})
