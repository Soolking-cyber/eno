// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { PRICE_GUIDANCE } from '@/lib/price-guidance'
import { FALLBACK_BELOW_CREDIBLE_FRACTION, MarketPrice } from './market-price'

/**
 * <MarketPrice> — the PDP's band, in its two voices.
 *
 *  · A brand+model band (basis 'model', or no basis from an older caller) reads exactly as before:
 *    'Good price' / 'Typical price' / 'Above typical' and 'Based on N similar listings'.
 *  · A FALLBACK band (basis 'similar', src/lib/price-fallback.ts) names what it is — 'Based on N
 *    similar listings · asking prices' — and speaks only in the buyer's favour, only for a credible
 *    price: 'Below similar listings', never 'Good price', never 'Above typical'.
 *
 * ⚠️ EXPLICIT CLEANUP and language driven through setLang — same harness and same reasons as
 * price-band.test.tsx (no vitest globals; jsdom's localStorage here has no getItem/setItem).
 */
afterEach(cleanup)

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

const BAND = { n: 12, p25: 2_000_000, median: 2_400_000, p75: 3_000_000 }
const SIMILAR = { ...BAND, basis: 'similar' as const }
const MODEL = { ...BAND, basis: 'model' as const }

function text(lang: Language, price: number, band: React.ComponentProps<typeof MarketPrice>['band']) {
  const { container } = render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      <MarketPrice price={price} band={band} />
    </LanguageProvider>,
  )
  return container.textContent ?? ''
}

describe('a fallback band says what it is', () => {
  it("labels it 'Based on N similar listings · asking prices'", () => {
    expect(text('en', 2_500_000, SIMILAR)).toContain('Based on 12 similar listings · asking prices')
  })

  it("…and 'Dựa trên N tin tương tự · giá đang rao' for a Vietnamese reader", () => {
    expect(text('vi', 2_500_000, SIMILAR)).toContain('Dựa trên 12 tin tương tự · giá đang rao')
  })

  it('shows the P25–P75 range, in the reader\'s own money format', () => {
    expect(text('en', 2_500_000, SIMILAR)).toContain('2M – 3M')
    cleanup()
    expect(text('vi', 2_500_000, SIMILAR)).toContain('2tr – 3tr')
  })
})

describe('a fallback band speaks only in the buyer\'s favour', () => {
  it("a price under P25 reads 'Below similar listings' — not 'Good price'", () => {
    const t = text('en', 1_500_000, SIMILAR)
    expect(t).toContain('Below similar listings')
    expect(t).not.toContain('Good price')
  })

  it("'Thấp hơn tin tương tự' in Vietnamese", () => {
    expect(text('vi', 1_500_000, SIMILAR)).toContain('Thấp hơn tin tương tự')
  })

  it('⛔ a price above P75 gets NO verdict — no "Above typical" in front of buyers', () => {
    const t = text('en', 4_000_000, SIMILAR)
    expect(t).not.toContain('Above typical')
    expect(t).not.toContain('Below similar listings')
    expect(t).not.toContain('Typical price')
  })

  it('a typical price gets no verdict either', () => {
    const t = text('en', 2_500_000, SIMILAR)
    expect(t).not.toContain('Typical price')
    expect(t).not.toContain('Below similar listings')
  })

  it('⛔ an impossibly low price (a typo, bait) earns no green cue', () => {
    expect(text('en', 900_000, SIMILAR)).not.toContain('Below similar listings') // < 0.5 × P25
    cleanup()
    expect(text('en', 1_000_000, SIMILAR)).toContain('Below similar listings') // exactly 0.5 × P25
  })

  it('keeps the same floor as the sold-price guidance', () => {
    expect(FALLBACK_BELOW_CREDIBLE_FRACTION).toBe(PRICE_GUIDANCE.BELOW_CREDIBLE_FRACTION)
  })
})

describe('a brand+model band reads exactly as before', () => {
  for (const band of [MODEL, BAND]) {
    const which = 'basis' in band ? 'basis model' : 'no basis'
    it(`${which}: the verdicts and the plain label`, () => {
      expect(text('en', 1_500_000, band)).toContain('Good price')
      cleanup()
      expect(text('en', 2_500_000, band)).toContain('Typical price')
      cleanup()
      const above = text('en', 4_000_000, band)
      expect(above).toContain('Above typical')
      expect(above).toContain('Based on 12 similar listings')
      expect(above).not.toContain('asking prices')
    })
  }

  it('in Vietnamese too', () => {
    const t = text('vi', 1_500_000, MODEL)
    expect(t).toContain('Giá tốt')
    expect(t).toContain('Dựa trên 12 tin tương tự')
    expect(t).not.toContain('giá đang rao')
  })
})
