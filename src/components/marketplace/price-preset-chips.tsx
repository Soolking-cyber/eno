'use client'

import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Shopee-style one-tap budget buckets (VND, in the explorer's "min-max" string
// semantics — '' end = open-ended, 'all' = full range). Shared by the facet-bar
// price popover AND the mobile filter drawer so the two never drift. Recognizable
// fixed brackets (not derived quartiles) so the labels stay familiar.
const PRESETS: { key: string; min: number; max: number }[] = [
  { key: 'p1', min: 0, max: 500_000 },
  { key: 'p2', min: 500_000, max: 2_000_000 },
  { key: 'p3', min: 2_000_000, max: 10_000_000 },
  { key: 'p4', min: 10_000_000, max: Infinity },
]

/** One-tap price preset chips. Routes through the SAME `onChange` the manual min–max
 *  inputs use. Pass `bounds` (the histogram [min,max]) to hide presets that fall
 *  entirely outside the available data so no chip is a dead end. */
export function PricePresetChips({
  value,
  onChange,
  bounds,
  className,
}: {
  value: string
  onChange: (v: string) => void
  bounds?: [number, number]
  className?: string
}) {
  const { tr } = useLanguage()
  const label: Record<string, string> = {
    p1: tr('<500k', '<500k'),
    p2: tr('500k–2M', '500k–2tr'),
    p3: tr('2–10M', '2–10tr'),
    p4: tr('>10M', '>10tr'),
  }
  const active = value !== 'all' && value !== ''
  const apply = (min: number, max: number) => {
    const mn = min > 0 ? String(min) : ''
    const mx = Number.isFinite(max) ? String(max) : ''
    onChange(!mn && !mx ? 'all' : `${mn}-${mx}`)
  }
  const isOn = (min: number, max: number) => {
    if (!active) return false
    const [a, b] = value.split('-')
    const curMin = a ? Number(a) : 0
    const curMax = b ? Number(b) : Infinity
    return curMin === min && curMax === (Number.isFinite(max) ? max : Infinity)
  }
  const shown = bounds
    ? PRESETS.filter((p) => p.min < bounds[1] && (Number.isFinite(p.max) ? p.max : Infinity) > bounds[0])
    : PRESETS

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {shown.map((p) => {
        const on = isOn(p.min, p.max)
        return (
          <Button
            key={p.key}
            type="button"
            variant="bare"
            size="none"
            onClick={() => apply(p.min, p.max)}
            // TOGGLES, not a radio group: a valid "none applied" state exists (value 'all'/'' , or a
            // custom min–max the manual inputs land between two brackets), so this is not a
            // one-is-always-chosen radiogroup — each chip is independently applied-or-not. aria-pressed
            // is the honest role; without it the `on` paint was invisible to a screen reader.
            aria-pressed={on}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer',
              on ? 'border-accent-foreground/40 bg-tint text-accent-foreground' : 'border-border text-body hover:bg-muted',
            )}
          >
            {label[p.key]}
          </Button>
        )
      })}
    </div>
  )
}
