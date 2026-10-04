'use client'

import { useLanguage } from '@/context/language-context'
import { formatInteger, formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { KIND_LABEL, type SchoolKind } from '@/lib/schools/constants'
import type { PublicPay } from '@/lib/schools/queries'

/**
 * A "% recommend" figure needs this many votes (diff review): one down-vote would otherwise print
 * "0% recommend" in red on a business's page. Below it the row says how many votes there are.
 */
export const PCT_MIN_VOTES = 5

/** Token colours per kind — no raw hex (design canon). */
const KIND_TONE: Record<SchoolKind, string> = {
  language_centre: 'bg-brand-50 text-brand dark:bg-brand/20',
  international_school: 'bg-success/10 text-success',
  bilingual_school: 'bg-accent text-accent-foreground',
  agency: 'bg-warning/10 text-warning',
  university: 'bg-muted text-foreground',
}

/** Two-letter monogram. No logos: a school's mark is its trademark, and the directory never copies one. */
export function SchoolMonogram({ name, kind, size = 'md' }: { name: string; kind: SchoolKind; size?: 'md' | 'lg' }) {
  const words = name.replace(/^the\s+/i, '').split(/[\s\-–—&/]+/).filter((w) => /[A-Za-zÀ-ỹ0-9]/.test(w))
  // An acronym name keeps its own letters ("ILA Vietnam" → IL, "RMIT University" → RM), else initials.
  const first = words[0] ?? '?'
  const letters = (/^[A-Z0-9]{2,}$/.test(first.replace(/[^A-Za-z0-9]/g, '')) || words.length < 2 ? first.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').slice(0, 2) : first[0] + words[1][0]).toUpperCase()
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-2xl font-bold tracking-tight',
        size === 'lg' ? 'size-16 text-xl' : 'size-11 text-sm',
        KIND_TONE[kind],
      )}
    >
      {letters}
    </span>
  )
}

export function KindLabel({ kind }: { kind: SchoolKind }) {
  const { tr } = useLanguage()
  return <>{tr(KIND_LABEL[kind].en, KIND_LABEL[kind].vi)}</>
}

/** "400,000–500,000 đ / hour" for a shown range; nothing for a hidden one. */
export function PayRange({ s, className }: { s: PublicPay; className?: string }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  const per = s.period === 'hour' ? tr('/ hour', '/ giờ') : tr('/ month', '/ tháng')
  return (
    <span className={className}>
      {formatInteger(s.lo, loc)}–{formatMoneyFull(s.hi, '₫', loc)} {per}
    </span>
  )
}
