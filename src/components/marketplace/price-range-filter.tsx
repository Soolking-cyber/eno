'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { RangeSlider } from '@/components/ui/range-slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PricePresetChips } from './price-preset-chips'

const BINS = 30

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
 */
export function PriceRangeFilter({
  value, onChange, query, className, activeClassName, wrapperClassName,
}: {
  value: string
  onChange: (v: string) => void
  query: string
  className?: string
  activeClassName?: string
  wrapperClassName?: string
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // labels/inputs follow the viewer's language
  const { currency, rates } = useCurrency()
  const rate = currency === 'VND' || currency === '₫' ? 1 : rates[currency] || 0
  const [open, setOpen] = useState(false)
  const [prices, setPrices] = useState<number[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lo, setLo] = useState<number | null>(null)
  const [hi, setHi] = useState<number | null>(null)

  // Fetch the histogram for the current filter signature each time the panel opens.
  // Anchoring, outside-tap close and Escape are the Popover primitive's job now.
  useEffect(() => {
    if (!open) return
    let cancel = false
    setLoaded(false)
    fetch(`/api/listings?${query}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) { if (Array.isArray(d.prices)) setPrices(d.prices); setLoaded(true) } })
      .catch(() => { if (!cancel) setLoaded(true) })
    return () => { cancel = true }
  }, [open, query])

  const dataMin = prices.length ? prices[0] : 0
  const dataMax = prices.length ? prices[prices.length - 1] : 0

  useEffect(() => {
    if (!prices.length) return
    const [mn, mx] = value !== 'all' ? value.split('-') : ['', '']
    setLo(mn ? Number(mn) : dataMin)
    setHi(mx ? Number(mx) : dataMax)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, value])

  const effLo = lo ?? dataMin
  const effHi = hi ?? dataMax
  const span = Math.max(1, dataMax - dataMin)
  const step = Math.max(1, Math.round(span / 1000))

  const buckets = useMemo(() => {
    if (!prices.length) return [] as number[]
    const w = span / BINS
    const c = new Array(BINS).fill(0)
    for (const p of prices) {
      let i = Math.floor((p - dataMin) / w)
      if (i < 0) i = 0
      if (i >= BINS) i = BINS - 1
      c[i]++
    }
    return c
  }, [prices, dataMin, span])
  const maxCount = Math.max(1, ...buckets)

  const commit = (nlo: number, nhi: number) => {
    const mn = nlo <= dataMin ? '' : String(Math.round(nlo))
    const mx = nhi >= dataMax ? '' : String(Math.round(nhi))
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }

  const inRangeCount = prices.filter((p) => p >= effLo && p <= effHi).length
  const toDisplay = (vnd: number) => (rate ? Math.round(vnd * rate) : Math.round(vnd))
  const fromDisplay = (disp: number) => (rate ? disp / rate : disp)
  const grp = (n: number) => (n ? new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(n) : '')
  const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0

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
    const min = mn ? Number(mn) : 0
    const max = mx ? Number(mx) : 0
    if (min && max) return `${compactAmt(min)}–${compactAmt(max)} ${sym}`
    if (min) return tr('From {x}', 'Từ {x}').replace('{x}', `${compactAmt(min)} ${sym}`)
    if (max) return tr('Up to {x}', 'Đến {x}').replace('{x}', `${compactAmt(max)} ${sym}`)
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
                count — worst on slider drag. The template translates once. */}
            {!loaded ? tr('Loading…', 'Đang tải…') : prices.length ? tr('{n} available', '{n} món').replace('{n}', String(inRangeCount)) : ''}
          </p>
        </div>

        {!loaded ? (
          <Skeleton className="mt-6 h-24 rounded-xl" />
        ) : prices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{tr('No listings match these filters yet.', 'Chưa có tin phù hợp với bộ lọc.')}</p>
        ) : (
          <>
            <div className="mt-4">
              <div className="relative flex h-20 items-end gap-[2px]">
                {buckets.map((c, i) => {
                  const binStart = dataMin + (i / BINS) * span
                  const binEnd = dataMin + ((i + 1) / BINS) * span
                  const within = binEnd >= effLo && binStart <= effHi
                  return (
                    <div
                      key={i}
                      className={cn('flex-1 rounded-lg transition-colors', within ? 'bg-primary' : 'bg-line-strong/50')}
                      style={{ height: `${Math.max(4, (c / maxCount) * 100)}%` }}
                    />
                  )
                })}
              </div>

              {/* Dual-thumb slider — Base UI Slider inside the primitive; the
                  nearest-thumb track press and the no-crossing clamp come for free. */}
              <RangeSlider
                className="mt-1"
                value={[effLo, effHi]}
                min={dataMin} max={dataMax} step={step}
                aria-label={[tr('Minimum price', 'Giá tối thiểu'), tr('Maximum price', 'Giá tối đa')]}
                onChange={([nlo, nhi]) => { setLo(nlo); setHi(nhi) }}
                onCommit={([nlo, nhi]) => commit(nlo, nhi)}
              />
            </div>

            {/* Preset budget chips — one tap sets the range via onChange (shared with
                the mobile filter drawer). Hidden when outside the loaded data range. */}
            <PricePresetChips value={value} onChange={onChange} bounds={[dataMin, dataMax]} className="mt-4" />

            <div className="mt-4 flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-2xs font-semibold text-ink-4">{tr('Minimum', 'Tối thiểu')}</span>
                <span className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted focus-within:bg-muted">
                  {currency === 'VND' && <span className="text-ink-4">₫</span>}
                  <Input
                    variant="unstyled"
                    type="text" inputMode="numeric" value={grp(toDisplay(effLo))}
                    onChange={(e) => setLo(Math.min(Math.max(dataMin, fromDisplay(digits(e.target.value))), effHi))}
                    onBlur={() => commit(effLo, effHi)}
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </span>
              </label>
              <span className="pb-2 text-ink-4">–</span>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-2xs font-semibold text-ink-4">{tr('Maximum', 'Tối đa')}</span>
                <span className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-muted focus-within:bg-muted">
                  {currency === 'VND' && <span className="text-ink-4">₫</span>}
                  <Input
                    variant="unstyled"
                    type="text" inputMode="numeric" value={grp(toDisplay(effHi))}
                    onChange={(e) => setHi(Math.max(Math.min(dataMax, fromDisplay(digits(e.target.value))), effLo))}
                    onBlur={() => commit(effLo, effHi)}
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </span>
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <Button variant="link" size="none"
                type="button"
                onClick={() => { setLo(dataMin); setHi(dataMax); onChange('all') }}
                className="text-xs font-semibold text-body underline-offset-2 hover:underline cursor-pointer"
              >
                {tr('Reset', 'Đặt lại')}
              </Button>
              <Button variant="cta" size="none"
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-1.5 text-xs transition-colors cursor-pointer"
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
