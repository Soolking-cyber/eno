'use client'

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { X } from '@/components/ui/icons'
import { groupVnd, parseVnd, vndWords, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'

type Preset = { label: string; value: number }

const CAP = 999_000_000_000 // 999 tỷ — guards the ×unit chips from absurd results
// `relative tap-44`: 24px drawn, 44px hit (10px each way). ⚠️ Paired with the row's `gap-y-5` below —
// the chips WRAP in the post wizard's max-w-xs price column, and at the old 6px row gap each row's
// 10px reach overlapped the other's by 14px, so the lower chip (later in the DOM, painted on top)
// stole taps from the bottom of the one above. 20px lets the two reaches meet without crossing.
const chip = 'relative rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-tint disabled:hover:text-body cursor-pointer tap-44'

/**
 * VND amount input. VND has many zeros (12.000.000), so typing is made fast:
 * live dot-grouping as you type, ×1,000 / ×1,000,000 unit multipliers
 * (type "12" → tap "×1,000,000" → 12,000,000), optional preset chips, and a
 * "= 12 triệu đồng" readability helper. Emits a digits-only string.
 */
export function VndInput({
  value, onChange, presets, placeholder, autoFocus, id, className, invalid, unit,
  maxFactor = 1_000_000_000,
  'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-required': ariaRequired,
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
  /** Same reason as the two above: the caller is the only one who knows the amount is required. */
  'aria-required'?: boolean
  /**
   * The largest unit chip. ×1.000.000.000 (tỷ) completes the ladder for cars and property, and is
   * one mistap from a 1,000× price on a phone case — so a caller that knows the category can stop
   * the ladder at triệu. Defaults to the full ladder (mark-sold-sheet keeps it).
   */
  maxFactor?: 1_000_000 | 1_000_000_000
  /**
   * The period the amount is quoted per, already translated ('/ tháng', '/ ngày'…), shown INSIDE the
   * field right after the "đ". It used to sit beside this whole component in the caller's flex row,
   * which centred it on the input + helper line + chip row together — about 45px below the digits.
   */
  unit?: string
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
  // The period is DRAWN inside the field, and a drawing is not announced: its span gets an id derived
  // from the field's own (no useId — this component stays hook-free apart from useLanguage, its tests
  // call it as a plain function) and joins aria-describedby, so a screen reader hears "/ ngày" too.
  const unitId = unit && id ? `${id}-unit` : undefined
  const describedByAll = [describedBy, unitId].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <div className="relative" data-vnd-field="">
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
          aria-describedby={describedByAll}
          aria-required={ariaRequired || undefined}
          // pr-20 / pr-32 are LOAD-BEARING: they reserve the room for the Clear button AND the "đ"
          // suffix (plus the period, when there is one) — without it the digits run under them.
          className={cn('py-2.5 pl-3.5 text-lg font-bold tabular-nums focus:ring-brand/20', unit ? 'pr-32' : 'pr-20', invalid && 'ring-2 ring-destructive/60')}
        />
        {/* The right-hand adornments, laid out as ONE row so a longer suffix ("đ / tháng") pushes
            Clear left instead of running under it. pointer-events-none so a tap on the suffix still
            lands in the input; Clear opts back in. */}
        <div className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center gap-3">
          {/* Clear lives IN the field, like every search box: as a fourth chip it wrapped the unit row
              onto a second line in the wizard's narrow price column. Same focus-hold as the chips. */}
          {digits ? (
            <IconButton
              size="xs"
              type="button"
              aria-label={tr('Clear price', 'Xoá giá')}
              onMouseDown={holdFocus}
              // Focus goes BACK to the field: this button unmounts the moment the amount is empty, so a
              // keyboard user who pressed it would otherwise be dropped onto <body>. Found through the
              // DOM, not a ref — the component stays hook-free apart from useLanguage (its tests call
              // it as a plain function, with a bare event: hence the optional call).
              onClick={(e) => { const field = e.currentTarget.closest?.('[data-vnd-field]')?.querySelector('input'); set(''); field?.focus() }}
              className="pointer-events-auto text-ink-4 transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
          <span className="flex items-baseline gap-1 text-sm font-bold text-ink-4"><span>đ</span>{unit ? <span id={unitId} className="font-semibold">{unit}</span> : null}</span>
        </div>
      </div>

      {/* Readability helper — reserves its line so the chips don't jump */}
      <p className={cn('mt-1 h-4 text-xs font-semibold', n > 0 ? 'text-accent-foreground' : 'text-transparent')}>
        = {vndWords(n, lang) || '—'}
      </p>

      {/* Fast-entry chips */}
      <div className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-5">
        <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000)} disabled={!digits} className={chip}>×{groupVnd('1000', locale)}</Button>
        <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000_000)} disabled={!digits} className={chip}>×{groupVnd('1000000', locale)}</Button>
        {/* tỷ / billion — completes the VN unit ladder (nghìn → triệu → tỷ) so cars,
            property and other big-ticket VND amounts are one tap (type "3" → 3 tỷ). Only where
            the caller allows it (`maxFactor`). Disabled-until-typed stays: hiding the chips until
            a digit lands would push everything below down on the first keystroke. */}
        {maxFactor === 1_000_000_000 && (
          <Button type="button" variant="ghost" size="none" onMouseDown={holdFocus} onClick={() => mul(1_000_000_000)} disabled={!digits} className={chip}>×{groupVnd('1000000000', locale)}</Button>
        )}
        {(presets ?? []).map((p) => (
          <Button type="button" variant="ghost" size="none" key={p.label} onMouseDown={holdFocus} onClick={() => set(p.value)} className={chip}>{p.label}</Button>
        ))}
      </div>
    </div>
  )
}
