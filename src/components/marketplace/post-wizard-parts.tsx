'use client'

// Presentational pieces of the PostWizard, moved out verbatim to keep post-wizard.tsx focused
// on flow/state. All pure (props in, JSX out), hoisted to module scope so React keeps stable
// component identity across the wizard's frequent re-renders (a keystroke must not remount
// these subtrees). No behaviour change from the in-file versions.

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Field as UiField,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@/components/ui/field'
import { useLanguage } from '@/context/language-context'
import { CategoryIcon } from './category-icons'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

export function PublishButton({
  className,
  onSubmit,
  canSubmit,
  submitting,
  edit,
  missingCount,
  t,
}: {
  className?: string
  onSubmit: () => void
  canSubmit: boolean
  submitting: boolean
  edit: boolean
  missingCount: number
  t: (vi: string, en: string) => string
}) {
  return (
    <Button variant="cta" size="none"
      onClick={onSubmit}
      // NOT disabled when fields are missing — a click then reveals what's left
      // (disabled submit hides the reason). Only blocked mid-submit. `canSubmit`
      // still drives the label ("N left" vs "Publish").
      disabled={submitting}
      aria-disabled={!canSubmit}
      className={cn('w-full rounded-xl px-7 py-3 text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer', !canSubmit && !submitting && 'opacity-70', className)}
    >
      {submitting
        ? (edit ? t('Đang lưu…', 'Saving…') : t('Đang đăng…', 'Posting…'))
        : missingCount
        ? t(`Còn ${missingCount} mục`, `${missingCount} left to finish`)
        : (edit ? t('Lưu thay đổi', 'Save changes') : t('Đăng tin', 'Publish listing'))}
    </Button>
  )
}

export function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <div>
        <h2 className="h-section text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** The wizard's field wrapper — the label/hint/error frame every step reuses.
 *
 *  ## What it used to be, and why that was the worst bug in the form
 *  A `<div>` with a bare `<label>` that had no `htmlFor` and wrapped nothing. A dangling label
 *  names NOTHING: title, description, brand, model, condition, contact name and phone all
 *  rendered a visible label that assistive tech could not connect to any input. The `id` prop
 *  landed on the WRAPPER, so it couldn't rescue the association either, and no control ever
 *  reported `aria-invalid` — the red text sat beside a field that still announced as valid.
 *
 *  Now it is `ui/field` (Base UI `Field.Root`): the label registers itself with the control, the
 *  hint and the error register as descriptions, and `invalid` sets `aria-invalid`. The call sites
 *  keep the same props — they only have to pass their control through `<FieldControl render={…}>`
 *  so Field knows which element to bind to.
 *
 *  ⚠️ Hint and error now render TOGETHER (they used to be a ternary — one XOR the other). Base UI
 *  merges both ids into a single `aria-describedby`, and the phone field genuinely wants both
 *  ("buyers never see it until you reply" AND "add a valid number").
 *
 *  ⚠️ `group` — Base UI's `Field.Control` needs a LABELABLE element (input/textarea/select). The
 *  chip grids, the sale/rent toggle and `RangeSpecInput` are none of those, so a `Field.Label`
 *  there would dangle exactly like the old one. Those pass `group` and get the same wiring by
 *  hand on a `role="group"`: `aria-labelledby` → the label, `aria-invalid`, `aria-describedby` →
 *  the hint + error. Same contract, no lie about being an input.
 *
 *  ⚠️ `id` lands on the WRAPPER (it always did). `scrollToMissing()` in post-wizard.tsx looks up
 *  `pw-description` / `pw-condition` / `pw-details` as SCROLL anchors, so that must not move. The
 *  one id that has to be on the control itself is `pw-title` — it is passed to `<FieldControl>`
 *  there, not to this wrapper.
 */
export function Field({ id, label, counter, hint, error, group, children }: { id?: string; label: string; counter?: string; hint?: string; error?: string; group?: boolean; children: React.ReactNode }) {
  const uid = useId()
  const labelId = `${uid}-label`
  const hintId = `${uid}-hint`
  const errorId = `${uid}-error`

  if (group) {
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
    return (
      <div id={id} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span id={labelId} className="text-sm font-semibold text-foreground">{label}</span>
          {counter && <span className="text-2xs text-ink-4">{counter}</span>}
        </div>
        {/* aria-invalid is not a supported prop on role="group" (jsx-a11y/role-supports-aria-props),
            and screen readers ignore it there — the error reaches AT via aria-describedby → the
            role="alert" message below. */}
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {children}
        </div>
        {hint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
        {/* Nothing focuses a chip grid on a failed publish, so the message is announced
            (role="alert") as well as being the group's description. */}
        {error && <p id={errorId} role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <UiField id={id} invalid={!!error}>
      <div className="flex items-center justify-between">
        <FieldLabel className="font-semibold">{label}</FieldLabel>
        {counter && <span className="text-2xs text-ink-4">{counter}</span>}
      </div>
      {children}
      {hint && <FieldDescription className="text-muted-foreground">{hint}</FieldDescription>}
      {/* FieldError has match={true} baked in — it renders whenever the CALLER says so.
          Never render it unconditionally: this app validates in React state, not native
          validity, so an always-mounted error would show an empty description. */}
      {error && <FieldError className="font-semibold">{error}</FieldError>}
    </UiField>
  )
}

export function Chips({ options, value, onPick }: { options: { value: string; label: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          variant="bare"
          size="none"
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
          className={cn('rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', value === o.value ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}

export function Preview({ cover, title, price, priceUnit, area, categoryIcon, t }: { cover?: string; title: string; price: string; priceUnit: string; area: string; categoryIcon?: string; t: (vi: string, en: string) => string }) {
  const { lang } = useLanguage() // preview price mirrors what buyers in this language will see
  return (
    <div className="w-full">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-tint">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CategoryIcon name={categoryIcon || ''} className="h-8 w-8 text-ink-4" />
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground">{title || t('Tiêu đề tin của bạn', 'Your listing title')}</h3>
      <p className="mt-0.5 text-sm font-bold text-foreground">
        {price ? formatMoneyFull(Number(price), '₫', moneyLocale(lang)) : t('Giá', 'Price')}{price && priceUnit ? <span className="font-normal text-ink-4"> {priceUnit}</span> : null}
      </p>
      {area && <p className="text-xs text-muted-foreground">{area}</p>}
    </div>
  )
}
