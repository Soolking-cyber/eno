'use client'

import { useEffect, useRef, useState } from 'react'
import { EnoSlider } from '@/components/marketplace/eno-slider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/context/language-context'
import { moneyLocale } from '@/lib/vnd'
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
  const { lang, tr } = useLanguage()
  const decimals = range.step < 1 ? 1 : 0
  // ⚠️ `&& decimals === 0` MAKES THE BLUR PARSE SAFE BY CONSTRUCTION — it is not redundant.
  // Grouping is only unambiguous for whole numbers: in vi the group separator is '.', the same
  // character as the en decimal mark, so a grouped FRACTIONAL range would render "12.345,6" and
  // `clean` (which keeps '.') could not recover it. No range in taxonomy.ts is both today
  // (mileage is the only grouped one, step 1000), so this changes nothing now — it just means a
  // future `step: 0.1` range falls back to ungrouped digits instead of silently mis-parsing.
  const grouped = range.max >= 10000 && decimals === 0

  // Grouped numbers follow the viewer's language, like every other number in the app
  // (moneyLocale + <CountValue>). Hardcoding 'en-US' put "125,000" in a Vietnamese
  // seller's mileage box, and a comma is the DECIMAL mark in vi — it reads as 125.
  const display = (n: number) =>
    grouped
      ? new Intl.NumberFormat(moneyLocale(lang) === 'vi' ? 'vi-VN' : 'en-US').format(n)
      : decimals > 0 ? n.toFixed(1).replace(/\.0$/, '') : String(n)
  const clamp = (n: number) => Math.min(Math.max(n, range.min), range.max)
  const round = (n: number) => (decimals > 0 ? Math.round(n * 10) / 10 : Math.round(n))
  // ⚠️ BLUR MUST PARSE WHAT `display` WROTE, NOT RAW `Number()`. The box is seeded from
  // display(value) and blur re-reads that text even when nothing was typed. Under the old
  // en-US grouping Number('125,000') was NaN and onBlur restored the previous value — wrong,
  // but harmless. Under vi grouping Number('125.000') is 125, so tabbing THROUGH the mileage
  // field would have silently written 125 km onto the listing. Strip the separators first —
  // the same normalisation `onType` already applies to every keystroke. Dropping '.' is safe
  // because `grouped` is gated on `decimals === 0` above: there is no decimal here to lose.
  const clean = (raw: string) => (decimals > 0 ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, ''))

  // Local text mirrors what the user types; synced from `value` only when the input
  // isn't focused (so an external change — e.g. dragging the slider — updates it).
  const [text, setText] = useState(value == null ? '' : display(value))
  const focused = useRef(false)
  // ⚠️ `lang` IS A REAL DEPENDENCY, NOT NOISE — do not prune it. `display` now closes over the
  // language, so without it a box seeded as "125,000" keeps its English commas after the viewer
  // switches to Vietnamese, while every other number on the page flips to dots. Re-seeding is a
  // no-op for ungrouped ranges (toFixed/String ignore the locale) and never fights typing,
  // because the focus guard still holds.
  useEffect(() => { if (!focused.current) setText(value == null ? '' : display(value)) }, [value, lang])

  const onType = (raw: string) => {
    const cleaned = clean(raw)
    setText(cleaned)
    if (cleaned === '' || cleaned === '.') { onChange(null); return }
    const n = Number(cleaned)
    if (Number.isFinite(n)) onChange(round(n)) // commit unclamped so partial typing isn't fought
  }
  const onBlur = () => {
    focused.current = false
    if (text === '' || text === '.') { onChange(null); setText(''); return }
    const cleaned = clean(text)
    const n = cleaned === '' ? NaN : Number(cleaned)
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
