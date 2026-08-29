// @vitest-environment jsdom
// ⚠️ jsdom, because this module reads `window.localStorage` and the suite's default is node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  TOUR_EXAMPLE_QUERY,
  TOUR_DEMO,
  TOUR_TARGETS,
  hasSeenTour,
  markTourSeen,
  markTourPending,
  tourPending,
  resetTour,
  tourAnchorFor,
  TOUR_STORAGE_KEY,
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

  /**
   * ⛔ THE SHAPE THAT ACTUALLY BIT, and it is NOT the one above. iOS Safari in private mode does not
   * throw on `getItem` — it reads fine and returns null; only the WRITE throws on quota. So the
   * "unreadable storage" branch never runs, `hasSeenTour()` correctly answers false, `markTourSeen()`
   * silently fails, and the visitor gets the tour again on every single load with no way to stop it.
   * That is what the owner reported on 2026-08-28, and a reviewer reading only the test above
   * concluded the opposite — that a storage failure SUPPRESSES the tour. Both are true, of different
   * failures. The cookie mirror is what closes this one.
   */
  it('still remembers when writes are refused but reads work (private mode)', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem() { throw new Error('QuotaExceededError') },
      removeItem: (k: string) => { map.delete(k) },
    })
    expect(hasSeenTour()).toBe(false)
    markTourSeen()
    expect(hasSeenTour()).toBe(true)
    // and a reset must reach the cookie too, or it would silently do nothing
    resetTour()
    expect(hasSeenTour()).toBe(false)
  })

  /**
   * ⛔ A COOKIE WHOSE NAME MERELY *ENDS* WITH OURS MUST NOT COUNT. The first version tested
   * `document.cookie.includes('eno_intro_tour_v1=done')`, which any cookie named `x_eno_intro_tour_v1`
   * also satisfies — and since `resetTour()` deletes only the exact name, the tour would have been
   * pinned to "already seen" with no way to clear it. A reviewer caught it.
   */
  it('does not mistake a different cookie whose name ends with ours', () => {
    document.cookie = `x_${TOUR_STORAGE_KEY}=done; path=/`
    expect(hasSeenTour()).toBe(false)
    document.cookie = `x_${TOUR_STORAGE_KEY}=; path=/; max-age=0`
  })

  /**
   * ⛔ THE CLAIM SURVIVES A FIRST PAGE THAT IS NOT THE HOME PAGE. The consent card is global, the
   * tour only runs on `/`, and dropping the event off-home lost the tour permanently for anyone who
   * arrived on a shared listing link — consent is stored by then, so the card never fires again.
   * ⚠️ AND IT IS STILL A ONE-SHOT: starting spends it, so a reload cannot replay the tour.
   */
  /**
   * ⛔ THE ONE REVERSION design-lint CANNOT SEE. That gate fires on lines carrying `tour-mask`, so
   * the realistic tidy-up — DELETING the class and restoring `'fixed bg-black/40 material
   * backdrop-blur-md'` — produces no finding at all, and is perfectly legal for every other
   * material in the app. It is also exactly how the reported bug is reintroduced: those covered
   * tints are forced to #000 under `prefers-contrast: more`, and four opaque panels around a small
   * hole is a black screen. A reviewer pointed out the guard promised more than it delivered; this
   * is the half that has to live here, because it is an assertion about a specific file.
   */
  it('keeps the spotlight mask on .tour-mask, with no tint or blur utility', () => {
    const src = readFileSync('src/components/marketplace/intro-tour.tsx', 'utf8')
    /**
     * ⚠️ READS THE MASK'S OWN className, NOT A `const panel`. The first version pinned that
     * constant, which vanished when the four geometry-animated panels became one clip-path overlay
     * — so the guard failed for a reason that had nothing to do with what it guards. Matching the
     * class list wherever it lives survives that shape change and the next one.
     */
    /**
     * ⚠️ A WINDOW AROUND THE TOKEN, NOT A `className=` MATCH — the same approach design-lint's
     * `tour-mask` rule settled on, and for the same reason. The class list is assembled with `cn()`
     * across two arguments, so a regex anchored to `className="…"` finds nothing and a regex for
     * the first string literal finds only half of it. Reading the neighbourhood covers both.
     * ⚠️ EXACTLY ONE MASK, asserted so that a second element carrying its own tint — the shape a
     * reviewer pointed at — is a failure rather than a silent bypass.
     */
    /**
     * ⚠️ COMMENTS STRIPPED FIRST. The note explaining WHY this mask is one clip-path element quotes
     * the class name it replaced, so a raw count sees two and fails for the most annoying possible
     * reason: prose. design-lint's own `tour-mask` rule strips comments before scanning for exactly
     * this; a guard that a comment can trip teaches people to stop writing comments.
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    const hits = [...code.matchAll(/\btour-mask\b/g)]
    expect(hits, 'nothing in intro-tour.tsx carries `tour-mask` — did the mask move or get renamed?').toHaveLength(1)
    const cls = code.slice(Math.max(0, hits[0].index - 220), hits[0].index + 220)
    expect(cls).toContain('material')
    // ⛔ The mask must not swallow the tap the step is asking for — see the note at its call site.
    expect(cls).toContain('pointer-events-none')
    // ⚠️ Both spellings of the failure: a translucent tint AND a fully opaque one.
    expect(cls).not.toMatch(/\bbg-[a-z0-9[\]()-]+(\/[0-9]+)?\b/)
    expect(cls).not.toMatch(/backdrop-blur/)
  })
  it('parks the claim off-home and spends it exactly once', () => {
    expect(tourPending()).toBe(false)
    markTourPending()
    expect(tourPending()).toBe(true)
    expect(hasSeenTour()).toBe(false)
    markTourSeen()
    expect(tourPending()).toBe(false)
    expect(hasSeenTour()).toBe(true)
  })
})

describe('steps', () => {
  it('anchors the search step and every demo step, and centres the last', () => {
    expect(tourAnchorFor('search')).toBe(TOUR_TARGETS.search)
    expect(tourAnchorFor('category')).toBe('[data-cat="electronics"]')
    expect(tourAnchorFor('subcategory')).toBe('[data-subcat="laptops-pcs"]')
    expect(tourAnchorFor('brand')).toBe('[data-brand="apple"]')
    expect(tourAnchorFor('model')).toBe('[data-model="MacBook Pro M5"]')
    // The one step with no target: the closing card is centred in the viewport.
    expect(tourAnchorFor('result')).toBeNull()
  })

  /**
   * ⛔ THE SELECTOR AND THE PARAM MUST DESCRIBE THE SAME CONTROL. The tour drives the URL and points
   * the hand at a chip; if those two disagree the visitor watches a highlighted "Electronics" while
   * the results filter to something else — a demonstration that demonstrates a lie. Nothing else
   * checks it, because each half is correct on its own.
   */
  it('pairs every demo selector with the parameter it stands for', () => {
    for (const d of TOUR_DEMO) {
      expect(tourAnchorFor(d.id), d.id).toBe(d.selector)
      // The value must be the one written into the selector, or the hand and the filter diverge.
      expect(d.selector, d.id).toContain(`="${d.value}"`)
      expect(tourAnchorFor(d.id), d.id).toBeTruthy()
    }
  })

  /**
   * ⛔ THE ORDER IS THE DEMONSTRATION. Category before subcategory before brand before model is the
   * order the facet UI reveals them in; shuffle it and a step filters by a control the interface
   * has not offered yet. ⚠️ The owner asked for "model and lastly brand" — the interface disagrees
   * and the interface wins here; see the note in intro-tour.ts.
   */
  it('walks the facets in the order the interface reveals them', () => {
    expect(TOUR_DEMO.map((d) => d.id)).toEqual(['category', 'subcategory', 'brand', 'model'])
  })

  /**
   * ⛔ PINNED BECAUSE THE OWNER'S OWN STRING RETURNS ZERO LISTINGS. They asked for "Macbook pro 16
   * inch m5 64GB 1TB"; measured against production that returns 0, while this trimmed form returns
   * 25 and the full facet chain on top of it still returns 8. A tour that ends on an empty page
   * teaches the visitor the catalogue is empty, so this string is a deliberate edit, not a drift.
   */
  it('points the worked example at a query that has stock', () => {
    expect(TOUR_EXAMPLE_QUERY).toBe('Macbook Pro M5 1TB')
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
   * ⚠️ COVERS THE DEMO SELECTORS TOO. The first version checked only TOUR_TARGETS, so the four
   * chips — `data-cat`, `data-subcat`, `data-brand`, `data-model` — were unpinned. The consequence
   * has changed with the redesign and is now smaller but stranger: the tour drives the URL, so
   * renaming one no longer stalls it. The filter still applies; the hand simply has nothing to
   * point at, and the visitor watches a step narrate a control that is not highlighted.
   */
  it('every anchored step has its attribute in the markup', () => {
    const all = { ...TOUR_TARGETS, ...Object.fromEntries(TOUR_DEMO.map((d) => [d.id, d.selector])) }
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
