// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { buildHistogram } from '@/lib/price-histogram'
import { PriceRangeFilter } from './price-range-filter'

/**
 * THE PRICE PANEL AGAINST THE BINNED HISTOGRAM (src/lib/price-histogram.ts).
 *
 * What these pin is what the old `{ prices }` endpoint broke on any view with more than 5,000
 * matches: the count must be the WHOLE distribution's, a typed max above the data must be saved as
 * typed (never clamped and turned into "no max"), a URL-restored range outside the data must not
 * be rewritten, and an old cached `{ prices }` body must degrade to "no histogram", not crash.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own
 * (same note as facet-bar.test.tsx).
 */
afterEach(cleanup)

// 12,000 listings — past the old 5,000 cap — spread 0 → 1.45B with most of them cheap.
const HIST = buildHistogram([
  { price: 0, count: 2 },
  { price: 24_000, count: 6_000 },
  { price: 500_000, count: 4_000 },
  { price: 22_000_000, count: 1_997 },
  { price: 1_450_000_000, count: 1 },
])

let histogramBody: unknown = HIST
beforeEach(() => {
  histogramBody = HIST
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('histogram=1') ? histogramBody : {}),
      } as unknown as Response),
    ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function renderFilter(value = 'all', countsApproximate = false) {
  const onChange = vi.fn()
  render(
    <LanguageProvider>
      <CurrencyProvider>
        <PriceRangeFilter value={value} onChange={onChange} query="histogram=1&category=electronics" countsApproximate={countsApproximate} />
      </CurrencyProvider>
    </LanguageProvider>,
  )
  return onChange
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button')[0])
  return await screen.findByRole('dialog', { name: 'Price range' })
}

