'use client'

import { useLanguage } from '@/context/language-context'
import type { PriceBandBasis } from '@/lib/price-fallback'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'

// "Where does this offer stand?" — the market-price band for a listing's brand+model+segment
// (P25–P75 of comparable active listings), with a gauge marking where THIS asking price sits.
// Presentational: the server fetches the band (getPriceBand) and only renders this when there
// IS one (enough comparable listings), so there's nothing to suppress here.
//
// A FALLBACK band (`basis: 'similar'` — a sofa, a cot, a dress: no model, so the comparables are
// similar listings on the same shelf; src/lib/price-fallback.ts) draws the same range and gauge and
// SAYS LESS, because it knows less:
//  · the line under it names what it is — 'Based on N similar listings · asking prices';
//  · the verdict speaks only in the buyer's favour — 'Below similar listings', and only for a
//    credible price. Never 'Above typical': calling a seller expensive in front of buyers on a
//    similar-items comparison is the public mark price-guidance.ts refuses even on eight confirmed
//    sales ("same fact, different room" — the seller is told it while posting, in the wizard's
//    "Above the typical {range} range" box). Never 'Good price' either: that is a judgement of the
//    item, and the comparison is not of the item. ⚠️ The wizard's below-range line promises "buyers
//    will see a good deal"; this green cue keeps that promise, except under the credibility floor
//    below, where the buyer sees the gauge and no cue (the wizard's owner can branch on `basis`).
//  · the gauge marker stays neutral unless that verdict is shown, so the colour never says what the
//    words do not.
type Band = { n: number; p25: number; median: number; p75: number; basis?: PriceBandBasis }

/**
 * Under this fraction of P25 a fallback band shows NO verdict. The same floor, for the same reason, as
 * PRICE_GUIDANCE.BELOW_CREDIBLE_FRACTION in price-guidance.ts: an impossibly low price is a typo, a
 * different item or bait, and none of them has earned the marketplace's green "below" cue. Typed here
 * rather than imported so this PDP island does not pull price-guidance.ts and trade-loop.ts into its
 * bundle for one number; market-price.test.tsx holds the two equal.
 */
export const FALLBACK_BELOW_CREDIBLE_FRACTION = 0.5

export function MarketPrice({ price, band }: { price: number; band: Band }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  const pos = price < band.p25 ? 'low' : price > band.p75 ? 'high' : 'typical'
  const similar = band.basis === 'similar'
  // The verdict this band may state: all three for a brand+model band; for a fallback band only a
  // credible 'low', otherwise none (see the header).
  const verdict = !similar ? pos : pos === 'low' && price >= band.p25 * FALLBACK_BELOW_CREDIBLE_FRACTION ? 'low' : null
  const label =
    verdict === 'low'
      ? similar
        ? tr('Below similar listings', 'Thấp hơn tin tương tự')
        : tr('Good price', 'Giá tốt')
      : verdict === 'high'
        ? tr('Above typical', 'Cao hơn mặt bằng')
        : verdict === 'typical'
          ? tr('Typical price', 'Giá phổ biến')
          : null

  // Gauge scale — pad the ends so the marker sits inside the track even for an outlier ask.
  const lo = Math.min(band.p25, price) * 0.92
  const hi = Math.max(band.p75, price) * 1.08
  const span = Math.max(hi - lo, 1)
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100))
  const bandLeft = at(band.p25)
  const bandWidth = Math.max(2, at(band.p75) - at(band.p25))
  const markerLeft = at(price)

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{tr('Market price', 'Giá thị trường')}</span>
        {/* `data-fab-avoid` on the verdict and the range: the support bubble rested over 'Giá phổ biến'
            on first paint (pdp-01) — it yields to them now (back-to-top.tsx OBSTACLES). */}
        {label && (
          <span
            data-fab-avoid
            className={cn(
              'text-2xs font-bold',
              verdict === 'low' ? 'text-success' : verdict === 'high' ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        )}
      </div>
      <div data-fab-avoid className="mt-1 text-sm font-bold text-foreground tabular-nums">
        {compactPrice(band.p25, loc)}
        <span className="font-normal text-ink-4"> – </span>
        {compactPrice(band.p75, loc)}
      </div>
      {/* Gauge: shaded typical band (P25–P75) + a marker where this listing's price sits. */}
      <div className="relative mt-2.5 h-2 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 rounded-full bg-accent-foreground/25" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
        <div
          className={cn(
            'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow',
            verdict === 'low' ? 'bg-success' : verdict === 'high' ? 'bg-warning' : 'bg-primary',
          )}
          style={{ left: `${markerLeft}%` }}
        />
      </div>
      <p className="mt-2 text-2xs text-ink-4">
        {similar
          ? tr('Based on {n} similar listings · asking prices', 'Dựa trên {n} tin tương tự · giá đang rao').replace('{n}', String(band.n))
          : tr('Based on {n} similar listings', 'Dựa trên {n} tin tương tự').replace('{n}', String(band.n))}
      </p>
    </div>
  )
}
