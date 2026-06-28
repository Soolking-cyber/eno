'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import type { RangeMeta } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

// A single precise numeric spec input: a draggable slider + a type-in box (with
// unit). Used in the post wizard + editor for range facets (year / mileage /
// engine). `value` is null when unset. Engine shows one decimal; mileage groups
// thousands. Typing is NOT clamped/reformatted mid-keystroke (so "2025" or "2.5"
// survive) — clamping happens on blur.
export function RangeSpecInput({
  range, value, onChange, className,
}: {
  range: RangeMeta
  value: number | null
  onChange: (v: number | null) => void
  className?: string
}) {
  const { tr } = useLanguage()
  const decimals = range.step < 1 ? 1 : 0
  const grouped = range.max >= 10000

  const display = (n: number) =>
    grouped ? new Intl.NumberFormat('en-US').format(n) : decimals > 0 ? n.toFixed(1).replace(/\.0$/, '') : String(n)
  const clamp = (n: number) => Math.min(Math.max(n, range.min), range.max)
  const round = (n: number) => (decimals > 0 ? Math.round(n * 10) / 10 : Math.round(n))

  // Local text mirrors what the user types; synced from `value` only when the input
  // isn't focused (so an external change — e.g. dragging the slider — updates it).
  const [text, setText] = useState(value == null ? '' : display(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value == null ? '' : display(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (raw: string) => {
    const cleaned = decimals > 0 ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '')
    setText(cleaned)
    if (cleaned === '' || cleaned === '.') { onChange(null); return }
    const n = Number(cleaned)
    if (Number.isFinite(n)) onChange(round(n)) // commit unclamped so partial typing isn't fought
  }
  const onBlur = () => {
    focused.current = false
    if (text === '' || text === '.') { onChange(null); setText(''); return }
    const n = Number(text)
    if (!Number.isFinite(n)) { setText(value == null ? '' : display(value)); return }
    const c = round(clamp(n))
    onChange(c)
    setText(display(c))
  }

  const slider = value == null ? range.min : clamp(value)
  const pct = ((slider - range.min) / Math.max(range.step, range.max - range.min)) * 100

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl bg-tint px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <input
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={text}
            onFocus={() => { focused.current = true }}
            onChange={(e) => onType(e.target.value)}
            onBlur={onBlur}
            placeholder={tr('Any', 'Bất kỳ')}
            className="w-20 bg-transparent text-foreground outline-none placeholder:text-ink-4"
          />
          {range.unit && <span className="shrink-0 text-ink-4">{range.unit}</span>}
        </span>
        {value != null && (
          <button
            type="button"
            onClick={() => { onChange(null); setText('') }}
            className="text-xs font-semibold text-ink-4 hover:text-foreground cursor-pointer"
          >
            {tr('Clear', 'Xóa')}
          </button>
        )}
      </div>
      <div className="relative h-5 w-full max-w-sm">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${value == null ? 0 : pct}%` }}
        />
        <input
          type="range"
          className="eno-slider"
          min={range.min}
          max={range.max}
          step={range.step}
          value={slider}
          onChange={(e) => onChange(round(Number(e.target.value)))}
          aria-label={range.unit || 'value'}
        />
      </div>
    </div>
  )
}
