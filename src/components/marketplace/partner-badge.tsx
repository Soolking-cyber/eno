'use client'
import * as React from 'react'

import Link from 'next/link'
import { Tooltip } from '@/components/ui/tooltip'
import { UI_ART } from '@/generated/icon-paths'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * THE OFFICIAL-PARTNER BADGE — a shield + "P" plate in partner green that explains itself when tapped.
 * (Since 2026-09-14; the history below is of the worded pill it replaced — see the plate comment.)
 *
 * Owner, 2026-08-13: "official partner badge with gold outline similar to trust badge, short
 * precise partner in white inside golden pill and when clicked similar to trust explanation".
 *
 * ⚠️ THIS REINSTATES A BADGE THAT WAS DELIBERATELY REMOVED, AND THE REASON IT WAS REMOVED IS
 * ANSWERED RATHER THAN IGNORED. On 2026-08-11 the worded chip was dropped in favour of the gold
 * avatar ring, because a third chip in a row that already carries trust + business was noise. The
 * ring then had two problems its own comment in seller-card.tsx records: it carries no accessible
 * name, and gold-vs-grey is exactly the distinction a colour-blind reader cannot make — so the
 * status survived only as `sr-only` text. A word solves both, and the ring stays: the ring is the
 * glance, the pill is the claim, and the pill is now also the door to the explanation.
 *
 * ⚠️ IT IS A LINK, LIKE THE TRUST BADGE, NOT A DIALOG. `TrustScore` takes an `href` and says in
 * its own comment "tapping any trust badge explains the system" — /partners is the same move for
 * the same reason. A dialog cannot be linked to from an email, indexed, or opened in a new tab,
 * and this page is exactly the kind of thing a suspicious buyer wants to read in full before
 * trusting a storefront.
 *
 * ⚠️ prefetch={false}, and the trust badge documents why: this renders once per seller card in a
 * feed, so auto-prefetch would warm the same explainer once per visible card. It is a footnote
 * link, not a primary route.
 */
/**
 * ⛔ `asLink={false}` INSIDE A LISTING CARD, AND IT IS NOT OPTIONAL THERE. As a link this chip is
 * 67x15px — a third of the 44px minimum — so once it sits ABOVE the card's stretched anchor (which
 * it must, or it is unreachable at all), a thumb aimed at the card and landing on the chip navigates
 * to /partners instead of the listing. That trades an unreachable link for an accidental trap in
 * the middle of every partner card, which is the worse of the two. A reviewer caught me making
 * exactly that trade. In a card the chip is a plain <span>: no tap target, no tab stop, and the
 * card behaves the way every other pixel of it behaves. The tooltip and the accessible name stay.
 * Standalone surfaces (the partner page, the PDP shop link, the seller card) keep the link, where
 * it has room and nothing is competing for the tap.
 */
