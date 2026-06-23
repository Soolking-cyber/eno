'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { cn } from '@/lib/utils'

const BINS = 30
const PANEL_W = 320

/**
 * Airbnb-style price filter: a histogram of the price distribution for the CURRENT
 * filters (fetched from /api/listings?histogram=1&…) with a dual-handle range
 * slider over it. Bars inside the selected range are highlighted so the user sees
 * exactly where their budget sits in what's available. Values are VND internally;
 * labels/inputs render in the viewer's display currency. Emits the "min-max" VND
 * string the explorer understands ('all' when the full range is selected). The
 * panel is PORTALED to <body> so the facet row's horizontal scroll can't clip it.
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
  const { tr } = useLanguage()
  const { currency, rates, format } = useCurrency()
  const rate = currency === 'VND' || currency === '₫' ? 1 : rates[currency] || 0
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [prices, setPrices] = useState<number[]>([])
  const [lo, setLo] = useState<number | null>(null)
  const [hi, setHi] = useState<number | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8))
    setPos({ top: r.bottom, left }) // flush under the trigger (morph window)
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    let cancel = false
    fetch(`/api/listings?${query}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel && Array.isArray(d.prices)) setPrices(d.prices) })
      .catch(() => {})
    const onWin = () => place()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => { cancel = true; window.removeEventListener('resize', onWin); window.removeEventListener('scroll', onWin, true) }
  }, [open, query, place])

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

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const commit = (nlo: number, nhi: number) => {
    const mn = nlo <= dataMin ? '' : String(Math.round(nlo))
    const mx = nhi >= dataMax ? '' : String(Math.round(nhi))
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }

  const pct = (v: number) => ((v - dataMin) / span) * 100
  const inRangeCount = prices.filter((p) => p >= effLo && p <= effHi).length
  const toDisplay = (vnd: number) => (rate ? Math.round(vnd * rate) : Math.round(vnd))
  const fromDisplay = (disp: number) => (rate ? disp / rate : disp)
  const grp = (n: number) => (n ? new Intl.NumberFormat('en-US').format(n) : '')
  const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0

  const active = value !== 'all'
  const triggerText = active && prices.length
    ? `${format(effLo)} – ${effHi >= dataMax ? format(dataMax) + '+' : format(effHi)}`
    : tr('Price', 'Giá')

  return (
    <div className={cn('relative', wrapperClassName)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full shrink-0 items-center justify-between gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
          open ? 'rounded-b-none bg-card text-foreground shadow-pop' : active ? activeClassName : className,
        )}
      >
        <span className="truncate">{triggerText}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
      </button>

      {mounted && open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_W }}
          className="z-[70] max-w-[calc(100vw-1rem)] rounded-b-2xl rounded-tr-2xl bg-card p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-100"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-foreground">{tr('Price range', 'Khoảng giá')}</p>
            <p className="text-xs text-muted-foreground">
              {prices.length ? tr(`${inRangeCount} available`, `${inRangeCount} món`) : tr('Loading…', 'Đang tải…')}
            </p>
          </div>

          {prices.length === 0 ? (
            <div className="mt-6 h-24 animate-pulse rounded-xl bg-muted" />
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
                        className={cn('flex-1 rounded-sm transition-colors', within ? 'bg-[#0a66c2]' : 'bg-line-strong/50')}
                        style={{ height: `${Math.max(4, (c / maxCount) * 100)}%` }}
                      />
                    )
                  })}
                </div>

                <div className="relative mt-1 h-5">
                  <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-muted" />
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#0a66c2]"
                    style={{ left: `${pct(effLo)}%`, width: `${Math.max(0, pct(effHi) - pct(effLo))}%` }}
                  />
                  <input
                    type="range" className="eno-range" aria-label={tr('Minimum price', 'Giá tối thiểu')}
                    min={dataMin} max={dataMax} step={step} value={effLo}
                    onChange={(e) => setLo(Math.min(Number(e.target.value), effHi))}
                    onPointerUp={() => commit(effLo, effHi)} onKeyUp={() => commit(effLo, effHi)}
                  />
                  <input
                    type="range" className="eno-range" aria-label={tr('Maximum price', 'Giá tối đa')}
                    min={dataMin} max={dataMax} step={step} value={effHi}
                    onChange={(e) => setHi(Math.max(Number(e.target.value), effLo))}
                    onPointerUp={() => commit(effLo, effHi)} onKeyUp={() => commit(effLo, effHi)}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-end gap-3">
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-semibold text-ink-4">{tr('Minimum', 'Tối thiểu')}</span>
                  <span className="flex items-center gap-1 rounded-xl bg-tint px-3 py-2 text-sm">
                    {currency === 'VND' && <span className="text-ink-4">₫</span>}
                    <input
                      type="text" inputMode="numeric" value={grp(toDisplay(effLo))}
                      onChange={(e) => setLo(Math.min(Math.max(dataMin, fromDisplay(digits(e.target.value))), effHi))}
                      onBlur={() => commit(effLo, effHi)}
                      className="w-full bg-transparent text-foreground outline-none"
                    />
                  </span>
                </label>
                <span className="pb-2 text-ink-4">–</span>
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-semibold text-ink-4">{tr('Maximum', 'Tối đa')}</span>
                  <span className="flex items-center gap-1 rounded-xl bg-tint px-3 py-2 text-sm">
                    {currency === 'VND' && <span className="text-ink-4">₫</span>}
                    <input
                      type="text" inputMode="numeric" value={grp(toDisplay(effHi))}
                      onChange={(e) => setHi(Math.max(Math.min(dataMax, fromDisplay(digits(e.target.value))), effLo))}
                      onBlur={() => commit(effLo, effHi)}
                      className="w-full bg-transparent text-foreground outline-none"
                    />
                  </span>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { setLo(dataMin); setHi(dataMax); onChange('all') }}
                  className="text-xs font-semibold text-body underline-offset-2 hover:underline cursor-pointer"
                >
                  {tr('Reset', 'Đặt lại')}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-[#0a66c2] px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#004182] cursor-pointer"
                >
                  {tr('Done', 'Xong')}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
