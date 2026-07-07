'use client'

import { useRouter } from 'next/navigation'
import { SellerCard, type SellerCardSeller } from '@/components/marketplace/seller-card'
import type { SellerMetrics } from '@/lib/seller-metrics'

/**
 * Client boundary for the storefront header. The storefront body is a server
 * component, so it can't hand SellerCard an onChat callback directly — this thin
 * wrapper supplies it. "Chat" reuses the EXISTING quick-chat mechanism: navigate
 * to the seller's newest active listing PDP with #contact, which the listing's
 * ContactComposer already reacts to (scroll into view + prefill the opener +
 * focus). No new seller-scoped conversation kind is invented.
 *
 * When the seller has no active listing to anchor to, chatListingId is null and
 * the primary button is simply omitted.
 */
export function StorefrontSellerCard({
  seller,
  metrics,
  chatListingId,
  listingCount,
}: {
  seller: SellerCardSeller
  metrics: SellerMetrics
  chatListingId: string | null
  listingCount?: number
}) {
  const router = useRouter()
  return (
    <SellerCard
      seller={seller}
      metrics={metrics}
      variant="storefront"
      listingCount={listingCount}
      onChat={chatListingId ? () => router.push(`/listings/${chatListingId}#contact`) : undefined}
    />
  )
}
