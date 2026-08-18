// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * THE BOTTOM NAV DISAPPEARING WHILE SCROLLING.
 *
 * ⛔ THE BUG THIS LOCKS DOWN IS A FALSE POSITIVE, NOT A CRASH. `keyboardOpen()` compared
 * `window.innerHeight` against `visualViewport.height` and called any gap over 120px a keyboard. On
 * iOS Safari that gap IS the visible browser chrome: `innerHeight` stays at the full layout height
 * while the visual viewport shrinks by the top and bottom toolbars, which scrolling UP re-expands.
 * So an ordinary scroll hid the bottom nav, and scrolling back down restored it — intermittently,
 * depending on how far the toolbars happened to be extended. Reported 2026-08-18.
 *
 * ⚠️ THE TEST HAS TO SIMULATE THE TOOLBAR, WHICH IS WHY THERE WAS NO TEST BEFORE. Nothing about
 * this is visible from the type system or from rendering the nav: it needs a viewport whose height
 * differs from innerHeight with NOTHING focused. That is the whole scenario, and it is two lines.
 */

function setViewport(innerHeight: number, vvHeight: number) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })
  Object.defineProperty(window, 'visualViewport', {
    value: { height: vvHeight, offsetTop: 0, addEventListener: () => {}, removeEventListener: () => {} },
    configurable: true,
  })
}

describe('virtual keyboard detection', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { document.body.innerHTML = '' })

  it('⛔ does NOT report a keyboard when browser chrome shrinks the viewport and nothing is focused', async () => {
    // iOS Safari with both toolbars expanded: a 140px gap, larger than the 120px threshold.
    setViewport(900, 760)
    const { hasEditableFocus } = await import('./use-virtual-keyboard')
    // Nothing focused → the focus gate must veto, whatever the heights say.
    expect(hasEditableFocus()).toBe(false)
  })

  it('reports focus for a text input, which is what a real keyboard needs', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    input.focus()
    const { hasEditableFocus } = await import('./use-virtual-keyboard')
    expect(hasEditableFocus()).toBe(true)
  })

  it('ignores controls that raise no soft keyboard', async () => {
    const { hasEditableFocus } = await import('./use-virtual-keyboard')
    for (const type of ['checkbox', 'radio', 'button', 'file', 'range']) {
      const el = document.createElement('input')
      el.type = type
      document.body.appendChild(el)
      el.focus()
      expect(hasEditableFocus(), `input[type=${type}] must not count as a keyboard`).toBe(false)
      el.remove()
    }
  })

  it('ignores a readonly or disabled field — neither summons a keyboard', async () => {
    const { hasEditableFocus } = await import('./use-virtual-keyboard')
    const ro = document.createElement('input'); ro.type = 'text'; ro.readOnly = true
    document.body.appendChild(ro); ro.focus()
    expect(hasEditableFocus()).toBe(false)
    ro.remove()
    const ta = document.createElement('textarea'); ta.disabled = true
    document.body.appendChild(ta); ta.focus()
    expect(hasEditableFocus()).toBe(false)
  })

  it('counts contenteditable, which the chat composer uses', async () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(div, 'isContentEditable', { value: true })
    document.body.appendChild(div)
    div.focus()
    const { hasEditableFocus } = await import('./use-virtual-keyboard')
    expect(hasEditableFocus()).toBe(true)
  })
})
