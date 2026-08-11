// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import type { DimensionCounts } from '@/lib/facet-counts'
import {
  LADDER_ALL,
  MobileLadder,
  allChipCount,
  ladderPath,
  optionCount,
  usableOptions,
  visibleLevels,
  type LadderLevel,
} from './mobile-ladder'

/**
 * THE MOBILE LADDER — the things that are invisible in a screenshot and expensive to get wrong:
 * what the counts contract actually says, which chips are allowed to exist, and whether the
 * collapsed line still tells the truth about the path.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach and the second render in the file would fail with "Found
 * multiple elements". Same note as result-line.test.tsx and chat-send-button.test.tsx.
 */
afterEach(cleanup)

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * HARNESS
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ jsdom SHIPS NEITHER OBSERVER, AND WITHOUT BOTH STUBS EVERY RENDER IN THIS FILE THROWS.
 * `useScrollArrows` constructs a ResizeObserver on mount (one per rail), and the sticky line's
 * collapse is driven by an IntersectionObserver. Stubbing them is not a shortcut around the
 * behaviour — the IO stub is the only way to DRIVE the collapse deterministically, since jsdom
 * has no layout and therefore no scrolling to observe.
 */
/**
 * ⚠️ THE STUB MODELS THE REAL COORDINATE SPACES, AND THE FIRST VERSION DID NOT — WHICH IS HOW IT
 * CERTIFIED A BUG. It hand-fed a single `boundingClientRect.top` and the component compared that
 * against 0, so the test and the defect agreed with each other and the suite was green.
 *
 * The spec: `rootMargin` shifts the ROOT rectangle, which the entry reports as `rootBounds`. The
 * target's `boundingClientRect` is plain viewport coordinates and is NEVER adjusted. So the stub
 * takes the rows' real viewport box plus the dock offset the component asked for, and derives
 * both fields the way a browser would — including `isIntersecting`. A test that cannot express
 * the difference between the two origins cannot test the thing that went wrong.
 */
type IORect = { top: number; bottom: number }
type IOEntryish = { isIntersecting: boolean; boundingClientRect: IORect; rootBounds: IORect | null }
type IOCb = (entries: IOEntryish[]) => void
/** The margin each live observer was constructed with, so the stub can shift the root like a
 *  browser does instead of taking the answer as an input. */
const liveIO = new Map<IOCb, number>()

/** Pretend viewport height — only its ORDER relative to the fixtures matters. */
const VIEWPORT_H = 800

class FakeIntersectionObserver {
  constructor(
    private cb: IOCb,
    init?: { rootMargin?: string },
  ) {
    // "-44px 0px 0px 0px" → 44. This is the number the component measured off the bar, so the
    // stub learns the dock line from the component rather than from the test author.
    const top = /^(-?\d+(?:\.\d+)?)px/.exec(init?.rootMargin ?? '')
    liveIO.set(cb, top ? -Number(top[1]) : 0)
  }
  observe() {}
  unobserve() {}
  takeRecords(): IOEntryish[] {
    return []
  }
  disconnect() {
    liveIO.delete(this.cb)
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  liveIO.clear()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
  liveIO.clear()
})

/**
 * Put the ladder's rows at a real VIEWPORT position and let the stub derive what a browser would
 * report. `top`/`bottom` are plain client coordinates — the same numbers a scroll produces.
 */
function rowsAt({ top, bottom }: { top: number; bottom: number }) {
  act(() => {
    for (const [cb, dock] of Array.from(liveIO)) {
      const rootBounds = { top: dock, bottom: VIEWPORT_H }
      // A browser's own definition: any overlap with the (shifted) root at all.
      const isIntersecting = bottom > rootBounds.top && top < rootBounds.bottom
      cb([{ isIntersecting, boundingClientRect: { top, bottom }, rootBounds }])
    }
  })
}

/** The dock offset the component measured and handed to its observer. */
function measuredDock(): number {
  return Array.from(liveIO.values())[0] ?? 0
}

/** Rows scrolled fully up past the dock line. */
const scrolledPastDock = () => rowsAt({ top: -220, bottom: -20 })
/** Rows on screen near the top of the page. */
const restingAtTop = () => rowsAt({ top: 10, bottom: 200 })
/** Rows still below the fold — a short viewport, or a deep-linked scroll position. */
const stillBelowFold = () => rowsAt({ top: 400, bottom: 600 })

/**
 * Give the sticky bar a REAL geometry. jsdom reports every rect as zero, so without this the
 * measured dock is 0 and the coordinate-space regression below — which only exists when the dock
 * is non-zero — is unreachable. 56 + 44 is the shape an integrator gets when they follow this
 * file's advice and pass the resolved header height as `stickyTop`.
 */
function stubDock(top: number, height: number): () => void {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLElement && this.dataset.slot === 'mobile-ladder-sticky') {
      return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
    return orig.call(this)
  }
  return () => {
    Element.prototype.getBoundingClientRect = orig
  }
}

