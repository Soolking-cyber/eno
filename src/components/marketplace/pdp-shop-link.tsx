'use client'

import Link from 'next/link'
import { ChevronRight, Building2, BadgeCheck } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TrustScore } from './trust-score'
import { RatingValue, CountValue } from './rating-value'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { lastSeenBucket } from '@/lib/last-seen'
import { useMounted } from '@/hooks/use-mounted'
import type { SellerMetrics } from '@/lib/seller-metrics'

/** Shopee "shop on top": the SINGLE seller surface on the PDP, sitting directly above the media.
 *  It carries the full seller identity + trust (name, Business badge, trust score, Joined · rating ·
 *  reviews) AND the "Shop >" jump to the storefront — so the old duplicate seller-card lower in the
 *  buy box is gone (its "Chat now" lives on in the ContactComposer). The whole strip is a div (not
 *  one anchor) so the trust chip and the Shop link can each be their own real link. */
export function PdpShopLink({ name, avatarColor, avatarUrl, isBusiness, businessVerified, href, metrics, className }: {
  name: string
  avatarColor?: string | null
  avatarUrl?: string | null
  isBusiness?: boolean
  businessVerified?: boolean
  href: string
  metrics: SellerMetrics
  className?: string
}) {
  const { tr } = useLanguage()
  const { responseBucket, lastSeenDay, memberSinceYear, reviewCount, rating, trustScore } = metrics

  // Presence, bucketed from the day-coarse date (the PDP is 30d-ISR, so a
  // server-baked label would freeze — client recompute only ever under-claims; see
  // src/lib/last-seen.ts). Rendered ONLY after mount: the bucket depends on the
  // client's clock, so baking it into SSR HTML risks a STRUCTURAL hydration mismatch
  // on a stale ISR serve (the span itself appears/disappears across the 1/7/30-day
  // boundaries — suppressHydrationWarning can't cover element topology; dual review
  // caught it). Two-pass render is the React-sanctioned shape for client-time values.
  const mounted = useMounted()
  const lastSeen = mounted ? lastSeenBucket(lastSeenDay) : { key: null as null, en: '', vi: '' }

  // Honest metrics strip — only signals that exist (never zero-filled), joined with middots.
  const strip: React.ReactNode[] = []
  if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  if (lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
  strip.push(tr(`Joined ${memberSinceYear}`, `Tham gia ${memberSinceYear}`))
  if (reviewCount > 0) {
    strip.push(
      <span key="reviews" className="inline-flex items-center gap-1">
        <RatingValue value={rating} />★ · <CountValue value={reviewCount} /> {tr('reviews', 'đánh giá')}
      </span>,
    )
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Avatar name={name} url={avatarUrl} color={avatarColor} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-bold text-foreground">{name}</span>
          {isBusiness && (
            businessVerified ? (
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
      <Link
        href={href}
        aria-label={tr('Visit shop', 'Vào gian hàng')}
        className="group flex shrink-0 items-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-secondary"
      >
        {tr('Shop', 'Gian hàng')}
        <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </Link>
    </div>
  )
}
