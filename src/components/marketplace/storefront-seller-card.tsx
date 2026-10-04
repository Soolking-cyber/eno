'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { SITE_NAME } from '@/lib/edition'
import { Bilingual } from '@/components/marketplace/bilingual'
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
  chatOrigin,
  listingCount,
}: {
  seller: SellerCardSeller
  metrics: SellerMetrics
  chatListingId: string | null
  /**
   * Set on a shop's OWN HOST (`<handle>.eno.vn`): the chat becomes a plain link to the listing on this
   * canonical origin instead of an in-app push (B3-STORE, inbox-05). The session cookie is scoped to the
   * canonical host and every write is pinned there (proxy.ts), so a chat started under the shop's host
   * could only 403 — the visitor has to cross to the app to talk, and the label says so.
   */
  chatOrigin?: string
  listingCount?: number
}) {
  const router = useRouter()
  const card = (
    <SellerCard
      seller={seller}
      metrics={metrics}
      variant="storefront"
      listingCount={listingCount}
      onChat={chatListingId && !chatOrigin ? () => router.push(`/listings/${chatListingId}#contact`) : undefined}
    />
  )
  if (!chatListingId || !chatOrigin) return card
  return (
    // The same column and gap SellerCard gives its own CTA row, so the two hosts' headers line up.
    <div className="flex flex-col gap-3">
      {card}
      <div className="flex items-center gap-2">
        {/* ⚠️ The className sits on the BUTTON, not the <Link>: a class on an asChild child is
            concatenated, not merged (CLAUDE.md). Same shape as SellerCard's storefront CTA. */}
        <Button variant="cta" size="none" className="press gap-1.5 px-8 py-2.5" asChild>
          <Link href={`${chatOrigin.replace(/\/$/, '')}/listings/${chatListingId}#contact`}>
            <MessageCircle className="h-4 w-4" aria-hidden /> <Bilingual en="Chat on {site}" vi="Chat trên {site}" values={{ site: SITE_NAME }} />
          </Link>
        </Button>
      </div>
    </div>
  )
}
