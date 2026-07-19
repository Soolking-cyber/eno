'use client'

import { useLanguage } from '@/context/language-context'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'

// "Where does this offer stand?" — the market-price band for a listing's brand+model+segment
// (P25–P75 of comparable active listings), with a gauge marking where THIS asking price sits.
// Presentational: the server fetches the band (getPriceBand) and only renders this when there
// IS one (enough comparable listings), so there's nothing to suppress here.
type Band = { n: number; p25: number; median: number; p75: number }

export function MarketPrice({ price, band }: { price: number; band: Band }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  const pos = price < band.p25 ? 'low' : price > band.p75 ? 'high' : 'typical'
  const label =
    pos === 'low' ? tr('Good price', 'Giá tốt') : pos === 'high' ? tr('Above typical', 'Cao hơn mặt bằng') : tr('Typical price', 'Giá phổ biến')

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
        <span
          className={cn(
            'text-2xs font-bold',
            pos === 'low' ? 'text-success' : pos === 'high' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
      </div>
      <div className="mt-1 text-sm font-bold text-foreground tabular-nums">
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
            pos === 'low' ? 'bg-success' : pos === 'high' ? 'bg-warning' : 'bg-primary',
          )}
          style={{ left: `${markerLeft}%` }}
        />
      </div>
      <p className="mt-2 text-2xs text-ink-4">{tr('Based on {n} similar listings', 'Dựa trên {n} tin tương tự').replace('{n}', String(band.n))}</p>
    </div>
  )
}
