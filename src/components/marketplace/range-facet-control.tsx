'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import type { RangeMeta } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

// Min–max range filter for a numeric facet (year / mileage / engine) — a dual-thumb
// slider with type-in Min/Max boxes, mirroring the price filter's interaction. Emits
// the "min-max" string the explorer understands ('all' when the full range is open;
// an empty side means open-ended, e.g. "2020-" = 2020 and newer).
export function RangeFacetControl({
  range, value, onChange,
}: {
  range: RangeMeta
  value: string
  onChange: (v: string) => void
}) {
  const { tr } = useLanguage()
  const { min, max, step, unit } = range
  const decimals = step < 1 ? 1 : 0
  const grouped = max >= 10000
  const fmt = (n: number) => (grouped ? new Intl.NumberFormat('en-US').format(n) : n.toFixed(decimals).replace(/\.0$/, ''))
  const round = (n: number) => (decimals > 0 ? Math.round(n * 10) / 10 : Math.round(n))

  const fromValue = (v: string): [number, number] => {
    if (!v || v === 'all') return [min, max]
    const [a = '', b = ''] = v.split('-')
    return [a !== '' ? Number(a) : min, b !== '' ? Number(b) : max]
  }
  const [lo, setLo] = useState<number>(() => fromValue(value)[0])
  const [hi, setHi] = useState<number>(() => fromValue(value)[1])
  useEffect(() => { const [a, b] = fromValue(value); setLo(a); setHi(b) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value])

  const commit = (nlo: number, nhi: number) => {
    const mn = nlo <= min ? '' : String(round(nlo))
    const mx = nhi >= max ? '' : String(round(nhi))
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }
  const span = Math.max(step, max - min)
  const pct = (v: number) => ((v - min) / span) * 100
  const digits = (s: string) => (decimals > 0 ? s.replace(/[^0-9.]/g, '') : s.replace(/[^0-9]/g, ''))

  return (
    <div className="min-w-0 flex-1">
      <div className="relative h-5">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#0a66c2]"
          style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
        />
        <input
          type="range" className="eno-range" aria-label={tr('Minimum', 'Tối thiểu')}
          min={min} max={max} step={step} value={lo}
          onChange={(e) => setLo(Math.min(round(Number(e.target.value)), hi))}
          onPointerUp={() => commit(lo, hi)} onKeyUp={() => commit(lo, hi)}
        />
        <input
          type="range" className="eno-range" aria-label={tr('Maximum', 'Tối đa')}
          min={min} max={max} step={step} value={hi}
          onChange={(e) => setHi(Math.max(round(Number(e.target.value)), lo))}
          onPointerUp={() => commit(lo, hi)} onKeyUp={() => commit(lo, hi)}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <input
            type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={lo <= min ? '' : fmt(lo)} placeholder={tr('Min', 'Tối thiểu')}
            onChange={(e) => { const d = digits(e.target.value); setLo(d === '' ? min : Math.min(Math.max(min, Number(d)), hi)) }}
            onBlur={() => commit(lo, hi)}
            className="w-16 bg-transparent text-foreground outline-none placeholder:text-ink-4"
          />
          {unit && lo > min && <span className="text-ink-4">{unit}</span>}
        </span>
        <span className="text-ink-4">–</span>
        <span className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <input
            type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={hi >= max ? '' : fmt(hi)} placeholder={tr('Max', 'Tối đa')}
            onChange={(e) => { const d = digits(e.target.value); setHi(d === '' ? max : Math.max(Math.min(max, Number(d)), lo)) }}
            onBlur={() => commit(lo, hi)}
            className="w-16 bg-transparent text-foreground outline-none placeholder:text-ink-4"
          />
          {unit && hi < max && <span className="text-ink-4">{unit}</span>}
        </span>
      </div>
    </div>
  )
}
