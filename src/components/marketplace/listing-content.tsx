'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { timeAgo } from '@/lib/types'

/**
 * Client-side localized listing title — mirrors the card: Vietnamese uses the
 * hand-authored titleVi, every other language machine-translates the source title
 * (from the warm cache). Lets the listing page be statically/ISR-rendered (no
 * per-request server translation) while still showing in-language content.
 */
export function LocalizedTitle({ title, titleVi }: { title: string; titleVi: string | null }) {
  const { lang } = useLanguage()
  return <>{useTr(lang === 'vi' ? titleVi || title : title)}</>
}

/** Relative "x ago" in the active language (client — keeps the page cacheable). */
export function PostedAgo({ iso }: { iso: string }) {
  const { lang } = useLanguage()
  return <>{timeAgo(iso, lang)}</>
}
