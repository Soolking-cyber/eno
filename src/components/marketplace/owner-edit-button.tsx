'use client'

import { useRouter } from 'next/navigation'
import { Pencil } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'

/**
 * EDIT — shown to a seller on their OWN listing, wherever they meet it.
 *
 * Owner, 2026-08-14: a seller browsing the marketplace or their own storefront should be able to
 * fix a price or a photo from the card, instead of navigating to the dashboard to find the same
 * listing again. So this rides beside Save on the card overlay and beside the heart on the product
 * page — the two places a listing already offers actions.
 *
 * ⚠️ OWNERSHIP IS `listing.sellerId === my sellerId`, AND BOTH SIDES ARE ALREADY PUBLIC. The
 * tempting comparison is the seller's `ownerId` against the session user id, which would mean
 * serialising an account UUID into every card payload on the site — a real identifier for a real
 * person, published to everyone, to decide whether one button renders. `sellerId` is a storefront
 * id that is already on every card, and the viewer learns only their OWN from `/api/me`. Nothing
 * new becomes public.
 *
 * ⛔ THIS IS AN AFFORDANCE, NOT A PERMISSION. `/listings/[id]/edit` re-proves ownership server-side
 * and must keep doing so — hiding a control is not authorisation, and anyone can type the URL.
 *
 * ⚠️ KNOWN GAP, ACCEPTED: A STOREFRONT CREATED MID-SESSION DOES NOT LIGHT THIS UP UNTIL A RELOAD.
 * auth-context fetches `/api/me` only when the Supabase `user` changes, and creating a Seller does
 * not change it — so a seller's very FIRST listing shows no Edit control until the next full page
 * load. Raised by external review (fable, 2026-08-14) and deliberately not fixed here: the fix is a
 * refresh signal wired into the post-wizard success path, and post-wizard.tsx is a landmine file
 * whose invariants are worth more than this convenience. Revisit if the owner reports it.
 *
 * ⚠️ GATED ON `identityLoaded`, NOT JUST ON `sellerId`. Null means both "no storefront" and "not
 * asked yet" (the ambiguity auth-context documents), so rendering on `sellerId` alone would pop the
 * button in a beat after hydration on every card the seller owns — visible movement on the feed for
 * a control most viewers never see. Waiting costs an owner nothing.
 */
export function OwnerEditButton({
  listingId,
  sellerId: listingSellerId,
  compact = false,
  dense = false,
  className,
}: {
  listingId: string
  /** The LISTING's storefront id — not the viewer's. */
  sellerId: string | null | undefined
  /** Icon-only, to sit in an over-media overlay beside Save. */
  compact?: boolean
  /**
   * ⛔ SET THIS IN THE CARD'S HOVER ROW. IT IS NOT A SIZE PREFERENCE — IT IS THE TAP-TARGET FIX.
   * The row is `gap-1` h-8 glyphs at ~36px pitch, and `IconButton` defaults `tapTarget` to TRUE,
   * which grows a 44px `::before`. On that pitch the pad OVERLAPS the neighbouring control, so a
   * click near the boundary fires the wrong action — the three siblings all pass
   * `tapTarget={false}` and say so in their own comment. Without this the pencil would sit a size
   * larger than its neighbours AND swallow the edge of Locate.
   */
  dense?: boolean
  className?: string
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  const { sellerId: mySellerId, identityLoaded } = useAuth()

  if (!identityLoaded || !mySellerId || !listingSellerId || mySellerId !== listingSellerId) return null

  const href = `/listings/${listingId}/edit`
  const label = tr('Edit listing', 'Sửa tin')

  /**
   * ⚠️ `stopPropagation` + `preventDefault` ARE LOAD-BEARING ON THE CARD. The whole card is wrapped
   * in an absolutely-positioned `<a data-card-link>` overlay, so a click here would otherwise
   * navigate to the listing instead of the editor — the same trap Save and Share already handle.
   */
  const go = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    hapticTap()
    router.push(href)
  }

  if (compact) {
    /**
     * ⚠️ `IconButton variant="overlay"` — THE SANCTIONED OVER-MEDIA LANGUAGE, not a hand-rolled
     * chip. save-listing-button.tsx states the rule in its own comment: white ink with a baked drop
     * shadow, and NO circle chip, because "a hover chip over a photo looks like a bug". The first
     * cut of this used `bg-black/35 rounded-full` and would have sat beside Save looking like a
     * different control from a different app.
     *
     * ⚠️ TWO SETS OF NEIGHBOURS, TWO GEOMETRIES — `dense` picks. On the PDP overlay the pencil
     * stands beside Share and Save, which are `size="md"` with the default 44px tap pad. In the
     * card's hover row it stands beside Chat/Offer/Locate, which are `size="sm"` with the pad
     * explicitly OFF. Matching the wrong set is visible (a glyph a size larger than its three
     * neighbours) and, worse, clickable where nothing is drawn. The icon stays `h-5 w-5` in both:
     * all five siblings use it, and `h-4` was simply my mistake.
     */
    return (
      <IconButton
        size={dense ? 'sm' : 'md'}
        variant="overlay"
        tapTarget={!dense}
        onClick={go}
        onMouseEnter={() => router.prefetch(href)}
        aria-label={label}
        title={label}
        className={cn(!dense && 'press', className)}
      >
        <Pencil className="h-5 w-5" aria-hidden />
      </IconButton>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={go}
      onMouseEnter={() => router.prefetch(href)}
      className={cn('gap-1.5', className)}
    >
      <Pencil className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  )
}
