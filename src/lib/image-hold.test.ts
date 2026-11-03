// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HELD_PHOTO_ATTR, IMAGES_HELD_ATTR, IMAGE_HOLD_JS, IMAGE_HOLD_TIMEOUT_MS } from './image-hold'

const held = () => document.documentElement.hasAttribute(IMAGES_HELD_ATTR)
// The script as the browser runs it: the page's window is this test's.
const runHead = () => new Function(IMAGE_HOLD_JS)()

describe('holding off-screen card photos until the scripts are in', () => {
  beforeEach(() => { vi.useFakeTimers(); document.documentElement.removeAttribute(IMAGES_HELD_ATTR) })
  afterEach(() => { vi.useRealTimers(); document.documentElement.removeAttribute(IMAGES_HELD_ATTR) })

  it('the head script starts the hold', () => {
    runHead()
    expect(held()).toBe(true)
  })

  it.each(['reload', 'back_forward'])('never on a %s: those photos come from the cache, and a reader put back mid-page would meet grey boxes', (type) => {
    const entries = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type }] as never)
    runHead()
    expect(held()).toBe(false)
    entries.mockRestore()
  })

  it('load ends it: every script has arrived, so the photos compete with nothing', () => {
    runHead()
    window.dispatchEvent(new Event('load'))
    expect(held()).toBe(false)
  })

  it('whatever ends it leaves no listener or timer behind', () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    runHead()
    window.dispatchEvent(new Event('load'))
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['load', 'scroll'])
    expect(vi.getTimerCount()).toBe(0)
    removed.mockRestore()
  })

  it('scrolling ends it at once, so the photos start loading', () => {
    runHead()
    window.dispatchEvent(new Event('scroll'))
    expect(held()).toBe(false)
  })

  it('a scroll inside a rail ends it too, though it does not bubble', () => {
    runHead()
    const rail = document.body.appendChild(document.createElement('div'))
    rail.dispatchEvent(new Event('scroll'))
    rail.remove()
    expect(held()).toBe(false)
  })

  it('a load that never comes still shows the photos', () => {
    runHead()
    vi.advanceTimersByTime(IMAGE_HOLD_TIMEOUT_MS - 1)
    expect(held()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(held()).toBe(false)
  })

  it('a throw in the script means no hold, which is the page as it always was', () => {
    const set = vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(() => { throw new Error('no') })
    expect(runHead).not.toThrow()
    set.mockRestore()
    expect(held()).toBe(false)
  })
})

describe('the parts that must stay wired', () => {
  it('the layout runs the head script', () => {
    expect(readFileSync('src/app/[lang]/layout.tsx', 'utf8')).toMatch(/__html: IMAGE_HOLD_JS/)
  })

  it.each([['src/components/marketplace/seller-listings.tsx', 'i'], ['src/components/marketplace/listings-explorer.tsx', 'index']])('%s marks only its cards past the first screen', (file, index) => {
    expect(readFileSync(file, 'utf8')).toContain(`holdPhoto={${index} >= HELD_FROM_CARD}`)
  })
})

describe('the stylesheet rule', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const rule = new RegExp(`@media \\(max-width: 639\\.98px\\) and \\(max-height: 1100px\\) \\{\\s*html\\[${IMAGES_HELD_ATTR}\\] img\\[${HELD_PHOTO_ATTR}\\] \\{\\s*display: none;`)

  it('hides only a held photo, only during the hold, only on a screen too short to reach it', () => {
    expect(css).toMatch(rule)
  })

  it('stops where LISTING_GRID turns to three columns', () => {
    expect(readFileSync('src/components/marketplace/listing-grid.ts', 'utf8')).toMatch(/grid-cols-2 [^']*sm:grid-cols-3/)
  })
})
