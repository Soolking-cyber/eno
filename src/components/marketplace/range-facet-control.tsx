'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { RangeSlider } from '@/components/ui/range-slider'
import { useLanguage } from '@/context/language-context'
import type { RangeMeta } from '@/lib/taxonomy'

// Min–max range filter for a numeric facet (year / mileage / engine) — a dual-thumb
// slider with type-in Min/Max boxes, mirroring the price filter's interaction. Emits
// the "min-max" string the explorer understands ('all' when the full range is open;
// an empty side means open-ended, e.g. "2020-" = 2020 and newer). Typing isn't
// clamped/reformatted mid-keystroke — clamping happens on blur.
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
  // String mirrors for the type-in boxes (synced from lo/hi when not focused).
  const [loText, setLoText] = useState('')
  const [hiText, setHiText] = useState('')
  const loFoc = useRef(false)
  const hiFoc = useRef(false)

  useEffect(() => { const [a, b] = fromValue(value); setLo(a); setHi(b) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value])
  useEffect(() => { if (!loFoc.current) setLoText(lo <= min ? '' : fmt(lo)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lo])
  useEffect(() => { if (!hiFoc.current) setHiText(hi >= max ? '' : fmt(hi)) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hi])

  const commit = (nlo: number, nhi: number) => {
    const mn = nlo <= min ? '' : String(round(nlo))
    const mx = nhi >= max ? '' : String(round(nhi))
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }
  const digits = (s: string) => (decimals > 0 ? s.replace(/[^0-9.]/g, '') : s.replace(/[^0-9]/g, ''))

  const blurLo = () => {
    loFoc.current = false
    let n = loText === '' ? min : Number(loText)
    if (!Number.isFinite(n)) n = min
    n = Math.min(Math.max(round(n), min), hi)
    setLo(n); commit(n, hi); setLoText(n <= min ? '' : fmt(n))
  }
  const blurHi = () => {
    hiFoc.current = false
    let n = hiText === '' ? max : Number(hiText)
    if (!Number.isFinite(n)) n = max
    n = Math.max(Math.min(round(n), max), lo)
    setHi(n); commit(lo, n); setHiText(n >= max ? '' : fmt(n))
  }

  return (
    <div className="min-w-0 flex-1">
      {/* Dual-thumb track — Base UI Slider inside the primitive. Track-press moves the
          nearest thumb and the thumbs cannot cross; nothing to re-implement here. */}
      <RangeSlider
        value={[lo, hi]} min={min} max={max} step={step}
        thumbAriaLabels={[tr('Minimum', 'Tối thiểu'), tr('Maximum', 'Tối đa')]}
        onChange={([a, b]) => { setLo(a); setHi(b) }}
        onCommit={([a, b]) => commit(a, b)}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Input
            variant="unstyled"
            type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={loText} placeholder={tr('Min', 'Tối thiểu')}
            aria-label={unit ? `${tr('Minimum', 'Tối thiểu')} (${unit})` : tr('Minimum', 'Tối thiểu')}
            onFocus={() => { loFoc.current = true }}
            onChange={(e) => setLoText(digits(e.target.value))}
            onBlur={blurLo}
            className="w-16"
          />
          {unit && loText !== '' && <span className="text-ink-4">{unit}</span>}
        </span>
        <span className="text-ink-4">–</span>
        <span className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Input
            variant="unstyled"
            type="text" inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={hiText} placeholder={tr('Max', 'Tối đa')}
            aria-label={unit ? `${tr('Maximum', 'Tối đa')} (${unit})` : tr('Maximum', 'Tối đa')}
            onFocus={() => { hiFoc.current = true }}
            onChange={(e) => setHiText(digits(e.target.value))}
            onBlur={blurHi}
            className="w-16"
          />
          {unit && hiText !== '' && <span className="text-ink-4">{unit}</span>}
        </span>
      </div>
    </div>
  )
}
