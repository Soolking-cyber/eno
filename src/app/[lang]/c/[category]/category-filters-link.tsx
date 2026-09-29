'use client'

import Link from 'next/link'
import { SlidersHorizontal } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'

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
 */
export function CategoryFiltersLink({ slug }: { slug: string }) {
  const { tr } = useLanguage()
  return (
    <Link
      href={`/?category=${encodeURIComponent(slug)}`}
      rel="nofollow"
      prefetch={false}
      className="relative tap-44 inline-flex items-center gap-1.5 whitespace-nowrap py-2.5 text-sm font-semibold text-accent-foreground hover:underline"
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      {tr('Filters', 'Bộ lọc')}
    </Link>
  )
}
