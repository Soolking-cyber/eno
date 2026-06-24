'use client'

import { useLanguage } from '@/context/language-context'
import type { RangeMeta } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

// A single precise numeric spec input: a draggable slider + a type-in box (with
// unit). Used in the post wizard + editor for range facets (year / mileage /
// engine). `value` is null when unset; dragging or typing sets a number, and the
// ✕ clears back to null. Engine shows one decimal; mileage groups thousands.
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
    grouped ? new Intl.NumberFormat('en-US').format(n) : n.toFixed(decimals).replace(/\.0$/, '')

  // Parse a typed string → clamped number (or null when emptied).
  const parse = (raw: string): number | null => {
    const cleaned = decimals > 0 ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '')
    if (cleaned === '') return null
    let n = Number(cleaned)
    if (!Number.isFinite(n)) return null
    n = Math.min(Math.max(n, range.min), range.max)
    return decimals > 0 ? Math.round(n * 10) / 10 : Math.round(n)
  }

  const slider = value ?? range.min

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl bg-tint px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <input
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={value == null ? '' : display(value)}
            onChange={(e) => onChange(parse(e.target.value))}
            placeholder={tr('Any', 'Bất kỳ')}
            aria-label={range.unit ? `${range.unit}` : undefined}
            className="w-24 bg-transparent text-foreground outline-none placeholder:text-ink-4"
          />
          {range.unit && <span className="shrink-0 text-ink-4">{range.unit}</span>}
        </span>
        {value != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-semibold text-ink-4 hover:text-foreground cursor-pointer"
          >
            {tr('Clear', 'Xóa')}
          </button>
        )}
      </div>
      <input
        type="range"
        className="eno-range w-full max-w-sm"
        min={range.min}
        max={range.max}
        step={range.step}
        value={slider}
        onChange={(e) => onChange(decimals > 0 ? Math.round(Number(e.target.value) * 10) / 10 : Number(e.target.value))}
        aria-label={range.unit || 'value'}
      />
    </div>
  )
}
