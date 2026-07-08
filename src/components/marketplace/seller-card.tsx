'use client'

import Link from 'next/link'
import { MessageCircle, Store, Building2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { TrustScore } from '@/components/marketplace/trust-score'
import { RatingValue, CountValue } from '@/components/marketplace/rating-value'
import { getInitials } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { SellerMetrics } from '@/lib/seller-metrics'

// Only the identity fields SellerCard needs — kept structural so BOTH the PDP
// (serialized seller) and the storefront (raw Seller row) satisfy it. Every trust
// signal (score/tier/rating/reviews/response) rides in via the `metrics` bundle so
// the raw responseRate number never reaches this client component.
export type SellerCardSeller = {
  id: string
  name: string
  avatarColor: string
  avatarUrl?: string | null
  isBusiness: boolean
}

export type SellerCardProps = {
  seller: SellerCardSeller
  metrics: SellerMetrics
  /** 'pdp' = compact block in the listing sticky column (default); 'storefront' =
   *  header on the seller's own page (no "View shop" link back to itself). */
  variant?: 'pdp' | 'storefront'
  /** Primary "Chat now" action. When omitted the primary button is hidden. */
  onChat?: () => void
  /** "View shop" destination — pdp only; ignored on the storefront variant. */
  storefrontHref?: string
  /** Optional "{N} listings" strip item (e.g. the storefront's active count). */
  listingCount?: number
  className?: string
}

/**
 * Shared seller identity + trust card. Reused by the PDP sticky column and the
 * storefront header. Renders a decomposed, honest metrics strip: only signals that
 * actually exist show (never zero-filled) — response bucket is already suppressed
 * upstream (responseBucket → key:null) when there's no track record.
 */
export function SellerCard({
  seller,
  metrics,
  variant = 'pdp',
  onChat,
  storefrontHref,
  listingCount,
  className,
}: SellerCardProps) {
  const { tr } = useLanguage()
  const initials = getInitials(seller.name)
  const { responseBucket, memberSinceYear, reviewCount, rating, trustScore } = metrics

  // Metrics strip leaves — build only the ones that exist, join with middots.
  const strip: React.ReactNode[] = []
  if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  strip.push(tr(`Joined ${memberSinceYear}`, `Tham gia ${memberSinceYear}`))
  if (reviewCount > 0) {
    strip.push(
      <span key="reviews" className="inline-flex items-center gap-1">
        <RatingValue value={rating} />★ · <CountValue value={reviewCount} />{' '}
        {tr('reviews', 'đánh giá')}
      </span>,
    )
  }
  if (typeof listingCount === 'number' && listingCount > 0) {
    strip.push(
      <span key="listings">
        <CountValue value={listingCount} /> {tr('listings', 'tin đăng')}
      </span>,
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        {seller.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seller.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
            style={{ backgroundColor: seller.avatarColor || '#0a66c2' }}
          >
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* On the storefront this IS the page's main heading (the listing title owns
                the PDP's <h1>), so it must be an <h1> and read as a title, not 14px body —
                a real SEO/a11y heading on the public /{handle} shop page. */}
            {variant === 'storefront' ? (
              <h1 className="truncate text-lg font-bold text-foreground">{seller.name}</h1>
            ) : (
              <span className="truncate text-sm font-bold text-foreground">{seller.name}</span>
            )}
            {seller.isBusiness && (
              <span className="inline-flex items-center gap-1 rounded-full bg-tint px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                <Building2 className="h-3 w-3" /> {tr('Business', 'Doanh nghiệp')}
              </span>
            )}
            <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" />
          </div>
          {strip.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              {strip.map((node, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-border">·</span>}
                  {node}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {(onChat || (variant === 'pdp' && storefrontHref)) && (
        <div className="flex items-center gap-2">
          {onChat && (
            <button
              type="button"
              onClick={onChat}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark cursor-pointer"
            >
              <MessageCircle className="h-4 w-4" /> {tr('Chat now', 'Chat ngay')}
            </button>
          )}
          {variant === 'pdp' && storefrontHref && (
            <Link
              href={storefrontHref}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
            >
              <Store className="h-4 w-4" /> {tr('View shop', 'Xem shop')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
