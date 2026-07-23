'use client'

import Link from 'next/link'
import { MessageCircle, Store, Building2, BadgeCheck } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { TrustScore } from '@/components/marketplace/trust-score'
import { RatingValue, CountValue } from '@/components/marketplace/rating-value'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { lastSeenBucket } from '@/lib/last-seen'
import { useMounted } from '@/hooks/use-mounted'
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
  /** The verified-business badge (server-computed isBusinessVerified). Optional so
   *  older serializers that don't send it degrade to the plain "Business" label. */
  businessVerified?: boolean
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
  const { responseBucket, lastSeenDay, memberSinceYear, reviewCount, rating, trustScore } = metrics

  // Presence, bucketed from the day-coarse date (never a raw timestamp) — computed
  // client-side so a stale ISR PDP can only under-claim, and rendered only AFTER
  // mount so the leaf can't structurally mismatch server HTML across a bucket
  // boundary (see use-mounted.ts + src/lib/last-seen.ts).
  const mounted = useMounted()
  const lastSeen = mounted ? lastSeenBucket(lastSeenDay) : { key: null as null, en: '', vi: '' }

  // Metrics strip leaves — build only the ones that exist, join with middots.
  const strip: React.ReactNode[] = []
  if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  if (lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
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
        <Avatar name={seller.name} url={seller.avatarUrl} color={seller.avatarColor} size="lg" />
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
              seller.businessVerified ? (
                <Badge variant="success" className="px-1.5 py-0.5 font-semibold">
                  <BadgeCheck className="h-3 w-3" /> {tr('Business verified', 'Doanh nghiệp đã xác minh')}
                </Badge>
              ) : (
                <Badge variant="neutral" className="px-1.5 py-0.5 font-semibold text-accent-foreground">
                  <Building2 className="h-3 w-3" /> {tr('Business', 'Doanh nghiệp')}
                </Badge>
              )
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
            <Button
              type="button"
              variant="cta"
              size="none"
              onClick={onChat}
              // `active:scale-100` dropped (2026-07-21). It was added when this button was
              // migrated from a raw <button className="press …"> to ui/button, to stop the
              // primitive's `active:scale-[0.97]` compounding with .press's own shrink — a real
              // problem back when .press wrote `transform` (an independent property, so the two
              // MULTIPLIED to 0.931). .press now writes `scale` from @layer components, so the
              // button's 0.97 simply wins and there is nothing left to cancel; the class would
              // now genuinely suppress the press feel on this CTA instead of being a no-op.
              //
              // flex-1 only on the PDP, where it splits the row with "View shop". On the
              // storefront the button is ALONE — flex-1 stretched it edge to edge (owner
              // 2026-07-23: "chat button too long"); content width + padding reads right.
              className={cn('press gap-1.5 py-2.5', variant === 'pdp' ? 'flex-1' : 'px-8')}
            >
              <MessageCircle className="h-4 w-4" /> {tr('Chat now', 'Chat ngay')}
            </Button>
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
