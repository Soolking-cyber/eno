'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { SITE_NAME } from '@/lib/edition'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SellerCard, type SellerCardSeller } from '@/components/marketplace/seller-card'
import type { SellerMetrics } from '@/lib/seller-metrics'
import { cn } from '@/lib/utils'
import { storeMember } from './store-pair'

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
  actions,
  presenceDue,
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
  /**
   * The page's own controls after Chat — Share and the ⋯ (SellerCard `actions`, owner 2026-11-16 hub Q21). They lead with Share,
   * Chat's partner: with them Chat is the pair's half, without them its own width (store-pair.ts `storeMember`).
   */
  actions?: React.ReactNode
  /** Presence will be drawn, decided by the page on the server (SellerCard `presenceDue`). */
  presenceDue?: boolean
}) {
  const router = useRouter()
  const crossHost = !!chatListingId && !!chatOrigin
  const card = (
    <SellerCard
      seller={seller}
      metrics={metrics}
      variant="storefront"
      listingCount={listingCount}
      presenceDue={presenceDue}
      onChat={chatListingId && !chatOrigin ? () => router.push(`/listings/${chatListingId}#contact`) : undefined}
      // On the shop's own host the row is drawn below, after the cross-host Chat link.
      actions={crossHost ? undefined : actions}
    />
  )
  if (!crossHost) return card
  return (
    // The same column and gap SellerCard gives its own CTA row (16px under the identity on a storefront's phone), so the two
    // hosts' headers line up.
    <div className="flex flex-col gap-3 max-sm:gap-4">
      {card}
      <div data-store-actions="" className="flex items-stretch gap-2">
        {/* ⚠️ The className sits on the BUTTON, not the <Link>: a class on an asChild child is
            concatenated, not merged (CLAUDE.md). Same shape as SellerCard's storefront CTA: with the page's
            Share beside it, the equal pair (store-pair.ts, owner 2026-11-16 hub Q21).
            ⛔ ITS LABEL MAY WRAP, ITS 12px SIDES MAY NOT (review, 2026-11-16): "Chat trên eno.vn" is the longest label any of the
            rows holds — below ~350px it takes two centred lines inside the pair's 12px (STORE_PAIR, measured there), and Share
            stands as tall beside it (`items-stretch`). This row has no ⋯ (no writes on the shop's own host). */}
        <Button variant="cta" size="none" className={cn('press gap-1.5 py-2.5', storeMember(!!actions))} asChild>
          <Link href={`${chatOrigin!.replace(/\/$/, '')}/listings/${chatListingId}#contact`}>
            <MessageCircle className="h-4 w-4" aria-hidden /> <Bilingual en="Chat on {site}" vi="Chat trên {site}" values={{ site: SITE_NAME }} />
            {/* Whose chat, for crawlers and screen readers: "Chat on eno.vn" alone was one anchor for six shops' listings
                (Seobility crawl 9, identical anchor text). */}
            <span className="sr-only"> — {seller.name}</span>
          </Link>
        </Button>
        {actions}
      </div>
    </div>
  )
}
