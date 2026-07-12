'use client'

import Link from 'next/link'
import { Star, BadgeCheck } from 'lucide-react'
import { useLanguage, Tr } from '@/context/language-context'
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
    <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold text-foreground">
        {tr('Buyer reviews', 'Đánh giá về người bán')}
        <span className="text-muted-foreground">({total})</span>
        <span className="ml-1 inline-flex items-center gap-0.5 text-body">
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
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
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-tint px-1.5 py-0.5 text-2xs font-medium text-accent-foreground">
                    <BadgeCheck className="h-3 w-3" aria-hidden />
                    {tr('Verified buyer', 'Đã mua')}
                  </span>
                )}
              </div>
              {/* User content — machine-translated into the viewer's language like the
                  storefront reviews (Tr handles arbitrary strings, not just UI copy). */}
              <p className="mt-0.5 line-clamp-3 text-sm text-body"><Tr text={r.text} /></p>
            </div>
          </li>
        ))}
      </ul>

      <Link
        href={sellerHref}
        className="mt-3 inline-block text-sm font-semibold text-accent-foreground hover:underline"
      >
        {tr('See all', 'Xem tất cả')}
      </Link>
    </section>
  )
}
