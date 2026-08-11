// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import type { SoldPriceBand } from '@/lib/price-guidance'
import { PriceBand, type PriceBandProps } from './price-band'

/**
 * <PriceBand> — the four things this component must be trusted to NOT do.
 *
 *  1. SAY SOMETHING WHEN IT KNOWS NOTHING. `band={null}` is production today, and it must render
 *     an empty container — no skeleton, no "not enough data", no zero-state box that somebody
 *     later fills with an asked-price fallback.
 *  2. BADGE A SELLER AS EXPENSIVE IN FRONT OF BUYERS. On a card, only "Below typical" exists.
 *     An above-range ask renders NOTHING AT ALL.
 *  3. BLOCK A POST. The above-range line at compose time is a sentence, not a validation error:
 *     no role="alert", no aria-invalid, no disabled control.
 *  4. GET THE MONEY WRONG. Vietnamese groups thousands with a DOT; a comma there is a different
 *     number, and this component states two of them side by side.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach (same note as offer-card.test.tsx / count-chip.test.tsx).
 */
afterEach(cleanup)

/** ⚠️ The language is driven through `setLang`, not localStorage: under this vitest/jsdom combo
 *  `window.localStorage` has no getItem/setItem, so a stored preference is silently swallowed and
 *  every "vi" assertion would quietly run in English. Same harness as offer-card.test.tsx. */
function clearLangPref() {
  try {
    window.localStorage?.removeItem?.('lang')
  } catch {
    /* no usable storage in this environment — nothing to clear */
  }
}
beforeEach(clearLangPref)
afterEach(clearLangPref)

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

/** The hand-computed band from src/lib/price-guidance.test.ts, so the two files describe the
 *  same eight sales: 10.875.000 – 12.625.000 đ, median 11.750.000. */
const BAND: SoldPriceBand = { n: 8, p25: 10_875_000, median: 11_750_000, p75: 12_625_000, tier: 'model_condition_year' }

function props(over: Partial<PriceBandProps> = {}): PriceBandProps {
  return { band: BAND, price: 11_500_000, placement: 'compose', ...over }
}

function renderIn(lang: Language, p: PriceBandProps) {
  return render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      <PriceBand {...p} />
    </LanguageProvider>,
  )
}

// ── 1. NOTHING IS A FINISHED ANSWER ────────────────────────────────────────────────────────

describe('with no band (production, today)', () => {
  it('renders nothing at all while posting', () => {
    const { container } = renderIn('en', props({ band: null }))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing at all on a card', () => {
    const { container } = renderIn('en', props({ band: null, placement: 'card', price: 1_000_000 }))
    expect(container.innerHTML).toBe('')
  })

  it('ships no placeholder to the server either', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <PriceBand {...props({ band: null })} />
      </LanguageProvider>,
    )
    expect(html).toBe('')
  })
})

// ── 2. THE CARD SHOWS ONLY THE GOOD NEWS ───────────────────────────────────────────────────

describe('on a card', () => {
  it('shows "Below typical" for an ask under the band', () => {
    renderIn('en', props({ placement: 'card', price: 9_000_000 }))
    expect(screen.getByText('Below typical')).toBeTruthy()
  })

  it('says it in Vietnamese for a Vietnamese reader', () => {
    renderIn('vi', props({ placement: 'card', price: 9_000_000 }))
    expect(screen.getByText('Dưới giá phổ biến')).toBeTruthy()
  })

  it('⚠️ renders NOTHING for an ask above the band — there is no overpriced badge', () => {
    const { container } = renderIn('en', props({ placement: 'card', price: 40_000_000 }))
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for a typical ask, and nothing on the band edges', () => {
    expect(renderIn('en', props({ placement: 'card', price: 11_500_000 })).container.innerHTML).toBe('')
    cleanup()
    expect(renderIn('en', props({ placement: 'card', price: BAND.p25 })).container.innerHTML).toBe('')
    cleanup()
    expect(renderIn('en', props({ placement: 'card', price: BAND.p75 })).container.innerHTML).toBe('')
  })

  it('renders nothing when there is no price to judge', () => {
    expect(renderIn('en', props({ placement: 'card', price: null })).container.innerHTML).toBe('')
    cleanup()
    expect(renderIn('en', props({ placement: 'card', price: undefined })).container.innerHTML).toBe('')
  })

  it('⚠️ gives a bait price NO chip — the endorsement has to be earned', () => {
    // Without a floor on "below", a listing at 100.000 đ against an 11tr band collected the
    // marketplace's own green "good deal" cue. That is the no-overpriced-badge rule inverted.
    const { container } = renderIn('en', props({ placement: 'card', price: 100_000 }))
    expect(container.innerHTML).toBe('')
  })

  it('never states a figure — the chip is a verdict, not a second price on the card', () => {
    const { container } = renderIn('vi', props({ placement: 'card', price: 9_000_000 }))
    expect(container.textContent).not.toMatch(/\d/)
  })
})

// ── 3. THE SELLER HEARS IT WHILE THEY CAN STILL ACT ────────────────────────────────────────

