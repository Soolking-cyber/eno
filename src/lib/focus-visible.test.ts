/**
 * isFocusVisible asks the browser whether a focus is the keyboard's (`:focus-visible`), and answers true where the browser
 * cannot parse the selector, so a keyboard user there keeps what the focus handler gave before (hydration-06).
 */
import { describe, expect, it } from 'vitest'
import { isFocusVisible } from './focus-visible'

const el = (matches: (selector: string) => boolean) => ({ matches }) as unknown as Element

describe('isFocusVisible', () => {
  it('a keyboard focus: true', () => {
    expect(isFocusVisible(el((s) => s === ':focus-visible'))).toBe(true)
  })

  it('a tap or a click that focused the element: false', () => {
    expect(isFocusVisible(el(() => false))).toBe(false)
  })

  it('a browser without :focus-visible (it throws on the selector): true, as before', () => {
    expect(isFocusVisible(el(() => { throw new SyntaxError("':focus-visible' is not a valid selector") }))).toBe(true)
  })
})
