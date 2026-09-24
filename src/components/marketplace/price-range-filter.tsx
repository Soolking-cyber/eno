'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { barInRange, countInRange, histogramBars, parseHistogram, positionOf, type PriceHistogram } from '@/lib/price-histogram'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { RangeSlider } from '@/components/ui/range-slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PricePresetChips } from './price-preset-chips'

/** One side of the committed "min-max" string. Empty or malformed (`?priceMin=abc`) is an open end
 *  — never a NaN in the field, the count or the trigger label. */
function parseBound(s: string | undefined): number | null {
  const n = s ? Number(s) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Airbnb-style price filter: a histogram of the price distribution for the CURRENT
 * filters (fetched from /api/listings?histogram=1&…) with a dual-handle range
 * slider over it. Bars inside the selected range are highlighted so the user sees
 * exactly where their budget sits in what's available. Values are VND internally;
 * labels/inputs render in the viewer's display currency. Emits the "min-max" VND
 * string the explorer understands ('all' when the full range is selected). The
 * panel is a Base UI Popover (Trigger + Portal + Positioner + Popup): it portals to
 * <body> so the facet row's horizontal scroll can't clip it, and brings the
 * disclosure roles, Escape, focus move + return and anchoring for free.
 *
 * ⚠️ THE HISTOGRAM IS BINS, NOT PRICES (src/lib/price-histogram.ts explains why: the old endpoint
 * shipped only the 5,000 CHEAPEST prices and this panel read them as the whole range). Three
 * invariants follow, and each one is a bug that shipped before:
 *
 *  1. THE SLIDER MOVES OVER EDGE INDICES, not raw VND. The edges are nice log-spaced numbers, so the
 *     axis is logarithmic (a 0 → 1.45B catalogue is unusable on a linear one) and every stop is a
 *     clean URL value. The count at a stop is EXACT — whole bins plus the listings priced exactly at
 *     the upper stop (`atEdge`).
 *  2. A TYPED VALUE IS KEPT EXACTLY AS TYPED — only floored at 0 and ordered lo ≤ hi on blur. It is
 *     NEVER clamped to the data's [min, max], and a URL-restored range outside it is never rewritten:
 *     the old clamp is exactly how a typed max above the truncated range got saved as "no max".
 *     Between two edges its thumb sits at a fractional position and the count is an estimate ("≈").
 *  3. `null` MEANS OPEN. The low thumb at the first stop is "no min", the high thumb at the last
 *     stop is "no max"; neither writes a bound into the URL.
 */
export function PriceRangeFilter({
  value, onChange, query, countsApproximate = false, className, activeClassName, wrapperClassName,
}: {
  value: string
  onChange: (v: string) => void
  query: string
  /**
   * The grid shows a set the histogram cannot count exactly: "Near you" distance-filters in the
   * browser, and a text search can add semantic hits the SQL `where` never sees. Then every count is
   * shown with "≈" — an exact-looking number over a grid holding a different set is the bug this
   * panel was rewritten to remove.
   */
  countsApproximate?: boolean
  className?: string
  activeClassName?: string
  wrapperClassName?: string
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // labels/inputs follow the viewer's language
  const { currency, rates } = useCurrency()
  const rate = currency === 'VND' || currency === '₫' ? 1 : rates[currency] || 0
  const [open, setOpen] = useState(false)
  // `null` = no histogram (failed fetch, or an OLD cached `{ prices }` body) — the panel still offers
  // the presets and the typed inputs, it just has no bars or slider to draw.
  const [hist, setHist] = useState<PriceHistogram | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [lo, setLo] = useState<number | null>(null) // VND; null = no minimum
  const [hi, setHi] = useState<number | null>(null) // VND; null = no maximum
  // Which thumb the current drag moves — Base UI reports it on change but not on commit.
  const activeThumb = useRef(-1)

  // Fetch the histogram for the current filter signature each time the panel opens.
  // Anchoring, outside-tap close and Escape are the Popover primitive's job now.
  useEffect(() => {
    if (!open) return
    let cancel = false
    setLoaded(false)
    fetch(`/api/listings?${query}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) { setHist(parseHistogram(d)); setLoaded(true) } })
      .catch(() => { if (!cancel) { setHist(null); setLoaded(true) } })
    return () => { cancel = true }
  }, [open, query])

  // The committed range, restored verbatim (see invariant 2 above). Re-read on open so an edit
  // abandoned without a blur does not survive a close.
  useEffect(() => {
    const [mn, mx] = value !== 'all' ? value.split('-') : ['', '']
    // A malformed URL bound (`?priceMin=abc`) is an open end — never a NaN in the field or the count.
    setLo(parseBound(mn))
    setHi(parseBound(mx))
  }, [value, open])

  const edges = useMemo(() => hist?.edges ?? [], [hist])
  const lastIdx = edges.length - 1
  const hasBins = !!hist && hist.total > 0 && lastIdx >= 1
  const bars = useMemo(() => (hist ? histogramBars(hist) : []), [hist])
  const maxCount = Math.max(1, ...bars.map((b) => b.count))
  const posLo = lo == null ? 0 : positionOf(edges, lo)
  const posHi = hi == null ? lastIdx : positionOf(edges, hi)
  const inRange = hist ? countInRange(hist, lo, hi) : { count: 0, exact: true }

  const commit = (nlo: number | null, nhi: number | null) => {
    const mn = nlo != null && nlo > 0 ? String(Math.round(nlo)) : ''
    const mx = nhi != null ? String(Math.round(nhi)) : ''
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }
  /**
   * Slider position → the bound it means for one thumb (0 = min, 1 = max). The first stop is
   * "no min", the last is "no max".
   *
   * ⚠️ A POSITION BETWEEN TWO STOPS IS THE OTHER THUMB'S, AND MEANS ITS VALUE, EXACTLY. Base UI only
   * ever hands back a stop or — when a thumb runs into its neighbour — the neighbour's own position,
   * and a TYPED neighbour sits between stops (480,000 → 54.8). Rounding that to a stop lands on one
   * side of the typed value or the other: for the min thumb 55 → 500,000, above a 480,000 max (an
   * inverted, zero-result range); for the max thumb meeting a typed 480,000 min, back on 500,000 —
   * the key press swallowed and the thumb unable ever to reach the min. Meeting the neighbour takes
   * its value as typed, so lo ≤ hi holds and the typed number is neither moved nor re-rounded.
   * A stop is still clamped against the other bound as a backstop.
   */
  const boundAt = (side: 0 | 1, pos: number): number | null => {
    const k = Math.round(pos)
    const other = side === 0 ? hi : lo
    if (Math.abs(pos - k) > 1e-9 && other != null) return other
    if (side === 0) return k <= 0 ? null : Math.min(edges[k], hi ?? Infinity)
    return k >= lastIdx ? null : Math.max(edges[k], lo ?? -Infinity)
  }
  /**
   * What a thumb announces, from the position Base UI hands over. Its OWN current position is its
   * bound as held — a typed price between stops is read out as typed, not as the nearest stop — and
   * any other position is what a commit there would write. An open end is said as one: the first
   * and last stops are "no minimum" / "no maximum", not the price of the edge they happen to sit on.
   */
  const ariaValueText = (pos: number, i: number) => {
    const side = i === 0 ? 0 : 1
    const b = pos === (side === 0 ? posLo : posHi) ? (side === 0 ? lo : hi) : boundAt(side, pos)
    if (b == null) return side === 0 ? tr('No minimum', 'Không có giá tối thiểu') : tr('No maximum', 'Không có giá tối đa')
    return `${grp(toDisplay(b))} ${sym}`
  }

  const toDisplay = (vnd: number) => (rate ? Math.round(vnd * rate) : Math.round(vnd))
  const fromDisplay = (disp: number) => (rate ? disp / rate : disp)
  const grp = (n: number | null) => (n == null || !Number.isFinite(n) ? '' : new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(n))
  // Empty field = open end; anything typed is kept (floored at 0 by construction: digits only).
  const typed = (s: string) => { const d = s.replace(/\D/g, ''); return d ? fromDisplay(Number(d)) : null }

  const active = value !== 'all'

  // Compact label for the bar trigger (e.g. "1.5M–3.9M ₫") — the full grouped numbers
  // were far too long. The dropdown inputs still show exact amounts.
  const sym = currency === 'VND' || currency === '₫' ? '₫' : currency
  const compactAmt = (vnd: number) => {
    const d = toDisplay(vnd)
    // vi + ₫ display: native shorthand ("1,5tr–3,9tr ₫"), matching the map pins.
    // A foreign display currency keeps the international suffixes below.
    if (locale === 'vi' && sym === '₫') return compactPrice(d, 'vi')
    if (d >= 1_000_000) return `${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
    if (d >= 1_000) return `${Math.round(d / 1_000)}k`
    return String(d)
  }
  // The label parses min/max straight from the committed `value` string so a
  // URL-restored filter labels itself immediately — the histogram fetch is lazy
  // (panel open), and the old `prices.length` guard left the generic "Price"
  // trigger until first open.
  const triggerText = (() => {
    if (!active) return tr('Price', 'Giá')
    const [mn, mx] = value.split('-')
    const min = parseBound(mn) ?? 0
    // A typed max of 0 ("free only") is a real bound, so test for null, not falsiness.
    const max = parseBound(mx)
    if (min && max != null) return `${compactAmt(min)}–${compactAmt(max)} ${sym}`
    if (min) return tr('From {x}', 'Từ {x}').replace('{x}', `${compactAmt(min)} ${sym}`)
    if (max != null) return tr('Up to {x}', 'Đến {x}').replace('{x}', `${compactAmt(max)} ${sym}`)
    return tr('Price', 'Giá')
  })()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', wrapperClassName)}>
        <PopoverTrigger
          render={
            <Button
              variant="bare"
              size="none"
              type="button"
              className={cn(
                // active:scale-100 is load-bearing: this button is the popover anchor and
                // floating-ui reads its rect — a press transform would move the panel off it.
                // h-12 (48px) to match the other facet pills — flat, borderless.
                'flex min-h-12 w-full shrink-0 items-center justify-between gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors duration-150 active:scale-100 cursor-pointer',
                open ? 'text-foreground' : active ? activeClassName : className,
              )}
            >
              <span className="truncate">{triggerText}</span>
              <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
            </Button>
          }
        />
      </div>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        // Absorb the dismiss-tap: without this, tapping a listing card to close the price panel
        // would ALSO open that card's PDP (Base UI popovers are non-modal). area-filter and the
        // sibling selects all keep this backdrop; price-filter must not be the one that leaks.
        backdrop
        aria-label={tr('Price range', 'Khoảng giá')}
        className="block w-80 max-w-[calc(100vw-1rem)] p-4 shadow-pop ring-0"
      >
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-bold text-foreground">{tr('Price range', 'Khoảng giá')}</p>
          <p className="text-xs text-muted-foreground">
            {/* {n} template, not `${count} available` interpolation: an interpolated
                string mints one MT-cache key (one billed translate segment) per unique
                count — worst on slider drag. The template translates once.
                "≈" only when a typed bound cuts through a non-empty bin: at every slider
                stop the count is exact (see src/lib/price-histogram.ts). */}
            {!loaded
              ? tr('Loading…', 'Đang tải…')
              : hasBins
                ? (inRange.exact && !countsApproximate ? tr('{n} available', '{n} món') : tr('≈{n} available', '≈{n} món')).replace('{n}', String(inRange.count))
                : ''}
          </p>
        </div>

        {!loaded ? (
          <Skeleton className="mt-6 h-24 rounded-xl" />
        ) : hist && hist.total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{tr('No listings match these filters yet.', 'Chưa có tin phù hợp với bộ lọc.')}</p>
        ) : (
          <>
            {/* No histogram (a failed fetch, or an old cached response without `edges`) draws no
                bars and no slider, but the presets and the typed fields still work. */}
            {hasBins && (
              <div className="mt-4">
                {/* One bar per bin (merged only past ~60 bins). `flexGrow: span` keeps a merged
                    bar as wide as the slider stops it covers, so bars and thumbs line up. */}
                <div className="relative flex h-20 items-end gap-[2px]">
                  {bars.map((bar) => {
                    const within = barInRange(edges, bar, lo, hi)
                    return (
                      <div
                        key={bar.from}
                        className={cn('min-w-0 rounded-lg transition-colors', within ? 'bg-primary' : 'bg-line-strong/50')}
                        style={{ flex: `${bar.span} 1 0`, height: `${Math.max(4, (bar.count / maxCount) * 100)}%` }}
                      />
                    )
                  })}
                </div>

                {/* Dual-thumb slider over EDGE INDICES (invariant 1). Only the thumb that moved
                    updates its bound, so a typed value on the other side survives a drag. */}
                <RangeSlider
                  className="mt-1"
                  value={[posLo, posHi]}
                  min={0} max={lastIdx} step={1}
                  thumbAriaLabels={[tr('Minimum price', 'Giá tối thiểu'), tr('Maximum price', 'Giá tối đa')]}
                  getAriaValueText={ariaValueText}
                  onChange={([a, b], t) => {
                    activeThumb.current = t
                    if (t === 0) setLo(boundAt(0, a))
                    else if (t === 1) setHi(boundAt(1, b))
                  }}
                  onCommit={([a, b]) => {
                    const t = activeThumb.current
                    activeThumb.current = -1
                    commit(t === 0 ? boundAt(0, a) : lo, t === 1 ? boundAt(1, b) : hi)
                  }}
                />
              </div>
            )}

            {/* Preset budget chips — one tap sets the range via onChange (shared with
                the mobile filter drawer). Hidden when outside the matching data's real
                [min, max] — the whole distribution now, not a cheapest-5,000 slice. */}
            <PricePresetChips value={value} onChange={onChange} bounds={hasBins && hist ? [hist.min, hist.max] : undefined} className="mt-4" />

            <div className="mt-4 flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-2xs font-semibold text-ink-4">{tr('Minimum', 'Tối thiểu')}</span>
                {/* ⛔ A BACKGROUND TINT IS NOT A FOCUS INDICATOR. `focus-within:bg-muted` alone measured
                    1.05:1 against the surrounding canvas — a keyboard user could not tell which of
                    the two fields they were in. These inputs use `variant="unstyled"` and so opt
                    out of the app-wide `:focus-visible` outline, which is why the tint was all
                    there was. The ring at full alpha measures 5.5:1, the same colour the header
                    CTA's outline uses.
                    ⚠️ `focus-within`, not `:focus-visible`, because the ring belongs on this
                    wrapper — the focusable is the `<Input>` inside it, and the wrapper is what
                    draws the field's visible boundary.
                    ⛔ `ring-[var(--ring)]`, NOT `ring-ring` — see help-center.tsx: the bare utility
                    paints a transparent ring. */}
                  <span className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted focus-within:bg-muted focus-within:ring-2 focus-within:ring-[color:var(--ring)]">
                  {currency === 'VND' && <span className="text-ink-4">₫</span>}
                  <Input
                    variant="unstyled"
                    type="text" inputMode="numeric" value={lo == null ? '' : grp(toDisplay(lo))}
                    placeholder={hasBins && hist ? grp(toDisplay(hist.min)) : undefined}
                    onChange={(e) => setLo(typed(e.target.value))}
                    // Kept as typed (invariant 2) — only ordered against the max, on blur.
                    onBlur={() => { const n = lo != null && hi != null && lo > hi ? hi : lo; setLo(n); commit(n, hi) }}
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </span>
              </label>
              <span className="pb-2 text-ink-4">–</span>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-2xs font-semibold text-ink-4">{tr('Maximum', 'Tối đa')}</span>
                {/* ⛔ A BACKGROUND TINT IS NOT A FOCUS INDICATOR. `focus-within:bg-muted` alone measured
                    1.05:1 against the surrounding canvas — a keyboard user could not tell which of
                    the two fields they were in. These inputs use `variant="unstyled"` and so opt
                    out of the app-wide `:focus-visible` outline, which is why the tint was all
                    there was. The ring at full alpha measures 5.5:1, the same colour the header
                    CTA's outline uses.
                    ⚠️ `focus-within`, not `:focus-visible`, because the ring belongs on this
                    wrapper — the focusable is the `<Input>` inside it, and the wrapper is what
                    draws the field's visible boundary. */}
                  <span className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted focus-within:bg-muted focus-within:ring-2 focus-within:ring-[color:var(--ring)]">
                  {currency === 'VND' && <span className="text-ink-4">₫</span>}
                  <Input
                    variant="unstyled"
                    type="text" inputMode="numeric" value={hi == null ? '' : grp(toDisplay(hi))}
                    placeholder={hasBins && hist ? grp(toDisplay(hist.max)) : undefined}
                    onChange={(e) => setHi(typed(e.target.value))}
                    // Kept as typed (invariant 2) — never clamped to the data's max, only ordered
                    // against the min, on blur.
                    onBlur={() => { const n = hi != null && lo != null && hi < lo ? lo : hi; setHi(n); commit(lo, n) }}
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </span>
              </label>
            </div>

            {/* ⚠️ 44px TARGETS FOR THE TWO CONTROLS THAT COMMIT OR UNDO THE RANGE — they were
                34×16 (Reset) and 63×28 (Done). Reset grows by padding and pulls back with `-ml-3`,
                so its WORD stays aligned with the inputs above while the target grows around it. */}
            <div className="mt-4 flex items-center justify-between">
              <Button variant="link" size="none"
                type="button"
                onClick={() => { setLo(null); setHi(null); onChange('all') }}
                className="min-h-11 -ml-3 px-3 text-xs font-semibold text-body underline-offset-2 hover:underline cursor-pointer"
              >
                {tr('Reset', 'Đặt lại')}
              </Button>
              <Button variant="cta" size="none"
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-lg px-5 text-sm transition-colors cursor-pointer"
              >
                {tr('Done', 'Xong')}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
