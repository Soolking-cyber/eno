'use client'

import { Building2 } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

/**
 * "VERIFIED" — the business badge, and the ONLY business badge.
 *
 * ⛔ THERE IS NO LONGER AN UNVERIFIED "Business" CHIP ANYWHERE. Owner, 2026-08-17: "dont show
 * business badge anywhere if businesses are not verified, similar to partner badge but business
 * icon with verified text". The old neutral chip reported the account TYPE — a thing the seller
 * chose at signup and nobody checked — in the same row, at the same size, as claims eno actually
 * verified. A reader cannot be expected to know that one of two grey-green pills means "we checked
 * a document" and the other means "they ticked a box". So the unverified case now shows NOTHING,
 * which is the one-badge rule the storefront already followed (owner, 2026-07-23): a badge means
 * eno checked something, or there is no badge.
 *
 * ⚠️ ONE COMPONENT BECAUSE THE COPY MUST NOT DRIFT. seller-card.tsx and pdp-shop-link.tsx each had
 * their own copy of this chip, and both carried a comment telling the next person to "keep the two
 * files in step" — an instruction that only works until someone does not read it. They now render
 * the same component, so there is nothing to keep in step.
 *
 * ⚠️ THE SHORT WORD IS THE VISIBLE ONE, THE FULL PHRASE IS THE ANNOUNCED ONE — the same split
 * PartnerBadge uses, for the same reason: the pill has room for a word, and a badge that wraps onto
 * two lines inside a card meta row is worse than a shorter one. The tooltip and the accessible name
 * both carry "Business verified", so nothing is lost to a screen reader or to page text.
 *
 * ⚠️ A PLAIN <span> WITH THE TRUST CHIP'S EXACT CLASS STRING, NOT <Badge> — copied deliberately
 * from partner-badge.tsx, which records why: `text-2xs` sets font-size AND line-height, and whether
 * it or `leading-none` wins is decided by STYLESHEET ORDER, so routing this through ui/badge's
 * size variant made the pill measurably taller than the trust chip beside it. Same declaration,
 * same box.
 */
export function BusinessVerifiedBadge({ className }: { className?: string }) {
  const { tr } = useLanguage()
  const word = tr('Verified', 'Đã xác minh')
  const full = tr('Business verified', 'Doanh nghiệp đã xác minh')
  return (
    <Tooltip
      content={tr('Business verified — eno checked this seller’s documents', 'Doanh nghiệp đã xác minh — eno đã kiểm tra giấy tờ')}
      side="top"
    >
      <span
        /**
         * ⛔ `role="img"` IS LOAD-BEARING, NOT DECORATION — without it this badge announced
         * NOTHING. `aria-label` is ignored on a GENERIC element (ARIA 1.2 accessible-name
         * computation), and both children here are `aria-hidden`, so the computed name was the
         * empty string: a screen reader would have skipped the verification status entirely.
         * Reviewer-caught, and it would have been a regression on the badge it replaced rather
         * than a redesign of it. `role="img"` makes the element name-able, so the full phrase
         * lands and the icon+word are read as one thing instead of two fragments.
         */
        role="img"
        aria-label={full}
        /**
         * ⚠️ FOCUSABLE SO THE EXPLANATION IS REACHABLE WITHOUT A POINTER. A tooltip on a
         * non-focusable element can only be opened by hover, which excludes keyboard users
         * entirely — PartnerBadge avoids this by being a <Link>, which is focusable for free;
         * this badge links nowhere, so it has to say so itself.
         */
        tabIndex={0}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          // The tokens ui/badge's own `success` variant uses — not invented shades, so this
          // pill tracks the theme (and dark mode) with every other success surface.
          'bg-success/15 text-success',
          className,
        )}
      >
        {/* ⚠️ 11px, matching trust-score.tsx's mini glyph and PartnerBadge exactly — the icon is the
            tallest child, so its size IS the chip's height, and h-3 (12px) makes this pill one pixel
            taller than the trust chip next to it. */}
        <Building2 aria-hidden size={11} className="shrink-0" />
        <span aria-hidden>{word}</span>
      </span>
    </Tooltip>
  )
}
