'use client'

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
export function PartnerBadge({ size = 'sm', className }: { size?: 'sm' | 'md'; className?: string }) {
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
      <Link
        href="/partners"
        prefetch={false}
        aria-label={`${full} — ${tr('how eno chooses partners', 'eno chọn đối tác thế nào')}`}
        className="inline-flex shrink-0 cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          {word}
        </span>
      </Link>
    </Tooltip>
  )
}
