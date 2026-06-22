'use client'

import { useLanguage } from '@/context/language-context'
import { groupVnd, parseVnd, vndWords } from '@/lib/vnd'
import { cn } from '@/lib/utils'

type Preset = { label: string; value: number }

const CAP = 999_000_000_000 // 999 tỷ — guards the ×unit chips from absurd results
const chip = 'rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-tint disabled:hover:text-body cursor-pointer'

/**
 * VND amount input. VND has many zeros (12.000.000), so typing is made fast:
 * live dot-grouping as you type, ×1,000 / ×1,000,000 unit multipliers
 * (type "12" → tap "×1,000,000" → 12,000,000), optional preset chips, and a
 * "= 12 triệu đồng" readability helper. Emits a digits-only string.
 */
export function VndInput({
  value, onChange, presets, placeholder, autoFocus, id, className,
}: {
  value: string
  onChange: (digits: string) => void
  presets?: Preset[]
  placeholder?: string
  autoFocus?: boolean
  id?: string
  className?: string
}) {
  const { lang, tr } = useLanguage()
  const digits = (value || '').replace(/\D/g, '')
  const n = parseVnd(digits)

  const set = (d: number | string) => onChange(String(d).replace(/\D/g, ''))
  const mul = (factor: number) => { if (n > 0) set(Math.min(n * factor, CAP)) }

  return (
    <div className={className}>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoFocus={autoFocus}
          value={groupVnd(digits)}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder ?? '0'}
          className="w-full rounded-xl border border-line-strong bg-card py-2.5 pl-3.5 pr-14 text-lg font-bold tabular-nums text-foreground outline-none transition-colors focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-4">VND</span>
      </div>

      {/* Readability helper — reserves its line so the chips don't jump */}
      <p className={cn('mt-1 h-4 text-xs font-semibold', n > 0 ? 'text-accent-foreground' : 'text-transparent')}>
        = {vndWords(n, lang) || '—'}
      </p>

      {/* Fast-entry chips */}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => mul(1_000)} disabled={!digits} className={chip}>×1,000</button>
        <button type="button" onClick={() => mul(1_000_000)} disabled={!digits} className={chip}>×1,000,000</button>
        {(presets ?? []).map((p) => (
          <button type="button" key={p.label} onClick={() => set(p.value)} className={chip}>{p.label}</button>
        ))}
        {digits ? <button type="button" onClick={() => set('')} className={cn(chip, 'text-ink-4')}>{tr('Clear', 'Xóa')}</button> : null}
      </div>
    </div>
  )
}
