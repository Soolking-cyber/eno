'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { groupVnd, moneyLocale } from '@/lib/vnd'
import type { Field, FieldError } from '@/lib/rent-tools/calc'

/**
 * The rent tools' form fields: a real <label> for every control (never a placeholder for one), the error under its field
 * and wired to it (`aria-describedby`, `aria-invalid`), and an amount regrouped on blur ("15tr" → "15,000,000") so the
 * reader sees how it was read.
 * ⛔ A FIELD'S ERROR IS SHOWN ONLY ONCE THE READER HAS LEFT IT, AND HIDDEN AGAIN WHILE THEY EDIT IT (gate round 2): shown
 * on every keystroke, "8" then "85" each announced "add a unit" (the error is role="alert") before the "tr" was typed.
 * `useFieldPhase` keeps that state; a fresh page is never a wall of red, and nothing is announced mid-typing.
 */
export function useFieldPhase() {
  const [phase, setPhase] = useState<Record<string, 'editing' | 'left'>>({})
  return {
    /** Has the reader left this field (and not come back to it)? Only then is its error printed. */
    shown: (id: string) => phase[id] === 'left',
    onEnter: (id: string) => () => setPhase((s) => ({ ...s, [id]: 'editing' })),
    onLeave: (id: string) => () => setPhase((s) => ({ ...s, [id]: 'left' })),
  }
}

export function useFieldErrors() {
  const { tr } = useLanguage()
  return (e: FieldError, kind: 'money' | 'months'): string => {
    switch (e) {
      case 'empty': return kind === 'money' ? tr('Enter an amount.', 'Hãy nhập số tiền.') : tr('Enter a number of months.', 'Hãy nhập số tháng.')
      case 'zero': return kind === 'money' ? tr('Enter an amount above 0.', 'Hãy nhập số tiền lớn hơn 0.') : tr('Enter at least 1 month.', 'Hãy nhập ít nhất 1 tháng.')
      case 'negative': return tr('This cannot be negative.', 'Không thể là số âm.')
      case 'tooLarge': return tr('That is too large to be right. Check the number of zeros.', 'Số này quá lớn. Hãy kiểm tra lại số chữ số 0.')
      case 'noUnit': return tr('Add a unit (500k, 15tr) or write the full amount (500000).', 'Thêm đơn vị (500k, 15tr) hoặc ghi đủ số (500000).')
      case 'ambiguous': return tr('This can be read two ways. Write the full amount, e.g. 15500000.', 'Số này có thể hiểu theo hai cách. Hãy ghi đủ số, ví dụ 15500000.')
      case 'notWhole': return kind === 'months' ? tr('Use whole months (or halves for a deposit).', 'Dùng số tháng tròn (tiền cọc có thể là nửa tháng).') : tr('Enter a whole amount.', 'Hãy nhập số tròn.')
      default: return kind === 'money' ? tr('Enter an amount in đồng, e.g. 15000000 or 15tr.', 'Nhập số tiền bằng đồng, ví dụ 15000000 hoặc 15tr.') : tr('Enter a number of months, e.g. 1 or 2.', 'Nhập số tháng, ví dụ 1 hoặc 2.')
    }
  }
}

/**
 * What the result area says while there is no result: the tool's own "enter …" line when the first field that does not
 * read is simply empty (`empty`: only the tool's key fields count as that); the name of that field once its error is
 * shown; and while it is still being typed, a neutral line — never "enter the rent" beside a rent that is already there,
 * and never a field's error before the field's own line says it. `fields` in form order.
 */
export function useWaitingLine() {
  const { tr } = useLanguage()
  return (enterLine: string, fields: readonly { label: string; read: Field<number>; empty: boolean; shown: boolean }[]): string => {
    const first = fields.find((f) => !f.read.ok)
    if (!first || first.empty) return enterLine
    if (!first.shown) return tr('The result appears once every figure reads.', 'Kết quả sẽ hiện khi mọi ô đều hợp lệ.')
    const en = 'Check “{field}” to see the result.'
    return fillBilingual(tr('Check “{field}” to see the result.', 'Hãy kiểm tra ô “{field}” để xem kết quả.'), en, { field: first.label })
  }
}

type Props = {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  /** The field as read; `shown` (useFieldPhase) decides whether its error is printed yet. */
  read: Field<number>
  shown: boolean
  onEnter: () => void
  onLeave: () => void
  hint?: string
}

function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-bold leading-5 text-foreground">{label}</Label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-t-meta text-body">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-t-meta text-destructive" role="alert">{error}</p>}
    </div>
  )
}

/** A read amount written back into its field: grouped, with its "đ" when the figure alone would be refused (under 1.000). */
export function regroup(value: number, locale: 'en' | 'vi'): string {
  const grouped = groupVnd(String(value), locale)
  return value < 1000 ? `${grouped} đ` : grouped
}

export function MoneyField({ id, label, value, onChange, read, shown, onEnter, onLeave, hint }: Props) {
  const { lang } = useLanguage()
  const message = useFieldErrors()
  const error = shown && !read.ok ? message(read.error, 'money') : null
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <Input
          id={id}
          type="text"
          // ⛔ "text", NOT "numeric" (gate round 2): iOS gives "numeric" a digits-only pad, and the shorthand the page
          // advertises (15tr, 500k, 1,5 tỷ) cannot be typed on it.
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onEnter}
          onBlur={() => {
            // Regroup what was read, so "15tr" visibly becomes 15,000,000 (15.000.000 in Vietnamese). ⛔ Under 1.000 the "đ"
            // stays: a bare "500" has no unit and is refused, so "500đ" must not become "500" on the way out of the field.
            if (read.ok && read.value > 0) onChange(regroup(read.value, moneyLocale(lang)))
            onLeave()
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className="pr-10 text-base"
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base text-muted-foreground">đ</span>
      </div>
    </FieldShell>
  )
}

export function MonthsField({ id, label, value, onChange, read, shown, onEnter, onLeave, hint, halves }: Props & { halves?: boolean }) {
  const message = useFieldErrors()
  const error = shown && !read.ok ? message(read.error, 'months') : null
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        type="text"
        inputMode={halves ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onEnter}
        onBlur={onLeave}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="text-base"
      />
    </FieldShell>
  )
}

/** The result area: announced politely as it changes, a tint well like the formula's. */
export function ResultWell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl bg-tint px-4 py-4" aria-live="polite">
      {children}
    </div>
  )
}
