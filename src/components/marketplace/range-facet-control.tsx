'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { RangeSlider } from '@/components/ui/range-slider'
import { useLanguage } from '@/context/language-context'
import { moneyLocale } from '@/lib/vnd'
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
  const { lang, tr } = useLanguage()
  const { min, max, step, unit } = range
  const decimals = step < 1 ? 1 : 0
  // ⚠️ `&& decimals === 0` MAKES THE BLUR PARSE SAFE BY CONSTRUCTION — it is not redundant.
  // Grouping is only unambiguous for whole numbers: in vi the group separator is '.', the same
  // character as the en decimal mark, so a grouped FRACTIONAL range would render "12.345,6" and
  // `parseNum` (which keeps '.') could not recover it. No range in taxonomy.ts is both today
  // (mileage is the only grouped one, step 1000), so this changes nothing now — it just means a
  // future `step: 0.1` range falls back to ungrouped digits instead of silently mis-parsing.
  const grouped = max >= 10000 && decimals === 0
  // Grouped numbers follow the viewer's language — the same rule as every other number in
  // the app (moneyLocale + <CountValue>). Hardcoding 'en-US' showed a Vietnamese buyer
  // "125,000 km", and a comma is the DECIMAL mark in vi, so it reads as 125.
  const fmt = (n: number) =>
    grouped
      ? new Intl.NumberFormat(moneyLocale(lang) === 'vi' ? 'vi-VN' : 'en-US').format(n)
      : n.toFixed(decimals).replace(/\.0$/, '')
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

  useEffect(() => { const [a, b] = fromValue(value); setLo(a); setHi(b) }, [value])
  // ⚠️ `lang` IS A REAL DEPENDENCY, NOT NOISE — do not prune it. `fmt` now closes over the
  // language, so without it a box seeded as "125,000" keeps its English commas after the viewer
  // switches to Vietnamese, while every other number on the page flips to dots. Re-seeding is a
  // no-op for ungrouped ranges (toFixed ignores the locale) and never fights typing, because the
  // focus guards still hold.
  useEffect(() => { if (!loFoc.current) setLoText(lo <= min ? '' : fmt(lo)) }, [lo, lang])
  useEffect(() => { if (!hiFoc.current) setHiText(hi >= max ? '' : fmt(hi)) }, [hi, lang])

  const commit = (nlo: number, nhi: number) => {
    const mn = nlo <= min ? '' : String(round(nlo))
    const mx = nhi >= max ? '' : String(round(nhi))
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }
  const digits = (s: string) => (decimals > 0 ? s.replace(/[^0-9.]/g, '') : s.replace(/[^0-9]/g, ''))
  // ⚠️ BLUR MUST PARSE WHAT `fmt` WROTE, NOT RAW `Number()`. The boxes are seeded from
  // fmt(lo)/fmt(hi) and blur re-reads that text even when the user typed nothing. Under the
  // old en-US grouping Number('125,000') was NaN and the guard below reset that side to the
  // open end — wrong, but loud. Under vi grouping Number('125.000') is 125, so a focus-then-
  // blur with no edit would silently narrow the filter 1000×. Strip the separators first —
  // the same normalisation `digits` already applies to every keystroke. Dropping '.' is safe
  // because `grouped` is gated on `decimals === 0` above: there is no decimal here to lose.
  const parseNum = (s: string) => { const d = digits(s); return d === '' ? NaN : Number(d) }

  const blurLo = () => {
    loFoc.current = false
    let n = loText === '' ? min : parseNum(loText)
    if (!Number.isFinite(n)) n = min
    n = Math.min(Math.max(round(n), min), hi)
    setLo(n); commit(n, hi); setLoText(n <= min ? '' : fmt(n))
  }
  const blurHi = () => {
    hiFoc.current = false
    let n = hiText === '' ? max : parseNum(hiText)
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
