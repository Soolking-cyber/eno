'use client'

import { useEffect, useRef, useState } from 'react'
import { EnoSlider } from '@/components/marketplace/eno-slider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  // The facet's own label lives on the caller's heading, not in RangeMeta — so the
  // control names itself by its unit ("Value (km)"), which is at least a real name.
  const name = range.unit ? `${tr('Value', 'Giá trị')} (${range.unit})` : tr('Value', 'Giá trị')

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl bg-tint px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Input
            variant="unstyled"
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            value={text}
            onFocus={() => { focused.current = true }}
            onChange={(e) => onType(e.target.value)}
            onBlur={onBlur}
            aria-label={name}
            placeholder={tr('Any', 'Bất kỳ')}
            className="w-20"
          />
          {range.unit && <span className="shrink-0 text-ink-4">{range.unit}</span>}
        </span>
        {value != null && (
          <Button
            type="button"
            variant="ghost"
            size="none"
            onClick={() => { onChange(null); setText('') }}
            className="text-xs font-semibold text-ink-4 hover:bg-transparent hover:text-foreground cursor-pointer"
          >
            {tr('Clear', 'Xóa')}
          </Button>
        )}
      </div>
      <EnoSlider
        className="w-full max-w-sm"
        min={range.min}
        max={range.max}
        step={range.step}
        value={slider}
        onChange={(v) => onChange(round(v))}
        aria-label={name}
      />
    </div>
  )
}
