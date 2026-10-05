'use client'

import { useState } from 'react'
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

/** Two letters for a school with no logo tile: an acronym keeps its own ("ILA Vietnam" → IL), else initials. */
function monogram(name: string): string {
  const words = name.replace(/^the\s+/i, '').split(/[\s\-–—&/]+/).filter((w) => /[A-Za-zÀ-ỹ0-9]/.test(w))
  const first = words[0] ?? '?'
  return (/^[A-Z0-9]{2,}$/.test(first.replace(/[^A-Za-z0-9]/g, '')) || words.length < 2 ? first.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').slice(0, 2) : first[0] + words[1][0]).toUpperCase()
}

/** One 2:1 box per size, shared by the logo and the monogram so a row lines up either way. */
const TILE = {
  sm: 'h-8 w-16 rounded-lg text-xs',
  md: 'h-10 w-20 rounded-lg text-sm sm:h-12 sm:w-24 sm:rounded-xl',
  lg: 'h-16 w-32 rounded-xl text-xl sm:h-20 sm:w-40 sm:rounded-2xl',
} as const
const SIZES = { sm: '64px', md: '(min-width: 640px) 96px, 80px', lg: '(min-width: 640px) 160px, 128px' } as const

/**
 * The school's own logo (owner, 2026-10-05: "add official logos of all these education centers and
 * schools"), captured from its own website by scripts/harvest-school-logos.mjs and turned into a 2:1 tile
 * by scripts/build-school-logos.mjs. The tile carries its own background, so it is drawn whole (object-cover)
 * and a white wordmark made for a dark header stays legible. It sits beside the school's name, which is the
 * accessible label, so the image itself is decorative. No tile (`logo` null): the two-letter monogram.
 */
export function SchoolLogo({ slug, logo, name, kind, size = 'md' }: { slug: string; logo: string | null; name: string; kind: SchoolKind; size?: keyof typeof TILE }) {
  // A tile that fails to load — taken down after this HTML was cached, or a network error — shows the
  // monogram, never an empty ringed box (diff review). `complete && naturalWidth === 0` catches a failure
  // that happened before hydration, when onError was not attached yet. ⚠️ Safe for lazy images too, and
  // measured, not assumed (2026-10-05, Chromium, WebKit and Firefox): a lazy image that has not loaded yet
  // reports complete=false, and complete with naturalWidth 0 appears only after a real failure — so no
  // row below the fold is ever turned into a monogram by this check.
  const [broken, setBroken] = useState(false)
  if (!logo || broken) {
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 select-none items-center justify-center font-bold tracking-tight', TILE[size], KIND_TONE[kind])}>
        {monogram(name)}
      </span>
    )
  }
  // A plain <img>: fixed-size stamped tiles from our own origin in the two widths 2x/3x screens need, so
  // next/image would only add a proxy hop.
  const base = `/schools/logos/${slug}`
  return (
    <img
      ref={(el) => { if (el?.complete && el.naturalWidth === 0) setBroken(true) }}
      onError={() => setBroken(true)}
      src={`${base}.webp?v=${logo}`}
      srcSet={`${base}.webp?v=${logo} 240w, ${base}-2x.webp?v=${logo} 480w`}
      sizes={SIZES[size]}
      width={240}
      height={120}
      alt=""
      loading={size === 'lg' ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('shrink-0 bg-card object-cover ring-1 ring-border', TILE[size])}
    />
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