/** The dropped-option diagnostic, picked out BY CONTENT rather than by `calls[0]` or a call count.
 *  React and the primitives warn too, so an index would couple these assertions to whatever else
 *  happened to log first — and a count would fail the moment anything else in the tree spoke up. */
function droppedWarning(warn: { mock: { calls: unknown[][] } }): string {
  const hit = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('cannot be rendered as a chip'))
  return hit ?? '(no dropped-option warning was emitted)'
}

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT localStorage — measured by result-line.test.tsx
 * on this same jsdom/vitest pairing, where `window.localStorage` is a bare object with no
 * getItem/setItem, so the provider's own try/catch swallows the write and every "vi" assertion
 * would silently have run in English. Driving setLang is also what a user actually does.
 */
function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

/**
 * ⚠️ THE PROVIDER IS A `wrapper`, NOT A HAND-BUILT TREE — AND THAT DISTINCTION SILENTLY VOIDED
 * TWO TESTS BEFORE IT WAS FOUND.
 *
 * The obvious harness renders `<LanguageProvider><LangSwitch/>{ui}</LanguageProvider>` and then
 * calls `rerender(<LanguageProvider>{newUi}</LanguageProvider>)`. Those two trees have DIFFERENT
 * children: [LangSwitch, MobileLadder] then [MobileLadder]. React reconciles children by
 * position, sees a different component type at index 0, and unmounts the whole subtree — so
 * every `rerender` was a fresh MOUNT. Two tests written to prove that an effect re-runs on a
 * dependency change, and that a state flag does not survive, therefore passed against code with
 * the bug still in it: a remount re-runs every effect and resets every useState by definition.
 * Measured with a stderr probe (the effect logged on both renders with the old deps).
 *
 * `render(ui, { wrapper })` keeps the tree shape identical across `rerender`, so a rerender is a
 * re-RENDER. Every call site below therefore passes the bare component, never a provider.
 */
