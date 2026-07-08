'use client'

import { SellerCard, type SellerCardSeller } from './seller-card'
import type { SellerMetrics } from '@/lib/seller-metrics'

/**
 * PDP-side client wrapper for the shared <SellerCard>. The listing page is a
 * server component and can't hand a function to a client component, so the
 * "Chat now" action lives here: it fires the same 'eno:chat-now' event the sticky
 * mobile bar uses, and the #contact composer sends the canned opener + jumps to
 * the thread — one shared contact path, no duplicate compose logic.
 */
export function PdpSellerCard({
  seller,
  metrics,
  storefrontHref,
}: {
  seller: SellerCardSeller
  metrics: SellerMetrics
  storefrontHref: string
}) {
  const onChat = () => {
    // Composer owns the send: fires the opener + redirects to the live thread.
    window.dispatchEvent(new Event('eno:chat-now'))
  }

  return (
    <SellerCard
      variant="pdp"
      seller={seller}
      metrics={metrics}
      onChat={onChat}
      storefrontHref={storefrontHref}
    />
  )
}
