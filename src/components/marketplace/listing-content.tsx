'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { detectContentLang } from '@/lib/detect-lang'

/**
 * Client-side localized listing title — mirrors the card: Vietnamese uses the
 * hand-authored titleVi, every other language machine-translates the source title
 * (from the warm cache). Lets the listing page be statically/ISR-rendered (no
 * per-request server translation) while still showing in-language content.
 */
export function LocalizedTitle({ title, titleVi }: { title: string; titleVi: string | null }) {
  const { lang } = useLanguage()
  const out = useTr(lang === 'vi' ? titleVi || title : title)
  // Tag the title's language when it differs from the page so a screen reader
  // voices it correctly (WCAG 3.1.2). Never mislabels — see detectContentLang.
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}

/** Relative "x ago" in the active language (client — keeps the page cacheable). */
export function PostedAgo({ iso }: { iso: string }) {
  const { lang } = useLanguage()
  return <>{timeAgo(iso, lang)}</>
}
