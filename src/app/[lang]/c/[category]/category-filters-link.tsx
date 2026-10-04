'use client'

import Link from 'next/link'
import { SlidersHorizontal } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'

/**
 * /c/<category>'s way into the explorer's facets, at the end of its sort strip (SellerListings
 * `stripEnd`). The strip sorts in place now; this is what is left of the page's old dead end — the
 * filters (price, area, condition, brand) live in the explorer, one tap away, already scoped.
 *
 * ⚠️ rel="nofollow" AND prefetch={false}: `/?category=` is canonicalised to `/`, so a followed link
 * spends crawl on a URL Google is told to drop, and a prefetch would render the whole explorer for
 * every visitor who merely scrolls past the strip (wave-B addendum, 2026-09-28).
 * ⚠️ A CLIENT LEAF because the label follows the visitor's language on the client, like the tabs
 * beside it; the pair is facet-bar.tsx's own, so it adds no copy.
 * ⚠️ IN THE READER'S LANGUAGE: a Vietnamese page links the `/vi` twin, never the English-pinned `/`
 * (A1-LANG, disc-10). `query` carries the landing's own scope beside the category — the district hub's
 * `district`, and `homes=1` while the page lists homes only (rental-homes.ts HOMES_ONLY_PARAM). Empty
 * values are dropped.
 * ⚠️ THE EXPLORER HONOURS `district` BUT NOT `homes` — DEFERRED TO B1. readExplorerUrl
 * (src/lib/explorer-url.ts) has no homes axis, so a homes-only page's link still opens every rental of
 * its category/district there; only /api/listings reads `homes`. The param rides along anyway: it is the
 * page's true scope, harmless where it is ignored, and right the day B1 teaches the explorer to read it.
 */
export function CategoryFiltersLink({ slug, query }: { slug: string; query?: Record<string, string> }) {
  const { tr, lang } = useLanguage()
  const params = new URLSearchParams({ category: slug })
  for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v)
  return (
    <Link
      href={localizedHref(`/?${params.toString()}`, variantOfLanguage(lang))}
      rel="nofollow"
      prefetch={false}
      className="relative tap-44 inline-flex items-center gap-1.5 whitespace-nowrap py-2.5 text-sm font-semibold text-accent-foreground hover:underline"
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      {tr('Filters', 'Bộ lọc')}
    </Link>
  )
}
