// @vitest-environment jsdom
// ⚠️ jsdom, because this module reads `window.localStorage` and the suite's default is node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  TOUR_EXAMPLE_QUERY,
  TOUR_DRILL,
  TOUR_TARGETS,
  drillDone,
  hasSeenTour,
  markTourSeen,
  resetTour,
  tourAnchorFor,
} from './intro-tour'

/**
 * ⚠️ A REAL STORAGE IS STUBBED IN, because the one jsdom provides in this suite is a partial shim:
 * it has no `clear`, and `getItem` throws — which sent every happy-path assertion down the
 * unreadable-storage branch and made `hasSeenTour()` answer `true` on a fresh store. Measured
 * rather than assumed after the first run failed. A Map is enough and behaves the same.
 */
beforeEach(() => {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  })
  resetTour()
})
afterEach(() => vi.unstubAllGlobals())

describe('tour memory', () => {
  it('has not been seen until it is marked, and stays seen after', () => {
    expect(hasSeenTour()).toBe(false)
    markTourSeen()
    expect(hasSeenTour()).toBe(true)
    resetTour()
    expect(hasSeenTour()).toBe(false)
  })

  /**
   * ⛔ FAILS TOWARD "DO NOT SHOW IT". Safari in private mode THROWS on localStorage rather than
   * returning null. Answering `false` there would replay the tour on every single page load with no
   * way for the visitor to make it stop — far worse than never showing it at all.
   */
  it('treats unreadable storage as already seen', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('SecurityError') },
      setItem() { throw new Error('SecurityError') },
      removeItem() { throw new Error('SecurityError') },
    })
    expect(hasSeenTour()).toBe(true)
    // …and neither write may escape, or first paint dies with it.
    expect(() => markTourSeen()).not.toThrow()
    expect(() => resetTour()).not.toThrow()
  })
})

describe('steps', () => {
  it('anchors the search step and every drill step, and centres the rest', () => {
    expect(tourAnchorFor('search')).toBe(TOUR_TARGETS.search)
    expect(tourAnchorFor('category')).toBe('[data-cat="electronics"]')
    expect(tourAnchorFor('subcategory')).toBe('[data-subcat="phone-cases"]')
    expect(tourAnchorFor('brand')).toBe('[data-brand="apple"]')
    expect(tourAnchorFor('model')).toBe('[data-model="iPhone 17 Pro Max"]')
    expect(tourAnchorFor('result')).toBeNull()
    expect(tourAnchorFor('signup')).toBeNull()
  })

  /**
   * ⛔ THE STEP ADVANCES ONLY WHEN THE VISITOR'S OWN CLICK LANDS. Owner: "let them experience how to
   * find" — so each level is read back off the query string the explorer maintains, which is true
   * however they got there (the highlighted chip or its copy inside the "More" overflow).
   */
  it('reads each drill level back off the query string', () => {
    expect(drillDone('category', '?category=electronics')).toBe(true)
    expect(drillDone('category', '?category=vehicles')).toBe(false)
    expect(drillDone('category', '')).toBe(false)
    expect(drillDone('subcategory', '?category=electronics&subcategory=phone-cases')).toBe(true)
    expect(drillDone('brand', '?category=electronics&subcategory=phone-cases&brand=apple')).toBe(true)
    expect(drillDone('model', '?model=iPhone+17+Pro+Max')).toBe(true)
    // Steps that are not part of the drill can never satisfy it.
    expect(drillDone('search', '?q=anything')).toBe(false)
    expect(drillDone('signup', '?category=electronics')).toBe(false)
  })

  /** The selectors and the params must describe the SAME control, or a step waits forever. */
  it('pairs every drill selector with the param that clicking it sets', () => {
    for (const [id, d] of Object.entries(TOUR_DRILL)) {
      expect(tourAnchorFor(id as never), id).toBe(d.selector)
      expect(drillDone(id as never, `?${d.param}=${encodeURIComponent(d.value)}`), id).toBe(true)
    }
  })

  /**
   * The owner named the example: Electronics → Apple → iPhone 17 Pro Max covers.
   * ⚠️ Asserts the QUERY the tour dispatches, not a href — an earlier version pinned a
   * `TOUR_EXAMPLE_HREF` that the code had stopped using, which is false confidence rather than a test.
   */
  it('points the worked example at the phone the owner asked for', () => {
    expect(TOUR_EXAMPLE_QUERY).toBe('iPhone 17 Pro Max case')
  })
})

/**
 * ⛔ THE SELECTORS ARE A CONTRACT WITH THE MARKUP, AND A BROKEN ONE IS SILENT. A step whose anchor
 * has vanished is SKIPPED, by design — so renaming `data-tour="search"` in header.tsx without
 * touching intro-tour.ts does not throw, does not warn, and does not fail any other test. It just
 * quietly makes the tour one step shorter. This is the assertion that notices.
 */
describe('the anchors exist in the markup', () => {
  const grep = (pattern: string): string[] => {
    try {
      return execFileSync('git', ['grep', '-l', '--untracked', '-F', pattern, '--', 'src'], { encoding: 'utf8' })
        .split('\n').filter(Boolean).filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'src/lib/intro-tour.ts')
    } catch (e) {
      const err = e as { status?: number; code?: string }
      if (err.status !== 1) throw new Error(`git grep failed (${err.code ?? `status ${err.status}`})`)
      return []
    }
  }

  /**
   * ⚠️ THIS COUNTS FILES, NOT ELEMENTS — `git grep -l` lists paths, so one file could still render
   * the attribute twice and `document.querySelector` would take whichever came first. The stronger
   * claim is checked in the browser instead (both anchors measured unique on the built home page);
   * what this pins is the thing a unit test CAN pin: the attribute exists, in exactly one place, so
   * a rename cannot silently shorten the tour. A reviewer was right that the old wording oversold it.
   */
  /**
   * ⚠️ COVERS THE DRILL SELECTORS TOO. The first version checked only TOUR_TARGETS, so the four
   * chips the guided walk depends on — `data-cat`, `data-subcat`, `data-brand`, `data-model` —
   * were unpinned: rename one and the step would poll, time out and skip, quietly turning a
   * four-level walkthrough into a shorter one. A reviewer pointed at the gap.
   */
  it('every anchored step has its attribute in the markup', () => {
    const all = { ...TOUR_TARGETS, ...Object.fromEntries(Object.entries(TOUR_DRILL).map(([k, d]) => [k, d.selector])) }
    for (const [id, selector] of Object.entries(all)) {
      // `[data-tour="search"]` → `data-tour="search"`, the literal that appears in the JSX.
      const attr = selector.replace(/^\[|\]$/g, '')
      // ⚠️ The attribute NAME, not the whole `[name="value"]` — the value is dynamic in the JSX
      // (`data-subcat={sub.slug}`), so only the attribute itself can be grepped for.
      const name = attr.split('=')[0]
      expect(grep(name).length, `nothing carries ${name} — the "${id}" step would be skipped`).toBeGreaterThan(0)
    }
  })
})