export function PartnerBadge({ size = 'sm', className, asLink = true }: { size?: 'sm' | 'md'; className?: string; asLink?: boolean }) {
  const { tr } = useLanguage()
  // The full phrase is the accessible name and the tooltip; the plate itself shows only "P".
  const full = tr('Official partner', 'Đối tác chính thức')
  return (
    /* ⚠️ NO "tap to find out" IN THE TOOLTIP. A tooltip does not open on touch, so the one
       instruction aimed at touch users is the one they can never read; on desktop it says out
       loud what a cursor already shows. The hint names the thing instead. */
    <Tooltip content={tr('Official partner — chosen and checked by eno', 'Đối tác chính thức — do eno chọn và thẩm định')} side="top">
      <LinkOrSpan
        asLink={asLink}
        /* ⚠️ role="img" ON THE SPAN BRANCH, BECAUSE ARIA FORBIDS NAMING A GENERIC ROLE. A bare
           <span aria-label> may be ignored outright, leaving only the visible "Partner" — half the
           phrase. `img` is the role for a graphical composite that reads as one thing, accepts an
           accessible name, and hides the inner glyph and word from being announced separately.
           The LINK branch needs none of this: a link is nameable by definition. */
        {...(asLink ? {} : { role: 'img' as const })}
        aria-label={asLink ? `${full} — ${tr('how eno chooses partners', 'eno chọn đối tác thế nào')}` : full}
        /* ⛔ relative + z-[1], OR THIS LINK IS UNREACHABLE INSIDE A CARD. <ListingCard> stretches
           its own anchor across the whole tile (`absolute inset-0 z-0`), and a STATIC element cannot
           sit above a positioned one whatever its z-index — so elementFromPoint at this badge's
           centre returned the card's /listings/… link, and tapping "official partner" opened the
           listing. Measured on the live feed: a 67x15 <a href="/partners">, position static,
           z-index auto, covered on every card that has one. The save button already escapes the
           same way with z-10; z-[1] is enough to clear a z-0 sibling and stays under it. */
        /* ⚠️ NO relative/z-index HERE ANY MORE. A z-escape was briefly added so this link could be
           tapped above a card's `absolute inset-0 z-0` anchor — but the card renders the SPAN
           variant now, so no remaining call site sits under a stretched link, and leaving the
           escape in would silently change stacking on the three surfaces that never needed it. */
        className={cn(
          'inline-flex shrink-0 rounded-full',
          asLink && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          // ⚠️ `-m-[4.5px] p-[4.5px]` ON THE LINK: the plate is 15px tall, under the 24px minimum as a tap target
          // (codex). 4.5px a side makes it exactly 24px tall and the negative margin gives the space
          // back, so nothing moves. The link branch only renders standalone (shop link, seller card,
          // /partners) and partner REPLACES the trust chip, so the grown box has no neighbouring target.
          // Not an absolute hit-area pseudo-element: that needs `relative`, which the note above forbids.
          asLink && '-m-[4.5px] p-[4.5px]',
        )}
      >
        {/* ⚠️ A GLYPH + "P" ON A TRANSLUCENT PLATE — THE TRUST CHIP'S OWN SHAPE. Owner, 2026-09-14: "semitransparent
            plates similar to heart icons plate on product cards but with their respective subtle coloring. also have
            letter P only for partner badge", then the same day: "partner badge should have an icon next to it similar
            to trust badge". So the box is the trust chip's exact class string (px-1.5 py-0.5 text-2xs leading-none,
            an 11px glyph setting the 15px height) — the two sit on one line at one height because they are the same
            declaration, the fix the owner asked for on 2026-08-13 when a separately-sized pill measured taller.
            ⛔ THE SAME SHIELD AS THE TRUST CHIP, NOT A HANDSHAKE (owner, 2026-09-14: "just have the same shield icon for
            partners not the waving one"). A handshake shipped for a few hours in 67802694; the owner prefers one mark
            across both badges, told apart by the partner green and the "P" where the trust chip has a number.
            This reverses the 2026-08-13 rule that the word "Partner" stays at every width — the owner's call. The full
            "Official partner" is still the accessible name (role=img / the link's label) and the tooltip.
            ⚠️ THE SAME `.badge-plate` AS THE TRUST CHIP, tinted and inked with the partner green; the contrast
            measurements are on that rule in globals.css. */}
        <span
          className={cn(
            'badge-plate inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none',
            className,
          )}
          style={{ '--plate-tint': 'var(--partner-ink)', '--plate-ink': 'var(--partner-ink)' } as React.CSSProperties}
        >
          {/* The trust chip's exact glyph — Solar shield-verified at 11px, painted the same way (trust-score.tsx mini). */}
          <svg width={11} height={11} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
            {UI_ART['shield-verified'].rest.map((p, i) => (
              <path key={i} d={p.d} fill="currentColor" fillRule={p.evenOdd ? 'evenodd' : undefined} clipRule={p.evenOdd ? 'evenodd' : undefined} />
            ))}
          </svg>
          {/* Through tr() like every visible string (react/jsx-no-literals). "P" in both languages is the
              owner's letter; the Vietnamese side is where an "Đ" would go if that is ever asked for. */}
          {tr('P', 'P')}
        </span>
      </LinkOrSpan>
    </Tooltip>
  )
}

/**
 * A <Link> or a <span>, one prop apart. Written as a component rather than a ternary at the call
 * site so the chip, the tooltip wiring and the accessible name are declared exactly once — the two
 * branches cannot drift into two different badges.
 */
const LinkOrSpan = React.forwardRef<HTMLElement, { asLink: boolean; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>>(
  /* ⛔ forwardRef IS LOAD-BEARING, NOT BOILERPLATE. <Tooltip> attaches a ref to its child to
     position the popup against it; a plain function component swallows that ref, and the tooltip
     would render against nothing. It fails silently — no type error, no console warning, just a
     popup in the wrong place — which is why a reviewer had to catch it rather than a gate. */
  function LinkOrSpan({ asLink, className, children, ...rest }, ref) {
    if (!asLink) return <span ref={ref as React.Ref<HTMLSpanElement>} className={className} {...rest}>{children}</span>
    return <Link ref={ref as React.Ref<HTMLAnchorElement>} href="/partners" prefetch={false} className={className} {...rest}>{children}</Link>
  },
)