describe('PriceRangeFilter — binned histogram', () => {
  it('counts the whole distribution, not a 5,000 slice', async () => {
    const user = userEvent.setup()
    renderFilter()
    await open(user)
    expect(await screen.findByText('12000 available')).toBeDefined()
  })

  it('with "Near you" or a text search the grid is not the counted set, so even a stop count shows "≈"', async () => {
    const user = userEvent.setup()
    renderFilter('all', true)
    await open(user)
    expect(await screen.findByText('≈12000 available')).toBeDefined()
  })

  it('a typed max above the data is committed as typed, not clamped to "no max"', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter()
    const dialog = await open(user)
    await screen.findByText('12000 available')
    const [, max] = dialog.querySelectorAll('input[inputmode="numeric"]')
    await user.type(max as HTMLInputElement, '2000000000')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('-2000000000')
  })

  it('a typed bound between two edges shows an estimate', async () => {
    const user = userEvent.setup()
    renderFilter()
    const dialog = await open(user)
    await screen.findByText('12000 available')
    const [min] = dialog.querySelectorAll('input[inputmode="numeric"]')
    // 450,000 sits inside the 400k–500k bin, which holds nothing: still exact.
    await user.type(min as HTMLInputElement, '450000')
    expect(screen.getByText('5998 available')).toBeDefined()
    // 20,000 cuts the 20k–25k bin that holds the 24k listings: an estimate.
    await user.clear(min as HTMLInputElement)
    await user.type(min as HTMLInputElement, '21000')
    expect(screen.getByText(/^≈\d+ available$/)).toBeDefined()
  })

  it('a URL-restored range outside the data is shown verbatim, not rewritten', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('5-3000000000')
    const dialog = await open(user)
    await screen.findByText('11998 available')
    const [min, max] = dialog.querySelectorAll('input[inputmode="numeric"]')
    expect((min as HTMLInputElement).value).toBe('5')
    expect((max as HTMLInputElement).value).toBe('3,000,000,000')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an old cached `{ prices }` body is "no histogram": no crash, the fields still work', async () => {
    histogramBody = { prices: [1, 2, 3] }
    const user = userEvent.setup()
    const onChange = renderFilter()
    const dialog = await open(user)
    await vi.waitFor(() => expect(dialog.querySelectorAll('input[inputmode="numeric"]')).toHaveLength(2))
    expect(dialog.querySelector('[role="slider"]')).toBeNull()
    const [min] = dialog.querySelectorAll('input[inputmode="numeric"]')
    await user.type(min as HTMLInputElement, '100000')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('100000-')
  })

  it('the slider steps over nice edges; the last stop is "no max", one stop down is a clean bound', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter()
    await open(user)
    await screen.findByText('12000 available')
    // jsdom has no layout, so Base UI keeps the thumbs `visibility: hidden` and they have no
    // accessible role here — reach the thumb's range input directly.
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    // The last stop is "no max" and is announced as one — not as the 1.5B edge it sits on.
    expect(hiThumb.getAttribute('aria-valuetext')).toBe('No maximum')
    hiThumb.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('-1200000000')
    // Announced from the value the step produced, not one stop behind it.
    expect(hiThumb.getAttribute('aria-valuetext')).toBe('1,200,000,000 ₫')
    // Exact at a stop: everything but the one 1.45B listing.
    expect(screen.getByText('11999 available')).toBeDefined()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('all')
  })

  it('an arrow key from a typed, between-stops max steps to the NEAREST stop, not past it', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('-420000') // between the 400k and 500k stops, nearer 400k
    await open(user)
    await screen.findByText(/available$/)
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    hiThumb.focus()
    // Base UI alone rounds 420k to the 400k stop first and then steps: 300k.
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('-400000')
  })

  it('an arrow key up from a typed max just below a stop lands on that stop', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('-480000') // nearer the 500k stop
    await open(user)
    await screen.findByText(/available$/)
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    hiThumb.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('-500000')
  })

  it('the min thumb pushed into a typed max never commits an inverted range', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('-480000')
    await open(user)
    await screen.findByText(/available$/)
    const loThumb = document.querySelector('input[aria-label="Minimum price"]') as HTMLInputElement
    loThumb.focus()
    // End parks the min thumb on the max thumb's fractional position (≈54.8); rounded, that is the
    // 500k stop — above the 480k max. It must stop AT the max instead.
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('480000-480000')
  })

  /**
   * Finding 3: open ends read out as prices ("0 ₫" for no minimum, "1,500,000,000 ₫" for no
   * maximum). A typed price between stops must be announced as typed, not as the nearest stop.
   */
  it('announces open ends as "No minimum" / "No maximum", and a typed bound as typed', async () => {
    const user = userEvent.setup()
    renderFilter('-420000')
    await open(user)
    await screen.findByText(/available$/)
    const loThumb = document.querySelector('input[aria-label="Minimum price"]') as HTMLInputElement
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    expect(loThumb.getAttribute('aria-valuetext')).toBe('No minimum')
    expect(hiThumb.getAttribute('aria-valuetext')).toBe('420,000 ₫')
    loThumb.focus()
    await user.keyboard('{ArrowRight}')
    expect(loThumb.getAttribute('aria-valuetext')).toBe('1 ₫')
  })

  /**
   * Finding 5: one key press must be ONE commit (one URL write / history entry) — on a stop, where
   * Base UI handles the key, and between stops, where RangeSlider's own handler does and Base UI
   * bails on `defaultPrevented`. Base UI 1.6 commits inside keydown and never on keyup.
   */
  it('one key press commits exactly once, on a stop and between stops', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('-420000')
    await open(user)
    await screen.findByText(/available$/)
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    hiThumb.focus()
    await user.keyboard('{ArrowLeft}') // between stops → RangeSlider's handler
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('-400000')
    await user.keyboard('{ArrowLeft}') // on a stop → Base UI's handler
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith('-300000')
  })

  /**
   * Finding 8: a thumb meeting a TYPED neighbour between two stops must take the neighbour's value.
   * Rounding the neighbour's fractional position instead swallowed the key press whenever it
   * rounded away from the moving thumb: the min could never reach a typed 420,000 max from 400,000,
   * nor the max a typed 480,000 min from 500,000.
   */
  it('a thumb stepping into a typed neighbour meets it exactly (never stuck, never inverted)', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('400000-420000')
    await open(user)
    await screen.findByText(/available$/)
    const loThumb = document.querySelector('input[aria-label="Minimum price"]') as HTMLInputElement
    loThumb.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('420000-420000')
  })

  it('the max thumb stepping down into a typed min meets it exactly', async () => {
    const user = userEvent.setup()
    const onChange = renderFilter('480000-500000')
    await open(user)
    await screen.findByText(/available$/)
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    hiThumb.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('480000-480000')
  })

  /**
   * Finding 1 at the panel: the dearest listing (1,450,000,000) is not an edge. A min of exactly
   * that price used to pro-rate its bin and print "≈0 available" while the feed returns it.
   */
  it('a typed min equal to the dearest price counts that listing exactly', async () => {
    const user = userEvent.setup()
    renderFilter()
    const dialog = await open(user)
    await screen.findByText('12000 available')
    const [min] = dialog.querySelectorAll('input[inputmode="numeric"]')
    await user.type(min as HTMLInputElement, '1450000000')
    expect(screen.getByText('1 available')).toBeDefined()
  })

  /**
   * Finding 6: bins are half-open, so the bar whose UPPER edge is the min holds nothing ≥ min and
   * must not be lit. Nine unmerged bins: 100k 120k 150k 200k 250k 300k 400k 500k 600k 800k.
   */
  it('a min on a stop lights the bars from that stop up, not the bar below it', async () => {
    histogramBody = buildHistogram([
      { price: 100_000, count: 1 },
      { price: 450_000, count: 1 },
      { price: 500_000, count: 1 },
      { price: 700_000, count: 1 },
    ])
    const user = userEvent.setup()
    renderFilter('500000-')
    const dialog = await open(user)
    await screen.findByText('2 available')
    const bars = [...(dialog.querySelector('.h-20') as HTMLElement).children]
    expect(bars).toHaveLength(9)
    const lit = bars.map((b, i) => (b.className.includes('bg-primary') ? i : -1)).filter((i) => i >= 0)
    expect(lit).toEqual([7, 8]) // [500k, 600k) and [600k, 800k] — not [400k, 500k)
  })

  /**
   * Finding 7: every match at one price. The panel's slider moves over edge INDICES, so [p, p]
   * is a 0..1 axis — never a zero-width track — and RangeSlider widens a real one anyway.
   */
  it('single-price data renders a working slider with no NaN anywhere', async () => {
    histogramBody = buildHistogram([{ price: 300_000, count: 9 }])
    const user = userEvent.setup()
    const onChange = renderFilter()
    const dialog = await open(user)
    await screen.findByText('9 available')
    const hiThumb = document.querySelector('input[aria-label="Maximum price"]') as HTMLInputElement
    expect(hiThumb.min).toBe('0')
    expect(hiThumb.max).toBe('1')
    expect(hiThumb.getAttribute('aria-valuenow')).toBe('1')
    expect(dialog.innerHTML).not.toContain('NaN')
    hiThumb.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('-300000')
    expect(screen.getByText('9 available')).toBeDefined()
    expect(dialog.innerHTML).not.toContain('NaN')
  })

  it('a malformed URL bound is an open end, not "NaN"', async () => {
    const user = userEvent.setup()
    renderFilter('abc-')
    const dialog = await open(user)
    expect(await screen.findByText('12000 available')).toBeDefined()
    const [min] = dialog.querySelectorAll('input[inputmode="numeric"]')
    expect((min as HTMLInputElement).value).toBe('')
    expect(dialog.textContent).not.toContain('NaN')
  })

  it('zero matches says so', async () => {
    histogramBody = { total: 0, min: 0, max: 0, edges: [], counts: [], atEdge: [], atMin: 0, atMax: 0 }
    const user = userEvent.setup()
    renderFilter()
    await open(user)
    expect(await screen.findByText('No listings match these filters yet.')).toBeDefined()
  })
})
