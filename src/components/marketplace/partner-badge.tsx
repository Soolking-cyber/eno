'use client'
import * as React from 'react'

import Link from 'next/link'
import { Tooltip } from '@/components/ui/tooltip'
import { ShieldCheck } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * THE OFFICIAL-PARTNER BADGE — a worded gold pill that explains itself when tapped.
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
  // Short and precise, per the brief. The TOOLTIP and the link's accessible name carry the full
  // "Official partner" — the pill itself only has room for the noun, and a badge that wraps onto
  // two lines inside a card meta row is worse than a shorter word.
  const word = tr('Partner', 'Đối tác')
  // The full phrase, reused so the visible word and the announced name cannot drift apart.
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
        )}
      >
        {/* ⚠️ A PLAIN <span> WITH THE TRUST CHIP'S EXACT CLASS STRING, NOT <Badge>. Owner,
            2026-08-13: "height is still taller than other trust pills" — it measured 18.8px against
            the trust chip's ~16px even though both were given px-1.5 py-0.5 text-2xs leading-none.
            The cause is the trap CLAUDE.md names: `text-2xs` is a Tailwind text utility, so it sets
            font-size AND line-height, and whether it or `leading-none` wins is decided by
            STYLESHEET ORDER, not by which class was passed last. Through ui/badge the size class
            arrived from the variant and the override from the caller, and the line-height came out
            of the size. Copying trust-score.tsx's own string verbatim removes the question: the two
            chips are the same box because they are the same declaration, and any future drift shows
            up in one place. `.partner-fill` supplies the ground and the ink. */}
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none',
          'partner-fill',
          className,
        )}>
          {/* Solar's shield-check, the same family the trust chip uses for its seal. Deliberately
              NOT the eno seal: the seal means "eno verified this account", and a partnership is a
              commercial agreement rather than a verification outcome. */}
          {/* ⚠️ 11px, MATCHING trust-score.tsx's mini glyph EXACTLY (`width={11} height={11}`).
              This is the last pixel of the height match the owner asked for: at h-3 (12px) the
              glyph, not the text, set the box and the pill measured 16px against the trust chip's
              15px. The icon is the tallest child, so its size IS the chip's height. */}
          <ShieldCheck aria-hidden size={11} className="shrink-0" />
          {/* ⛔ THE WORD STAYS AT EVERY WIDTH, and hiding it below `sm` was tried and reverted.
              It would have bought 44px in the feed card's meta row — but the row's truncation was
              fixed by abbreviating the city instead (listing-card.tsx), and measuring showed that
              alone is enough: 0 of 12 rows truncate at 320px with this badge at its full 67px.
              ⛔ AND THE COST WOULD HAVE BEEN REAL: below `sm` is exactly where hover does not
              exist, so a bare shield's only remaining explanation is a tooltip that can never
              open. A reviewer named that; the measurement is what made it unnecessary to argue. */}
          {word}
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
