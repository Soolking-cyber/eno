'use client'

import { SellerCard, type SellerCardSeller } from './seller-card'
import type { SellerMetrics } from '@/lib/seller-metrics'

/**
 * PDP-side client wrapper for the shared <SellerCard>. The listing page is a
 * server component and can't hand a function to a client component, so the
 * "Chat now" action lives here: it scrolls the existing #contact composer into
 * view, prefills the opener via the same 'eno:prefill-contact' event the sticky
 * mobile bar uses, then focuses the textarea — one shared contact path, no
 * duplicate compose logic.
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
    const el = document.getElementById('contact')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.dispatchEvent(new Event('eno:prefill-contact'))
    window.setTimeout(() => el.querySelector('textarea')?.focus({ preventScroll: true }), 350)
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