function renderIn(lang: 'en' | 'vi', ui: React.ReactElement) {
  function Wrapper({ children }: { children?: React.ReactNode }) {
    return (
      <LanguageProvider>
        <LangSwitch to={lang} />
        {children}
      </LanguageProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}

function rail(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-ladder-level="${id}"]`)
  if (!el) throw new Error(`no rail rendered for level "${id}"`)
  return el
}

/** Deep-freeze, the way the real payload arrives: it is a shared 60s memo entry, so a component
 *  that sorts or patches it in place throws in production and not in a lax fixture. */
function frozenCounts(all: number, values: Record<string, number>): DimensionCounts {
  return Object.freeze({ all, values: Object.freeze({ ...values }) }) as DimensionCounts
}

function level(over: Partial<LadderLevel> & Pick<LadderLevel, 'id'>): LadderLevel {
  return {
    label: over.id,
    options: [],
    value: LADDER_ALL,
    onSelect: () => {},
    ...over,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE COUNTS CONTRACT
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

describe('the counts contract', () => {
  it('renders NO counts for a dimension that was not computed — absent is not zero', () => {
    // This is the `facets: {}` case, which the feed returns on every load-more (offset > 0) and
    // under ?facets=0. A row of honest-looking zeros there would tell the user that every next
    // tap dead-ends, which is the exact opposite of what the chip counts exist to say.
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({
            id: 'brand',
            options: [
              { value: 'honda', label: 'Honda' },
              { value: 'yamaha', label: 'Yamaha' },
            ],
          }),
        ]}
      />,
    )
    expect(rail('brand').textContent).toBe('AllHondaYamaha')
    expect(rail('brand').textContent).not.toMatch(/\d/)
  })

  it('shows counts.all on the All chip WITHOUT summing the visible chips', () => {
    // `all` releases the dimension and keeps every other filter, so it also returns the rows in
    // no bucket (no brand set at all). 9 > 5 + 3 is the correct, expected shape — a component
    // that "reconciled" it by summing would under-report by every brandless listing.
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({
            id: 'brand',
            options: [
              { value: 'honda', label: 'Honda' },
              { value: 'yamaha', label: 'Yamaha' },
            ],
            counts: frozenCounts(9, { honda: 5, yamaha: 3 }),
          }),
        ]}
      />,
    )
    const chips = within(rail('brand')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['All9', 'Honda5', 'Yamaha3'])
  })

  it('renders chips from the OPTIONS and never from Object.keys(counts.values)', () => {
    // The payload honestly reports a number for anything the DATA carries — a legacy `rent` row
    // in a category that is now buy-sell-only, a brand slug that exists only in the DB. Which
    // chips EXIST is a product decision that lives in taxonomy.ts, so a value with no option is
    // a count nobody can see, and an option with no value is still a chip (at an honest 0).
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({
            id: 'type',
            options: [
              { value: 'sell', label: 'For sale' },
              { value: 'wanted', label: 'Wanted' },
            ],
            counts: frozenCounts(12, { sell: 12, rent: 4 }),
          }),
        ]}
      />,
    )
    const chips = within(rail('type')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['All12', 'For sale12', 'Wanted0'])
    expect(rail('type').textContent).not.toMatch(/4/)
  })

  it('survives a deep-frozen payload and frozen options, including across a tap', () => {
    const counts = frozenCounts(9, { honda: 5 })
    // ⚠️ THE FROZEN ARRAY IS PASSED BY REFERENCE. An earlier version spread it (`[...options]`),
    // which hands the component a fresh MUTABLE copy — the test named freezing in its title and
    // then quietly tested nothing. Caught by a reviewer.
    const options = [{ value: 'honda', label: 'Honda' }]
    Object.freeze(options[0])
    Object.freeze(options)
    const onSelect = vi.fn()
    renderIn('en', <MobileLadder levels={[level({ id: 'brand', options, counts, onSelect })]} />)
    // Any in-place sort/patch of either structure throws in a module (always strict mode), so a
    // clean render plus a clean tap IS the assertion.
    fireEvent.click(within(rail('brand')).getByRole('button', { name: /Honda/ }))
    expect(onSelect).toHaveBeenCalledWith('honda')
    expect(counts.values).toEqual({ honda: 5 })
  })

  it('optionCount: absent rail is null, missing key is zero, prototype keys are zero', () => {
    expect(optionCount(undefined, 'honda')).toBeNull()
    const counts = frozenCounts(3, { honda: 3 })
    expect(optionCount(counts, 'honda')).toBe(3)
    expect(optionCount(counts, 'yamaha')).toBe(0)
    // ⚠️ `Listing.model` is seller-typed free text, so these are reachable keys. A bare
    // `values[value]` returns Object.prototype.toString here — a FUNCTION, which formats as NaN.
    expect(optionCount(counts, 'toString')).toBe(0)
    expect(optionCount(counts, 'constructor')).toBe(0)
  })

  it('costs a row its numbers rather than throwing when the payload has no values map', () => {
    /**
     * ⚠️ `hasOwnProperty.call(undefined, k)` DOES NOT RETURN FALSE — it throws
     * `TypeError: Cannot convert undefined or null to object` (measured in node before this test
     * was written). `counts` arrives straight off `GET /api/listings` with no runtime validation,
     * so a version skew or a truncated response that omits `values` would take the whole explorer
     * subtree down to an error boundary instead of costing one rail its counts. The type says
     * this cannot happen; the type is a compile-time promise about JSON.
     */
    const partial = { all: 12 } as unknown as DimensionCounts
    expect(() => optionCount(partial, 'honda')).not.toThrow()
    expect(optionCount(partial, 'honda')).toBe(0)
    expect(optionCount({ all: 12, values: null } as unknown as DimensionCounts, 'honda')).toBe(0)
    renderIn(
      'en',
      <MobileLadder levels={[level({ id: 'brand', options: [{ value: 'honda', label: 'Honda' }], counts: partial })]} />,
    )
    expect(within(rail('brand')).getAllByRole('button').map((c) => c.textContent)).toEqual(['All12', 'Honda0'])
  })

  it('allChipCount: absent rail is null, and a hostile number is clamped rather than printed', () => {
    expect(allChipCount(undefined)).toBeNull()
    expect(allChipCount(frozenCounts(9, {}))).toBe(9)
    expect(allChipCount({ all: -1, values: {} })).toBe(0)
    expect(allChipCount({ all: Number.NaN, values: {} })).toBe(0)
  })

  it('formats counts with the viewer separators, through the repo count formatter', () => {
    // 1200 → "1.2k" in en and "1,2k" in vi. Hand-writing the number would print "1200" for both,
    // which is the drift the money/count formatters exist to prevent.
    const lv = level({
      id: 'category',
      options: [{ value: 'vehicles', label: 'Vehicles' }],
      counts: frozenCounts(1200, { vehicles: 1200 }),
    })
    renderIn('en', <MobileLadder levels={[lv]} />)
    expect(rail('category').textContent).toContain('1.2k')
    cleanup()
    renderIn('vi', <MobileLadder levels={[lv]} />)
    expect(rail('category').textContent).toContain('1,2k')
    expect(rail('category').textContent).toContain('Tất cả')
  })
})

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHICH ROWS EXIST
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

describe('visibleLevels — the cascade comes from the data', () => {
  it('drops a level with no options and keeps one whose parent has no selection', () => {
    // The brand rail opens as soon as a CATEGORY is chosen and most categories are browsed with
    // no subcategory at all — so "show level i only once level i−1 is chosen" would hide brands
    // behind a tap nobody makes. Non-empty options already encode reachability.
    const levels = [
      level({ id: 'category', options: [{ value: 'vehicles', label: 'Vehicles' }], value: 'vehicles' }),
      level({ id: 'subcategory', options: [{ value: 'manual', label: 'Manual' }] }),
      level({ id: 'brand', options: [{ value: 'honda', label: 'Honda' }] }),
      level({ id: 'model', options: [] }),
    ]
    expect(visibleLevels(levels).map((l) => l.id)).toEqual(['category', 'subcategory', 'brand'])
  })

  it('hides a rung whose only options are unusable, instead of leaving an orphan All row', () => {
    // ⚠️ VISIBILITY AND RENDERING MUST USE THE SAME PREDICATE. When the sentinel filter lived
    // privately inside the rail, `visibleLevels` still counted those options: the rung passed the
    // "has options" test and then rendered as a row holding nothing but an All chip that filters
    // nothing — precisely the empty rung the rule exists to hide. Empty string is the same case:
    // `allActive` already treats it as "nothing chosen".
    const levels = [
      level({ id: 'category', options: [{ value: 'vehicles', label: 'Vehicles' }] }),
      level({ id: 'model', options: [{ value: LADDER_ALL, label: 'all' }, { value: '', label: '' }] }),
    ]
    expect(visibleLevels(levels).map((l) => l.id)).toEqual(['category'])
    expect(usableOptions(levels[1].options)).toEqual([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderIn('en', <MobileLadder levels={levels} />)
      expect(document.querySelector('[data-ladder-level="model"]')).toBeNull()
      // ⚠️ AND IT STILL SAYS SO. This is the case the warning could not reach while it lived in
      // the rail: no rail mounts for this rung, so a rail-local effect never ran and the whole
      // level vanished in silence. Asserting it is what keeps the diagnostic where it can fire.
      expect(droppedWarning(warn)).toContain('cannot be rendered as a chip')
    } finally {
      warn.mockRestore()
    }
  })

  it('renders nothing at all when no level has options', () => {
    const { container } = renderIn('en', <MobileLadder levels={[level({ id: 'category' })]} />)
    expect(container.querySelector('[data-slot="mobile-ladder"]')).toBeNull()
  })
})

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * TAPS
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

describe('taps', () => {
  it('selects a chip, toggles the active chip back off, and releases from All', () => {
    const onSelect = vi.fn()
    const options = [
      { value: 'honda', label: 'Honda' },
      { value: 'yamaha', label: 'Yamaha' },
    ]
    const { rerender } = renderIn(
      'en',
      <MobileLadder levels={[level({ id: 'brand', options, onSelect })]} />,
    )
    fireEvent.click(within(rail('brand')).getByRole('button', { name: 'Honda' }))
    expect(onSelect).toHaveBeenLastCalledWith('honda')

    rerender(
      <MobileLadder levels={[level({ id: 'brand', options, value: 'honda', onSelect })]} />,
    )
    // Tap-to-toggle, matching the desktop rails: the chip you are standing on releases the level.
    fireEvent.click(within(rail('brand')).getByRole('button', { name: 'Honda' }))
    expect(onSelect).toHaveBeenLastCalledWith(LADDER_ALL)
    fireEvent.click(within(rail('brand')).getByRole('button', { name: 'All' }))
    expect(onSelect).toHaveBeenLastCalledWith(LADDER_ALL)
  })

  it('marks exactly one chip per rail as pressed, and All when nothing is chosen', () => {
    const options = [
      { value: 'honda', label: 'Honda' },
      { value: 'yamaha', label: 'Yamaha' },
    ]
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({ id: 'brand', options, value: 'honda' }),
          level({ id: 'model', options: [{ value: 'Vision', label: 'Vision' }] }),
        ]}
      />,
    )
    const pressed = (id: string) =>
      within(rail(id))
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
    expect(pressed('brand')).toEqual(['Honda'])
    expect(pressed('model')).toEqual(['All'])
  })

  it('drops an option whose value IS the release sentinel, and says so in development', () => {
    // Reachable: the model rail is keyed by `Listing.model`, which is seller-typed free text.
    // Rendered, such a chip sits pressed alongside the All chip it shares a value with, and
    // tapping it CLEARS the level — a control that can never do what it says.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderIn(
        'en',
        <MobileLadder
          levels={[
            level({
              id: 'model',
              options: [
                { value: LADDER_ALL, label: 'all' },
                { value: 'Vision', label: 'Vision' },
              ],
            }),
          ]}
        />,
      )
      const chips = within(rail('model')).getAllByRole('button')
      expect(chips.map((c) => c.textContent)).toEqual(['All', 'Vision'])
      expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
      expect(droppedWarning(warn)).toContain('cannot be rendered as a chip')
    } finally {
      warn.mockRestore()
    }
  })

  it('drops a repeated option value, keeping the first', () => {
    // Two options with the same value are the same filter twice: a React duplicate-key warning
    // plus two chips both aria-pressed for one selection, with removal undefined between them.
    expect(
      usableOptions([
        { value: 'honda', label: 'Honda' },
        { value: 'yamaha', label: 'Yamaha' },
        { value: 'honda', label: 'Honda (dup)' },
      ]).map((o) => o.label),
    ).toEqual(['Honda', 'Yamaha'])

    // ⚠️ THE WARNING IS STUBBED AND ASSERTED, NOT LEFT TO LEAK. Dropping a duplicate is one of the
    // three things that arm the dev warning, so an unstubbed render here printed a real message
    // into the suite output — and it named only the sentinel, which is the wording this asserts
    // is now general.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderIn(
        'en',
        <MobileLadder
          levels={[
            level({
              id: 'brand',
              value: 'honda',
              options: [
                { value: 'honda', label: 'Honda' },
                { value: 'honda', label: 'Honda (dup)' },
              ],
            }),
          ]}
        />,
      )
      const chips = within(rail('brand')).getAllByRole('button')
      expect(chips.map((c) => c.textContent)).toEqual(['All', 'Honda'])
      expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
      expect(droppedWarning(warn)).toContain('repeated')
    } finally {
      warn.mockRestore()
    }
  })

  it('does not re-fire All when All is already the state', () => {
    // The caller's selections live in a URL, so an unconditional call is a redundant history
    // entry and a redundant feed request every time someone taps the chip they are already on.
    const onSelect = vi.fn()
    renderIn(
      'en',
      <MobileLadder levels={[level({ id: 'brand', options: [{ value: 'honda', label: 'Honda' }], onSelect })]} />,
    )
    fireEvent.click(within(rail('brand')).getByRole('button', { name: 'All' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps every chip at a 44px box and every label contained', () => {
    // jsdom has no layout, so the class list IS the honest assertion here: `min-h-11` is the real
    // 44px tap target (not a `tap-44` ::before, whose overflow would let a tap near the boundary
    // fire the neighbouring filter), and `w-full break-words` on the LABEL is what stops a long
    // name growing past its fit-content chip and spilling over the chip beside it.
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({
            id: 'model',
            options: [{ value: 'x', label: 'Honda Vision 2023 phiên bản đặc biệt' }],
          }),
        ]}
      />,
    )
    for (const chip of within(rail('model')).getAllByRole('button')) {
      expect(chip.className).toContain('min-h-11')
      expect(chip.className).toContain('whitespace-normal')
      const label = chip.querySelector('span')
      expect(label?.className).toContain('w-full')
      expect(label?.className).toContain('break-words')
      // ⚠️ AND THE CLAMP, which is what actually lets the other two bite: a flex item's automatic
      // minimum size is its min-content width unless overflow is hidden, and `break-words` alone
      // does not reduce min-content. Shipping two of the three read as containment and was not.
      expect(label?.className).toContain('line-clamp-2')
    }
  })
})

describe('bringing an off-screen selection into view', () => {
  it('scrolls the rail when the selected chip FINALLY exists, not only when the value changes', () => {
    /**
     * ⚠️ THE CASE THE EFFECT WAS WRITTEN FOR, AND THE ONE ITS FIRST DEPS ARRAY COULD NOT SEE.
     * A rail can be mounted and populated while the SELECTED option is still missing — a model
     * restored from the URL before its list has landed, a stale pick the caller has not healed.
     * The effect ran on that render, found nothing, and returned; `level.value` never changed
     * again, so keying on it alone meant no later render re-ran it and the chip filtering the
     * user's feed stayed off-screen behind a horizontal swipe. All three reviewer families
     * flagged it. `chipExists` is the trigger that actually flips.
     */
    const scrollTo = vi.fn()
    const origScroll = Element.prototype.scrollTo
    const origRect = Element.prototype.getBoundingClientRect
    // jsdom implements no element scrolling and reports every rect as zero, so both stubs are
    // what make this path reachable at all — the component feature-detects `scrollTo` and skips
    // any chip it measures as already visible.
    Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo']
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      // Chips sit off the right edge of a 390pt rail; everything else IS the 390pt rail.
      return this instanceof HTMLElement && this.dataset.ladderChip ? rect(500, 600) : rect(0, 390)
    }
    try {
      const models = (options: { value: string; label: string }[]) => [
        level({ id: 'model', options, value: 'Vision' }),
      ]
      const { rerender } = renderIn('en', <MobileLadder levels={models([{ value: 'Wave', label: 'Wave' }])} />)
      expect(scrollTo).not.toHaveBeenCalled()

      rerender(
        <MobileLadder
          levels={models([
            { value: 'Wave', label: 'Wave' },
            { value: 'Vision', label: 'Vision' },
          ])}
        />,
    )
      expect(scrollTo).toHaveBeenCalledTimes(1)
      // The MINIMUM nudge, not a left-anchor: the chip [500,600] is cut off by the rail's right
      // edge (390), so scrollLeft moves 600 − 390 + 12 = 222. Anchoring it left would have been
      // 488 — a screen-width jolt for a chip that was already half under the thumb.
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ left: 222 })
    } finally {
      Element.prototype.scrollTo = origScroll
      Element.prototype.getBoundingClientRect = origRect
    }
  })
})

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE STICKY LINE
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

describe('ladderPath', () => {
  it('names every selected rung, root first, and skips a gap instead of stopping at it', () => {
    // "Vehicles › Honda" — category and brand chosen, no subcategory — is a real state, and the
    // line must say both words. Stopping at the first gap would drop a filter that IS applied.
    expect(
      ladderPath([
        level({ id: 'category', options: [{ value: 'vehicles', label: 'Vehicles' }], value: 'vehicles' }),
        level({ id: 'subcategory', options: [{ value: 'manual', label: 'Manual' }] }),
        level({ id: 'brand', options: [{ value: 'honda', label: 'Honda' }], value: 'honda' }),
      ]),
    ).toEqual([
      { id: 'category', label: 'Vehicles' },
      { id: 'brand', label: 'Honda' },
    ])
  })

  it('falls back to the raw value when the option list has not landed yet', () => {
    // A model restored from the URL before its rail has fetched is still filtering the feed.
    // Showing the slug is ugly; showing nothing would say the feed is unfiltered, which is a lie.
    expect(ladderPath([level({ id: 'model', options: [], value: 'honda-vision' })])).toEqual([
      { id: 'model', label: 'honda-vision' },
    ])
  })

  it('is empty when nothing is selected', () => {
    expect(ladderPath([level({ id: 'category', options: [{ value: 'a', label: 'A' }] })])).toEqual([])
  })
})

describe('the sticky line', () => {
  const deepLevels = (onSelect = () => {}): LadderLevel[] => [
    level({ id: 'category', options: [{ value: 'vehicles', label: 'Vehicles' }], value: 'vehicles', onSelect }),
    level({ id: 'subcategory', options: [{ value: 'manual', label: 'Manual' }], value: 'manual', onSelect }),
    level({ id: 'brand', options: [{ value: 'honda', label: 'Honda' }], value: 'honda', onSelect }),
    level({ id: 'model', options: [{ value: 'Vision', label: 'Vision' }], value: 'Vision', onSelect }),
  ]

  const bar = () => document.querySelector<HTMLElement>('[data-slot="mobile-ladder-sticky"]')

  it('does not exist while nothing is selected — an empty path has nothing to say', () => {
    renderIn('en', <MobileLadder levels={[level({ id: 'category', options: [{ value: 'a', label: 'A' }] })]} />)
    expect(bar()).toBeNull()
  })

  it('stays mounted but inert until the rows go up past the dock line', () => {
    // ⚠️ MOUNTED, NOT ABSENT: the bar's own rect is what the observer's dock line is measured
    // FROM (top may be an env()/calc() only the browser can resolve), so it fades rather than
    // unmounts. `inert` is what keeps an invisible control out of the tab order AND the a11y tree.
    renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    expect(bar()).not.toBeNull()
    expect(bar()!.hasAttribute('inert')).toBe(true)
    expect(bar()!.className).toContain('opacity-0')

    // Still BELOW the fold (short viewport / deep-linked scroll): not intersecting, but the rows
    // have not gone past the dock. Docking here would show a "collapsed" line above rows the
    // user has not reached.
    stillBelowFold()
    expect(bar()!.hasAttribute('inert')).toBe(true)

    scrolledPastDock()
    expect(bar()!.hasAttribute('inert')).toBe(false)
    expect(bar()!.className).toContain('opacity-100')

    restingAtTop()
    expect(bar()!.hasAttribute('inert')).toBe(true)
  })

  it('names the FULL path once collapsed', () => {
    renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    scrolledPastDock()
    const nav = within(bar()!).getByRole('navigation', { name: 'Selected path' })
    expect(nav.textContent).toBe('Vehicles›Manual›Honda›Vision')
  })

  it('clears the path, and offers no clear control when the caller owns no reset', () => {
    // ⚠️ NOT DERIVED as four onSelect(LADDER_ALL) calls: the caller's selections live in a URL,
    // so a loop would be four history entries and four feed requests for one user intent.
    const onClear = vi.fn()
    const { rerender } = renderIn('en', <MobileLadder levels={deepLevels()} onClear={onClear} onReopen={() => {}} />)
    scrolledPastDock()
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)

    rerender(
      <MobileLadder levels={deepLevels()} onReopen={() => {}} />,
    )
    expect(within(bar()!).queryByRole('button', { name: 'Clear selection' })).toBeNull()
  })

  it('is a way back into the ladder, not only a way to delete it', () => {
    const onReopen = vi.fn()
    renderIn('en', <MobileLadder levels={deepLevels()} onReopen={onReopen} />)
    scrolledPastDock()
    fireEvent.click(within(bar()!).getByRole('button', { name: /Vehicles/ }))
    expect(onReopen).toHaveBeenCalledTimes(1)
  })

  it('takes its offset and stacking order from props, hard-coding no chrome constant', () => {
    // #app-header has three geometries and the bottom bar is 72px; nothing here may guess either.
    // The default is deliberately UNDER the header (z 30 < 40) at top 0, because the header
    // retracts on scroll-down — exactly when this line has a job.
    renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    expect(bar()!.style.top).toBe('var(--ladder-sticky-top, 0px)')
    expect(bar()!.style.zIndex).toBe('30')
    expect(bar()!.style.paddingRight).toBe('calc(0.75rem + var(--ladder-sticky-inset-end, 0px))')

    cleanup()
    renderIn(
      'en',
      <MobileLadder
        levels={deepLevels()}
        onReopen={() => {}}
        stickyTop="calc(3.5rem + env(safe-area-inset-top))"
        stickyZIndex={45}
        stickyInsetEnd="var(--reserve, 4.25rem)"
      />,
    )
    expect(bar()!.style.top).toBe('calc(3.5rem + env(safe-area-inset-top))')
    expect(bar()!.style.zIndex).toBe('45')
    // ⚠️ THE RESERVE IS ADDED TO THE GUTTER, NEVER INSTEAD OF IT. Asserted through a `var()` the
    // CSS parser cannot fold: with a plain `4.25rem` this read `calc(5rem)`, which pinned the test
    // to one engine's constant folding and would go red on a jsdom bump for no product reason.
    // 4.25rem is the recommended bottom-dock value — the back-to-top cluster measures 44px at a
    // 16px gutter (60px), plus an 8px gap.
    expect(bar()!.style.paddingRight).toBe('calc(0.75rem + var(--reserve, 4.25rem))')
  })

  it('keeps the deepest rung when the line has to give up width', () => {
    // The rung the user just chose is the one they are looking for, so earlier rungs shrink and
    // ellipsise first. jsdom cannot measure, so the shrink rules themselves are the assertion.
    renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    scrolledPastDock()
    const spans = Array.from(
      within(bar()!).getByRole('navigation', { name: 'Selected path' }).querySelectorAll('span'),
    ).filter((s) => !s.hasAttribute('aria-hidden'))
    expect(spans.map((s) => s.textContent)).toEqual(['Vehicles', 'Manual', 'Honda', 'Vision'])
    for (const s of spans.slice(0, -1)) expect(s.className).toContain('shrink ')
    const last = spans[spans.length - 1]
    expect(last.className).toContain('shrink-0')
    expect(last.className).toContain('truncate')
  })

  it('docks the moment the rows pass the DOCK LINE, not the top of the screen', () => {
    /**
     * ⚠️ THE REGRESSION THREE REVIEWER FAMILIES FOUND INDEPENDENTLY, and the reason the harness
     * above had to be rebuilt: `rootMargin` shifts `rootBounds`, never the target's own
     * `boundingClientRect`. Comparing the target against 0 therefore asks "have the rows left the
     * SCREEN" instead of "have they gone behind the BAR", and everything in between reads as
     * neither — rows hidden under the header, no path line, for the whole dock offset.
     *
     * Here the bar sits at 56 with a height of 44, so the dock line is 100 — what an integrator
     * gets when they follow the file's own advice and pass the resolved header height. Rows at
     * y ∈ [10, 90] are entirely behind it and entirely on the screen: the old predicate said
     * "not collapsed" (top 10 is not < 0), the correct one says "collapsed".
     */
    const restore = stubDock(56, 44)
    try {
      renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
      expect(measuredDock()).toBe(100)
      rowsAt({ top: 10, bottom: 90 })
      expect(bar()!.hasAttribute('inert')).toBe(false)
      expect(bar()!.className).toContain('opacity-100')
      // And it still does NOT dock while any part of the rows is below the line.
      rowsAt({ top: 60, bottom: 260 })
      expect(bar()!.hasAttribute('inert')).toBe(true)
    } finally {
      restore()
    }
  })

  it('attaches its observer when the ROWS arrive, not only when the path changes', () => {
    /**
     * ⚠️ THE DEEP-LINK RESTORE, WHICH KILLED THE FEATURE OUTRIGHT UNTIL TWO REVIEWER FAMILIES
     * FOUND IT. Land on `?category=vehicles&brand=honda`: the values are known immediately, the
     * option lists are not. `ladderPath` still yields two crumbs (its raw-value fallback), so an
     * effect keyed only on `path.length` runs once against a component that rendered `null`,
     * finds no root, attaches nothing — and never runs again, because the path length never
     * moves. No IntersectionObserver is ever constructed and the bar stays inert for the whole
     * life of the mount.
     */
    const restored = (loaded: boolean) => [
      level({ id: 'category', options: loaded ? [{ value: 'vehicles', label: 'Vehicles' }] : [], value: 'vehicles' }),
      level({ id: 'brand', options: loaded ? [{ value: 'honda', label: 'Honda' }] : [], value: 'honda' }),
    ]
    const { rerender } = renderIn('en', <MobileLadder levels={restored(false)} onReopen={() => {}} />)
    expect(document.querySelector('[data-slot="mobile-ladder"]')).toBeNull()
    expect(liveIO.size).toBe(0)

    // The payload lands. `path.length` is STILL 2 — only the rows changed.
    rerender(<MobileLadder levels={restored(true)} onReopen={() => {}} />)
    expect(liveIO.size).toBe(1)
    scrolledPastDock()
    expect(bar()!.hasAttribute('inert')).toBe(false)
  })

  it('does not remount already-collapsed after the path is cleared', () => {
    // Left true, `collapsed` would survive the bar's unmount and the NEXT path would paint an
    // opaque, click-catching line for the frame before the observer's first callback lands.
    const { rerender } = renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    scrolledPastDock()
    expect(bar()!.hasAttribute('inert')).toBe(false)

    const cleared = [level({ id: 'category', options: [{ value: 'vehicles', label: 'Vehicles' }] })]
    rerender(
      <MobileLadder levels={cleared} onReopen={() => {}} />,
    )
    expect(bar()).toBeNull()

    rerender(
      <MobileLadder levels={deepLevels()} onReopen={() => {}} />,
    )
    expect(bar()!.hasAttribute('inert')).toBe(true)
    expect(bar()!.className).toContain('opacity-0')
  })

  it('does not resurrect an opaque bar when the rails empty and come back', () => {
    // ⚠️ THE SIBLING OF THE CLEARED-PATH CASE, ONE CONDITION OVER. Switch category while scrolled
    // into the results and every rail goes empty for a tick while it refetches — `path.length`
    // never moves, so a reset keyed only on the path leaves `collapsed` true, and the bar returns
    // pinned over content the user is looking straight at, swallowing taps including Clear.
    const loading = [
      level({ id: 'category', options: [], value: 'vehicles' }),
      level({ id: 'brand', options: [], value: 'honda' }),
    ]
    const { rerender } = renderIn('en', <MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    scrolledPastDock()
    expect(bar()!.hasAttribute('inert')).toBe(false)

    rerender(<MobileLadder levels={loading} onReopen={() => {}} />)
    expect(document.querySelector('[data-slot="mobile-ladder"]')).toBeNull()

    rerender(<MobileLadder levels={deepLevels()} onReopen={() => {}} />)
    expect(bar()!.hasAttribute('inert')).toBe(true)
    expect(bar()!.className).toContain('opacity-0')
  })

  it('scrolls the rows back under the dock when no onReopen is supplied', () => {
    // ⚠️ THE DEFAULT PATH HAD NO COVERAGE AT ALL — every other test here passes `onReopen`, so the
    // documented reason this line is not a dead end had never executed. jsdom's `window.scrollBy`
    // is a not-implemented stub, so the spy is also what makes it observable.
    const scrollBy = vi.fn()
    const orig = window.scrollBy
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    const restore = stubDock(56, 44)
    try {
      renderIn('en', <MobileLadder levels={deepLevels()} />)
      scrolledPastDock()
      fireEvent.click(within(bar()!).getByRole('button', { name: /Vehicles/ }))
      // root.top (0 in jsdom) − the BAR'S TOP (56), not the dock line at 56+44: the bar is gone
      // by the time the scroll lands, so aiming at the dock would park the rows 44px too low.
      // A MEASURED delta either way, never a chrome constant.
      expect(scrollBy).toHaveBeenCalledWith({ top: -56, behavior: 'smooth' })
    } finally {
      restore()
      window.scrollBy = orig
    }
  })

  it('speaks Vietnamese', () => {
    renderIn('vi', <MobileLadder levels={deepLevels()} onClear={() => {}} onReopen={() => {}} />)
    scrolledPastDock()
    expect(within(bar()!).getByRole('navigation', { name: 'Đường dẫn đã chọn' })).toBeTruthy()
    expect(within(bar()!).getByRole('button', { name: 'Xóa lựa chọn' })).toBeTruthy()
  })
})

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * A11Y NAMING
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

describe('rails name themselves without spending the fold on headings', () => {
  it('labels each row as a group with the caller localised label', () => {
    renderIn(
      'en',
      <MobileLadder
        levels={[
          level({ id: 'brand', label: 'Brand', options: [{ value: 'honda', label: 'Honda' }] }),
          level({ id: 'model', label: 'Model', options: [{ value: 'Vision', label: 'Vision' }] }),
        ]}
      />,
    )
    expect(screen.getByRole('group', { name: 'Brand' })).toBe(rail('brand'))
    expect(screen.getByRole('group', { name: 'Model' })).toBe(rail('model'))
    // No visible heading text: on a 390pt screen four labelled rows spend a third of the fold on
    // words the chips beneath them already say.
    expect(rail('brand').textContent).toBe('AllHonda')
  })
})
