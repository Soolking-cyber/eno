// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { buildHistogram } from '@/lib/price-histogram'
import { PricePresetChips } from './price-preset-chips'

afterEach(cleanup)

const renderChips = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const labels = () => screen.queryAllByRole('button').map((b) => b.textContent)

/**
 * ⛔ OWNER, 2026-09-25: "show only available filter options". A preset is drawn only if it would
 * NARROW the feed, decided from the histogram only where its count is exact.
 */
describe('<PricePresetChips> — only presets that narrow', () => {
  it('drops a preset that would hold every listing in view (Food: all 17 under 500k)', () => {
    const hist = buildHistogram([{ price: 50_000, count: 10 }, { price: 300_000, count: 7 }])
    renderChips(<PricePresetChips value="all" onChange={() => {}} bounds={[hist.min, hist.max]} hist={hist} />)
    expect(labels()).toEqual([])
  })

  it('keeps presets that split the rows', () => {
    const hist = buildHistogram([{ price: 100_000, count: 3 }, { price: 5_000_000, count: 4 }])
    renderChips(<PricePresetChips value="all" onChange={() => {}} bounds={[hist.min, hist.max]} hist={hist} />)
    expect(labels()).toContain('<500k')
    expect(labels()).toContain('2–10M')
  })

  it('keeps the APPLIED preset even when it now covers everything', () => {
    const hist = buildHistogram([{ price: 50_000, count: 10 }])
    renderChips(<PricePresetChips value="-500000" onChange={() => {}} bounds={[hist.min, hist.max]} hist={hist} />)
    expect(labels()).toEqual(['<500k'])
  })

  it('draws every preset with no histogram — no evidence, no hiding', () => {
    renderChips(<PricePresetChips value="all" onChange={() => {}} />)
    expect(labels()).toHaveLength(4)
  })
})