describe('while posting', () => {
  it('states the range, the sample size and what it is comparing against', () => {
    const { container } = renderIn('en', props())
    expect(container.textContent).toContain('10,875,000 VND')
    expect(container.textContent).toContain('12,625,000 VND')
    expect(container.textContent).toContain('Based on 8 confirmed sales')
    expect(container.textContent).toContain('Same model, year and condition')
  })

  it('⚠️ groups Vietnamese money with DOTS — a comma there is a different number', () => {
    const { container } = renderIn('vi', props())
    expect(container.textContent).toContain('10.875.000 đ')
    expect(container.textContent).toContain('12.625.000 đ')
    expect(container.textContent).not.toContain('10,875,000')
    expect(container.textContent).toContain('Dựa trên 8 giao dịch đã xác nhận')
  })

  it('NAMES the fact when the typed price is above the range', () => {
    const { container } = renderIn('en', props({ price: 20_000_000 }))
    expect(container.textContent).toContain('Higher than this model has been selling for')
    expect(container.textContent).toContain('You can still post it')
  })

  it('⚠️ says nothing about an ask one đồng over the band — that is haggling room, not a warning', () => {
    // An ask is an opening position; a bare `> p75` would fire on the median honest seller and
    // the sentence would become furniture. Raised by an external reviewer.
    const { container } = renderIn('en', props({ price: BAND.p75 + 1 }))
    expect(container.textContent).not.toContain('Higher than')
    cleanup()
    const clear = renderIn('en', props({ price: Math.round(BAND.p75 * 1.2) })).container
    expect(clear.textContent).toContain('Higher than')
  })

  it('⚠️ renders a zero-width band as ONE figure, not as a range from X to X', () => {
    // Nine fixed-price units of the same new phone across three shops is an ordinary shape.
    // "12.000.000 đ – 12.000.000 đ" reads as a broken widget. Caught by an external reviewer
    // against the pure suite own per-party-cap fixture, which builds exactly this band.
    const flat = { ...BAND, p25: 12_000_000, median: 12_000_000, p75: 12_000_000 }
    const { container } = renderIn('vi', props({ band: flat, price: 12_000_000 }))
    expect(container.textContent).toContain('12.000.000 đ')
    expect(container.textContent).not.toContain('–')
  })

  it('⚠️ does not block, alarm or invalidate anything — it is a sentence, not a validation error', () => {
    const { container } = renderIn('en', props({ price: 20_000_000 }))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[aria-invalid]')).toBeNull()
    expect(container.querySelector('[disabled]')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
  })

  it('⚠️ announces the verdict POLITELY from a region that is already mounted', () => {
    // Without this the sentence appears as the seller types and a screen-reader user hears
    // nothing — the exact failure the feature exists to fix. `polite`, never assertive: it is
    // information, not an error. A region inserted WITH its text does not announce reliably, so
    // the region exists even when there is no verdict. (External reviewer, round 2.)
    const quiet = renderIn('en', props({ price: 11_500_000 })).container
    const region = quiet.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region?.textContent).toBe('')
    expect(quiet.querySelector('[aria-live="assertive"]')).toBeNull()
    cleanup()
    const loud = renderIn('en', props({ price: 20_000_000 })).container
    expect(loud.querySelector('[aria-live="polite"]')?.textContent).toContain('Higher than')
  })

  it('tells a seller pricing under the range that it reads as a good price', () => {
    const { container } = renderIn('en', props({ price: 8_000_000 }))
    expect(container.textContent).toContain('Below the range')
  })

  it('passes no verdict on a typical price, or on a field the seller has not filled in', () => {
    const typical = renderIn('en', props({ price: 11_500_000 })).container.textContent ?? ''
    expect(typical).not.toContain('Higher than')
    expect(typical).not.toContain('Below the range')
    cleanup()
    const empty = renderIn('en', props({ price: null })).container.textContent ?? ''
    expect(empty).toContain('10,875,000 VND')
    expect(empty).not.toContain('Higher than')
    expect(empty).not.toContain('Below the range')
  })

  it('states which comparison each tier is', () => {
    const labels: Array<[SoldPriceBand['tier'], string]> = [
      ['model_condition_year', 'Same model, year and condition'],
      ['model_condition', 'Same model and condition'],
      ['model_year', 'Same model and year'],
      ['model', 'Same model'],
    ]
    for (const [tier, label] of labels) {
      const { container } = renderIn('en', props({ band: { ...BAND, tier } }))
      expect(container.textContent).toContain(label)
      cleanup()
    }
  })

  it('draws no gauge — the band is an estimate from 8 sales, not a needle', () => {
    const { container } = renderIn('en', props())
    // A marker would need an inline left:%; nothing here is positioned from the data.
    expect(container.querySelector('[style]')).toBeNull()
  })
})

// ── 4. SERVER-SAFE ─────────────────────────────────────────────────────────────────────────

describe('server rendering', () => {
  it('reads no clock, so the cached HTML is the same markup every time', () => {
    const first = renderToStaticMarkup(
      <LanguageProvider>
        <PriceBand {...props()} />
      </LanguageProvider>,
    )
    const second = renderToStaticMarkup(
      <LanguageProvider>
        <PriceBand {...props()} />
      </LanguageProvider>,
    )
    expect(first).toBe(second)
    expect(first).toContain('10,875,000 VND')
  })
})
