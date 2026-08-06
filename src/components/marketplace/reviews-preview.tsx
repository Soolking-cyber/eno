'use client'

import Link from 'next/link'
import { Star, ChevronRight } from 'lucide-react'
import { EnoSeal } from './eno-seal'
import { useLanguage, Tr } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { getInitials } from '@/lib/utils'
import { RatingValue } from './rating-value'
import type { SellerReviewPreview } from '@/lib/seller-metrics'

/**
 * Compact reviews block for the PDP seller area. Shows the seller-level average +
 * total and up to two verified-first review snippets, then links to the full
 * storefront. Renders NOTHING when there are no reviews (no empty state).
 */
export function ReviewsPreview({
  reviews,
  total,
  avg,
  sellerHref,
}: {
  reviews: SellerReviewPreview[]
  total: number
  avg: number
  sellerHref: string
}) {
  const { tr } = useLanguage()
  if (total === 0 || reviews.length === 0) return null

  return (
    // No outer margin: the PDP wrapper owns this block's spacing (hairline + pt), so a
    // margin here double-counted against the buy-box column's gap.
    <section>
      {/* Shared PDP section-header treatment (text-lg font-semibold); the count + rating
          drop to text-sm so the heading word carries the weight, aligned on the baseline. */}
      <h2 className="mb-3 flex items-baseline gap-1.5 text-lg font-semibold text-foreground">
        {tr('Buyer reviews', 'Đánh giá về người bán')}
        <span className="text-sm font-medium text-muted-foreground">({total})</span>
        {/* self-center: an inline-flex box's baseline comes from its FIRST item — the star SVG,
            whose "baseline" is its bottom edge — so baseline-aligning this chip lifts the number
            off the heading's baseline. Optically centering the icon+number pair is the stable way. */}
        <span className="ml-1 inline-flex items-center gap-0.5 self-center text-sm font-medium text-body">
          <Star className="h-4 w-4 fill-rating text-rating" aria-hidden />
          <RatingValue value={avg} />
        </span>
      </h2>

      <ul className="space-y-3">
        {reviews.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-body">
              {getInitials(r.author)}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-foreground">{r.author}</span>
                {r.verified && (
                  <Badge
                    variant="neutral"
                    size="sm"
                    className="gap-0.5 px-1.5 font-medium text-accent-foreground"
                  >
                    <EnoSeal aria-hidden className="h-3 w-3" />
                    {tr('Verified buyer', 'Đã mua')}
                  </Badge>
                )}
              </div>
              {/* User content — machine-translated into the viewer's language like the
                  storefront reviews (Tr handles arbitrary strings, not just UI copy). */}
              <p className="mt-0.5 line-clamp-3 text-sm text-body"><Tr text={r.text} /></p>
            </div>
          </li>
        ))}
      </ul>

      {/* Same See-all shape as the Shelf rails (label + chevron) — one idiom across the PDP. */}
      <Link
        href={sellerHref}
        className="mt-3 inline-flex items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline"
      >
        {tr('See all', 'Xem tất cả')}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  )
}
