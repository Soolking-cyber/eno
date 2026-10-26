// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useSearchShortcuts } from './use-explorer'
import { HEADER_SEARCH_INPUT_ID } from '@/lib/header-search'

// Sweep 2026-10-22: '/' and Ctrl/⌘+K looked up the retired hero's #listings-search-input and called preventDefault before
// finding it — each did nothing and swallowed the browser's own shortcut (Firefox quick find, the address-bar search).
function Harness({ field = true, shown = true }: { field?: boolean; shown?: boolean }) {
  useSearchShortcuts(() => {})
  // jsdom lays nothing out: a shown field is one with a client rect, as in a browser.
  const ref = (el: HTMLInputElement | null) => { if (el) el.getClientRects = () => (shown ? [{}] : []) as unknown as DOMRectList }
  return <>{field && <input id={HEADER_SEARCH_INPUT_ID} ref={ref} />}<textarea data-testid="other" /></>
}
const press = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}
afterEach(cleanup)

describe('useSearchShortcuts', () => {
  it("'/' and a plain Ctrl/⌘+K focus the header's search field", () => {
    render(<Harness />)
    const field = document.getElementById(HEADER_SEARCH_INPUT_ID)!
    expect(press({ key: '/' }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field)
    field.blur()
    expect(press({ key: 'k', metaKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field)
  })
  it('⛔ takes nothing from the browser when there is no field, or the key is not exactly theirs', () => {
    render(<Harness field={false} />)
    expect(press({ key: '/' }).defaultPrevented).toBe(false)
    expect(press({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(false)
    cleanup()
    render(<Harness />)
    expect(press({ key: 'K', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
    ;(document.querySelector('[data-testid="other"]') as HTMLElement).focus()
    expect(press({ key: '/' }).defaultPrevented).toBe(false)
    expect(press({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(false) // Ctrl+K edits the line on macOS
    cleanup()
    render(<Harness shown={false} />) // rendered, hidden at this breakpoint
    expect(press({ key: '/' }).defaultPrevented).toBe(false)
  })
})
