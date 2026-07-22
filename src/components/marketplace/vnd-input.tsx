'use client'

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupVnd, parseVnd, vndWords, moneyLocale } from '@/lib/vnd'
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
  value, onChange, presets, placeholder, autoFocus, id, className, invalid,
  'aria-label': ariaLabel, 'aria-describedby': describedBy,
}: {
  value: string
  onChange: (digits: string) => void
  presets?: Preset[]
  placeholder?: string
  autoFocus?: boolean
  id?: string
  className?: string
  invalid?: boolean
  /** VndInput renders a <div>, so it is NOT a labelable control and cannot sit in a <FieldControl>.
   *  Its inner <input> therefore has no way to acquire a name or a reason on its own — these two
   *  props are how the caller supplies them by hand. Without them the price field announces as
   *  "invalid, blank edit field": no name, no reason, on the one control that blocks every publish. */
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // grouping follows the viewer's language (vi: dots)
  const digits = (value || '').replace(/\D/g, '')
  const n = parseVnd(digits)

  const set = (d: number | string) => onChange(String(d).replace(/\D/g, ''))
  const mul = (factor: number) => { if (n > 0) set(Math.min(n * factor, CAP)) }

  // FOCUS-HOLD for the helper chips. Same invariant as the chat send button (see
  // messages/[id]/page.tsx + CLAUDE.md): a tap that lets the browser move focus to the
  // chip BLURS the amount field, so iOS tears the numeric keyboard down — the user taps
  // "×1.000.000" mid-entry and has to re-tap the field to keep typing, and the layout
  // reflow slides the next chip out from under their finger. preventDefault on MOUSEDOWN
  // suppresses the focus transfer while leaving `click` intact.
  // ⚠️ onMouseDown, NEVER onPointerDown — pointerdown fires before the browser has decided
  // focus and preventing it does not hold the field. That distinction is the invariant.
  // Keyboard users are unaffected: Tab still focuses the chips, Enter/Space still activate
  // them (both go through keydown, not mousedown).
  const holdFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className={className}>
      <div className="relative">
        <Input
          id={id}
          variant="filled"
          inputMode="numeric"
          autoFocus={autoFocus}
          value={groupVnd(digits, locale)}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder ?? '0'}
          // `invalid` used to paint the red ring and NOTHING else: the field LOOKED invalid and
          // REPORTED valid, so a screen-reader user was never told the price was rejected. The ring
          // is for the sighted; aria-invalid is for everyone else. Both, or neither.
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          // pr-14 is LOAD-BEARING: it reserves the room for the "VND" suffix span
          // below — without it the digits run under the suffix.
          className={cn('py-2.5 pl-3.5 pr-14 text-lg font-bold tabular-nums focus:ring-brand/20', invalid && 'ring-2 ring-destructive/60')}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-4">VND</span>
      </div>

      {/* Readability helper — reserves its line so the chips don't jump */}
      <p className={cn('mt-1 h-4 text-xs font-semibold', n > 0 ? 'text-accent-foreground' : 'text-transparent')}>
        = {vndWords(n, lang) || '—'}
      </p>

      {/* Fast-entry chips */}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000)} disabled={!digits} className={chip}>×{groupVnd('1000', locale)}</Button>
        <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000_000)} disabled={!digits} className={chip}>×{groupVnd('1000000', locale)}</Button>
        {/* tỷ / billion — completes the VN unit ladder (nghìn → triệu → tỷ) so cars,
            property and other big-ticket VND amounts are one tap (type "3" → 3 tỷ). */}
        <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000_000_000)} disabled={!digits} className={chip}>×{groupVnd('1000000000', locale)}</Button>
        {(presets ?? []).map((p) => (
          <Button type="button" variant="ghost" size="none" key={p.label} onMouseDown={holdFocus} onClick={() => set(p.value)} className={chip}>{p.label}</Button>
        ))}
        {digits ? <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => set('')} className={cn(chip, 'text-ink-4')}>{tr('Clear', 'Xóa')}</Button> : null}
      </div>
    </div>
  )
}
