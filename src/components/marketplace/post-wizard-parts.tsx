'use client'

// Presentational pieces of the PostWizard, moved out verbatim to keep post-wizard.tsx focused
// on flow/state. All pure (props in, JSX out), hoisted to module scope so React keeps stable
// component identity across the wizard's frequent re-renders (a keystroke must not remount
// these subtrees). No behaviour change from the in-file versions.

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

export function Field({ id, label, counter, hint, error, children }: { id?: string; label: string; counter?: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        {counter && <span className="text-2xs text-ink-4">{counter}</span>}
      </div>
      {children}
      {error ? <p role="alert" className="text-xs font-semibold text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
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
      <div className="relative aspect-[10/11] w-full overflow-hidden rounded-xl bg-tint">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
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
