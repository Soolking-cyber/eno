// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { returnFocusTo } from './return-focus'

/**
 * A triggerless dialog's `finalFocus` (src/lib/return-focus.ts): the caller's control while it is on the page, Base UI's own
 * choice (`true`) once it is gone, nothing (`false`) for a close that hands over to another layer — read at CLOSE time.
 */
describe('returnFocusTo', () => {
  it('no control: no opinion (undefined), so Base UI keeps its default', () => {
    expect(returnFocusTo(undefined)).toBeUndefined()
  })

  it('the control while it is on the page, Base UI\'s default once it has left, and the answer is read when the close completes', () => {
    const button = document.createElement('button')
    const ref = { current: null as HTMLElement | null }
    const pick = returnFocusTo(ref)!
    expect(pick()).toBe(true) // not mounted yet
    ref.current = button
    expect(pick()).toBe(true) // mounted in no document
    document.body.append(button)
    expect(pick()).toBe(button)
    button.remove()
    expect(pick()).toBe(true)
  })

  it('a close that hands over to another layer returns nothing — that layer returns focus itself', () => {
    const button = document.body.appendChild(document.createElement('button'))
    const handingOff = { current: true }
    const pick = returnFocusTo({ current: button }, handingOff)!
    expect(pick()).toBe(false)
    handingOff.current = false
    expect(pick()).toBe(button)
    button.remove()
  })
})
